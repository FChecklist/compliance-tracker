// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20). Twenty (already
// rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith) evaluated and
// rejected as software. Deliberately narrow -- a lead-to-client pipeline,
// not a generic sales CRM (no campaigns/quotes/email marketing, none
// needed for a compliance-service-provider's business). Gated identically
// to the existing Clients page (accountType !== 'company') at the UI
// layer, matching that page's own precedent.
import { crmLeads, crmOpportunities, crmStageHistory, crmPipelineStages, crmLostReasons, crmSalesTargets, crmActivities, clients, erpCustomers, tasks, users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, inArray, sql, lte, isNotNull, isNull, ne } from "drizzle-orm"
import { buildPipelineDeals } from "./sales-pipeline-dashboard-service"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { recordTaskEscalationEdge } from "@/lib/task-dependency-graph"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { ServiceError, serviceErrorBody } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
import { explainCrmLeadDecision, explainCrmOpportunityDecision } from "@/lib/explainability/ai-decision-explanation"
export { ServiceError, serviceErrorBody }

// Sales Pipeline closure (2026-08-07): actorRole is optional and additive --
// every pre-existing call site (createLead, bulkReassignLeads, etc.) keeps
// working unchanged. Only updateOpportunity() reads it, to decide whether a
// caller is allowed to move a deal OUT of a closed (won/lost) stage --
// see isValidStageTransition() below.
//
// role (below, merged from the separate own-record-or-manager RBAC closure
// landed on main the same window) is a second, independently-optional field
// -- only the create/update entry points below (the ones reachable from the
// native /api/crm/leads* and /api/crm/opportunities* routes, which always
// authenticate via requireAuth() and so always have a real dbUser.role)
// enforce it. Every other function in this file (scoring, analysis,
// follow-up-task chaining, convert-to-client, the v1/projexa bulk-reassign
// aliases which already gate at manager rank via requireRoleOrScope() at the
// route layer) is unaffected by this field. Deliberately not unified into
// one field: actorRole is typed UserRole (stage-transition rank lookup),
// role is a plain string (RBAC gate functions below); merging them would
// widen either type unnecessarily.
export type CrmContext = { orgId: string; userId: string; actorRole?: UserRole; role?: string }

// Gap found via a fresh audit immediately before this wave: crm-accounts-
// service.ts got a real owner-or-manager RBAC gate in Wave 4 (17 Jul 2026,
// canEditAccount/canReassignOrDeleteAccount/canCreateCrmRecord below) but
// crm_leads/crm_opportunities -- the sibling tables one wave earlier -- never
// did. Today any authenticated org member, including viewer/client_viewer/
// external_auditor rank, can create/edit any lead or opportunity and can
// silently reassign ownership via a plain PATCH { ownerId } with zero rank
// check at all through the native CRM UI's own routes. Same shape as
// crm-accounts-service.ts's gates, applied to the sibling tables (see that
// file's own header for why this wasn't factored into one shared utility
// yet -- no such utility exists in this codebase as of this wave either).
const MANAGER_RANK = ROLE_RANK.manager // 3 -- manager/senior_professional/branch_manager/admin/veridian_admin
const MEMBER_RANK = ROLE_RANK.member // 2 -- member/team_member and above (i.e. not viewer/client_viewer/external_auditor)

export type AccessGateResult = { ok: true } | { ok: false; reason: string }

/**
 * Who may edit an existing lead's own fields (status, source, next-action,
 * etc.) -- everything EXCEPT reassigning ownership, see
 * canReassignOrDeleteLead below for that higher bar. A rep (member rank or
 * above) may edit a lead they own, or an unowned lead; manager rank and
 * above may edit any lead regardless of owner.
 */
export function canEditLead(actorRole: string, leadOwnerId: string | null, actorId: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MEMBER_RANK) return { ok: false, reason: "This action requires member role or higher" }
  if (actorRank >= MANAGER_RANK) return { ok: true }
  if (leadOwnerId === null || leadOwnerId === actorId) return { ok: true }
  return { ok: false, reason: "Only this lead's owner or a manager can make this change" }
}

/** Reassigning a lead's owner is a team-lead-level action regardless of who currently owns it -- manager rank or above only. */
export function canReassignOrDeleteLead(actorRole: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MANAGER_RANK) return { ok: false, reason: "This action requires manager role or higher" }
  return { ok: true }
}

/** Same owner-or-manager shape as canEditLead, for opportunities. */
export function canEditOpportunity(actorRole: string, opportunityOwnerId: string | null, actorId: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MEMBER_RANK) return { ok: false, reason: "This action requires member role or higher" }
  if (actorRank >= MANAGER_RANK) return { ok: true }
  if (opportunityOwnerId === null || opportunityOwnerId === actorId) return { ok: true }
  return { ok: false, reason: "Only this opportunity's owner or a manager can make this change" }
}

/** Reassigning an opportunity's owner -- manager rank or above only, same shape as canReassignOrDeleteLead. */
export function canReassignOrDeleteOpportunity(actorRole: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MANAGER_RANK) return { ok: false, reason: "This action requires manager role or higher" }
  return { ok: true }
}

/** Creating a brand-new lead/opportunity has no existing owner to check against -- any rep (member rank+) can create. */
export function canCreateCrmRecord(actorRole: string): AccessGateResult {
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MEMBER_RANK) return { ok: false, reason: "This action requires member role or higher" }
  return { ok: true }
}

function assertGate(gate: AccessGateResult): void {
  if (!gate.ok) throw new ServiceError(gate.reason, 403)
}

export async function listLeads(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmLeads.findMany({ where: eq(crmLeads.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

// Priority 15 (Sales & CRM depth wave): a real, DB-level paginated/filtered
// list -- listLeads() above is left completely untouched (native VERIDIAN
// CRM UI at /api/crm/leads still returns a flat array from it, unchanged
// behavior). This is the variant PROJEXA's alias route calls: a 100-person
// firm running 500 projects can have thousands of leads, so "fetch
// everything, paginate client-side" was never going to hold up.
// Priority 17 remaining gap: companyId is an optional equality filter, same
// shape/precedent as erp-financial-report-service.ts's CompanyScope --
// companyId omitted/undefined means "no filter" (unchanged behavior for
// every caller before this wave), never a silent "match nothing".
export type ListLeadsOptions = { search?: string; status?: string; ownerId?: string; source?: string; companyId?: string; page?: number; pageSize?: number }
export type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number }

export async function listLeadsPaged(ctx: { orgId: string }, opts: ListLeadsOptions = {}): Promise<PagedResult<typeof crmLeads.$inferSelect>> {
  await requireSalesEnabled(ctx.orgId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(crmLeads.orgId, ctx.orgId)]
    if (opts.status) conditions.push(eq(crmLeads.status, opts.status))
    if (opts.ownerId) conditions.push(eq(crmLeads.ownerId, opts.ownerId))
    if (opts.source) conditions.push(eq(crmLeads.source, opts.source))
    if (opts.companyId) conditions.push(eq(crmLeads.companyId, opts.companyId))
    if (opts.search?.trim()) conditions.push(ilike(crmLeads.name, `%${opts.search.trim()}%`))
    const where = and(...conditions)

    const [items, totalRows] = await Promise.all([
      db.query.crmLeads.findMany({ where, orderBy: (t, { desc }) => desc(t.createdAt), limit: pageSize, offset: (page - 1) * pageSize }),
      db.select({ count: sql<number>`count(*)` }).from(crmLeads).where(where),
    ])
    return { items, total: Number(totalRows[0]?.count ?? 0), page, pageSize }
  })
}

export async function createLead(
  ctx: CrmContext,
  input: { name: string; contactEmail?: string; contactPhone?: string; source?: string; ownerId?: string; companyId?: string; nextActionDate?: string; nextActionNote?: string }
) {
  await requireSalesEnabled(ctx.orgId)
  if (ctx.role !== undefined) assertGate(canCreateCrmRecord(ctx.role))
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [lead] = await db.insert(crmLeads).values({
      orgId: ctx.orgId, name, contactEmail: input.contactEmail || null, contactPhone: input.contactPhone || null,
      source: input.source || null, ownerId: input.ownerId || null, companyId: input.companyId || null, createdById: ctx.userId,
      nextActionDate: input.nextActionDate || null, nextActionNote: input.nextActionNote || null,
    }).returning()
    // Opening entry in the stage ledger -- every lead's funnel history now
    // starts from a real row, not an implicit "created, no record" gap.
    await db.insert(crmStageHistory).values({ orgId: ctx.orgId, entityType: "lead", entityId: lead.id, fromStage: null, toStage: lead.status, changedById: ctx.userId })
    return lead
  })
}

export async function updateLead(
  ctx: CrmContext,
  leadId: string,
  patch: Partial<{ status: string; ownerId: string | null; source: string | null; nextActionDate: string | null; nextActionNote: string | null }>,
  stageChangeNote?: string
) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lead not found", 404)
    if (ctx.role !== undefined) {
      // Ownership reassignment (ownerId changing to a genuinely different
      // value) is gated at manager rank regardless of who currently owns
      // the lead; every other field edit follows the owner-or-manager gate.
      const isReassignment = patch.ownerId !== undefined && (patch.ownerId || null) !== existing.ownerId
      assertGate(isReassignment ? canReassignOrDeleteLead(ctx.role) : canEditLead(ctx.role, existing.ownerId, ctx.userId))
    }
    const [updated] = await db.update(crmLeads).set({ ...patch, updatedAt: new Date() }).where(eq(crmLeads.id, leadId)).returning()
    if (patch.status && patch.status !== existing.status) {
      await db.insert(crmStageHistory).values({
        orgId: ctx.orgId, entityType: "lead", entityId: leadId, fromStage: existing.status, toStage: patch.status, note: stageChangeNote ?? null, changedById: ctx.userId,
      })
    }
    return updated
  })
}

// Priority 15 (Sales & CRM depth wave): bulk owner reassignment -- a sales
// manager redistributing a rep's queue (e.g. on leave/departure) across
// hundreds of leads one-at-a-time was never realistic at this firm's scale.
export async function bulkReassignLeads(ctx: CrmContext, leadIds: string[], ownerId: string | null) {
  await requireSalesEnabled(ctx.orgId)
  if (!leadIds?.length) throw new ServiceError("leadIds is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const updated = await db.update(crmLeads).set({ ownerId, updatedAt: new Date() })
      .where(and(eq(crmLeads.orgId, ctx.orgId), inArray(crmLeads.id, leadIds))).returning()
    return updated
  })
}

// Closes the loop into the existing Wave-1 clients table rather than
// creating a second, disconnected "client" concept.
export async function convertLeadToClient(ctx: CrmContext, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const lead = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!lead) throw new ServiceError("Lead not found", 404)
    if (lead.convertedClientId) throw new ServiceError("This lead has already been converted", 400)

    const [client] = await db.insert(clients).values({ orgId: ctx.orgId, name: lead.name }).returning()
    const [updated] = await db.update(crmLeads)
      .set({ status: "converted", convertedClientId: client.id, updatedAt: new Date() })
      .where(eq(crmLeads.id, leadId)).returning()
    return { lead: updated, client }
  })
}

export async function listOpportunities(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmOpportunities.findMany({ where: eq(crmOpportunities.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

// Priority 15 (Sales & CRM depth wave): same paginated/filtered variant as
// listLeadsPaged above, additive alongside the untouched listOpportunities.
export type ListOpportunitiesOptions = { search?: string; stage?: string; ownerId?: string; erpCustomerId?: string; page?: number; pageSize?: number }

export async function listOpportunitiesPaged(ctx: { orgId: string }, opts: ListOpportunitiesOptions = {}): Promise<PagedResult<typeof crmOpportunities.$inferSelect>> {
  await requireSalesEnabled(ctx.orgId)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25))
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(crmOpportunities.orgId, ctx.orgId)]
    if (opts.stage) conditions.push(eq(crmOpportunities.stage, opts.stage))
    if (opts.ownerId) conditions.push(eq(crmOpportunities.ownerId, opts.ownerId))
    if (opts.erpCustomerId) conditions.push(eq(crmOpportunities.erpCustomerId, opts.erpCustomerId))
    if (opts.search?.trim()) conditions.push(ilike(crmOpportunities.name, `%${opts.search.trim()}%`))
    const where = and(...conditions)

    const [items, totalRows] = await Promise.all([
      db.query.crmOpportunities.findMany({ where, orderBy: (t, { desc }) => desc(t.createdAt), limit: pageSize, offset: (page - 1) * pageSize }),
      db.select({ count: sql<number>`count(*)` }).from(crmOpportunities).where(where),
    ])
    return { items, total: Number(totalRows[0]?.count ?? 0), page, pageSize }
  })
}

export async function createOpportunity(
  ctx: CrmContext,
  input: {
    name: string; leadId?: string; clientId?: string; erpCustomerId?: string; stage?: string; estimatedValue?: number;
    currencyId?: string; exchangeRate?: number;
    expectedCloseDate?: string; ownerId?: string; nextActionDate?: string; nextActionNote?: string
  }
) {
  await requireSalesEnabled(ctx.orgId)
  if (ctx.role !== undefined) assertGate(canCreateCrmRecord(ctx.role))
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.leadId && !input.clientId && !input.erpCustomerId) throw new ServiceError("An opportunity needs a leadId, a clientId, or an erpCustomerId", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.erpCustomerId) {
      const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.erpCustomerId), eq(erpCustomers.orgId, ctx.orgId)) })
      if (!customer) throw new ServiceError("Customer not found", 404)
    }
    const [opportunity] = await db.insert(crmOpportunities).values({
      orgId: ctx.orgId, name, leadId: input.leadId || null, clientId: input.clientId || null, erpCustomerId: input.erpCustomerId || null,
      stage: input.stage || "prospecting", estimatedValue: input.estimatedValue != null ? String(input.estimatedValue) : null,
      currencyId: input.currencyId || null, exchangeRate: input.exchangeRate != null ? String(input.exchangeRate) : undefined,
      expectedCloseDate: input.expectedCloseDate || null, ownerId: input.ownerId || null, createdById: ctx.userId,
      nextActionDate: input.nextActionDate || null, nextActionNote: input.nextActionNote || null,
    }).returning()
    await db.insert(crmStageHistory).values({ orgId: ctx.orgId, entityType: "opportunity", entityId: opportunity.id, fromStage: null, toStage: opportunity.stage, changedById: ctx.userId })
    return opportunity
  })
}

export async function updateOpportunity(
  ctx: CrmContext,
  opportunityId: string,
  patch: Partial<{
    stage: string; estimatedValue: number | null; currencyId: string | null; exchangeRate: number;
    expectedCloseDate: string | null; ownerId: string | null; nextActionDate: string | null; nextActionNote: string | null;
    lostReasonId: string | null
  }>,
  stageChangeNote?: string
) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Opportunity not found", 404)

    // VERIDIAN Review Framework Sales Pipeline closure (2026-08-07,
    // "Business Rule & Validation Accuracy" finding): stage-transition
    // legality was previously entirely unenforced -- the UI's plain
    // <Select> let a deal jump from "won" straight back to "prospecting"
    // with no check at all. isValidStageTransition() is pure/unit-tested;
    // this is its one real call site.
    if (patch.stage && patch.stage !== existing.stage) {
      const stages = await listPipelineStages({ orgId: ctx.orgId }, "opportunity")
      const actorRank = ctx.actorRole ? ROLE_RANK[ctx.actorRole] : 0
      const verdict = isValidStageTransition(existing.stage, patch.stage, stages, actorRank)
      if (!verdict.valid) throw new ServiceError(verdict.reason ?? "Invalid stage transition", 400)
    }

    if (ctx.role !== undefined) {
      // Same reassignment-vs-edit split as updateLead above.
      const isReassignment = patch.ownerId !== undefined && (patch.ownerId || null) !== existing.ownerId
      assertGate(isReassignment ? canReassignOrDeleteOpportunity(ctx.role) : canEditOpportunity(ctx.role, existing.ownerId, ctx.userId))
    }

    const [updated] = await db.update(crmOpportunities)
      .set({
        ...patch,
        estimatedValue: patch.estimatedValue != null ? String(patch.estimatedValue) : undefined,
        exchangeRate: patch.exchangeRate != null ? String(patch.exchangeRate) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(crmOpportunities.id, opportunityId)).returning()
    if (patch.stage && patch.stage !== existing.stage) {
      await db.insert(crmStageHistory).values({
        orgId: ctx.orgId, entityType: "opportunity", entityId: opportunityId, fromStage: existing.stage, toStage: patch.stage, note: stageChangeNote ?? null, changedById: ctx.userId,
      })
    }
    return updated
  })
}

// Priority 15 (Sales & CRM depth wave): bulk owner reassignment, same
// rationale as bulkReassignLeads above.
export async function bulkReassignOpportunities(ctx: CrmContext, opportunityIds: string[], ownerId: string | null) {
  await requireSalesEnabled(ctx.orgId)
  if (!opportunityIds?.length) throw new ServiceError("opportunityIds is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const updated = await db.update(crmOpportunities).set({ ownerId, updatedAt: new Date() })
      .where(and(eq(crmOpportunities.orgId, ctx.orgId), inArray(crmOpportunities.id, opportunityIds))).returning()
    return updated
  })
}

// ─── Task #46 (CRM feature-parity gap analysis) ───────────────────────────
// bulkReassignLeads/bulkReassignOpportunities above cover MANUAL reassignment
// of an explicit id list. The gap analysis found we had no automatic/
// load-balanced distribution and no Total/Allocated/Un-Allocated dashboard.
// Owner mandate (deterministic-first, applies throughout this project):
// auto-assignment must be a plain deterministic algorithm -- least-loaded/
// round-robin, ZERO AI/LLM involvement -- same "pure function over existing
// columns" shape as bulkReassignLeads itself. Zero new schema: everything
// below is a query/update over the existing crm_leads/crm_opportunities/
// users tables, same as the rest of this file.
//
// computeRoundRobinAssignment is deliberately pure/exported (no db access)
// so it can be unit-tested directly, matching this file's own established
// convention (see crm-accounts-service.test.ts's header note: this repo's
// .test.ts files exercise pure predicates, never a live DB).
export type AssignmentOrder = "oldest_first" | "newest_first"

export function computeRoundRobinAssignment(
  recordIds: string[],
  userIds: string[],
  sharingCount?: number
): { assignments: { recordId: string; userId: string }[]; perUser: Record<string, number> } {
  const assignments: { recordId: string; userId: string }[] = []
  const perUser: Record<string, number> = {}
  for (const uid of userIds) perUser[uid] = 0
  if (!recordIds.length || !userIds.length) return { assignments, perUser }

  let userIdx = 0
  for (const recordId of recordIds) {
    let attempts = 0
    let placed = false
    while (attempts < userIds.length) {
      const uid = userIds[userIdx % userIds.length]
      userIdx += 1
      if (sharingCount == null || perUser[uid] < sharingCount) {
        assignments.push({ recordId, userId: uid })
        perUser[uid] += 1
        placed = true
        break
      }
      attempts += 1
    }
    // Every user is at (or over) sharingCount -- the whole pool is at
    // capacity, so nothing later in recordIds can be placed either. Stop
    // rather than looping through the rest for no effect.
    if (!placed) break
  }
  return { assignments, perUser }
}

export type AutoDistributeOptions = {
  // 'oldest_first' (default) matches the reference's "Order By" concept for
  // working a queue FIFO; 'newest_first' supported for the inverse.
  order?: AssignmentOrder
  // Manual-Assign-style per-target cap. Omitted => "Auto Assign" mode: ALL
  // currently-unassigned records are split evenly (round-robin) across
  // every active user in the pool.
  sharingCount?: number
  // Explicit pool of target users -- omitted => every active user in the org.
  targetUserIds?: string[]
}
export type AutoDistributeResult = {
  entityType: "lead" | "opportunity"
  totalUnassigned: number
  distributedCount: number
  remainingUnassigned: number
  perUser: { userId: string; name: string; assignedCount: number }[]
}

async function fetchActiveOrgUsers(db: TenantDb, orgId: string, targetUserIds?: string[]) {
  return db.query.users.findMany({
    where: targetUserIds?.length
      ? and(eq(users.orgId, orgId), eq(users.isActive, true), inArray(users.id, targetUserIds))
      : and(eq(users.orgId, orgId), eq(users.isActive, true)),
    orderBy: (t, { asc }) => asc(t.id),
    columns: { id: true, name: true },
  })
}

// Task #46: deterministic auto-assignment for leads -- queries currently
// unassigned leads (ownerId IS NULL), fetches active org users, and
// round-robins/least-loads them up to sharingCount per target (or evenly
// across all active users when sharingCount is omitted).
export async function autoDistributeLeads(ctx: CrmContext, opts: AutoDistributeOptions = {}): Promise<AutoDistributeResult> {
  await requireSalesEnabled(ctx.orgId)
  const order: AssignmentOrder = opts.order ?? "oldest_first"
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [unassigned, activeUsers] = await Promise.all([
      db.query.crmLeads.findMany({
        where: and(eq(crmLeads.orgId, ctx.orgId), isNull(crmLeads.ownerId)),
        orderBy: (t, { asc, desc }) => (order === "oldest_first" ? asc(t.createdAt) : desc(t.createdAt)),
        columns: { id: true },
      }),
      fetchActiveOrgUsers(db, ctx.orgId, opts.targetUserIds),
    ])

    const totalUnassigned = unassigned.length
    if (!totalUnassigned || !activeUsers.length) {
      return {
        entityType: "lead" as const, totalUnassigned, distributedCount: 0, remainingUnassigned: totalUnassigned,
        perUser: activeUsers.map((u) => ({ userId: u.id, name: u.name, assignedCount: 0 })),
      }
    }

    const { assignments, perUser } = computeRoundRobinAssignment(unassigned.map((l) => l.id), activeUsers.map((u) => u.id), opts.sharingCount)

    // One UPDATE per target user (inArray of that user's assigned ids),
    // matching bulkReassignLeads's own update shape above -- not N
    // single-row updates.
    const idsByOwner = new Map<string, string[]>()
    for (const a of assignments) idsByOwner.set(a.userId, [...(idsByOwner.get(a.userId) ?? []), a.recordId])
    for (const [ownerId, ids] of idsByOwner) {
      await db.update(crmLeads).set({ ownerId, updatedAt: new Date() })
        .where(and(eq(crmLeads.orgId, ctx.orgId), inArray(crmLeads.id, ids)))
    }

    return {
      entityType: "lead" as const, totalUnassigned, distributedCount: assignments.length,
      remainingUnassigned: totalUnassigned - assignments.length,
      perUser: activeUsers.map((u) => ({ userId: u.id, name: u.name, assignedCount: perUser[u.id] ?? 0 })),
    }
  })
}

// Task #46: same as autoDistributeLeads above, opportunity side.
export async function autoDistributeOpportunities(ctx: CrmContext, opts: AutoDistributeOptions = {}): Promise<AutoDistributeResult> {
  await requireSalesEnabled(ctx.orgId)
  const order: AssignmentOrder = opts.order ?? "oldest_first"
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [unassigned, activeUsers] = await Promise.all([
      db.query.crmOpportunities.findMany({
        where: and(eq(crmOpportunities.orgId, ctx.orgId), isNull(crmOpportunities.ownerId)),
        orderBy: (t, { asc, desc }) => (order === "oldest_first" ? asc(t.createdAt) : desc(t.createdAt)),
        columns: { id: true },
      }),
      fetchActiveOrgUsers(db, ctx.orgId, opts.targetUserIds),
    ])

    const totalUnassigned = unassigned.length
    if (!totalUnassigned || !activeUsers.length) {
      return {
        entityType: "opportunity" as const, totalUnassigned, distributedCount: 0, remainingUnassigned: totalUnassigned,
        perUser: activeUsers.map((u) => ({ userId: u.id, name: u.name, assignedCount: 0 })),
      }
    }

    const { assignments, perUser } = computeRoundRobinAssignment(unassigned.map((o) => o.id), activeUsers.map((u) => u.id), opts.sharingCount)

    const idsByOwner = new Map<string, string[]>()
    for (const a of assignments) idsByOwner.set(a.userId, [...(idsByOwner.get(a.userId) ?? []), a.recordId])
    for (const [ownerId, ids] of idsByOwner) {
      await db.update(crmOpportunities).set({ ownerId, updatedAt: new Date() })
        .where(and(eq(crmOpportunities.orgId, ctx.orgId), inArray(crmOpportunities.id, ids)))
    }

    return {
      entityType: "opportunity" as const, totalUnassigned, distributedCount: assignments.length,
      remainingUnassigned: totalUnassigned - assignments.length,
      perUser: activeUsers.map((u) => ({ userId: u.id, name: u.name, assignedCount: perUser[u.id] ?? 0 })),
    }
  })
}

// Task #46: the "Manual Assign" shape (a specific user + record count +
// ordering) -- bulkReassignLeads/bulkReassignOpportunities above take an
// explicit id list, they don't pick which unassigned records to hand a
// given user, so this is a genuinely thin wrapper: pick the N oldest/newest
// unassigned records, then delegate the actual write to the existing
// bulk-reassign function (zero duplicated update logic).
export async function manualAssignUnassigned(
  ctx: CrmContext,
  entityType: "lead" | "opportunity",
  targetUserId: string,
  count: number,
  order: AssignmentOrder = "oldest_first"
): Promise<{ entityType: "lead" | "opportunity"; assignedIds: string[] }> {
  await requireSalesEnabled(ctx.orgId)
  if (!targetUserId) throw new ServiceError("targetUserId is required", 400)
  if (!Number.isInteger(count) || count < 1) throw new ServiceError("count must be a positive integer", 400)

  if (entityType === "lead") {
    const candidates = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.crmLeads.findMany({
        where: and(eq(crmLeads.orgId, ctx.orgId), isNull(crmLeads.ownerId)),
        orderBy: (t, { asc, desc }) => (order === "oldest_first" ? asc(t.createdAt) : desc(t.createdAt)),
        limit: count,
        columns: { id: true },
      })
    )
    if (!candidates.length) return { entityType, assignedIds: [] }
    await bulkReassignLeads(ctx, candidates.map((c) => c.id), targetUserId)
    return { entityType, assignedIds: candidates.map((c) => c.id) }
  }

  const candidates = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmOpportunities.findMany({
      where: and(eq(crmOpportunities.orgId, ctx.orgId), isNull(crmOpportunities.ownerId)),
      orderBy: (t, { asc, desc }) => (order === "oldest_first" ? asc(t.createdAt) : desc(t.createdAt)),
      limit: count,
      columns: { id: true },
    })
  )
  if (!candidates.length) return { entityType, assignedIds: [] }
  await bulkReassignOpportunities(ctx, candidates.map((c) => c.id), targetUserId)
  return { entityType, assignedIds: candidates.map((c) => c.id) }
}

// Task #46: the Total/Allocated/Un-Allocated dashboard -- a GROUP BY
// ownerId count query over the existing crm_leads/crm_opportunities table,
// filtered by the existing users.isActive, per the gap analysis's own
// "ZERO new database schema" finding. Per-user activityStatus is an honest,
// best-available approximation, not a fabricated field: crm_activities has
// no per-owner column of its own (its assignedToId can differ from the
// entity's current owner), so "has activity" is derived by joining on
// entityId -- does any owned lead/opportunity have at least one logged
// crm_activities row -- rather than claiming to know what the OWNER
// personally did. A user with zero currently-assigned records gets
// activityStatus: null (there's nothing to categorize), not a fake status.
export type AssignmentOverviewUser = {
  userId: string
  name: string
  assignedCount: number
  activityStatus: "yet_to_start" | "in_progress" | null
}
export type AssignmentOverview = {
  entityType: "lead" | "opportunity"
  total: number
  allocated: number
  unallocated: number
  perUser: AssignmentOverviewUser[]
}

export async function getAssignmentOverview(ctx: { orgId: string }, entityType: "lead" | "opportunity"): Promise<AssignmentOverview> {
  await requireSalesEnabled(ctx.orgId)

  if (entityType === "lead") {
    return withTenantContext({ orgId: ctx.orgId }, async (db) => {
      const [totalRows, ownedLeads, activeUsers] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(crmLeads).where(eq(crmLeads.orgId, ctx.orgId)),
        db.query.crmLeads.findMany({ where: and(eq(crmLeads.orgId, ctx.orgId), isNotNull(crmLeads.ownerId)), columns: { id: true, ownerId: true } }),
        fetchActiveOrgUsers(db, ctx.orgId),
      ])
      const total = Number(totalRows[0]?.count ?? 0)
      const allocated = ownedLeads.length
      const unallocated = total - allocated

      const idsWithActivity = ownedLeads.length
        ? new Set(
            (
              await db.select({ entityId: crmActivities.entityId }).from(crmActivities)
                .where(and(eq(crmActivities.orgId, ctx.orgId), eq(crmActivities.entityType, "lead"), inArray(crmActivities.entityId, ownedLeads.map((l) => l.id))))
            ).map((r) => r.entityId)
          )
        : new Set<string>()

      const countsByOwner = new Map<string, number>()
      const activityByOwner = new Map<string, boolean>()
      for (const lead of ownedLeads) {
        const ownerId = lead.ownerId as string
        countsByOwner.set(ownerId, (countsByOwner.get(ownerId) ?? 0) + 1)
        if (idsWithActivity.has(lead.id)) activityByOwner.set(ownerId, true)
        else if (!activityByOwner.has(ownerId)) activityByOwner.set(ownerId, false)
      }

      const perUser: AssignmentOverviewUser[] = activeUsers.map((u) => {
        const assignedCount = countsByOwner.get(u.id) ?? 0
        return {
          userId: u.id, name: u.name, assignedCount,
          activityStatus: assignedCount === 0 ? null : activityByOwner.get(u.id) ? "in_progress" : "yet_to_start",
        }
      })

      return { entityType: "lead" as const, total, allocated, unallocated, perUser }
    })
  }

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [totalRows, ownedOpps, activeUsers] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(crmOpportunities).where(eq(crmOpportunities.orgId, ctx.orgId)),
      db.query.crmOpportunities.findMany({ where: and(eq(crmOpportunities.orgId, ctx.orgId), isNotNull(crmOpportunities.ownerId)), columns: { id: true, ownerId: true } }),
      fetchActiveOrgUsers(db, ctx.orgId),
    ])
    const total = Number(totalRows[0]?.count ?? 0)
    const allocated = ownedOpps.length
    const unallocated = total - allocated

    const idsWithActivity = ownedOpps.length
      ? new Set(
          (
            await db.select({ entityId: crmActivities.entityId }).from(crmActivities)
              .where(and(eq(crmActivities.orgId, ctx.orgId), eq(crmActivities.entityType, "opportunity"), inArray(crmActivities.entityId, ownedOpps.map((o) => o.id))))
          ).map((r) => r.entityId)
        )
      : new Set<string>()

    const countsByOwner = new Map<string, number>()
    const activityByOwner = new Map<string, boolean>()
    for (const opp of ownedOpps) {
      const ownerId = opp.ownerId as string
      countsByOwner.set(ownerId, (countsByOwner.get(ownerId) ?? 0) + 1)
      if (idsWithActivity.has(opp.id)) activityByOwner.set(ownerId, true)
      else if (!activityByOwner.has(ownerId)) activityByOwner.set(ownerId, false)
    }

    const perUser: AssignmentOverviewUser[] = activeUsers.map((u) => {
      const assignedCount = countsByOwner.get(u.id) ?? 0
      return {
        userId: u.id, name: u.name, assignedCount,
        activityStatus: assignedCount === 0 ? null : activityByOwner.get(u.id) ? "in_progress" : "yet_to_start",
      }
    })

    return { entityType: "opportunity" as const, total, allocated, unallocated, perUser }
  })
}

// Priority 15 (Sales & CRM depth wave): the stage-change ledger reader --
// backs a "history" tab on a lead/opportunity detail page.
export async function listStageHistory(ctx: { orgId: string }, entityType: "lead" | "opportunity", entityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmStageHistory.findMany({
      where: and(eq(crmStageHistory.orgId, ctx.orgId), eq(crmStageHistory.entityType, entityType), eq(crmStageHistory.entityId, entityId)),
      orderBy: (t, { desc }) => desc(t.changedAt),
    })
  )
}

// ─── VERIDIAN Review Framework gap-closure: Sales Pipeline (2026-08-07) ───
// "Data Model Completeness & Referential Integrity" finding: pipeline
// stages were hardcoded strings ('prospecting'|'proposal'|'negotiation'|
// 'won'|'lost') duplicated across crm-service.ts and crm/page.tsx, with no
// per-org configurability and no machine-readable "this is a terminal
// stage" flag. crm_pipeline_stages (drizzle/0314) is the new config table;
// these 5 rows are exactly the pre-existing hardcoded set, so seeding them
// changes no observable behavior for any org that hasn't touched pipeline
// config yet.
export type PipelineStageRow = typeof crmPipelineStages.$inferSelect
const DEFAULT_PIPELINE_STAGES: { stageKey: string; label: string; sortOrder: number; isWon: boolean; isLost: boolean }[] = [
  { stageKey: "prospecting", label: "Prospecting", sortOrder: 0, isWon: false, isLost: false },
  { stageKey: "proposal", label: "Proposal", sortOrder: 1, isWon: false, isLost: false },
  { stageKey: "negotiation", label: "Negotiation", sortOrder: 2, isWon: false, isLost: false },
  { stageKey: "won", label: "Won", sortOrder: 3, isWon: true, isLost: false },
  { stageKey: "lost", label: "Lost", sortOrder: 4, isWon: false, isLost: true },
]

/**
 * Returns this org's configured pipeline stages for `entityType`, lazily
 * seeding the 5 defaults above on first read (never on every read -- only
 * inserted when the org has zero rows for this entityType yet). This is the
 * one function every other pipeline-stage consumer (the Kanban UI,
 * isValidStageTransition below, getSalesPipelineOverview) goes through, so
 * an org's config is always resolvable even if it pre-dates drizzle/0314.
 */
export async function listPipelineStages(ctx: { orgId: string }, entityType: "lead" | "opportunity" = "opportunity"): Promise<PipelineStageRow[]> {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmPipelineStages.findMany({
      where: and(eq(crmPipelineStages.orgId, ctx.orgId), eq(crmPipelineStages.entityType, entityType)),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    if (existing.length > 0) return existing
    const seeded = await db.insert(crmPipelineStages).values(
      DEFAULT_PIPELINE_STAGES.map((s) => ({ orgId: ctx.orgId, entityType, ...s }))
    ).returning()
    return seeded.sort((a, b) => a.sortOrder - b.sortOrder)
  })
}

export async function createPipelineStage(
  ctx: { orgId: string },
  input: { entityType?: "lead" | "opportunity"; stageKey: string; label: string; sortOrder?: number; isWon?: boolean; isLost?: boolean }
) {
  await requireSalesEnabled(ctx.orgId)
  const stageKey = input.stageKey?.trim()
  const label = input.label?.trim()
  if (!stageKey || !label) throw new ServiceError("stageKey and label are required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [stage] = await db.insert(crmPipelineStages).values({
      orgId: ctx.orgId, entityType: input.entityType ?? "opportunity", stageKey, label,
      sortOrder: input.sortOrder ?? 0, isWon: input.isWon ?? false, isLost: input.isLost ?? false,
    }).returning()
    return stage
  })
}

export async function updatePipelineStage(
  ctx: { orgId: string },
  stageId: string,
  patch: Partial<{ label: string; sortOrder: number; isWon: boolean; isLost: boolean }>
) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmPipelineStages.findFirst({ where: and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Pipeline stage not found", 404)
    const [updated] = await db.update(crmPipelineStages).set({ ...patch, updatedAt: new Date() }).where(eq(crmPipelineStages.id, stageId)).returning()
    return updated
  })
}

export async function deletePipelineStage(ctx: { orgId: string }, stageId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmPipelineStages.findFirst({ where: and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Pipeline stage not found", 404)
    // Referential-integrity guard: refuse to delete a stage that any live
    // opportunity (or lead, for the entityType='lead' config) still
    // references -- deleting it out from under them would leave orphaned
    // stage values with no matching config row. Two explicit branches
    // (rather than a dynamic table variable) since crmLeads.status and
    // crmOpportunities.stage are different columns on different tables.
    const inUseCount = existing.entityType === "lead"
      ? await db.select({ count: sql<number>`count(*)` }).from(crmLeads).where(and(eq(crmLeads.orgId, ctx.orgId), eq(crmLeads.status, existing.stageKey)))
      : await db.select({ count: sql<number>`count(*)` }).from(crmOpportunities).where(and(eq(crmOpportunities.orgId, ctx.orgId), eq(crmOpportunities.stage, existing.stageKey)))
    if (Number(inUseCount[0]?.count ?? 0) > 0) {
      throw new ServiceError(`Cannot delete stage "${existing.label}" -- ${inUseCount[0].count} record(s) still use it`, 400)
    }
    await db.delete(crmPipelineStages).where(eq(crmPipelineStages.id, stageId))
    return { id: stageId }
  })
}

/**
 * Pure/unit-tested: is moving from `fromStage` to `toStage` legal? A deal
 * can move freely between any two non-terminal stages (backward included --
 * e.g. "negotiation" cooling back off to "proposal" is a real, common
 * pipeline event, not an error), and into a terminal (won/lost) stage from
 * anywhere. Moving OUT of a terminal stage ("reopening" a closed deal)
 * requires manager rank or above -- falls back to the hardcoded 'won'/'lost'
 * strings if `stages` has no matching config row (defensive; every real
 * call site resolves stages via listPipelineStages first, which always
 * returns at least the 5 seeded defaults).
 */
export function isValidStageTransition(
  fromStage: string,
  toStage: string,
  stages: Pick<PipelineStageRow, "stageKey" | "isWon" | "isLost">[],
  actorRank: number
): { valid: boolean; reason?: string } {
  if (fromStage === toStage) return { valid: true }
  const to = stages.find((s) => s.stageKey === toStage)
  if (!to) return { valid: false, reason: `Unknown pipeline stage "${toStage}"` }
  const from = stages.find((s) => s.stageKey === fromStage)
  const fromIsTerminal = from ? from.isWon || from.isLost : fromStage === "won" || fromStage === "lost"
  if (fromIsTerminal && actorRank < ROLE_RANK.manager) {
    return { valid: false, reason: `Cannot move a deal out of the closed stage "${fromStage}" -- requires manager approval` }
  }
  return { valid: true }
}

// Priority 15 (Sales & CRM depth wave): the pipeline/funnel dashboard's
// cross-cutting rollup -- stage totals + win/loss rate + overdue follow-ups,
// computed directly from crm_leads/crm_opportunities/crm_stage_history
// rather than a separate materialized/cached table (org-scale here, not
// platform-scale, so a live aggregate is cheap enough not to need caching).
//
// Sales Pipeline closure (2026-08-07, "Localization Readiness" finding):
// opportunitiesByStage/openPipelineValue now sum estimatedValue *
// exchangeRate rather than the raw estimatedValue -- every opportunity's
// exchangeRate defaults to '1' (org base currency), so an org that has
// never touched the new currencyId field gets byte-identical totals to
// before this change; only opportunities explicitly given a foreign
// currencyId/exchangeRate now roll up correctly into a single base-currency
// total instead of silently mixing currencies.
export async function getSalesPipelineOverview(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const [leads, opportunities, overdueLeadCountRows, overdueOppCountRows] = await Promise.all([
      db.query.crmLeads.findMany({ where: eq(crmLeads.orgId, ctx.orgId) }),
      db.query.crmOpportunities.findMany({ where: eq(crmOpportunities.orgId, ctx.orgId) }),
      db.select({ count: sql<number>`count(*)` }).from(crmLeads).where(and(eq(crmLeads.orgId, ctx.orgId), isNotNull(crmLeads.nextActionDate), lte(crmLeads.nextActionDate, today))),
      db.select({ count: sql<number>`count(*)` }).from(crmOpportunities).where(and(eq(crmOpportunities.orgId, ctx.orgId), isNotNull(crmOpportunities.nextActionDate), lte(crmOpportunities.nextActionDate, today))),
    ])

    const baseValue = (o: typeof opportunities[number]) =>
      o.estimatedValue != null ? Number(o.estimatedValue) * Number(o.exchangeRate ?? 1) : 0

    const leadsByStatus: Record<string, number> = {}
    for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1

    const opportunitiesByStage: Record<string, { count: number; value: number }> = {}
    for (const o of opportunities) {
      const bucket = (opportunitiesByStage[o.stage] ??= { count: 0, value: 0 })
      bucket.count += 1
      bucket.value += baseValue(o)
    }

    const won = opportunities.filter((o) => o.stage === "won").length
    const lost = opportunities.filter((o) => o.stage === "lost").length
    const winRate = won + lost > 0 ? won / (won + lost) : null
    const openPipelineValue = opportunities
      .filter((o) => o.stage !== "won" && o.stage !== "lost")
      .reduce((sum, o) => sum + baseValue(o), 0)

    return {
      totalLeads: leads.length,
      totalOpportunities: opportunities.length,
      leadsByStatus,
      opportunitiesByStage,
      wonCount: won,
      lostCount: lost,
      winRate,
      openPipelineValue,
      overdueLeadFollowUps: Number(overdueLeadCountRows[0]?.count ?? 0),
      overdueOpportunityFollowUps: Number(overdueOppCountRows[0]?.count ?? 0),
    }
  })
}

// Sales Pipeline closure (2026-08-07, "Notification & Alert Trigger
// Correctness" finding): "days stuck in current stage" for every open
// opportunity, resolved from crm_stage_history's latest row per opportunity
// (falling back to createdAt if an opportunity somehow has no history row --
// defensive only, every real create/update path writes one). This is the
// shared read both the Kanban UI's "stuck" badge and
// pipeline-stuck-deal-digest-service.ts's cron job consume, so the exact
// same definition of "stuck" is used in both places.
export type StuckOpportunity = { id: string; name: string; stage: string; ownerId: string | null; daysInStage: number }

export async function listStuckOpportunities(ctx: { orgId: string }, minDaysInStage: number = 30): Promise<StuckOpportunity[]> {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const open = await db.query.crmOpportunities.findMany({
      where: and(eq(crmOpportunities.orgId, ctx.orgId), ne(crmOpportunities.stage, "won"), ne(crmOpportunities.stage, "lost")),
    })
    if (open.length === 0) return []
    const history = await db.query.crmStageHistory.findMany({
      where: and(eq(crmStageHistory.orgId, ctx.orgId), eq(crmStageHistory.entityType, "opportunity"), inArray(crmStageHistory.entityId, open.map((o) => o.id))),
      orderBy: (t, { desc }) => desc(t.changedAt),
    })
    const latestChangeByOpp = new Map<string, Date>()
    for (const h of history) if (!latestChangeByOpp.has(h.entityId)) latestChangeByOpp.set(h.entityId, h.changedAt)

    const now = Date.now()
    const result: StuckOpportunity[] = []
    for (const o of open) {
      const since = latestChangeByOpp.get(o.id) ?? o.createdAt
      const daysInStage = Math.floor((now - since.getTime()) / 86_400_000)
      if (daysInStage >= minDaysInStage) result.push({ id: o.id, name: o.name, stage: o.stage, ownerId: o.ownerId, daysInStage })
    }
    return result.sort((a, b) => b.daysInStage - a.daysInStage)
  })
}

// Sales Pipeline closure (2026-08-07, "AI Copilot / Worker Agent
// Integration Depth" finding): aiWinProbability (analyzeOpportunity above)
// reasons about ONE opportunity at a time. This aggregates across the
// entire open funnel ("which deals are at risk this quarter") -- same
// 6-step orchestration shape as scoreLead/analyzeOpportunity, but with no
// single entity row to write the result back to, so the result is returned
// ephemeral (computed on demand, not cached/persisted) rather than forcing
// a new column onto an org-level table for a summary that goes stale the
// moment any opportunity changes.
export async function getPipelineAiSummary(ctx: CrmContext) {
  await requireSalesEnabled(ctx.orgId)
  const [opportunities, stuck] = await Promise.all([
    withTenantContext({ orgId: ctx.orgId }, (db) => db.query.crmOpportunities.findMany({ where: and(eq(crmOpportunities.orgId, ctx.orgId), ne(crmOpportunities.stage, "won"), ne(crmOpportunities.stage, "lost")) })),
    listStuckOpportunities({ orgId: ctx.orgId }),
  ])
  if (opportunities.length === 0) throw new ServiceError("No open opportunities to summarize", 400)

  const stuckIds = new Set(stuck.map((s) => s.id))
  const dealLines = opportunities.map((o) => {
    const daysInStage = stuck.find((s) => s.id === o.id)?.daysInStage
    return `- "${o.name}": stage=${o.stage}, value=${o.estimatedValue ?? "unknown"}, closeDate=${o.expectedCloseDate ?? "unknown"}, winProbability=${o.aiWinProbability ?? "not analyzed"}${daysInStage != null ? `, daysInStage=${daysInStage} (stuck)` : ""}`
  })

  // Same reasoning as scoreLead/analyzeOpportunity: opportunity names are
  // the only genuinely user-authored text reaching the model here.
  const policyDecision = enforcePolicy(
    { orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.pipeline_summary" },
    opportunities.map((o) => o.name).join("\n")
  )
  if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 403)

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

  const systemPrompt = await resolvePromptTemplate("crm_intelligence.pipeline_summary")
  const userMessage = `Open pipeline (${opportunities.length} deals, ${stuckIds.size} stuck 30+ days in their current stage):\n${dealLines.join("\n")}`

  const startedAt = Date.now()
  const { data: result, usage } = await callLLMJson<{ atRiskDealNames: string[]; summary: string; recommendedFocus: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 500 }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.pipeline_summary",
    input: { openOpportunityCount: opportunities.length }, output: { atRiskCount: result.atRiskDealNames?.length ?? 0 },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  return { ...result, generatedAt: new Date().toISOString(), openOpportunityCount: opportunities.length, stuckOpportunityCount: stuckIds.size }
}

// sap_reports gap analysis, lead_source_effectiveness (BUILD_NEW, no existing
// catalog row -- confirmed absent from the 80-row sap_reports classification
// PR #677 completed). Pure aggregation kept separate from the DB-fetch below,
// matching this repo's established "no live DB from a .test.ts file"
// convention (see sales-pipeline-dashboard-service.ts's own split). Per the
// gap analysis's own note: CAC is omitted entirely when no marketing-spend-
// by-source data exists, rather than fabricating a cost figure with no real
// input -- this schema has no spend-by-source table today, so CAC is never
// computed here, not silently zeroed.
export type LeadSourceRow = { id: string; source: string | null; status: string }
export type OpportunityForSourceRow = { leadId: string | null; stage: string; estimatedValue: string | number | null }

export function aggregateLeadSourceEffectiveness(leads: LeadSourceRow[], opportunities: OpportunityForSourceRow[]) {
  // Every real lead attributes its own opportunities via leadId -- an
  // opportunity's source is inherited from the lead it originated from,
  // never re-declared independently (opportunities created directly against
  // an existing client, with no leadId, have no attributable source and are
  // excluded, same "unattributed, not zero" honesty as crmLeads.companyId).
  const oppsByLeadId = new Map<string, OpportunityForSourceRow[]>()
  for (const o of opportunities) {
    if (!o.leadId) continue
    const bucket = oppsByLeadId.get(o.leadId) ?? []
    bucket.push(o)
    oppsByLeadId.set(o.leadId, bucket)
  }

  const bySource: Record<string, { totalLeads: number; wonDeals: number; totalDeals: number; wonValue: number }> = {}
  for (const lead of leads) {
    const key = lead.source?.trim() || "unattributed"
    const bucket = (bySource[key] ??= { totalLeads: 0, wonDeals: 0, totalDeals: 0, wonValue: 0 })
    bucket.totalLeads += 1
    const opps = oppsByLeadId.get(lead.id) ?? []
    for (const o of opps) {
      if (o.stage !== "won" && o.stage !== "lost") continue
      bucket.totalDeals += 1
      if (o.stage === "won") {
        bucket.wonDeals += 1
        bucket.wonValue += o.estimatedValue != null ? Number(o.estimatedValue) : 0
      }
    }
  }

  const bySourceReport = Object.entries(bySource)
    .map(([source, b]) => ({
      source,
      totalLeads: b.totalLeads,
      conversionRate: b.totalDeals > 0 ? b.wonDeals / b.totalDeals : null,
      avgWonDealSize: b.wonDeals > 0 ? b.wonValue / b.wonDeals : null,
      wonDeals: b.wonDeals,
      totalDeals: b.totalDeals,
    }))
    .sort((a, b) => b.totalLeads - a.totalLeads)

  return { bySource: bySourceReport }
}

export async function getLeadSourceEffectivenessReport(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [leads, opportunities] = await Promise.all([
      db.query.crmLeads.findMany({ where: eq(crmLeads.orgId, ctx.orgId), columns: { id: true, source: true, status: true } }),
      db.query.crmOpportunities.findMany({ where: eq(crmOpportunities.orgId, ctx.orgId), columns: { leadId: true, stage: true, estimatedValue: true } }),
    ])
    return aggregateLeadSourceEffectiveness(leads, opportunities)
  })
}

// ─── Sales Pipeline Interactive Dashboard (2026-07-27, Owner mockup) ──────
// Fetches everything the dashboard needs in one shot -- opportunities, the
// owner-id -> name lookup, and monthly targets -- and hands the raw rows to
// sales-pipeline-dashboard-service.ts's pure buildPipelineDeals(). All actual
// KPI/chart aggregation happens client-side over this one payload so every
// cross-filter click (SCOPE item 4) recomputes instantly with zero extra
// requests, using the exact same pure functions this file's tests cover.
export async function getSalesPipelineDashboardData(ctx: { orgId: string }) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [opportunities, orgUsers, targets] = await Promise.all([
      db.query.crmOpportunities.findMany({ where: eq(crmOpportunities.orgId, ctx.orgId) }),
      db.query.users.findMany({ where: eq(users.orgId, ctx.orgId), columns: { id: true, name: true } }),
      db.query.crmSalesTargets.findMany({ where: eq(crmSalesTargets.orgId, ctx.orgId) }),
    ])

    const ownerNameById: Record<string, string> = Object.fromEntries(orgUsers.map((u) => [u.id, u.name]))
    const deals = buildPipelineDeals(
      opportunities.map((o) => ({
        id: o.id, name: o.name, ownerId: o.ownerId, estimatedValue: o.estimatedValue,
        stage: o.stage, expectedCloseDate: o.expectedCloseDate, aiWinProbability: o.aiWinProbability,
      })),
      ownerNameById
    )

    return {
      deals,
      targets: targets.map((t) => ({ month: t.month.slice(0, 7), targetValue: Number(t.targetValue) })),
    }
  })
}

/** Upserts an org's monthly revenue target (find-or-create by orgId+month, same app-level-uniqueness convention as the rest of this file's bare-text-id tables). */
export async function setSalesTarget(ctx: { orgId: string; userId: string }, input: { month: string; targetValue: number }) {
  await requireSalesEnabled(ctx.orgId)
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new ServiceError("month must be 'YYYY-MM'", 400, { code: "VALIDATION" })
  if (!Number.isFinite(input.targetValue)) throw new ServiceError("targetValue must be a finite number", 400, { code: "VALIDATION" })
  const monthDate = `${input.month}-01`

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmSalesTargets.findFirst({
      where: and(eq(crmSalesTargets.orgId, ctx.orgId), eq(crmSalesTargets.month, monthDate)),
    })
    if (existing) {
      const [updated] = await db.update(crmSalesTargets)
        .set({ targetValue: String(input.targetValue), updatedAt: new Date() })
        .where(eq(crmSalesTargets.id, existing.id))
        .returning()
      return updated
    }
    const [created] = await db.insert(crmSalesTargets)
      .values({ orgId: ctx.orgId, month: monthDate, targetValue: String(input.targetValue), createdById: ctx.userId })
      .returning()
    return created
  })
}

// ─── Wave 75 (CRM Intelligence, AI_OS_CERTIFICATION.md §3.3 NOT_BUILT) ────
// crmLeads/crmOpportunities were pure CRUD with zero AI reasoning. Both
// functions reason over each record's own structured fields (source/status/
// contact completeness/age for a lead; stage/value/close-date/age for an
// opportunity) -- there's no free-text notes field on either table today,
// so this is genuinely all the signal available, not an artificially
// narrowed prompt.
function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

export async function scoreLead(ctx: CrmContext, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const lead = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!lead) throw new ServiceError("Lead not found", 404, { code: "NOT_FOUND" })

    // VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md §3/#6: lead.name is the one
    // genuinely user-authored field reaching the model here (everything
    // else in userMessage below is system-derived from DB columns) -- a
    // prompt-injection or personal-use payload smuggled into a lead name
    // at creation time is the real threat model for this call site, so
    // that's the exact text checked, not the whole constructed message.
    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.score_lead" },
      lead.name
    )
    if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 403, { code: "AI_REFUSED" })

    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503, { code: "AI_NOT_CONFIGURED" })

    const systemPrompt = await resolvePromptTemplate("crm_intelligence.score_lead")
    const userMessage = `Lead: "${lead.name}"\nSource: ${lead.source ?? "unknown"}\nStatus: ${lead.status}\nHas email: ${!!lead.contactEmail}\nHas phone: ${!!lead.contactPhone}\nDays since created: ${daysSince(lead.createdAt)}\nDays since last update: ${daysSince(lead.updatedAt)}`

    const startedAt = Date.now()
    // AI Architecture / Explainability & Transparency gap-closure
    // (2026-07-18, migration 0225): confidence/assumptions/rejectedAlternatives
    // are requested by the bumped prompt version (see that migration) but
    // stay optional on the response type -- an org whose model config still
    // resolves an older cached/BYO prompt (or a model that ignores part of
    // the schema) shouldn't 500 on missing fields, just fall back to no
    // explanation extras, same honesty posture as every other AI call site.
    const { data: result, usage } = await callLLMJson<{
      score: number; reasoning: string; recommendedAction: string
      confidence?: "low" | "medium" | "high"; assumptions?: string[]
      rejectedAlternatives?: { option: string; reason: string }[]
    }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 500 }, modelConfig.fallback
    )

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.score_lead",
      input: { leadId }, output: { score: result.score },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    const [updated] = await db.update(crmLeads).set({
      aiScore: Math.round(result.score), aiScoreReasoning: result.reasoning,
      aiRecommendedAction: result.recommendedAction, aiScoredAt: new Date(),
      aiConfidence: result.confidence ?? null,
      aiAssumptions: result.assumptions ?? [],
      aiRejectedAlternatives: result.rejectedAlternatives ?? [],
    }).where(eq(crmLeads.id, leadId)).returning()
    return updated
  })
}

export async function analyzeOpportunity(ctx: CrmContext, opportunityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const opp = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!opp) throw new ServiceError("Opportunity not found", 404, { code: "NOT_FOUND" })

    // Same reasoning as scoreLead() above -- opp.name is the only
    // user-authored text reaching the model here.
    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.analyze_opportunity" },
      opp.name
    )
    if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 403, { code: "AI_REFUSED" })

    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503, { code: "AI_NOT_CONFIGURED" })

    const systemPrompt = await resolvePromptTemplate("crm_intelligence.analyze_opportunity")
    const userMessage = `Opportunity: "${opp.name}"\nStage: ${opp.stage}\nEstimated value: ${opp.estimatedValue ?? "unknown"}\nExpected close date: ${opp.expectedCloseDate ?? "unknown"}\nDays since created: ${daysSince(opp.createdAt)}\nDays since last update: ${daysSince(opp.updatedAt)}`

    const startedAt = Date.now()
    // Same optional-extras posture as scoreLead() above.
    const { data: result, usage } = await callLLMJson<{
      winProbability: number; riskFactors: string[]; recommendedAction: string
      confidence?: "low" | "medium" | "high"; assumptions?: string[]
      rejectedAlternatives?: { option: string; reason: string }[]
    }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 600 }, modelConfig.fallback
    )

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.analyze_opportunity",
      input: { opportunityId }, output: { winProbability: result.winProbability },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    const [updated] = await db.update(crmOpportunities).set({
      aiWinProbability: Math.round(result.winProbability), aiRiskFactors: result.riskFactors ?? [],
      aiRecommendedAction: result.recommendedAction, aiAnalyzedAt: new Date(),
      aiConfidence: result.confidence ?? null,
      aiAssumptions: result.assumptions ?? [],
      aiRejectedAlternatives: result.rejectedAlternatives ?? [],
    }).where(eq(crmOpportunities.id, opportunityId)).returning()
    return updated
  })
}

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain AI Decisions"/"Explains Why a Decision Was Made" -- a
// general-purpose way to fetch the AiDecisionExplanation for a scored
// lead/analyzed opportunity, for a shared UI ("explain this AI decision")
// surface to call instead of each caller re-deriving the shape by hand.
export async function explainCrmAiDecision(ctx: { orgId: string }, entityType: "lead" | "opportunity", entityId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    if (entityType === "lead") {
      const lead = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, entityId), eq(crmLeads.orgId, ctx.orgId)) })
      if (!lead) throw new ServiceError("Lead not found", 404, { code: "NOT_FOUND" })
      return explainCrmLeadDecision(lead)
    }
    const opp = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, entityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!opp) throw new ServiceError("Opportunity not found", 404, { code: "NOT_FOUND" })
    return explainCrmOpportunityDecision(opp)
  })
}

// ─── Wave 78 (Multi-Agent Chaining, AI_OS_CERTIFICATION.md §2.2 NOT_BUILT) ─
// scoreLead/analyzeOpportunity's aiRecommendedAction was a read-only
// suggestion nothing ever acted on. This turns it into literal input to a
// second, independent AI call -- task-execution-engine.ts's own planning
// pass (worker-agent dispatch + Wave 77 memory read-back) -- rather than a
// generic event bus. Still human-gated by the explicit call here, matching
// task-execution-engine's own "no unattended write action" doctrine.
//
// GP-20 Phase 2 (CONSTITUTION.yaml, task-dependency-graph cycle detection):
// this is the one real place in this codebase where one task's processing
// spawns AND dispatches (executes) a second, distinct `tasks` row -- so it's
// the real call site the new escalation-edge guard hooks into. `fromTaskId`,
// when the caller knows this follow-up was itself raised while working an
// existing task, is recorded as a real entity_relationships edge
// (task -> task, 'escalates_to') via recordTaskEscalationEdge(), which
// refuses (ServiceError) before this insert ever runs if the edge would
// close a cycle back to an ancestor task. Optional and additive -- omitting
// it (every caller before this change) behaves exactly as before.
async function createChainedTask(ctx: CrmContext, title: string, description: string, fromTaskId?: string | null) {
  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: ctx.userId, assignedById: ctx.userId, title, description, status: "in_progress",
    }).returning()
    if (fromTaskId) {
      await recordTaskEscalationEdge(db, { orgId: ctx.orgId, fromTaskId, toTaskId: task.id, reason: "chained_follow_up_task" })
    }
    return task
  })
  await executeTask(ctx.orgId, ctx.userId, created.id, created.title, created.description, null, null)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) => db.query.tasks.findFirst({ where: eq(tasks.id, created.id) }))
}

export async function createFollowUpTaskFromLead(ctx: CrmContext, leadId: string, fromTaskId?: string | null) {
  await requireSalesEnabled(ctx.orgId)
  const lead = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
  )
  if (!lead) throw new ServiceError("Lead not found", 404)
  if (!lead.aiRecommendedAction) throw new ServiceError("Score this lead first to get an AI-recommended action", 400)
  return createChainedTask(ctx, `Follow up: ${lead.name}`, lead.aiRecommendedAction, fromTaskId)
}

export async function createFollowUpTaskFromOpportunity(ctx: CrmContext, opportunityId: string, fromTaskId?: string | null) {
  await requireSalesEnabled(ctx.orgId)
  const opp = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
  )
  if (!opp) throw new ServiceError("Opportunity not found", 404)
  if (!opp.aiRecommendedAction) throw new ServiceError("Analyze this opportunity first to get an AI-recommended action", 400)
  return createChainedTask(ctx, `Follow up: ${opp.name}`, opp.aiRecommendedAction, fromTaskId)
}


// ─── VERIDIAN CRM Wave 1 (2026-07-21) ─────────────────────────────────────
// CRUD audit finding (Owner-directed completion pass): listLeads/
// listLeadsPaged/createLead/updateLead existed but no single-lead fetch and
// no delete path -- same gap on the opportunity side (listOpportunities/
// listOpportunitiesPaged/createOpportunity/updateOpportunity existed, no
// getOpportunity/deleteOpportunity). Accounts and contacts (crm-accounts-
// service.ts) already had full CRUD including delete -- checked, not a gap
// there. Delete here follows crm-accounts-service.ts's own deleteAccount()
// precedent for the hard-delete-with-referential-blocker shape (this
// schema has no isActive/archivedAt column on crm_leads/crm_opportunities
// to soft-delete against -- confirmed by reading the table definitions
// fresh before writing this, not assumed) -- but deliberately does NOT
// call logActivity() the way crm-accounts-service.ts's deletes do: this
// file's own CrmContext type (unlike crm-accounts-service.ts's
// CrmAccountContext) carries no dbUser, and none of this file's existing
// create/update functions log activity either -- adding it only to these
// two new functions would be an inconsistent, half-applied convention
// borrowed from a different file, not a real fix.

export async function getLead(ctx: { orgId: string }, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
  )
}

export async function deleteLead(ctx: CrmContext, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lead not found", 404)
    // Delete is a reassign-or-delete-grade action, same bar as an ownerId
    // reassignment PATCH above -- canReassignOrDeleteLead exists precisely
    // for this, matching deleteAccount's own assertGate(canReassignOrDelete
    // Account(...)) precedent in crm-accounts-service.ts. This was the one
    // real gap this PR's own audit pass caught before merge: the gate
    // function was added and named for this call site but never wired here.
    if (ctx.role !== undefined) assertGate(canReassignOrDeleteLead(ctx.role))

    const linkedOpportunities = await db.query.crmOpportunities.findMany({
      where: and(eq(crmOpportunities.leadId, leadId), eq(crmOpportunities.orgId, ctx.orgId)), columns: { id: true },
    })
    if (linkedOpportunities.length) {
      throw new ServiceError(
        `Cannot delete this lead -- it still has ${linkedOpportunities.length} linked opportunity/opportunities. Reassign or remove them first.`,
        409
      )
    }

    await db.delete(crmLeads).where(eq(crmLeads.id, leadId))
    return { id: leadId }
  })
}

export async function getOpportunity(ctx: { orgId: string }, opportunityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
  )
}

export async function deleteOpportunity(ctx: CrmContext, opportunityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Opportunity not found", 404)
    // Same reassign-or-delete-grade gate as deleteLead above -- see that
    // function's comment for why this was added during this PR's own audit
    // pass rather than left as a silent zero-gate hole in the delete path.
    if (ctx.role !== undefined) assertGate(canReassignOrDeleteOpportunity(ctx.role))
    await db.delete(crmOpportunities).where(eq(crmOpportunities.id, opportunityId))
    return { id: opportunityId }
  })
}

// Structured Lost Reason (Odoo reference: a configurable Lost Reasons
// taxonomy, not free text -- see odoo-reverse-engineering/docs/crm/fields.md
// "Marking a deal 'Lost' is backed by a structured Lost Reasons config
// list... not a free-text field"). Org-configurable, not a hardcoded enum,
// same rationale as this schema's other org-scoped lookup data.
export async function createLostReason(ctx: CrmContext, reasonText: string) {
  await requireSalesEnabled(ctx.orgId)
  const trimmed = reasonText?.trim()
  if (!trimmed) throw new ServiceError("reasonText is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [reason] = await db.insert(crmLostReasons).values({ orgId: ctx.orgId, reasonText: trimmed }).returning()
    return reason
  })
}

export async function listLostReasons(ctx: { orgId: string }, opts: { includeInactive?: boolean } = {}) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmLostReasons.findMany({
      where: opts.includeInactive
        ? eq(crmLostReasons.orgId, ctx.orgId)
        : and(eq(crmLostReasons.orgId, ctx.orgId), eq(crmLostReasons.isActive, true)),
      orderBy: (t, { asc }) => asc(t.reasonText),
    })
  )
}

export async function deactivateLostReason(ctx: { orgId: string }, lostReasonId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.crmLostReasons.findFirst({ where: and(eq(crmLostReasons.id, lostReasonId), eq(crmLostReasons.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lost reason not found", 404)
    const [updated] = await db.update(crmLostReasons).set({ isActive: false }).where(eq(crmLostReasons.id, lostReasonId)).returning()
    return updated
  })
}
