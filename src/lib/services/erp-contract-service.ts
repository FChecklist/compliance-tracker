// Wave 71 (Contract & Commercial Lifecycle Management) -- per
// COMPARISON_CSV_GAP_ANALYSIS.md, Sales>Contract Management was a complete
// gap. Independently designed to match this codebase's own service-layer
// conventions (erp-procurement-workflow-service.ts's max()+1 per-org
// numbering, erp-returns-service.ts's status-machine shape) -- no
// third-party code copied.
import {
  erpContracts, erpContractAmendments, erpContractBillingSchedules, erpContractRevenueSchedules,
  erpContractObligations, erpSubscriptionPlans, erpSubscriptions, erpCustomers, users,
  clmClauses, clmContractTemplates, clmTemplateClauses, erpContractNegotiationRounds,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"
import { isSelfApproval } from "./approval-workflow-service"

export type ErpContractContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type ContractInput = {
  customerId: string
  title: string
  contractType?: string
  startDate: string
  endDate?: string
  autoRenew?: boolean
  renewalNoticeDays?: number
  contractValue?: number
  currencyId?: string
  slaResponseHours?: number
  slaResolutionHours?: number
  ownerId?: string
}

export async function listContracts(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpContracts.findMany({ where: eq(erpContracts.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function getContract(ctx: { orgId: string }, contractId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const [amendments, billingSchedules, revenueSchedules, obligations, negotiationRounds] = await Promise.all([
      db.query.erpContractAmendments.findMany({ where: eq(erpContractAmendments.contractId, contractId), orderBy: (t, { desc }) => desc(t.amendmentNumber) }),
      db.query.erpContractBillingSchedules.findMany({ where: eq(erpContractBillingSchedules.contractId, contractId), orderBy: (t, { asc }) => asc(t.nextBillingDate) }),
      db.query.erpContractRevenueSchedules.findMany({ where: eq(erpContractRevenueSchedules.contractId, contractId), orderBy: (t, { asc }) => asc(t.periodStart) }),
      db.query.erpContractObligations.findMany({ where: eq(erpContractObligations.contractId, contractId), orderBy: (t, { asc }) => asc(t.dueDate) }),
      db.query.erpContractNegotiationRounds.findMany({ where: eq(erpContractNegotiationRounds.contractId, contractId), orderBy: (t, { asc }) => asc(t.roundNumber) }),
    ])
    return { ...contract, amendments, billingSchedules, revenueSchedules, obligations, negotiationRounds }
  })
}

export async function createContract(ctx: ErpContractContext, input: ContractInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.startDate) throw new ServiceError("startDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) })
    if (!customer) throw new ServiceError("Customer not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpContracts.contractNumber}), 0)` })
      .from(erpContracts).where(eq(erpContracts.orgId, ctx.orgId))

    const [contract] = await db.insert(erpContracts).values({
      orgId: ctx.orgId,
      customerId: input.customerId,
      contractNumber: Number(maxNumber) + 1,
      title: input.title,
      contractType: input.contractType,
      startDate: input.startDate,
      endDate: input.endDate,
      autoRenew: input.autoRenew ?? false,
      renewalNoticeDays: input.renewalNoticeDays,
      contractValue: input.contractValue !== undefined ? String(input.contractValue) : "0",
      currencyId: input.currencyId,
      slaResponseHours: input.slaResponseHours !== undefined ? String(input.slaResponseHours) : undefined,
      slaResolutionHours: input.slaResolutionHours !== undefined ? String(input.slaResolutionHours) : undefined,
      ownerId: input.ownerId,
      createdById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_contract.created", entityType: "erp_contract", entityId: contract.id })
    return contract
  })
}

const VALID_CONTRACT_TRANSITIONS: Record<string, string[]> = {
  draft: ["active", "terminated"],
  active: ["expired", "terminated", "renewed"],
  renewed: ["active", "expired", "terminated"],
  expired: [],
  terminated: [],
}

export async function updateContractStatus(ctx: ErpContractContext, contractId: string, status: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const allowed = VALID_CONTRACT_TRANSITIONS[contract.status] ?? []
    if (!allowed.includes(status)) throw new ServiceError(`Cannot transition contract from '${contract.status}' to '${status}'`, 409)

    const [updated] = await db.update(erpContracts).set({ status: status as typeof erpContracts.$inferSelect["status"], updatedAt: new Date() }).where(eq(erpContracts.id, contractId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_contract.status_changed", entityType: "erp_contract", entityId: contractId, details: JSON.stringify({ from: contract.status, to: status }) })
    return updated
  })
}

export type AmendmentInput = { description: string; previousValue?: number; newValue?: number; effectiveDate: string }

export async function addAmendment(ctx: ErpContractContext, contractId: string, input: AmendmentInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)
  if (!input.effectiveDate) throw new ServiceError("effectiveDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpContractAmendments.amendmentNumber}), 0)` })
      .from(erpContractAmendments).where(eq(erpContractAmendments.contractId, contractId))

    const [amendment] = await db.insert(erpContractAmendments).values({
      contractId,
      amendmentNumber: Number(maxNumber) + 1,
      description: input.description,
      previousValue: input.previousValue !== undefined ? String(input.previousValue) : undefined,
      newValue: input.newValue !== undefined ? String(input.newValue) : undefined,
      effectiveDate: input.effectiveDate,
      createdById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_contract.amended", entityType: "erp_contract", entityId: contractId, details: JSON.stringify({ amendmentId: amendment.id }) })
    return amendment
  })
}

export async function approveAmendment(ctx: ErpContractContext, amendmentId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const amendment = await db.query.erpContractAmendments.findFirst({ where: eq(erpContractAmendments.id, amendmentId) })
    if (!amendment) throw new ServiceError("Amendment not found", 404)
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, amendment.contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Amendment not found", 404)
    if (amendment.status === "approved") throw new ServiceError("Amendment is already approved", 409)
    // No route currently calls this function (it's dead code as of this
    // wave), but adding the same self-approval guard defensively so it's
    // safe by construction the day it's wired up, rather than relying on
    // whoever adds the route to remember.
    if (isSelfApproval(amendment.createdById, ctx.userId)) {
      throw new ServiceError("You cannot approve an amendment you created yourself -- an independent approver is required", 403)
    }

    const updates: { status: "approved"; contractValue?: string } = { status: "approved" }
    const [updated] = await db.update(erpContractAmendments).set(updates).where(eq(erpContractAmendments.id, amendmentId)).returning()
    if (amendment.newValue !== null) {
      await db.update(erpContracts).set({ contractValue: amendment.newValue, updatedAt: new Date() }).where(eq(erpContracts.id, amendment.contractId))
    }
    return updated
  })
}

export type BillingScheduleInput = { billingFrequency: "monthly" | "quarterly" | "half_yearly" | "annually" | "milestone"; nextBillingDate: string; amount: number }

export async function addBillingSchedule(ctx: { orgId: string }, contractId: string, input: BillingScheduleInput) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const [schedule] = await db.insert(erpContractBillingSchedules).values({
      contractId, billingFrequency: input.billingFrequency, nextBillingDate: input.nextBillingDate, amount: String(input.amount),
    }).returning()
    return schedule
  })
}

export type RevenueScheduleInput = { periodStart: string; periodEnd: string; recognizedAmount: number; deferredAmount: number }

export async function addRevenueSchedule(ctx: { orgId: string }, contractId: string, input: RevenueScheduleInput) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const [schedule] = await db.insert(erpContractRevenueSchedules).values({
      contractId, periodStart: input.periodStart, periodEnd: input.periodEnd,
      recognizedAmount: String(input.recognizedAmount), deferredAmount: String(input.deferredAmount),
    }).returning()
    return schedule
  })
}

export type ObligationInput = { description: string; dueDate: string; responsibleUserId?: string }

export async function addObligation(ctx: { orgId: string }, contractId: string, input: ObligationInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.description?.trim()) throw new ServiceError("description is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const [obligation] = await db.insert(erpContractObligations).values({
      contractId, description: input.description, dueDate: input.dueDate, responsibleUserId: input.responsibleUserId,
    }).returning()
    return obligation
  })
}

export async function completeObligation(ctx: { orgId: string }, obligationId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const obligation = await db.query.erpContractObligations.findFirst({ where: eq(erpContractObligations.id, obligationId) })
    if (!obligation) throw new ServiceError("Obligation not found", 404)
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, obligation.contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Obligation not found", 404)
    const [updated] = await db.update(erpContractObligations).set({ status: "completed", completedAt: new Date() }).where(eq(erpContractObligations.id, obligationId)).returning()
    return updated
  })
}

// ─── Subscription Plans + Subscriptions ───────────────────────────────────

export type SubscriptionPlanInput = { name: string; billingFrequency: "monthly" | "quarterly" | "half_yearly" | "annually" | "milestone"; price: number; currencyId?: string }

export async function listSubscriptionPlans(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSubscriptionPlans.findMany({ where: eq(erpSubscriptionPlans.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  })
}

export async function createSubscriptionPlan(ctx: { orgId: string }, input: SubscriptionPlanInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [plan] = await db.insert(erpSubscriptionPlans).values({
      orgId: ctx.orgId, name: input.name, billingFrequency: input.billingFrequency, price: String(input.price), currencyId: input.currencyId,
    }).returning()
    return plan
  })
}

export type SubscriptionInput = { customerId: string; planId: string; contractId?: string; startDate: string; nextRenewalDate?: string }

export async function listSubscriptions(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSubscriptions.findMany({ where: eq(erpSubscriptions.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function createSubscription(ctx: { orgId: string }, input: SubscriptionInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.planId) throw new ServiceError("planId is required", 400)
  if (!input.startDate) throw new ServiceError("startDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [customer, plan] = await Promise.all([
      db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.customerId), eq(erpCustomers.orgId, ctx.orgId)) }),
      db.query.erpSubscriptionPlans.findFirst({ where: and(eq(erpSubscriptionPlans.id, input.planId), eq(erpSubscriptionPlans.orgId, ctx.orgId)) }),
    ])
    if (!customer) throw new ServiceError("Customer not found", 404)
    if (!plan) throw new ServiceError("Subscription plan not found", 404)

    const [subscription] = await db.insert(erpSubscriptions).values({
      orgId: ctx.orgId, customerId: input.customerId, planId: input.planId, contractId: input.contractId,
      startDate: input.startDate, nextRenewalDate: input.nextRenewalDate,
    }).returning()
    return subscription
  })
}

const VALID_SUBSCRIPTION_TRANSITIONS: Record<string, string[]> = {
  active: ["paused", "cancelled", "expired"],
  paused: ["active", "cancelled"],
  cancelled: [],
  expired: [],
}

export async function updateSubscriptionStatus(ctx: { orgId: string }, subscriptionId: string, status: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const subscription = await db.query.erpSubscriptions.findFirst({ where: and(eq(erpSubscriptions.id, subscriptionId), eq(erpSubscriptions.orgId, ctx.orgId)) })
    if (!subscription) throw new ServiceError("Subscription not found", 404)
    const allowed = VALID_SUBSCRIPTION_TRANSITIONS[subscription.status] ?? []
    if (!allowed.includes(status)) throw new ServiceError(`Cannot transition subscription from '${subscription.status}' to '${status}'`, 409)

    const updates: { status: typeof erpSubscriptions.$inferSelect["status"]; updatedAt: Date; cancelledAt?: Date } = { status: status as typeof erpSubscriptions.$inferSelect["status"], updatedAt: new Date() }
    if (status === "cancelled") updates.cancelledAt = new Date()
    const [updated] = await db.update(erpSubscriptions).set(updates).where(eq(erpSubscriptions.id, subscriptionId)).returning()
    return updated
  })
}

// ─── Wave 88: Clause Library (CLM003) ─────────────────────────────────────

export type ClauseInput = { title: string; category?: string; bodyText: string; riskLevel?: string; isStandard?: boolean }

export async function listClauses(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.clmClauses.findMany({ where: eq(clmClauses.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.title) })
  )
}

export async function createClause(ctx: { orgId: string; userId: string }, input: ClauseInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  if (!input.bodyText?.trim()) throw new ServiceError("bodyText is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [clause] = await db.insert(clmClauses).values({
      orgId: ctx.orgId, title: input.title, category: input.category, bodyText: input.bodyText,
      riskLevel: input.riskLevel, isStandard: input.isStandard ?? true, createdById: ctx.userId,
    }).returning()
    return clause
  })
}

export async function updateClause(ctx: { orgId: string }, clauseId: string, input: Partial<ClauseInput>) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const clause = await db.query.clmClauses.findFirst({ where: and(eq(clmClauses.id, clauseId), eq(clmClauses.orgId, ctx.orgId)) })
    if (!clause) throw new ServiceError("Clause not found", 404)
    const [updated] = await db.update(clmClauses).set({
      ...input, version: sql`${clmClauses.version} + 1`, updatedAt: new Date(),
    }).where(eq(clmClauses.id, clauseId)).returning()
    return updated
  })
}

// ─── Wave 88: Contract Templates (CLM002) ─────────────────────────────────

export type TemplateInput = { name: string; contractType?: string; description?: string }

export async function listContractTemplates(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.clmContractTemplates.findMany({ where: eq(clmContractTemplates.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  )
}

export async function createContractTemplate(ctx: { orgId: string; userId: string }, input: TemplateInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [template] = await db.insert(clmContractTemplates).values({
      orgId: ctx.orgId, name: input.name, contractType: input.contractType, description: input.description, createdById: ctx.userId,
    }).returning()
    return template
  })
}

export async function getContractTemplate(ctx: { orgId: string }, templateId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const template = await db.query.clmContractTemplates.findFirst({ where: and(eq(clmContractTemplates.id, templateId), eq(clmContractTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Template not found", 404)
    const templateClauses = await db.query.clmTemplateClauses.findMany({
      where: eq(clmTemplateClauses.templateId, templateId), orderBy: (t, { asc }) => asc(t.position), with: { clause: true },
    })
    return { ...template, clauses: templateClauses }
  })
}

export async function addClauseToTemplate(ctx: { orgId: string }, templateId: string, clauseId: string, isOptional?: boolean) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [template, clause] = await Promise.all([
      db.query.clmContractTemplates.findFirst({ where: and(eq(clmContractTemplates.id, templateId), eq(clmContractTemplates.orgId, ctx.orgId)) }),
      db.query.clmClauses.findFirst({ where: and(eq(clmClauses.id, clauseId), eq(clmClauses.orgId, ctx.orgId)) }),
    ])
    if (!template) throw new ServiceError("Template not found", 404)
    if (!clause) throw new ServiceError("Clause not found", 404)

    const existing = await db.query.clmTemplateClauses.findMany({ where: eq(clmTemplateClauses.templateId, templateId) })
    const [row] = await db.insert(clmTemplateClauses).values({
      templateId, clauseId, position: existing.length + 1, isOptional: isOptional ?? false,
    }).returning()
    return row
  })
}

export async function removeClauseFromTemplate(ctx: { orgId: string }, templateId: string, templateClauseId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const template = await db.query.clmContractTemplates.findFirst({ where: and(eq(clmContractTemplates.id, templateId), eq(clmContractTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Template not found", 404)
    await db.delete(clmTemplateClauses).where(and(eq(clmTemplateClauses.id, templateClauseId), eq(clmTemplateClauses.templateId, templateId)))
    return { success: true }
  })
}

// Plain token substitution ({{customerName}}/{{contractTitle}}/{{contractValue}}/
// {{startDate}}/{{endDate}}) over the template's ordered, non-optional
// clauses -- deliberately NOT generative/AI authoring (that's CLM004,
// explicitly out of scope this wave).
export async function generateContractFromTemplate(ctx: ErpContractContext, contractId: string, templateId: string, includeOptionalClauseIds?: string[]) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)), with: { customer: true } })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const template = await db.query.clmContractTemplates.findFirst({ where: and(eq(clmContractTemplates.id, templateId), eq(clmContractTemplates.orgId, ctx.orgId)) })
    if (!template) throw new ServiceError("Template not found", 404)

    const templateClauses = await db.query.clmTemplateClauses.findMany({
      where: eq(clmTemplateClauses.templateId, templateId), orderBy: (t, { asc }) => asc(t.position), with: { clause: true },
    })
    const included = templateClauses.filter((tc) => !tc.isOptional || includeOptionalClauseIds?.includes(tc.clauseId))

    const tokens: Record<string, string> = {
      customerName: contract.customer?.customerName ?? "",
      contractTitle: contract.title,
      contractValue: contract.contractValue,
      startDate: contract.startDate,
      endDate: contract.endDate ?? "",
    }
    const bodyText = included.map((tc) => {
      let text = `## ${tc.clause.title}\n\n${tc.clause.bodyText}`
      for (const [key, value] of Object.entries(tokens)) text = text.replaceAll(`{{${key}}}`, value)
      return text
    }).join("\n\n")

    const [updated] = await db.update(erpContracts).set({ templateId, bodyText, updatedAt: new Date() }).where(eq(erpContracts.id, contractId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_contract.generated_from_template", entityType: "erp_contract", entityId: contractId, details: JSON.stringify({ templateId }) })
    return updated
  })
}

// ─── Wave 88: Negotiation Log (CLM005) ────────────────────────────────────
// Mirrors Wave 83's erp_rfq_negotiation_rounds pattern exactly, scoped to
// contracts instead of quotations.

export async function addContractNegotiationRound(ctx: { orgId: string; userId: string }, contractId: string, input: { proposedValue?: number; notes?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)

    const existing = await db.query.erpContractNegotiationRounds.findMany({ where: eq(erpContractNegotiationRounds.contractId, contractId) })
    const [round] = await db.insert(erpContractNegotiationRounds).values({
      orgId: ctx.orgId, contractId, roundNumber: existing.length + 1,
      proposedValue: input.proposedValue !== undefined ? String(input.proposedValue) : undefined, notes: input.notes ?? null, createdById: ctx.userId,
    }).returning()
    return round
  })
}

export async function listContractNegotiationRounds(ctx: { orgId: string }, contractId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpContractNegotiationRounds.findMany({
      where: and(eq(erpContractNegotiationRounds.orgId, ctx.orgId), eq(erpContractNegotiationRounds.contractId, contractId)),
      orderBy: (t, { asc }) => asc(t.roundNumber),
    })
  )
}
