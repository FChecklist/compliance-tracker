// Wave B (VERIDIAN Review Framework remediation -- 2045-parameter maturity
// review flagged "Payment Entries has no real approval workflow wired up").
// erp_payment_entries has existed since Wave 49 with zero service-layer
// consumer anywhere in this codebase (confirmed via repo-wide grep) --
// erp-invoicing-service.ts's own recordSalesInvoicePayment comment says so
// explicitly. This file is the first real consumer.
//
// Owner decision (2026-07-16), explicit and load-bearing for this whole
// file: wire a REAL approval workflow, with NO live payment-gateway
// connection. Razorpay credentials exist in this org's GitHub Secrets but
// are never imported, referenced, or activated here -- this module only
// ever writes rows to erp_payment_entries / posts an internal GL journal
// entry once approved. There is no webhook route, no Razorpay SDK call, no
// outbound network call of any kind in this file.
//
// Approval gating: reuses this codebase's real, established precedent --
// ROLE_RANK + isSelfApproval from approval-workflow-service.ts (the shared
// Approval Workflow Engine's own role-rank + no-self-certification guard,
// Wave 51/PLAN-16). Deliberately NOT routed through that engine's optional
// startApprovalWorkflow()/decideApprovalStep() machinery, though: that
// engine's own documented fallback is "no workflow definition configured
// for this entityType -> auto-approve with zero gate" (see
// erp-procurement-workflow-service.ts's submitPurchaseRequisition) -- fine
// for a purchase requisition, but wrong for money movement, and directly
// contrary to this task's explicit requirement that approval is mandatory
// regardless of whether an org admin has configured a workflow definition.
// So the manager-rank-or-above gate here is unconditional, hard-coded
// (ROLE_RANK.manager = 3, i.e. manager/senior_professional/branch_manager/
// admin/veridian_admin), not "unless no workflow is configured."
import {
  erpPaymentEntries, erpBankAccounts, erpCustomers, erpSuppliers,
  erpSalesInvoices, erpPurchaseInvoices, erpJournalEntries, erpJournalEntryLines,
  auditLogs, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, desc, gte, lte, sql, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"
import { isPeriodOpenForDate } from "./erp-financial-report-service"
import { findControlAccount } from "./erp-invoicing-service"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"
import { isSelfApproval } from "./approval-workflow-service"
import { isDelegatedByAuthorizedDelegator } from "./delegation-service"
import { ErpContext } from "./actor-context"
import { createFraudCaseTx } from "./fraud-case-service"
import { recordAndEscalateAnomaly } from "./risk-escalation-service"
import {
  evaluateDuplicatePayment, evaluateRoundNumberThresholdAvoidance, evaluateAfterHoursHighImpactAction,
  DUPLICATE_PAYMENT_WINDOW_DAYS,
} from "@/lib/risk-anomaly-detection"

// VERIDIAN Review Framework gap-closure (Fraud & Abuse Detection): the
// review's own recommended threshold-avoidance signal needs a real
// mandatory-approval amount to compare against. No such org-configurable
// threshold exists anywhere in this schema yet -- rather than invent a new
// per-org settings surface for this one rule (out of scope for this gap-
// closure), this reuses a fixed, documented default matching a typical
// statutory/internal-control approval limit. A future org-level override
// would live in module-rules-resolver.ts's resolveModuleRule() alongside
// risks' own severity_matrix, the same pattern already established.
const DEFAULT_PAYMENT_APPROVAL_THRESHOLD = 100_000


export type PaymentEntryStatus = (typeof erpPaymentEntries.$inferSelect)["status"]

const MANAGER_RANK = ROLE_RANK.manager // 3 -- "manager rank or above" per this task's brief

// ============================================================
// Pure helpers (no DB) -- kept testable without withTenantContext, matching
// this repo's own established pattern of not touching a live DB from a
// .test.ts file (see approval-workflow-service.test.ts's own header note).
// ============================================================

/** The state machine this whole file enforces: draft -[submit]-> submitted -[approve/reject]-> approved|rejected. draft -[cancel]-> cancelled. Every other (state, action) pair is invalid. */
export function nextPaymentEntryStatus(current: PaymentEntryStatus, action: "submit" | "approve" | "reject" | "cancel"): PaymentEntryStatus | null {
  if (action === "submit") return current === "draft" ? "submitted" : null
  if (action === "cancel") return current === "draft" ? "cancelled" : null
  if (action === "approve") return current === "submitted" ? "approved" : null
  if (action === "reject") return current === "submitted" ? "rejected" : null
  return null
}

export type DecisionGateResult = { ok: true } | { ok: false; reason: string }

/**
 * The mandatory approval gate: an independent (non-self) approver at
 * manager rank or above. Pure so it's unit-testable without a DB -- mirrors
 * decideApprovalStep()'s identical two checks (self-approval, then rank).
 *
 * V2-11 delegation-expiry-enforcement-audit: `hasDelegatedAuthority`
 * (default false, so every existing caller/test is unaffected) mirrors
 * decideApprovalStep()'s own isDelegated()-backed fallback -- an
 * already-expiry/revocation-checked "does an active approval_type
 * delegation grant this actor authority" boolean, computed by the caller
 * (decidePaymentEntry, DB-touching) and passed in here so this function
 * itself stays pure and DB-free. This does NOT weaken this file's own
 * documented mandatory-approval design: self-approval is still always
 * blocked, and skipping approval entirely (the "no workflow configured"
 * auto-approve fallback this file's header explicitly rejects) is still
 * impossible -- a rank-insufficient actor is only ever let through if a
 * real, currently-active delegation record already grants them that
 * specific authority.
 */
export function canDecidePaymentEntry(actorRole: string, createdById: string | null, actorId: string, hasDelegatedAuthority = false): DecisionGateResult {
  if (isSelfApproval(createdById, actorId)) {
    return { ok: false, reason: "You cannot approve or reject a payment entry you submitted yourself -- an independent approver is required" }
  }
  const actorRank = ROLE_RANK[actorRole as UserRole] ?? 0
  if (actorRank < MANAGER_RANK && !hasDelegatedAuthority) {
    return { ok: false, reason: "This action requires manager role or higher" }
  }
  return { ok: true }
}

function amountOf(entry: { paymentType: "receive" | "pay"; paidAmount: string; receivedAmount: string }): number {
  return entry.paymentType === "receive" ? Number(entry.receivedAmount) : Number(entry.paidAmount)
}

// ============================================================
// Reads
// ============================================================

export type PaymentEntryListFilters = { status?: PaymentEntryStatus; partyType?: "customer" | "supplier"; page?: number; limit?: number }

export async function listPaymentEntries(ctx: { orgId: string }, filters: PaymentEntryListFilters = {}) {
  await requireErpEnabled(ctx.orgId)
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(200, Math.max(1, filters.limit ?? 25))
  const offset = (page - 1) * limit

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(erpPaymentEntries.orgId, ctx.orgId)]
    if (filters.status) conditions.push(eq(erpPaymentEntries.status, filters.status))
    if (filters.partyType) conditions.push(eq(erpPaymentEntries.partyType, filters.partyType))
    const where = and(...conditions)

    const [entries, [{ count }]] = await Promise.all([
      db.query.erpPaymentEntries.findMany({ where, orderBy: (t, { desc }) => desc(t.postingDate), limit, offset }),
      db.select({ count: sql<number>`count(*)::int` }).from(erpPaymentEntries).where(where),
    ])

    return { entries: await withPartyNames(db, ctx.orgId, entries), total: count, page, limit, totalPages: Math.ceil(count / limit) }
  })
}

/** Awaiting-decision inbox for the current user -- submitted entries this user's rank qualifies to decide, excluding their own submissions (mirrors approval-workflow-service.ts's listMyPendingApprovals + isSelfApproval). */
export async function listPendingPaymentApprovals(ctx: ErpContext) {
  await requireErpEnabled(ctx.orgId)
  const actorRank = ROLE_RANK[ctx.dbUser.role as UserRole] ?? 0
  if (actorRank < MANAGER_RANK) return []

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entries = await db.query.erpPaymentEntries.findMany({
      where: and(eq(erpPaymentEntries.orgId, ctx.orgId), eq(erpPaymentEntries.status, "submitted")),
      orderBy: (t, { asc }) => asc(t.submittedAt),
    })
    const decidable = entries.filter((e) => !isSelfApproval(e.createdById, ctx.userId))
    return withPartyNames(db, ctx.orgId, decidable)
  })
}

async function withPartyNames<T extends { partyType: "customer" | "supplier"; partyId: string }>(db: TenantDb, orgId: string, entries: T[]) {
  const customerIds = entries.filter((e) => e.partyType === "customer").map((e) => e.partyId)
  const supplierIds = entries.filter((e) => e.partyType === "supplier").map((e) => e.partyId)
  const [customers, suppliers] = await Promise.all([
    customerIds.length ? db.query.erpCustomers.findMany({ where: and(eq(erpCustomers.orgId, orgId), inArray(erpCustomers.id, customerIds)) }) : Promise.resolve([]),
    supplierIds.length ? db.query.erpSuppliers.findMany({ where: and(eq(erpSuppliers.orgId, orgId), inArray(erpSuppliers.id, supplierIds)) }) : Promise.resolve([]),
  ])
  const customerNameById = new Map(customers.map((c): [string, string] => [c.id, c.customerName]))
  const supplierNameById = new Map(suppliers.map((s): [string, string] => [s.id, s.supplierName]))
  return entries.map((e) => ({
    ...e,
    partyName: e.partyType === "customer" ? customerNameById.get(e.partyId) ?? null : supplierNameById.get(e.partyId) ?? null,
  }))
}

export async function getPaymentEntry(ctx: { orgId: string }, id: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.erpPaymentEntries.findFirst({ where: and(eq(erpPaymentEntries.id, id), eq(erpPaymentEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Payment entry not found", 404)
    const [withParty] = await withPartyNames(db, ctx.orgId, [entry])

    let invoice: { invoiceNumber: number; grandTotal: string; outstandingAmount: string; status: string } | null = null
    if (entry.invoiceType === "sales_invoice" && entry.invoiceId) {
      const inv = await db.query.erpSalesInvoices.findFirst({ where: eq(erpSalesInvoices.id, entry.invoiceId) })
      if (inv) invoice = { invoiceNumber: inv.invoiceNumber, grandTotal: inv.grandTotal, outstandingAmount: inv.outstandingAmount, status: inv.status }
    } else if (entry.invoiceType === "purchase_invoice" && entry.invoiceId) {
      const inv = await db.query.erpPurchaseInvoices.findFirst({ where: eq(erpPurchaseInvoices.id, entry.invoiceId) })
      if (inv) invoice = { invoiceNumber: inv.invoiceNumber, grandTotal: inv.grandTotal, outstandingAmount: inv.outstandingAmount, status: inv.status }
    }

    return { ...withParty, invoice }
  })
}

/** Full audit trail (who created/submitted/approved/rejected and when) -- reuses the platform's real audit_logs table, same convention as veri-meeting-service.ts's listMeetingAuditLog. */
export async function getPaymentEntryAuditTrail(ctx: { orgId: string }, id: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.auditLogs.findMany({
      where: and(eq(auditLogs.entityType, "erp_payment_entry"), eq(auditLogs.entityId, id), eq(auditLogs.orgId, ctx.orgId)),
      orderBy: desc(auditLogs.createdAt),
      limit: 50,
    })
  )
}

// ============================================================
// Writes
// ============================================================

export type CreatePaymentEntryInput = {
  paymentType: "receive" | "pay"
  partyType: "customer" | "supplier"
  partyId: string
  amount: number
  bankAccountId: string
  referenceNo?: string
  referenceDate?: string
  postingDate: string
  invoiceType?: "sales_invoice" | "purchase_invoice"
  invoiceId?: string
}

export async function createPaymentEntry(ctx: ErpContext, input: CreatePaymentEntryInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.amount || input.amount <= 0) throw new ServiceError("amount must be positive", 400)
  if (!input.bankAccountId) throw new ServiceError("bankAccountId is required", 400)
  if (!input.postingDate) throw new ServiceError("postingDate is required", 400)

  // Wire semantics match ERPNext's own receive-from-customer /
  // pay-to-supplier convention -- the only two combinations that make
  // sense for a party-scoped payment. A 'receive' against a supplier (or
  // 'pay' against a customer) is refused rather than silently allowed.
  if (input.paymentType === "receive" && input.partyType !== "customer") throw new ServiceError("A 'receive' payment must have partyType 'customer'", 400)
  if (input.paymentType === "pay" && input.partyType !== "supplier") throw new ServiceError("A 'pay' payment must have partyType 'supplier'", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const bankAccount = await db.query.erpBankAccounts.findFirst({ where: and(eq(erpBankAccounts.id, input.bankAccountId), eq(erpBankAccounts.orgId, ctx.orgId)) })
    if (!bankAccount) throw new ServiceError("Bank account not found", 404)

    if (input.partyType === "customer") {
      const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, input.partyId), eq(erpCustomers.orgId, ctx.orgId)) })
      if (!customer) throw new ServiceError("Customer not found", 404)
    } else {
      const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.partyId), eq(erpSuppliers.orgId, ctx.orgId)) })
      if (!supplier) throw new ServiceError("Supplier not found", 404)
    }

    if (input.invoiceId) {
      await validateInvoiceLink(db, ctx.orgId, input, input.invoiceId)
    }

    // Fraud & Abuse Detection (VERIDIAN Review Framework gap-closure):
    // gather same-party recent payments BEFORE inserting this one, so the
    // duplicate check compares against genuinely prior entries, not itself.
    const windowMs = DUPLICATE_PAYMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const postingTime = new Date(input.postingDate).getTime()
    const windowStart = new Date(postingTime - windowMs).toISOString().slice(0, 10)
    const windowEnd = new Date(postingTime + windowMs).toISOString().slice(0, 10)
    const recentSameParty = await db.query.erpPaymentEntries.findMany({
      where: and(
        eq(erpPaymentEntries.orgId, ctx.orgId),
        eq(erpPaymentEntries.partyId, input.partyId),
        eq(erpPaymentEntries.partyType, input.partyType),
        eq(erpPaymentEntries.paymentType, input.paymentType),
        sql`${erpPaymentEntries.status} not in ('cancelled', 'rejected')`,
        gte(erpPaymentEntries.postingDate, windowStart),
        lte(erpPaymentEntries.postingDate, windowEnd),
      ),
    })

    const [entry] = await db.insert(erpPaymentEntries).values({
      orgId: ctx.orgId, paymentType: input.paymentType, partyType: input.partyType, partyId: input.partyId,
      paidAmount: input.paymentType === "pay" ? input.amount.toString() : "0",
      receivedAmount: input.paymentType === "receive" ? input.amount.toString() : "0",
      bankAccountId: input.bankAccountId, referenceNo: input.referenceNo, referenceDate: input.referenceDate,
      postingDate: input.postingDate, invoiceType: input.invoiceType ?? null, invoiceId: input.invoiceId ?? null,
      createdById: ctx.userId,
    }).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payment_entry.created", entityType: "erp_payment_entry", entityId: entry.id })

    // Consolidated into at most ONE fraud case / escalation per payment --
    // a payment that trips more than one rule (e.g. duplicate AND
    // threshold-avoidance) is one incident to investigate, not two separate
    // cases paging the same owner twice.
    const firedVerdicts = [
      evaluateDuplicatePayment(
        { amount: input.amount, postingDate: input.postingDate },
        recentSameParty.map((r) => ({ amount: amountOf(r), postingDate: r.postingDate }))
      ),
      evaluateRoundNumberThresholdAvoidance(input.amount, DEFAULT_PAYMENT_APPROVAL_THRESHOLD),
    ].filter((v): v is Extract<typeof v, { anomaly: true }> => v.anomaly)

    if (firedVerdicts.length > 0) {
      const severityRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }
      const worst = firedVerdicts.reduce((a, b) => (severityRank[b.severity] > severityRank[a.severity] ? b : a))
      const combinedReason = firedVerdicts.map((v) => v.reason).join("; ")

      const fraudCase = await createFraudCaseTx(
        db,
        { orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser },
        {
          title: `System-detected: ${combinedReason}`,
          fraudType: "financial",
          detectionSource: "system_alert",
          description: combinedReason,
          financialExposure: input.amount,
          reportedDate: new Date().toISOString().slice(0, 10),
        }
      )
      await recordAndEscalateAnomaly(db, {
        orgId: ctx.orgId,
        eventType: worst.eventType,
        severity: worst.severity,
        sourceEntityType: "erp_payment_entry",
        sourceEntityId: entry.id,
        actorUserId: ctx.userId,
        reason: combinedReason,
        detail: { fraudCaseId: fraudCase.id, amount: input.amount, partyId: input.partyId, matchedRules: firedVerdicts.map((v) => v.eventType) },
      })
    }

    return entry
  })
}

async function validateInvoiceLink(db: TenantDb, orgId: string, input: { paymentType: "receive" | "pay"; partyId: string; amount: number; invoiceType?: string }, invoiceId: string) {
  if (input.paymentType === "receive") {
    if (input.invoiceType && input.invoiceType !== "sales_invoice") throw new ServiceError("A 'receive' payment can only link to a sales_invoice", 400)
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: and(eq(erpSalesInvoices.id, invoiceId), eq(erpSalesInvoices.orgId, orgId)) })
    if (!invoice) throw new ServiceError("Sales invoice not found", 404)
    if (invoice.customerId !== input.partyId) throw new ServiceError("This invoice does not belong to the selected customer", 400)
    if (!["submitted", "partially_paid", "overdue"].includes(invoice.status)) throw new ServiceError(`Cannot apply a payment to an invoice in '${invoice.status}' status`, 409)
    if (input.amount > Number(invoice.outstandingAmount) + 0.01) throw new ServiceError(`Payment amount (${input.amount}) exceeds the invoice's outstanding balance (${invoice.outstandingAmount})`, 400)
  } else {
    if (input.invoiceType && input.invoiceType !== "purchase_invoice") throw new ServiceError("A 'pay' payment can only link to a purchase_invoice", 400)
    const invoice = await db.query.erpPurchaseInvoices.findFirst({ where: and(eq(erpPurchaseInvoices.id, invoiceId), eq(erpPurchaseInvoices.orgId, orgId)) })
    if (!invoice) throw new ServiceError("Purchase invoice not found", 404)
    if (invoice.supplierId !== input.partyId) throw new ServiceError("This invoice does not belong to the selected supplier", 400)
    if (!["submitted", "partially_paid", "overdue"].includes(invoice.status)) throw new ServiceError(`Cannot apply a payment to an invoice in '${invoice.status}' status`, 409)
    if (input.amount > Number(invoice.outstandingAmount) + 0.01) throw new ServiceError(`Payment amount (${input.amount}) exceeds the invoice's outstanding balance (${invoice.outstandingAmount})`, 400)
  }
}

/** draft -> submitted (awaiting a manager-rank decision). No GL posting happens here -- that's deferred to decidePaymentEntry's 'approved' branch. */
export async function submitPaymentEntry(ctx: ErpContext, id: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const entry = await db.query.erpPaymentEntries.findFirst({ where: and(eq(erpPaymentEntries.id, id), eq(erpPaymentEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Payment entry not found", 404)
    if (nextPaymentEntryStatus(entry.status, "submit") === null) throw new ServiceError("Only draft payment entries can be submitted", 409)

    const [updated] = await db.update(erpPaymentEntries)
      .set({ status: "submitted", submittedById: ctx.userId, submittedAt: new Date() })
      .where(eq(erpPaymentEntries.id, id)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payment_entry.submitted", entityType: "erp_payment_entry", entityId: id })
    return updated
  })
}

/** draft -> cancelled. Mirrors cancelSalesInvoice's identical "draft only" rule -- a submitted entry must go through a real decision (approve/reject), not be silently withdrawn. */
export async function cancelPaymentEntry(ctx: { orgId: string; userId: string }, id: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const entry = await db.query.erpPaymentEntries.findFirst({ where: and(eq(erpPaymentEntries.id, id), eq(erpPaymentEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Payment entry not found", 404)
    if (nextPaymentEntryStatus(entry.status, "cancel") === null) throw new ServiceError("Only draft payment entries can be cancelled directly", 409)
    const [updated] = await db.update(erpPaymentEntries).set({ status: "cancelled" }).where(eq(erpPaymentEntries.id, id)).returning()
    return updated
  })
}

/**
 * The approval decision. Mandatory gate (see file header): the deciding
 * user must be a real authenticated session user (ctx.dbUser, never an API
 * key -- there is no ActorCtx/apiKey union on this function, unlike several
 * sibling erp-*-service.ts writers, precisely so this can't be called from
 * a Bearer-API-key caller with no real identity behind it), must not be the
 * same user who created the entry, and must hold manager rank or above.
 *
 * Approving posts a real, internal GL journal entry -- 'receive' debits the
 * bank account and credits the org's receivable control account; 'pay'
 * debits the payable control account and credits the bank account -- and,
 * if this entry is linked to an invoice, reduces that invoice's
 * outstandingAmount exactly like recordSalesInvoicePayment does. Rejecting
 * records the decision with no GL/invoice side effect at all.
 */
export async function decidePaymentEntry(ctx: ErpContext, id: string, decision: "approved" | "rejected", comment?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const entry = await db.query.erpPaymentEntries.findFirst({ where: and(eq(erpPaymentEntries.id, id), eq(erpPaymentEntries.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Payment entry not found", 404)
    if (nextPaymentEntryStatus(entry.status, decision === "approved" ? "approve" : "reject") === null) {
      throw new ServiceError(entry.status === "draft" ? "This payment entry must be submitted before it can be decided" : "This payment entry has already been decided", 409)
    }

    const actorRank = ROLE_RANK[ctx.dbUser.role as UserRole] ?? 0
    // V2-11 audit fix (AUDIT: FAIL, 2026-07-26 comment on PR #579): a
    // delegation only counts here if its OWN delegatorUserId currently
    // holds manager rank or above independently -- otherwise a
    // rank-insufficient user could self-grant (delegateRoleKey equal to
    // their own role) or accomplice-grant (delegateUserId) payment-approval
    // authority nobody with real manager authority ever delegated.
    const hasDelegatedAuthority = actorRank < MANAGER_RANK
      && await isDelegatedByAuthorizedDelegator(db, ctx.orgId, "approval_type", "erp_payment_entry", ctx.userId, [ctx.dbUser.role], async (delegatorUserId) => {
        const delegator = await db.query.users.findFirst({ where: eq(users.id, delegatorUserId) })
        return delegator != null && (ROLE_RANK[delegator.role as UserRole] ?? 0) >= MANAGER_RANK
      })
    const gate = canDecidePaymentEntry(ctx.dbUser.role, entry.createdById, ctx.userId, hasDelegatedAuthority)
    if (!gate.ok) throw new ServiceError(gate.reason, 403)

    if (decision === "rejected") {
      const [updated] = await db.update(erpPaymentEntries)
        .set({ status: "rejected", decidedById: ctx.userId, decidedAt: new Date(), decisionComment: comment ?? null })
        .where(eq(erpPaymentEntries.id, id)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payment_entry.rejected", entityType: "erp_payment_entry", entityId: id, details: comment ? JSON.stringify({ comment }) : undefined })
      return updated
    }

    const periodOpen = await isPeriodOpenForDate(ctx, entry.postingDate)
    if (!periodOpen) throw new ServiceError(`The accounting period covering ${entry.postingDate} is closed`, 409)

    if (!entry.bankAccountId) throw new ServiceError("This payment entry has no bank account set", 400)
    const bankAccount = await db.query.erpBankAccounts.findFirst({ where: and(eq(erpBankAccounts.id, entry.bankAccountId), eq(erpBankAccounts.orgId, ctx.orgId)) })
    if (!bankAccount) throw new ServiceError("Bank account not found", 404)
    if (!bankAccount.glAccountId) throw new ServiceError("This bank account has no linked GL account -- set one before approving", 400)

    const controlAccount = await findControlAccount(db, ctx.orgId, entry.partyType === "customer" ? "receivable" : "payable")
    const amount = amountOf(entry)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpJournalEntries.entryNumber}), 0)` }).from(erpJournalEntries).where(eq(erpJournalEntries.orgId, ctx.orgId))
    const [je] = await db.insert(erpJournalEntries).values({
      orgId: ctx.orgId, entryNumber: Number(maxNumber) + 1, postingDate: entry.postingDate,
      referenceType: "payment_entry", referenceId: id,
      userRemark: `${entry.paymentType === "receive" ? "Payment received" : "Payment made"}${entry.referenceNo ? ` (Ref: ${entry.referenceNo})` : ""}`,
      status: "submitted", totalDebit: amount.toString(), totalCredit: amount.toString(), createdById: ctx.userId, submittedAt: new Date(),
    }).returning()

    const lines = entry.paymentType === "receive"
      ? [
          { journalEntryId: je.id, accountId: bankAccount.glAccountId, debit: amount.toString(), credit: "0", partyType: entry.partyType, partyId: entry.partyId },
          { journalEntryId: je.id, accountId: controlAccount.id, debit: "0", credit: amount.toString(), partyType: entry.partyType, partyId: entry.partyId },
        ]
      : [
          { journalEntryId: je.id, accountId: controlAccount.id, debit: amount.toString(), credit: "0", partyType: entry.partyType, partyId: entry.partyId },
          { journalEntryId: je.id, accountId: bankAccount.glAccountId, debit: "0", credit: amount.toString(), partyType: entry.partyType, partyId: entry.partyId },
        ]
    await db.insert(erpJournalEntryLines).values(lines)

    if (entry.invoiceId && entry.invoiceType) {
      await applyPaymentToInvoice(db, entry.invoiceType as "sales_invoice" | "purchase_invoice", entry.invoiceId, amount)
    }

    const [updated] = await db.update(erpPaymentEntries)
      .set({ status: "approved", journalEntryId: je.id, decidedById: ctx.userId, decidedAt: new Date(), decisionComment: comment ?? null })
      .where(eq(erpPaymentEntries.id, id)).returning()

    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_payment_entry.approved", entityType: "erp_payment_entry", entityId: id, details: JSON.stringify({ amount, journalEntryId: je.id }) })

    // Anomaly Detection (VERIDIAN Review Framework gap-closure): approving a
    // real money movement is exactly the "high-impact action" shape the
    // finding named -- flag it when it happens outside business hours.
    const afterHoursVerdict = evaluateAfterHoursHighImpactAction("erp_payment_entry.approved", new Date())
    if (afterHoursVerdict.anomaly) {
      await recordAndEscalateAnomaly(db, {
        orgId: ctx.orgId, eventType: afterHoursVerdict.eventType, severity: afterHoursVerdict.severity,
        sourceEntityType: "erp_payment_entry", sourceEntityId: id, actorUserId: ctx.userId,
        reason: afterHoursVerdict.reason, detail: { amount, journalEntryId: je.id },
      })
    }
    return updated
  })
}

/** Reduces the linked invoice's outstandingAmount and rolls its status forward, exactly matching recordSalesInvoicePayment's identical newOutstanding/newStatus logic -- generalized here to whichever invoice table this payment entry links to. */
async function applyPaymentToInvoice(db: TenantDb, invoiceType: "sales_invoice" | "purchase_invoice", invoiceId: string, amount: number) {
  if (invoiceType === "sales_invoice") {
    const invoice = await db.query.erpSalesInvoices.findFirst({ where: eq(erpSalesInvoices.id, invoiceId) })
    if (!invoice) return // invoice was deleted/moved since creation -- don't fail the whole approval over a denormalized link, same defensive posture as this file's other best-effort side effects
    const newOutstanding = Math.max(0, Number(invoice.outstandingAmount) - amount)
    const newStatus = newOutstanding <= 0.01 ? "paid" : "partially_paid"
    await db.update(erpSalesInvoices).set({ outstandingAmount: newOutstanding.toString(), status: newStatus }).where(eq(erpSalesInvoices.id, invoiceId))
  } else {
    const invoice = await db.query.erpPurchaseInvoices.findFirst({ where: eq(erpPurchaseInvoices.id, invoiceId) })
    if (!invoice) return
    const newOutstanding = Math.max(0, Number(invoice.outstandingAmount) - amount)
    const newStatus = newOutstanding <= 0.01 ? "paid" : "partially_paid"
    await db.update(erpPurchaseInvoices).set({ outstandingAmount: newOutstanding.toString(), status: newStatus }).where(eq(erpPurchaseInvoices.id, invoiceId))
  }
}

// ============================================================
// FI-AP-008 (sap_mapping.sqlite gap analysis, "Subcontractor Payment
// Application Status", BUILD_NEW/HIGH -- see task-fi-ap-008-subcontractor-
// payment-application-status). Discovery, honestly documented: this is NOT
// the same object as compliance.construction_progress_claims (0269/0270,
// this same wave's sibling PR) -- that table tracks the CUSTOMER-facing
// billing claim (milestone_achieved -> drafted -> submitted ->
// client_approved -> invoiced/rejected, money flowing IN from a client) and
// has no supplier/subcontractor concept at all (customerId, boqId, no
// supplierId column). It is also not the same subject as FI-AP-007
// "Subcontractor Retention Summary" (a sibling PR on its own branch, not
// yet merged as of this writing) -- that report is about how much of an
// already-submitted bill's value is WITHHELD, not what stage of approval
// the bill/payment itself is in.
//
// The real subcontractor-facing (money flowing OUT) equivalent of
// construction_progress_claims already exists, independently of this PR:
// erp_payment_entries (Wave B, VERIDIAN Review Framework remediation, see
// this file's own header) already implements a genuine maker-checker state
// machine for money leaving the org -- draft -[submit]-> submitted
// -[approve/reject]-> approved|rejected (draft -[cancel]-> cancelled) --
// with real submittedAt/decidedAt timestamps, for any paymentType='pay',
// partyType='supplier' row. When invoiceType='purchase_invoice' and
// invoiceId is set, that row IS, literally, a subcontractor's payment
// application against a specific bill: submitted -> under manager-rank
// review -> approved (which this file's decidePaymentEntry synchronously
// posts to the GL and applies to the invoice -- there is no separate
// "paid" state on this table; 'approved' and "disbursed" happen in the
// same transaction, so this report does not invent a fourth state that
// doesn't exist) or rejected.
//
// So this is genuine REUSE of an already-real, already-timestamped
// workflow, not a new table/state machine -- the actual gap this PR closes
// is that no report exists yet presenting this data as a subcontractor-
// payment worklist with aging. Two honest scope notes:
//  1. "Subcontractor" is identified via erpSuppliers.trade IS NOT NULL
//     (this schema's own documented convention for a construction
//     subcontractor-type supplier -- see schema.ts's Wave 120 comment on
//     that column), not supplierType (free text, inconsistent values) and
//     not "has retention" (FI-AP-007's proxy, which only covers bills that
//     already have retention_percent > 0 on its own not-yet-merged branch --
//     not usable as a filter here since it doesn't exist on main).
//  2. A subcontractor invoice with an outstanding balance but ZERO payment
//     entry created against it yet is a real, useful worklist signal too
//     (the application hasn't even been started) -- included as its own
//     bucket below rather than silently omitted, using the invoice's own
//     postingDate as the best available "clock start" (there is no
//     payment-entry row yet to carry a real submittedAt for these).
// ============================================================

/** Any status a subcontractor pay-type payment entry can be in, per this file's own nextPaymentEntryStatus state machine, plus the not_yet_initiated bucket this report adds for invoices with no payment entry at all yet. */
export type SubcontractorPaymentApplicationStatus =
  | "drafted" | "submitted" | "approved_and_paid" | "rejected" | "cancelled" | "not_yet_initiated"

/** A worklist row is "stuck" once it has sat this many days in submitted/not_yet_initiated -- a plain documented default, not derived from any org setting (none exists for this). */
export const STUCK_APPLICATION_THRESHOLD_DAYS = 7

export type PaymentApplicationEntryInput = {
  id: string; supplierId: string; invoiceId: string | null
  status: PaymentEntryStatus; paidAmount: string | number
  createdAt: string | Date; submittedAt: string | Date | null; decidedAt: string | Date | null
}

export type UninitiatedInvoiceInput = {
  invoiceId: string; supplierId: string; invoiceNumber: number
  postingDate: string; grandTotal: string | number; outstandingAmount: string | number
}

export type SubcontractorPaymentApplicationRow = {
  applicationId: string | null // null for the not_yet_initiated bucket -- there is no erp_payment_entries row yet
  supplierId: string
  invoiceId: string | null
  invoiceNumber: number | null
  status: SubcontractorPaymentApplicationStatus
  amount: number
  submittedAt: string | Date | null
  statusChangedAt: string | Date
  daysInCurrentStatus: number
  isStuck: boolean
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000))
}

/** Maps a real erp_payment_entries row to this report's worklist vocabulary. 'approved' really does mean paid here -- see this file's decidePaymentEntry, which posts the GL entry and applies the payment to the invoice in the same transaction as the approval. */
function statusFromEntry(status: PaymentEntryStatus): SubcontractorPaymentApplicationStatus {
  if (status === "draft") return "drafted"
  if (status === "submitted") return "submitted"
  if (status === "approved") return "approved_and_paid"
  if (status === "rejected") return "rejected"
  return "cancelled"
}

/**
 * Pure core, no DB -- matches this repo's established test-without-a-live-
 * DB convention (see this same file's nextPaymentEntryStatus/
 * canDecidePaymentEntry, and erp-invoicing-service.ts's
 * computePaymentProposal/FI-AP-005 precedent above). Takes plain rows the
 * caller already fetched and produces the real worklist: current status,
 * submission date, amount, and a real days-in-current-status aging signal.
 */
export function computeSubcontractorPaymentApplicationWorklist(
  entries: PaymentApplicationEntryInput[],
  uninitiatedInvoices: UninitiatedInvoiceInput[],
  asOfDate: string
): { asOfDate: string; applicationCount: number; stuckCount: number; rows: SubcontractorPaymentApplicationRow[] } {
  const asOfMs = new Date(asOfDate).getTime()

  const entryRows: SubcontractorPaymentApplicationRow[] = entries.map((e) => {
    const status = statusFromEntry(e.status)
    // Clock start for aging: the timestamp that actually moved with the
    // CURRENT status. 'cancelled' has no dedicated timestamp anywhere in
    // this schema (cancelPaymentEntry only sets status, see this file's
    // own function) -- createdAt is the best honestly-available proxy,
    // same "disclosed, not invented" approach as FI-AP-007's own header.
    const statusChangedAt =
      status === "drafted" || status === "cancelled" ? e.createdAt
      : status === "submitted" ? (e.submittedAt ?? e.createdAt)
      : (e.decidedAt ?? e.submittedAt ?? e.createdAt) // approved_and_paid | rejected
    const daysInCurrentStatus = daysBetween(new Date(statusChangedAt).getTime(), asOfMs)
    return {
      applicationId: e.id, supplierId: e.supplierId, invoiceId: e.invoiceId, invoiceNumber: null,
      status, amount: Number(e.paidAmount), submittedAt: e.submittedAt,
      statusChangedAt, daysInCurrentStatus,
      isStuck: status === "submitted" && daysInCurrentStatus > STUCK_APPLICATION_THRESHOLD_DAYS,
    }
  })

  const uninitiatedRows: SubcontractorPaymentApplicationRow[] = uninitiatedInvoices.map((inv) => {
    const daysInCurrentStatus = daysBetween(new Date(inv.postingDate).getTime(), asOfMs)
    return {
      applicationId: null, supplierId: inv.supplierId, invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber,
      status: "not_yet_initiated", amount: Number(inv.outstandingAmount), submittedAt: null,
      statusChangedAt: inv.postingDate, daysInCurrentStatus,
      isStuck: daysInCurrentStatus > STUCK_APPLICATION_THRESHOLD_DAYS,
    }
  })

  const rows = [...entryRows, ...uninitiatedRows].sort((a, b) => b.daysInCurrentStatus - a.daysInCurrentStatus)
  return {
    asOfDate, applicationCount: rows.length,
    stuckCount: rows.filter((r) => r.isStuck).length,
    rows,
  }
}

/**
 * FI-AP-008 real report: every subcontractor (erpSuppliers.trade IS NOT
 * NULL) pay-type payment entry linked to a purchase invoice, plus every
 * subcontractor purchase invoice with an outstanding balance and no
 * payment entry started yet -- a worklist for whoever manages subcontractor
 * payments, with a real days-in-current-status aging signal so a stuck
 * application (sitting in "submitted", i.e. awaiting manager decision,
 * past STUCK_APPLICATION_THRESHOLD_DAYS) is visible, not silently lost.
 */
export async function subcontractorPaymentApplicationStatus(
  ctx: { orgId: string },
  filters: { supplierId?: string; asOfDate?: string } = {}
) {
  await requireErpEnabled(ctx.orgId)
  const asOfDate = filters.asOfDate ?? new Date().toISOString().slice(0, 10)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const subcontractors = await db.query.erpSuppliers.findMany({
      where: and(
        eq(erpSuppliers.orgId, ctx.orgId),
        sql`${erpSuppliers.trade} IS NOT NULL`,
        ...(filters.supplierId ? [eq(erpSuppliers.id, filters.supplierId)] : []),
      ),
    })
    const supplierIds = subcontractors.map((s) => s.id)
    const supplierNameById = new Map(subcontractors.map((s): [string, string] => [s.id, s.supplierName]))
    if (supplierIds.length === 0) {
      return {
        asOfDate, applicationCount: 0, stuckCount: 0,
        rows: [] as (SubcontractorPaymentApplicationRow & { supplierName: string | null })[],
      }
    }

    const entries = await db.query.erpPaymentEntries.findMany({
      where: and(
        eq(erpPaymentEntries.orgId, ctx.orgId), eq(erpPaymentEntries.paymentType, "pay"),
        eq(erpPaymentEntries.partyType, "supplier"), inArray(erpPaymentEntries.partyId, supplierIds),
        eq(erpPaymentEntries.invoiceType, "purchase_invoice"), sql`${erpPaymentEntries.invoiceId} IS NOT NULL`,
      ),
    })
    const linkedInvoiceIds = new Set(entries.map((e) => e.invoiceId).filter((id): id is string => id != null))

    const openInvoices = await db.query.erpPurchaseInvoices.findMany({
      where: and(
        eq(erpPurchaseInvoices.orgId, ctx.orgId), inArray(erpPurchaseInvoices.supplierId, supplierIds),
        inArray(erpPurchaseInvoices.status, ["submitted", "partially_paid", "overdue"]),
      ),
    })
    const uninitiated = openInvoices.filter((inv) => !linkedInvoiceIds.has(inv.id))

    const worklist = computeSubcontractorPaymentApplicationWorklist(
      entries.map((e) => ({
        id: e.id, supplierId: e.partyId, invoiceId: e.invoiceId, status: e.status,
        paidAmount: e.paidAmount, createdAt: e.createdAt, submittedAt: e.submittedAt, decidedAt: e.decidedAt,
      })),
      uninitiated.map((inv) => ({
        invoiceId: inv.id, supplierId: inv.supplierId, invoiceNumber: inv.invoiceNumber,
        postingDate: inv.postingDate, grandTotal: inv.grandTotal, outstandingAmount: inv.outstandingAmount,
      })),
      asOfDate,
    )

    const invoiceNumberById = new Map(openInvoices.map((inv): [string, number] => [inv.id, inv.invoiceNumber]))
    const rows = worklist.rows.map((r) => ({
      ...r,
      invoiceNumber: r.invoiceNumber ?? (r.invoiceId ? invoiceNumberById.get(r.invoiceId) ?? null : null),
      supplierName: supplierNameById.get(r.supplierId) ?? null,
    }))

    return {
      asOfDate: worklist.asOfDate, applicationCount: worklist.applicationCount, stuckCount: worklist.stuckCount, rows,
    }
  })
}
