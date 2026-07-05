// Wave 71 (Contract & Commercial Lifecycle Management) -- per
// COMPARISON_CSV_GAP_ANALYSIS.md, Sales>Contract Management was a complete
// gap. Independently designed to match this codebase's own service-layer
// conventions (erp-procurement-workflow-service.ts's max()+1 per-org
// numbering, erp-returns-service.ts's status-machine shape) -- no
// third-party code copied.
import {
  erpContracts, erpContractAmendments, erpContractBillingSchedules, erpContractRevenueSchedules,
  erpContractObligations, erpSubscriptionPlans, erpSubscriptions, erpCustomers, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

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
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpContracts.findMany({ where: eq(erpContracts.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function getContract(ctx: { orgId: string }, contractId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Contract not found", 404)
    const [amendments, billingSchedules, revenueSchedules, obligations] = await Promise.all([
      db.query.erpContractAmendments.findMany({ where: eq(erpContractAmendments.contractId, contractId), orderBy: (t, { desc }) => desc(t.amendmentNumber) }),
      db.query.erpContractBillingSchedules.findMany({ where: eq(erpContractBillingSchedules.contractId, contractId), orderBy: (t, { asc }) => asc(t.nextBillingDate) }),
      db.query.erpContractRevenueSchedules.findMany({ where: eq(erpContractRevenueSchedules.contractId, contractId), orderBy: (t, { asc }) => asc(t.periodStart) }),
      db.query.erpContractObligations.findMany({ where: eq(erpContractObligations.contractId, contractId), orderBy: (t, { asc }) => asc(t.dueDate) }),
    ])
    return { ...contract, amendments, billingSchedules, revenueSchedules, obligations }
  })
}

export async function createContract(ctx: ErpContractContext, input: ContractInput) {
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
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const amendment = await db.query.erpContractAmendments.findFirst({ where: eq(erpContractAmendments.id, amendmentId) })
    if (!amendment) throw new ServiceError("Amendment not found", 404)
    const contract = await db.query.erpContracts.findFirst({ where: and(eq(erpContracts.id, amendment.contractId), eq(erpContracts.orgId, ctx.orgId)) })
    if (!contract) throw new ServiceError("Amendment not found", 404)
    if (amendment.status === "approved") throw new ServiceError("Amendment is already approved", 409)

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
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSubscriptionPlans.findMany({ where: eq(erpSubscriptionPlans.orgId, ctx.orgId), orderBy: (t, { asc }) => asc(t.name) })
  })
}

export async function createSubscriptionPlan(ctx: { orgId: string }, input: SubscriptionPlanInput) {
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
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSubscriptions.findMany({ where: eq(erpSubscriptions.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function createSubscription(ctx: { orgId: string }, input: SubscriptionInput) {
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
