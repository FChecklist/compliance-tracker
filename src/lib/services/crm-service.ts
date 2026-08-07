// Wave 41 (VERIDIAN CRM, PLATFORM_STRATEGY.md §20). Twenty (already
// rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith) evaluated and
// rejected as software. Deliberately narrow -- a lead-to-client pipeline,
// not a generic sales CRM (no campaigns/quotes/email marketing, none
// needed for a compliance-service-provider's business). Gated identically
// to the existing Clients page (accountType !== 'company') at the UI
// layer, matching that page's own precedent.
import { crmLeads, crmOpportunities, crmStageHistory, clients, erpCustomers, erpCompanies, tasks, notifications } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, ilike, inArray, sql, lte, isNotNull, isNull, ne, or } from "drizzle-orm"
import { z } from "zod"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { isVeriRewardEnabledForOrg } from "./veri-reward-enablement-service"
import { awardPoints } from "./veri-reward-service"
import { listOrgIdsWithBranchEnabled } from "./product-branch-service"
import { ServiceError } from "./compliance-service"
import { requireSalesEnabled } from "./crm-enablement-service"
export { ServiceError }

export type CrmContext = { orgId: string; userId: string }

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
  const parsed = createLeadSchema.safeParse(input)
  if (!parsed.success) throw new ServiceError("Validation failed", 400, fieldErrorsFromZod(parsed.error))
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
        userId: lead.ownerId, orgId: ctx.orgId, title: "New lead assigned",
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
  if (!parsed.success) throw new ServiceError("Validation failed", 400, fieldErrorsFromZod(parsed.error))

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmLeads.findFirst({ where: and(eq(crmLeads.id, leadId), eq(crmLeads.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Lead not found", 404)

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
        userId: patch.ownerId, orgId: ctx.orgId, title: "New lead assigned",
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
  patch: Partial<{ stage: string; estimatedValue: number | null; expectedCloseDate: string | null; ownerId: string | null; nextActionDate: string | null; nextActionNote: string | null }>,
  stageChangeNote?: string
) {
  await requireSalesEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.crmOpportunities.findFirst({ where: and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Opportunity not found", 404)
    const [updated] = await db.update(crmOpportunities)
      .set({ ...patch, estimatedValue: patch.estimatedValue != null ? String(patch.estimatedValue) : undefined, updatedAt: new Date() })
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

// Priority 15 (Sales & CRM depth wave): the pipeline/funnel dashboard's
// cross-cutting rollup -- stage totals + win/loss rate + overdue follow-ups,
// computed directly from crm_leads/crm_opportunities/crm_stage_history
// rather than a separate materialized/cached table (org-scale here, not
// platform-scale, so a live aggregate is cheap enough not to need caching).
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

    const leadsByStatus: Record<string, number> = {}
    for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1

    const opportunitiesByStage: Record<string, { count: number; value: number }> = {}
    for (const o of opportunities) {
      const bucket = (opportunitiesByStage[o.stage] ??= { count: 0, value: 0 })
      bucket.count += 1
      bucket.value += o.estimatedValue != null ? Number(o.estimatedValue) : 0
    }

    const won = opportunities.filter((o) => o.stage === "won").length
    const lost = opportunities.filter((o) => o.stage === "lost").length
    const winRate = won + lost > 0 ? won / (won + lost) : null
    const openPipelineValue = opportunities
      .filter((o) => o.stage !== "won" && o.stage !== "lost")
      .reduce((sum, o) => sum + (o.estimatedValue != null ? Number(o.estimatedValue) : 0), 0)

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

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const LEAD_CSV_COLUMNS = ["name", "contactEmail", "contactPhone", "source", "status", "ownerId", "companyId", "nextActionDate", "nextActionNote", "aiScore", "createdAt"] as const

/**
 * "Reporting & Export Accuracy": report_definitions already has built,
 * executable "Lead Register"/"Lead Source Report"/"Lead Status Report"
 * rows (0183_sales_report_definitions.sql) -- the genuine remaining gap is
 * that nothing in this codebase can emit CSV, and there is no export
 * action on the CRM UI itself. `opts` mirrors listLeadsPaged's filters so
 * "export what I'm currently looking at" works from the filtered list.
 */
export async function exportLeadsCsv(ctx: { orgId: string }, opts: ListLeadsOptions = {}): Promise<string> {
  const { items } = await listLeadsPaged(ctx, { ...opts, page: 1, pageSize: 10000 })
  const header = LEAD_CSV_COLUMNS.join(",")
  const rows = items.map((lead) =>
    LEAD_CSV_COLUMNS.map((col) => {
      const raw = lead[col as keyof typeof lead]
      if (raw == null) return ""
      const str = raw instanceof Date ? raw.toISOString() : String(raw)
      return escapeCsvField(str)
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
        userId: lead.ownerId, orgId: ctx.orgId, title: "Lead follow-up overdue",
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
