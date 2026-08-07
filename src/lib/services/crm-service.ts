// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20). Twenty (already
// rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith) evaluated and
// rejected as software. Deliberately narrow -- a lead-to-client pipeline,
// not a generic sales CRM (no campaigns/quotes/email marketing, none
// needed for a compliance-service-provider's business). Gated identically
// to the existing Clients page (accountType !== 'company') at the UI
// layer, matching that page's own precedent.
import { crmLeads, crmOpportunities, crmStageHistory, crmPipelineStages, clients, erpCustomers, tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, inArray, sql, lte, isNotNull, ne } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
export { ServiceError }

// Sales Pipeline closure (2026-08-07): actorRole is optional and additive --
// every pre-existing call site (createLead, bulkReassignLeads, etc.) keeps
// working unchanged. Only updateOpportunity() reads it, to decide whether a
// caller is allowed to move a deal OUT of a closed (won/lost) stage --
// see isValidStageTransition() below.
export type CrmContext = { orgId: string; userId: string; actorRole?: UserRole }

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
    expectedCloseDate: string | null; ownerId: string | null; nextActionDate: string | null; nextActionNote: string | null
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
// stage" flag. crm_pipeline_stages (drizzle/0225) is the new config table;
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
 * an org's config is always resolvable even if it pre-dates drizzle/0225.
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
    if (!lead) throw new ServiceError("Lead not found", 404)

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
    if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 403)

    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const systemPrompt = await resolvePromptTemplate("crm_intelligence.score_lead")
    const userMessage = `Lead: "${lead.name}"\nSource: ${lead.source ?? "unknown"}\nStatus: ${lead.status}\nHas email: ${!!lead.contactEmail}\nHas phone: ${!!lead.contactPhone}\nDays since created: ${daysSince(lead.createdAt)}\nDays since last update: ${daysSince(lead.updatedAt)}`

    const startedAt = Date.now()
    const { data: result, usage } = await callLLMJson<{ score: number; reasoning: string; recommendedAction: string }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 300 }, modelConfig.fallback
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
    }).where(eq(crmLeads.id, leadId)).returning()
    return updated
  })
}

export async function analyzeOpportunity(ctx: CrmContext, opportunityId: string) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const opp = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!opp) throw new ServiceError("Opportunity not found", 404)

    // Same reasoning as scoreLead() above -- opp.name is the only
    // user-authored text reaching the model here.
    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "crm_intelligence.analyze_opportunity" },
      opp.name
    )
    if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 403)

    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const systemPrompt = await resolvePromptTemplate("crm_intelligence.analyze_opportunity")
    const userMessage = `Opportunity: "${opp.name}"\nStage: ${opp.stage}\nEstimated value: ${opp.estimatedValue ?? "unknown"}\nExpected close date: ${opp.expectedCloseDate ?? "unknown"}\nDays since created: ${daysSince(opp.createdAt)}\nDays since last update: ${daysSince(opp.updatedAt)}`

    const startedAt = Date.now()
    const { data: result, usage } = await callLLMJson<{ winProbability: number; riskFactors: string[]; recommendedAction: string }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 400 }, modelConfig.fallback
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
    }).where(eq(crmOpportunities.id, opportunityId)).returning()
    return updated
  })
}

// ─── Wave 78 (Multi-Agent Chaining, AI_OS_CERTIFICATION.md §2.2 NOT_BUILT) ─
// scoreLead/analyzeOpportunity's aiRecommendedAction was a read-only
// suggestion nothing ever acted on. This turns it into literal input to a
// second, independent AI call -- task-execution-engine.ts's own planning
// pass (worker-agent dispatch + Wave 77 memory read-back) -- rather than a
// generic event bus. Still human-gated by the explicit call here, matching
// task-execution-engine's own "no unattended write action" doctrine.
async function createChainedTask(ctx: CrmContext, title: string, description: string) {
  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: ctx.userId, assignedById: ctx.userId, title, description, status: "in_progress",
    }).returning()
    return task
  })
  await executeTask(ctx.orgId, ctx.userId, created.id, created.title, created.description, null, null)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) => db.query.tasks.findFirst({ where: eq(tasks.id, created.id) }))
}

export async function createFollowUpTaskFromLead(ctx: CrmContext, leadId: string) {
  await requireSalesEnabled(ctx.orgId)
  const lead = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
  )
  if (!lead) throw new ServiceError("Lead not found", 404)
  if (!lead.aiRecommendedAction) throw new ServiceError("Score this lead first to get an AI-recommended action", 400)
  return createChainedTask(ctx, `Follow up: ${lead.name}`, lead.aiRecommendedAction)
}

export async function createFollowUpTaskFromOpportunity(ctx: CrmContext, opportunityId: string) {
  await requireSalesEnabled(ctx.orgId)
  const opp = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
  )
  if (!opp) throw new ServiceError("Opportunity not found", 404)
  if (!opp.aiRecommendedAction) throw new ServiceError("Analyze this opportunity first to get an AI-recommended action", 400)
  return createChainedTask(ctx, `Follow up: ${opp.name}`, opp.aiRecommendedAction)
}
