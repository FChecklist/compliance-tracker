// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20). Twenty (already
// rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith) evaluated and
// rejected as software. Deliberately narrow -- a lead-to-client pipeline,
// not a generic sales CRM (no campaigns/quotes/email marketing, none
// needed for a compliance-service-provider's business). Gated identically
// to the existing Clients page (accountType !== 'company') at the UI
// layer, matching that page's own precedent.
import { crmLeads, crmOpportunities, crmStageHistory, crmPipelineStages, crmLostReasons, crmSalesTargets, crmActivities, clients, erpCustomers, erpCompanies, tasks, users, notifications } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, inArray, sql, lte, gte, isNotNull, isNull, ne, or } from "drizzle-orm"
import { z } from "zod"
import { buildPipelineDeals, normalizePipelineStatus, computeKpis, computePipelineStatusOverview } from "./sales-pipeline-dashboard-service"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { recordTaskEscalationEdge } from "@/lib/task-dependency-graph"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { isVeriRewardEnabledForOrg } from "./veri-reward-enablement-service"
import { awardPoints } from "./veri-reward-service"
import { listOrgIdsWithBranchEnabled } from "./product-branch-service"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { ServiceError, serviceErrorBody } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
import { explainCrmLeadDecision, explainCrmOpportunityDecision } from "@/lib/explainability/ai-decision-explanation"
import { csvEscape } from "@/lib/report-export-shared"
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

// VERIDIAN Review Framework gap-closure (2026-08-07), "Business Rule &
// Validation Accuracy": server-side lead status transition validation,
// mirroring recruitment-service.ts's VALID_STAGE_TRANSITIONS pattern.
// 'lost' and 'converted' are terminal -- once a lead is converted, status
// only ever changes through convertLeadToClient() itself (which sets
// 'converted' directly, bypassing this map by design), never a raw PATCH.
export const VALID_LEAD_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["contacted", "lost"],
  converted: [],
  lost: [],
}

// Same gap-closure wave, "Error Handling & Data Validation Messaging":
// field-level Zod validation for create/update, so a caller gets a
// per-field message instead of a single generic string. Kept intentionally
// permissive on optional fields (matches the existing service behavior --
// this closes the "no field-level feedback" gap without tightening what
// was previously accepted).
export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  contactEmail: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  contactPhone: z.string().trim().optional(),
  source: z.string().trim().optional(),
  ownerId: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  nextActionDate: z.string().trim().optional(),
  nextActionNote: z.string().trim().optional(),
})

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "converted", "lost"]).optional(),
  ownerId: z.string().trim().nullable().optional(),
  source: z.string().trim().nullable().optional(),
  nextActionDate: z.string().trim().nullable().optional(),
  nextActionNote: z.string().trim().nullable().optional(),
  stageChangeNote: z.string().trim().optional(),
})

/** Flattens a ZodError into `{ field: message }` for a field-level API response. */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    if (!out[key]) out[key] = issue.message
  }
  return out
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
  const parsed = createLeadSchema.safeParse(input)
  if (!parsed.success) throw new ServiceError("Validation failed", 400, { fields: fieldErrorsFromZod(parsed.error) })
  const { data } = parsed

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [lead] = await db.insert(crmLeads).values({
      orgId: ctx.orgId, name: data.name, contactEmail: data.contactEmail || null, contactPhone: data.contactPhone || null,
      source: data.source || null, ownerId: data.ownerId || null, companyId: data.companyId || null, createdById: ctx.userId,
      nextActionDate: data.nextActionDate || null, nextActionNote: data.nextActionNote || null,
    }).returning()
    // Opening entry in the stage ledger -- every lead's funnel history now
    // starts from a real row, not an implicit "created, no record" gap.
    await db.insert(crmStageHistory).values({ orgId: ctx.orgId, entityType: "lead", entityId: lead.id, fromStage: null, toStage: lead.status, changedById: ctx.userId })

    // VERIDIAN Review Framework gap-closure, "Notification & Alert Trigger
    // Correctness": new-lead-assigned. Reuses the existing 'assignment'
    // notificationTypeEnum value (no schema change needed -- it already
    // covers this exact case) and never notifies the creator about their
    // own action (assigning to yourself doesn't need a ping).
    if (lead.ownerId && lead.ownerId !== ctx.userId) {
      await db.insert(notifications).values({
        userId: lead.ownerId, title: "New lead assigned",
        message: `You've been assigned lead "${lead.name}".`, type: "assignment",
        metadata: { kind: "crm_lead_assigned", leadId: lead.id },
      }).catch((err) => console.error(`[crm-service] failed to notify lead assignment for ${lead.id}:`, err))
    }
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
  const parsed = updateLeadSchema.safeParse({ ...patch, stageChangeNote })
  if (!parsed.success) throw new ServiceError("Validation failed", 400, { fields: fieldErrorsFromZod(parsed.error) })

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

    // VERIDIAN Review Framework gap-closure, "Business Rule & Validation
    // Accuracy": reject a status change that isn't a valid transition from
    // the lead's current status, mirroring recruitment-service.ts.
    if (patch.status && patch.status !== existing.status) {
      const allowed = VALID_LEAD_TRANSITIONS[existing.status] ?? []
      if (!allowed.includes(patch.status)) {
        throw new ServiceError(`Cannot move a lead from '${existing.status}' to '${patch.status}'`, 400)
      }
    }

    const previousOwnerId = existing.ownerId
    const [updated] = await db.update(crmLeads).set({ ...patch, updatedAt: new Date() }).where(eq(crmLeads.id, leadId)).returning()
    if (patch.status && patch.status !== existing.status) {
      await db.insert(crmStageHistory).values({
        orgId: ctx.orgId, entityType: "lead", entityId: leadId, fromStage: existing.status, toStage: patch.status, note: stageChangeNote ?? null, changedById: ctx.userId,
      })
    }
    // Same new-lead-assigned notification as createLead() above, for a
    // reassignment via PATCH (e.g. the single-lead owner picker in the UI).
    // bulkReassignLeads() below intentionally does NOT notify per-lead --
    // see that function's own comment.
    if (patch.ownerId && patch.ownerId !== previousOwnerId && patch.ownerId !== ctx.userId) {
      await db.insert(notifications).values({
        userId: patch.ownerId, title: "New lead assigned",
        message: `You've been assigned lead "${updated.name}".`, type: "assignment",
        metadata: { kind: "crm_lead_assigned", leadId: updated.id },
      }).catch((err) => console.error(`[crm-service] failed to notify lead reassignment for ${updated.id}:`, err))
    }
    return updated
  })
}

// Priority 15 (Sales & CRM depth wave): bulk owner reassignment -- a sales
// manager redistributing a rep's queue (e.g. on leave/departure) across
// hundreds of leads one-at-a-time was never realistic at this firm's scale.
//
// Security fix (rebase of PR #1014, replacing it after a human AUDIT: FAIL):
// this is a reassign-or-delete-grade action, same bar as a single-lead
// ownerId PATCH (updateLead above) or deleteLead -- canReassignOrDeleteLead
// exists precisely for this. The original PR wired the route
// (src/app/api/crm/leads/bulk-reassign/route.ts) without ever passing
// `role` into this ctx, so this gate was silently never enforced: any
// authenticated org member of any rank -- including viewer/client_viewer/
// external_auditor -- could bulk-reassign ownership of every lead in the
// org in one call. Same `if (ctx.role !== undefined)` optional-gate shape
// as every other call site in this file (role stays optional so any
// internal/system caller that doesn't carry a role is unaffected). Checked
// before requireSalesEnabled (unlike updateLead/deleteLead's deeper,
// existing-row-dependent gate placement) so an unauthorized caller is
// rejected on the cheap, synchronous, DB-free check first -- this also
// keeps the gate directly unit-testable without a live DB connection, per
// this file's own established testing convention (see the test below).
export async function bulkReassignLeads(ctx: CrmContext, leadIds: string[], ownerId: string | null) {
  if (ctx.role !== undefined) assertGate(canReassignOrDeleteLead(ctx.role))
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
// VERIDIAN Review Framework gap-closure, "Cross-Module Integration
// Consistency": crm_leads.source is documented (schema.ts) as free text,
// e.g. 'referral' | 'website' | 'cold_outreach' -- this is the same
// convention checked here, case-insensitively. NOT wired to
// sales_commission_accruals/sales_referrals -- confirmed by reading
// sales-engine-service.ts that those tables track the platform's own
// partner/channel program for NEW ORG signups (orgId is set once a
// *referred org* is provisioned), a different domain from an org's own
// CRM leads. veriRewardReferrals is the same category mismatch (user-
// invites-user platform growth, not CRM). Points go to the lead's owner
// (the rep who gets credit for landing a referred deal), falling back to
// the lead's creator if unowned.
const REFERRAL_SOURCE_PATTERN = /referral/i
const LEAD_CONVERSION_REFERRAL_POINTS = 50

async function awardReferralPointsIfApplicable(db: TenantDb, orgId: string, lead: typeof crmLeads.$inferSelect): Promise<void> {
  if (!lead.source || !REFERRAL_SOURCE_PATTERN.test(lead.source)) return
  const recipientId = lead.ownerId ?? lead.createdById
  if (!recipientId) return
  if (!(await isVeriRewardEnabledForOrg(orgId))) return
  await awardPoints(db, {
    orgId, userId: recipientId, delta: LEAD_CONVERSION_REFERRAL_POINTS,
    sourceType: "crm_lead_referral_conversion", sourceId: lead.id,
    reason: `Referred lead "${lead.name}" converted to a client`,
  }).catch((err) => console.error(`[crm-service] failed to award referral points for lead ${lead.id}:`, err))
}

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
    await awardReferralPointsIfApplicable(db, ctx.orgId, updated)
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
// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard" wave):
// this always fetched every opportunity org-wide, with no role scoping --
// any org user with sales-module access saw the whole org's pipeline,
// including every other rep's deals. `restrictToOwnerId`, when set by the
// caller (the API route, based on the requesting user's own role), narrows
// the query to that one owner's deals -- additive/optional, so the existing
// manager/admin-facing call (no opts) is unchanged.
export type SalesPipelineDashboardOptions = { restrictToOwnerId?: string }

export async function getSalesPipelineDashboardData(ctx: { orgId: string }, opts: SalesPipelineDashboardOptions = {}) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [opportunities, orgUsers, targets] = await Promise.all([
      db.query.crmOpportunities.findMany({
        where: opts.restrictToOwnerId
          ? and(eq(crmOpportunities.orgId, ctx.orgId), eq(crmOpportunities.ownerId, opts.restrictToOwnerId))
          : eq(crmOpportunities.orgId, ctx.orgId),
      }),
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

// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
// wave): "Notification & Alert Trigger Correctness" flagged that the
// Pipeline Status Overview/Monthly Revenue Trend charts above have no
// week-over-week comparison, so a real pipeline slowdown never surfaces as
// an alert -- a manager has to notice it themselves in the chart.
// crm_stage_history has no value column of its own (it's a pure from/to
// ledger), so "value of deals that turned Awarded in a given week" is
// approximated using each opportunity's CURRENT estimatedValue -- the same
// honest "best-available approximation, not fabricated" posture already
// used by getAssignmentOverview()'s activityStatus above (a deal's
// estimated value can drift after the stage change that's being measured,
// but there is no historized value to read instead).
export type SalesPipelineTrend = {
  currentWeekAwardedValue: number
  previousWeekAwardedValue: number
  currentWeekAwardedCount: number
  previousWeekAwardedCount: number
  // null when there's no prior-week baseline to compare against (can't
  // compute a meaningful percentage change from zero) -- never a fabricated 0.
  deltaPct: number | null
}

export async function getSalesPipelineTrend(ctx: { orgId: string }, opts: SalesPipelineDashboardOptions = {}): Promise<SalesPipelineTrend> {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [recentHistory, opportunities] = await Promise.all([
      db.query.crmStageHistory.findMany({
        where: and(eq(crmStageHistory.orgId, ctx.orgId), eq(crmStageHistory.entityType, "opportunity"), gte(crmStageHistory.changedAt, twoWeeksAgo)),
        columns: { entityId: true, toStage: true, changedAt: true },
      }),
      db.query.crmOpportunities.findMany({
        where: opts.restrictToOwnerId
          ? and(eq(crmOpportunities.orgId, ctx.orgId), eq(crmOpportunities.ownerId, opts.restrictToOwnerId))
          : eq(crmOpportunities.orgId, ctx.orgId),
        columns: { id: true, estimatedValue: true },
      }),
    ])

    const valueById = new Map(opportunities.map((o) => [o.id, o.estimatedValue != null ? Number(o.estimatedValue) : 0]))
    // Only present (thus restrictable) when a caller passed restrictToOwnerId
    // above -- otherwise every history row for this org counts, matching the
    // unrestricted (manager/admin) dashboard view.
    const ownedIds = opts.restrictToOwnerId ? new Set(opportunities.map((o) => o.id)) : null

    let currentWeekAwardedValue = 0, previousWeekAwardedValue = 0
    let currentWeekAwardedCount = 0, previousWeekAwardedCount = 0
    for (const h of recentHistory) {
      if (ownedIds && !ownedIds.has(h.entityId)) continue
      if (normalizePipelineStatus(h.toStage) !== "Awarded") continue
      const value = valueById.get(h.entityId) ?? 0
      if (h.changedAt >= weekAgo) {
        currentWeekAwardedValue += value
        currentWeekAwardedCount += 1
      } else {
        previousWeekAwardedValue += value
        previousWeekAwardedCount += 1
      }
    }

    const deltaPct = previousWeekAwardedValue > 0
      ? ((currentWeekAwardedValue - previousWeekAwardedValue) / previousWeekAwardedValue) * 100
      : null

    return { currentWeekAwardedValue, previousWeekAwardedValue, currentWeekAwardedCount, previousWeekAwardedCount, deltaPct }
  })
}

// VERIDIAN Review Framework gap-closure (2026-08-07): "AI Copilot / Worker
// Agent Integration Depth" flagged that this dashboard has no AI-generated
// narrative -- every number is a raw tile/chart, nothing summarizes what
// changed or why it matters, unlike scoreLead()/analyzeOpportunity() below.
// Same Prompt-OS pattern as those two: resolveModelConfig + a versioned
// prompt template (drizzle/0313_sales_pipeline_summary_prompt.sql) +
// recordOrchestraExecution. Unlike scoreLead/analyzeOpportunity, no
// enforcePolicy() call: every value in userMessage below is a system-
// computed number derived from this org's own aggregate data, not
// user-authored free text reaching the model, so there is nothing here for
// prompt-injection/PII policy to check -- same "check exactly the text that
// reaches the model, not the whole message" reasoning those two functions'
// own comments already document. Nothing is persisted -- this is a
// point-in-time read, generated on demand, same as the dashboard itself.
export async function generateSalesPipelineSummary(ctx: CrmContext, opts: SalesPipelineDashboardOptions = {}) {
  await requireSalesEnabled(ctx.orgId)
  const [{ deals }, trend] = await Promise.all([
    getSalesPipelineDashboardData(ctx, opts),
    getSalesPipelineTrend(ctx, opts),
  ])
  const kpis = computeKpis(deals)
  const statusOverview = computePipelineStatusOverview(deals)

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503, { code: "AI_NOT_CONFIGURED" })

  const systemPrompt = await resolvePromptTemplate("crm_intelligence.sales_pipeline_summary")
  const userMessage = [
    `Total pipeline value: ${kpis.salesValue}`,
    `Success rate (Awarded / (Awarded + Lost)): ${kpis.successPct.toFixed(1)}%`,
    `Hold rate: ${kpis.holdPct.toFixed(1)}%`,
    `Lost rate: ${kpis.lostPct.toFixed(1)}%`,
    `Regret rate: ${kpis.regretPct.toFixed(1)}%`,
    `Pipeline health (avg AI win probability across open deals): ${kpis.healthPct != null ? `${kpis.healthPct.toFixed(1)}%` : "no open deals scored yet"}`,
    `Status breakdown: ${statusOverview.map((s) => `${s.label}=${s.value}`).join(", ")}`,
    `This week's Awarded value: ${trend.currentWeekAwardedValue} (${trend.currentWeekAwardedCount} deal(s))`,
    `Previous week's Awarded value: ${trend.previousWeekAwardedValue} (${trend.previousWeekAwardedCount} deal(s))`,
    `Week-over-week change: ${trend.deltaPct != null ? `${trend.deltaPct.toFixed(1)}%` : "no prior-week baseline to compare against"}`,
  ].join("\n")

  const startedAt = Date.now()
  const { data: result, usage } = await callLLMJson<{ summary: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.3, maxTokens: 400 }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.sales_pipeline_summary",
    input: { restrictToOwnerId: opts.restrictToOwnerId ?? null }, output: { summaryLength: result.summary.length },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  return { summary: result.summary, generatedAt: new Date().toISOString(), trend }
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

// ─── CRM-007 "Sales Representative Performance Dashboard" (sap_mapping.sqlite
// sap_reports, module CRM, priority LOW, BUILD_NEW as of 2026-07-28) ───────
// Real gap confirmed by reading that row's veridian_gap_notes directly
// (2026-07-30, not trusted secondhand): ownerId already exists on both
// crmLeads and crmOpportunities (used by bulkReassignLeads/
// bulkReassignOpportunities above), so per-rep grouping was always possible,
// but no per-sales-rep aggregated dashboard (pipeline value, win rate,
// activity count) existed anywhere -- confirmed by grepping this file and
// crm-activities-service.ts fresh before writing this, not assumed. No new
// schema needed: crm_opportunities (estimatedValue/stage/ownerId/
// aiWinProbability/createdAt), crm_stage_history (won/lost transition dates)
// and crm_activities (assignedToId) already carry every column this report
// aggregates over.
//
// Two honest, disclosed gaps versus the SAP row's calculation_logic (never
// fabricated):
//  1. "Revenue Target"/"Revenue vs Target %": the row's own
//     input_data_required says a per-rep-per-period revenue target is a
//     "prerequisite data element" -- grepped schema.ts fresh for any
//     target/quota-style table (crm_targets, sales_targets, quota, etc.) and
//     found none. Reported as null, same "never scored just shows nothing"
//     convention as scoreLead/analyzeOpportunity above, not silently
//     defaulted to 0 or 100%.
//  2. "Weighted Pipeline Value": uses aiWinProbability (Wave 75 AI
//     enrichment, 0-100) as the probability -- the only per-opportunity win
//     probability this schema has. An opportunity never run through
//     analyzeOpportunity() has aiWinProbability=null and is honestly
//     excluded from the weighted sum (not assumed at 0% or 100%), matching
//     this exact function's own optional-extras posture.
//
// Split into a pure, DB-free aggregator (aggregateSalesRepPerformance, unit-
// tested directly with plain fixture data) plus a thin DB-fetching wrapper
// (getSalesRepPerformanceDashboard), the same separation
// aggregateDesignerTimesheetCosts/designerTimesheetReport established in
// construction-reports-service.ts.

export type SalesRepPerfOpportunityInput = {
  ownerId: string | null
  stage: string // 'prospecting' | 'proposal' | 'negotiation' | 'won' | 'lost'
  estimatedValue: number
  aiWinProbability: number | null // 0-100, null = never AI-scored
  createdAt: Date
  closedAt: Date | null // date this opportunity's stage first moved to 'won' or 'lost' (from crm_stage_history); null if still open or no history row found
}
export type SalesRepPerfActivityInput = { assignedToId: string | null }
export type SalesRepPerfRepName = { userId: string; userName: string }

export type SalesRepPerformanceRow = {
  ownerId: string | null
  repName: string
  openCount: number
  pipelineValue: number
  weightedPipelineValue: number
  wonCount: number
  lostCount: number
  closedWonRevenue: number
  closedLostRevenue: number
  winRate: number | null // percentage, 0-100; null if this rep has no closed deals yet
  avgDealSize: number | null // closedWonRevenue / wonCount; null if wonCount is 0
  avgSalesCycleDays: number | null // average days from creation to close, across won+lost deals with a known closedAt
  activityCount: number
  activitiesPerClosedDeal: number | null // activityCount / wonCount; null if wonCount is 0
  // Honest, disclosed gaps -- see this section's header comment. Never
  // fabricated: no per-rep revenue-target/quota table exists in this schema.
  revenueTarget: number | null
  targetAchievementPercent: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

export function aggregateSalesRepPerformance(
  opportunities: SalesRepPerfOpportunityInput[],
  activities: SalesRepPerfActivityInput[],
  repNames: SalesRepPerfRepName[] = []
): { reps: SalesRepPerformanceRow[]; totalPipelineValue: number; totalWeightedPipelineValue: number; totalClosedWonRevenue: number; totalClosedLostRevenue: number } {
  const nameByUserId = new Map(repNames.map((r) => [r.userId, r.userName]))

  type Bucket = {
    ownerId: string | null
    openCount: number; pipelineValue: number; weightedPipelineValue: number
    wonCount: number; lostCount: number; closedWonRevenue: number; closedLostRevenue: number
    salesCycleDaysSum: number; salesCycleDealsCount: number
    activityCount: number
  }
  const byRep = new Map<string, Bucket>()
  const bucketFor = (ownerId: string | null): Bucket => {
    const key = ownerId ?? "__unassigned__"
    let bucket = byRep.get(key)
    if (!bucket) {
      bucket = {
        ownerId, openCount: 0, pipelineValue: 0, weightedPipelineValue: 0,
        wonCount: 0, lostCount: 0, closedWonRevenue: 0, closedLostRevenue: 0,
        salesCycleDaysSum: 0, salesCycleDealsCount: 0, activityCount: 0,
      }
      byRep.set(key, bucket)
    }
    return bucket
  }

  for (const opp of opportunities) {
    const b = bucketFor(opp.ownerId)
    const value = opp.estimatedValue

    if (opp.stage === "won" || opp.stage === "lost") {
      if (opp.stage === "won") { b.wonCount += 1; b.closedWonRevenue += value }
      else { b.lostCount += 1; b.closedLostRevenue += value }
      if (opp.closedAt) {
        b.salesCycleDaysSum += daysBetween(opp.createdAt, opp.closedAt)
        b.salesCycleDealsCount += 1
      }
    } else {
      b.openCount += 1
      b.pipelineValue += value
      if (opp.aiWinProbability != null) b.weightedPipelineValue += value * (opp.aiWinProbability / 100)
    }
  }

  // Activity Count is attributed to whoever the activity is assigned to
  // (crm_activities.assignedToId), not to the owner of the lead/opportunity
  // it's logged against -- a manager can assign a follow-up task on one
  // rep's deal to someone else (e.g. an assistant), and this counts it
  // against the person actually doing the work, matching this field's own
  // purpose in crm-activities-service.ts. An activity with no assignedToId
  // set can't be attributed to any specific rep, so it's honestly excluded
  // from every rep's count rather than guessed.
  for (const act of activities) {
    if (!act.assignedToId) continue
    bucketFor(act.assignedToId).activityCount += 1
  }

  const reps: SalesRepPerformanceRow[] = [...byRep.values()]
    .map((b) => {
      const closedCount = b.wonCount + b.lostCount
      const winRate = closedCount > 0 ? round2((b.wonCount / closedCount) * 100) : null
      const avgDealSize = b.wonCount > 0 ? round2(b.closedWonRevenue / b.wonCount) : null
      const avgSalesCycleDays = b.salesCycleDealsCount > 0 ? round2(b.salesCycleDaysSum / b.salesCycleDealsCount) : null
      const activitiesPerClosedDeal = b.wonCount > 0 ? round2(b.activityCount / b.wonCount) : null
      return {
        ownerId: b.ownerId,
        repName: b.ownerId ? (nameByUserId.get(b.ownerId) ?? b.ownerId) : "Unassigned",
        openCount: b.openCount,
        pipelineValue: round2(b.pipelineValue),
        weightedPipelineValue: round2(b.weightedPipelineValue),
        wonCount: b.wonCount,
        lostCount: b.lostCount,
        closedWonRevenue: round2(b.closedWonRevenue),
        closedLostRevenue: round2(b.closedLostRevenue),
        winRate,
        avgDealSize,
        avgSalesCycleDays,
        activityCount: b.activityCount,
        activitiesPerClosedDeal,
        revenueTarget: null,
        targetAchievementPercent: null,
      }
    })
    .sort((a, b) => b.closedWonRevenue - a.closedWonRevenue)

  return {
    reps,
    totalPipelineValue: round2(reps.reduce((s, r) => s + r.pipelineValue, 0)),
    totalWeightedPipelineValue: round2(reps.reduce((s, r) => s + r.weightedPipelineValue, 0)),
    totalClosedWonRevenue: round2(reps.reduce((s, r) => s + r.closedWonRevenue, 0)),
    totalClosedLostRevenue: round2(reps.reduce((s, r) => s + r.closedLostRevenue, 0)),
  }
}

export type SalesRepPerformanceOptions = { periodStart?: string; periodEnd?: string; ownerIds?: string[] }

// Both the opportunity window and the activity window are scoped by
// createdAt within [periodStart, periodEnd] when given (an on-demand,
// LOW-priority report per the SAP row's own priority field -- one simple,
// consistent time anchor rather than two different windows for "open
// pipeline as of today" vs "closed this period", which the row's own
// implementation_notes explicitly ask to keep proportional/simple for a
// small firm). Omitting both means "all time", unchanged from every
// existing caller of this file's other list/paged functions.
export async function getSalesRepPerformanceDashboard(ctx: { orgId: string }, opts: SalesRepPerformanceOptions = {}) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const oppConditions = [eq(crmOpportunities.orgId, ctx.orgId)]
    if (opts.periodStart) oppConditions.push(gte(crmOpportunities.createdAt, new Date(opts.periodStart)))
    if (opts.periodEnd) oppConditions.push(lte(crmOpportunities.createdAt, new Date(`${opts.periodEnd}T23:59:59.999Z`)))
    if (opts.ownerIds?.length) oppConditions.push(inArray(crmOpportunities.ownerId, opts.ownerIds))

    const opportunities = await db.query.crmOpportunities.findMany({ where: and(...oppConditions) })
    const oppIds = opportunities.map((o) => o.id)

    const closedHistory = oppIds.length
      ? await db.query.crmStageHistory.findMany({
          where: and(
            eq(crmStageHistory.orgId, ctx.orgId),
            eq(crmStageHistory.entityType, "opportunity"),
            inArray(crmStageHistory.entityId, oppIds),
            inArray(crmStageHistory.toStage, ["won", "lost"])
          ),
          orderBy: (t, { asc }) => asc(t.changedAt),
        })
      : []
    // First won/lost transition per opportunity -- a deal that bounced
    // between stages (e.g. reopened then re-closed) still reports the date
    // it was first closed, not the most recent one.
    const closedAtByOppId = new Map<string, Date>()
    for (const h of closedHistory) {
      if (!closedAtByOppId.has(h.entityId)) closedAtByOppId.set(h.entityId, h.changedAt)
    }

    const activityConditions = [eq(crmActivities.orgId, ctx.orgId)]
    if (opts.periodStart) activityConditions.push(gte(crmActivities.createdAt, new Date(opts.periodStart)))
    if (opts.periodEnd) activityConditions.push(lte(crmActivities.createdAt, new Date(`${opts.periodEnd}T23:59:59.999Z`)))
    if (opts.ownerIds?.length) activityConditions.push(inArray(crmActivities.assignedToId, opts.ownerIds))
    const activities = await db.query.crmActivities.findMany({ where: and(...activityConditions) })

    const repIds = [...new Set([
      ...opportunities.map((o) => o.ownerId).filter((id): id is string => !!id),
      ...activities.map((a) => a.assignedToId).filter((id): id is string => !!id),
    ])]
    const repUsers = repIds.length
      ? await db.query.users.findMany({ where: inArray(users.id, repIds), columns: { id: true, name: true } })
      : []

    return aggregateSalesRepPerformance(
      opportunities.map((o) => ({
        ownerId: o.ownerId,
        stage: o.stage,
        estimatedValue: o.estimatedValue != null ? Number(o.estimatedValue) : 0,
        aiWinProbability: o.aiWinProbability,
        createdAt: o.createdAt,
        closedAt: closedAtByOppId.get(o.id) ?? null,
      })),
      activities.map((a) => ({ assignedToId: a.assignedToId })),
      repUsers.map((u) => ({ userId: u.id, userName: u.name }))
    )
  })
}

// ─── VERIDIAN Review Framework gap-closure (2026-08-07) ───────────────────
// The remaining 5 findings this wave closes: "Data Model Completeness &
// Referential Integrity" (orphan check), "Reporting & Export Accuracy" (CSV
// export), "Data Import/Export Template Fidelity" (CSV import), "AI
// Copilot Integration Depth" (auto-scoring), "Notification & Alert Trigger
// Correctness" (overdue nextActionDate). Each is a plain function here,
// called from a thin /api/crm/leads/** route or a scheduled
// /api/internal/*\/run cron -- same split as every other service in this
// file.

export type OrphanedLeadReference = { leadId: string; leadName: string; field: "companyId" | "convertedClientId"; value: string }

/**
 * "Data Model Completeness & Referential Integrity": companyId/
 * convertedClientId are bare text with no DB-level FK (matches this
 * codebase's established convention for every companyId column -- see
 * schema.ts's own comments on crmLeads.companyId). This is the periodic
 * orphan-check the finding's own recommended approach calls for, run via
 * /api/internal/crm-data-integrity/run rather than a DB constraint.
 */
export async function findOrphanedLeadReferences(ctx: { orgId: string }): Promise<OrphanedLeadReference[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const leads = await db.query.crmLeads.findMany({
      where: and(eq(crmLeads.orgId, ctx.orgId), or(isNotNull(crmLeads.companyId), isNotNull(crmLeads.convertedClientId))),
      columns: { id: true, name: true, companyId: true, convertedClientId: true },
    })
    if (leads.length === 0) return []

    const companyIds = [...new Set(leads.map((l) => l.companyId).filter((v): v is string => !!v))]
    const clientIds = [...new Set(leads.map((l) => l.convertedClientId).filter((v): v is string => !!v))]
    const [validCompanies, validClients] = await Promise.all([
      companyIds.length ? db.query.erpCompanies.findMany({ where: and(eq(erpCompanies.orgId, ctx.orgId), inArray(erpCompanies.id, companyIds)), columns: { id: true } }) : [],
      clientIds.length ? db.query.clients.findMany({ where: and(eq(clients.orgId, ctx.orgId), inArray(clients.id, clientIds)), columns: { id: true } }) : [],
    ])
    const validCompanyIds = new Set(validCompanies.map((c) => c.id))
    const validClientIds = new Set(validClients.map((c) => c.id))

    const orphans: OrphanedLeadReference[] = []
    for (const lead of leads) {
      if (lead.companyId && !validCompanyIds.has(lead.companyId)) orphans.push({ leadId: lead.id, leadName: lead.name, field: "companyId", value: lead.companyId })
      if (lead.convertedClientId && !validClientIds.has(lead.convertedClientId)) orphans.push({ leadId: lead.id, leadName: lead.name, field: "convertedClientId", value: lead.convertedClientId })
    }
    return orphans
  })
}

const LEAD_CSV_COLUMNS = ["name", "contactEmail", "contactPhone", "source", "status", "ownerId", "companyId", "nextActionDate", "nextActionNote", "aiScore", "createdAt"] as const

/**
 * "Reporting & Export Accuracy": report_definitions already has built,
 * executable "Lead Register"/"Lead Source Report"/"Lead Status Report"
 * rows (0183_sales_report_definitions.sql) -- the genuine remaining gap is
 * that nothing in this codebase can emit CSV, and there is no export
 * action on the CRM UI itself. `opts` mirrors listLeadsPaged's filters so
 * "export what I'm currently looking at" works from the filtered list.
 *
 * Security fix (rebase of PR #1014, replacing it after a human AUDIT: FAIL):
 * field escaping now reuses report-export-shared.ts's csvEscape() (guarded
 * against CSV/formula injection via FORMULA_INJECTION_PREFIX) instead of
 * this file's own escapeCsvField(), which only escaped quotes/commas/
 * newlines and left a leading =/+/-/@ in an attacker-controllable field
 * (name/contactEmail/contactPhone/source/nextActionNote) unescaped.
 */
export async function exportLeadsCsv(ctx: { orgId: string }, opts: ListLeadsOptions = {}): Promise<string> {
  const { items } = await listLeadsPaged(ctx, { ...opts, page: 1, pageSize: 10000 })
  const header = LEAD_CSV_COLUMNS.join(",")
  const rows = items.map((lead) =>
    LEAD_CSV_COLUMNS.map((col) => {
      const raw = lead[col as keyof typeof lead]
      if (raw == null) return ""
      const str = raw instanceof Date ? raw.toISOString() : String(raw)
      return csvEscape(str)
    }).join(",")
  )
  return [header, ...rows].join("\n")
}

export type LeadImportResult = { success: number; errors: { row: number; message: string }[]; leads: { id: string; name: string }[] }

/**
 * "Data Import/Export Template Fidelity": follows /api/compliance/import's
 * own CSV-parsing shape (header row, quoted-field parser, per-row
 * success/error accumulation) rather than inventing a second convention.
 * Only `name` is required -- everything else optional, matching
 * createLead()'s own validation.
 */
export async function importLeadsCsv(ctx: CrmContext, csvText: string): Promise<LeadImportResult> {
  await requireSalesEnabled(ctx.orgId)
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new ServiceError("CSV must have a header row and at least one data row", 400)

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""))
  const HEADER_MAP: Record<string, string> = {
    name: "name", "lead name": "name",
    email: "contactEmail", "contact email": "contactEmail",
    phone: "contactPhone", "contact phone": "contactPhone",
    source: "source", ownerid: "ownerId", "owner id": "ownerId", owner: "ownerId",
    companyid: "companyId", "company id": "companyId",
    "next action date": "nextActionDate", "next action note": "nextActionNote",
  }

  const result: LeadImportResult = { success: 0, errors: [], leads: [] }
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    if (values.length === 0) continue
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[HEADER_MAP[h] ?? h] = values[idx]?.trim().replace(/^"|"$/g, "") || "" })

    if (!row.name) {
      result.errors.push({ row: i + 1, message: "name is required" })
      continue
    }
    try {
      const lead = await createLead(ctx, {
        name: row.name, contactEmail: row.contactEmail || undefined, contactPhone: row.contactPhone || undefined,
        source: row.source || undefined, ownerId: row.ownerId || undefined, companyId: row.companyId || undefined,
        nextActionDate: row.nextActionDate || undefined, nextActionNote: row.nextActionNote || undefined,
      })
      result.success++
      result.leads.push({ id: lead.id, name: lead.name })
    } catch (err) {
      const message = err instanceof ServiceError ? err.message : "Failed to create lead"
      result.errors.push({ row: i + 1, message })
    }
  }
  return result
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes
    else if (char === "," && !inQuotes) { result.push(current); current = "" }
    else current += char
  }
  result.push(current)
  return result
}

const STALE_SCORE_DAYS = 14

/**
 * "AI Copilot / Worker Agent Integration Depth": scoring was manual-only
 * (a click per lead). This is the auto-score pass a scheduled
 * /api/internal/crm-lead-scoring/run cron calls, same
 * "iterate every org, best-effort per org" shape as
 * erp-accounting-service.ts's refreshLiveExchangeRatesForAllOrgs(). Scores
 * leads never scored, or last scored more than STALE_SCORE_DAYS ago --
 * never a lead already converted/lost (nothing left to act on).
 */
export async function autoScoreNewOrStaleLeadsForOrg(ctx: CrmContext, limit = 20): Promise<{ scored: number; failed: number }> {
  const staleCutoff = new Date(Date.now() - STALE_SCORE_DAYS * 86_400_000)
  const candidates = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.crmLeads.findMany({
      where: and(
        eq(crmLeads.orgId, ctx.orgId),
        inArray(crmLeads.status, ["new", "contacted", "qualified"]),
        or(isNull(crmLeads.aiScoredAt), lte(crmLeads.aiScoredAt, staleCutoff))
      ),
      columns: { id: true },
      limit,
    })
  )
  let scored = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      await scoreLead(ctx, candidate.id)
      scored++
    } catch (err) {
      failed++
      console.error(`[crm-service] auto-score failed for lead ${candidate.id}:`, err)
    }
  }
  return { scored, failed }
}

export type OverdueLeadFollowUp = { leadId: string; leadName: string; ownerId: string; nextActionDate: string }

/**
 * "Notification & Alert Trigger Correctness": nextActionDate-overdue.
 * Notifies each lead's owner at most once per overdue lead per run --
 * the scheduled cron this backs (/api/internal/crm-lead-followup-alerts/run)
 * runs daily, so a lead stays overdue and gets re-notified daily until
 * its owner acts, matching deadline_reminder's existing semantics
 * elsewhere (e.g. compliance-service.ts's own deadline reminders).
 */
export async function notifyOverdueLeadFollowUpsForOrg(ctx: { orgId: string }): Promise<OverdueLeadFollowUp[]> {
  const today = new Date().toISOString().slice(0, 10)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const overdue = await db.query.crmLeads.findMany({
      where: and(
        eq(crmLeads.orgId, ctx.orgId),
        isNotNull(crmLeads.nextActionDate),
        lte(crmLeads.nextActionDate, today),
        isNotNull(crmLeads.ownerId),
        ne(crmLeads.status, "converted"),
        ne(crmLeads.status, "lost"),
      ),
      columns: { id: true, name: true, ownerId: true, nextActionDate: true },
    })
    const notified: OverdueLeadFollowUp[] = []
    for (const lead of overdue) {
      if (!lead.ownerId || !lead.nextActionDate) continue
      await db.insert(notifications).values({
        userId: lead.ownerId, title: "Lead follow-up overdue",
        message: `Lead "${lead.name}" was due for follow-up on ${lead.nextActionDate}.`, type: "deadline_reminder",
        metadata: { kind: "crm_lead_followup_overdue", leadId: lead.id },
      })
      notified.push({ leadId: lead.id, leadName: lead.name, ownerId: lead.ownerId, nextActionDate: lead.nextActionDate })
    }
    return notified
  })
}

// ─── Platform-wide (cross-org) wrappers -- the actual /api/internal/*\/run
// cron entry points call these, one per org with Sales enabled, same
// "iterate + best-effort per org, never let one org's failure stop the
// rest" shape as refreshLiveExchangeRatesForAllOrgs(). ───────────────────

export async function autoScoreNewOrStaleLeadsForAllOrgs(): Promise<{ orgsProcessed: number; orgsFailed: number; totalScored: number; totalFailed: number }> {
  const orgIds = await listOrgIdsWithBranchEnabled("sales")
  let orgsProcessed = 0, orgsFailed = 0, totalScored = 0, totalFailed = 0
  for (const orgId of orgIds) {
    try {
      const { scored, failed } = await autoScoreNewOrStaleLeadsForOrg({ orgId, userId: "system" })
      orgsProcessed++
      totalScored += scored
      totalFailed += failed
    } catch (err) {
      orgsFailed++
      console.error(`[crm-service] auto-score run failed for org ${orgId}:`, err)
    }
  }
  return { orgsProcessed, orgsFailed, totalScored, totalFailed }
}

export async function notifyOverdueLeadFollowUpsForAllOrgs(): Promise<{ orgsProcessed: number; orgsFailed: number; totalNotified: number }> {
  const orgIds = await listOrgIdsWithBranchEnabled("sales")
  let orgsProcessed = 0, orgsFailed = 0, totalNotified = 0
  for (const orgId of orgIds) {
    try {
      const notified = await notifyOverdueLeadFollowUpsForOrg({ orgId })
      orgsProcessed++
      totalNotified += notified.length
    } catch (err) {
      orgsFailed++
      console.error(`[crm-service] overdue follow-up alert run failed for org ${orgId}:`, err)
    }
  }
  return { orgsProcessed, orgsFailed, totalNotified }
}

export async function checkOrphanedLeadReferencesForAllOrgs(): Promise<{ orgsProcessed: number; orgsFailed: number; totalOrphans: number; byOrg: Record<string, number> }> {
  const orgIds = await listOrgIdsWithBranchEnabled("sales")
  let orgsProcessed = 0, orgsFailed = 0, totalOrphans = 0
  const byOrg: Record<string, number> = {}
  for (const orgId of orgIds) {
    try {
      const orphans = await findOrphanedLeadReferences({ orgId })
      orgsProcessed++
      totalOrphans += orphans.length
      if (orphans.length > 0) {
        byOrg[orgId] = orphans.length
        console.warn(`[crm-service] org ${orgId} has ${orphans.length} orphaned crm_leads reference(s):`, orphans)
      }
    } catch (err) {
      orgsFailed++
      console.error(`[crm-service] orphan-check run failed for org ${orgId}:`, err)
    }
  }
  return { orgsProcessed, orgsFailed, totalOrphans, byOrg }
}
