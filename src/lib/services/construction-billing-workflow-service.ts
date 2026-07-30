// Progress-claim billing workflow (SAP-mapping PHASE-2-CROSSREF, sap_reports
// rows SD-002 "Billing Due List" + SD-007 "Sales Order Status Overview",
// both BUILD_NEW, engine_track=workflow -- see PROGRESS.md for the crossref
// evidence). A state machine over the pre-invoice approval stage a
// construction progress claim moves through -- construction-valuation-
// service.ts's generateInterimBill() already computes the real bill amounts
// from work-progress %; this service tracks milestone_achieved -> drafted ->
// submitted -> client_approved -> invoiced (or rejected, bounced back to
// drafted), then delegates to generateInterimBill() at the invoiced
// transition. Modeled directly on erp-selling-service.ts's
// QUOTATION_STATUSES/QUOTATION_TRANSITIONS explicit-transition-table
// convention -- no shared state-machine helper exists in this codebase to
// reuse instead (confirmed: every status-flow service hand-rolls its own
// Record<Status, readonly Status[]> map).
import { constructionProgressClaims, constructionInterimBills, erpSalesInvoices, erpPaymentEntries, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { generateInterimBill } from "./construction-valuation-service"
export { ServiceError }

export const CLAIM_STATUSES = ["milestone_achieved", "drafted", "submitted", "client_approved", "invoiced", "rejected"] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  milestone_achieved: ["drafted"],
  drafted: ["submitted"],
  submitted: ["client_approved", "rejected"],
  client_approved: ["invoiced"],
  invoiced: [],
  rejected: ["drafted"],
}

// A claim sitting in 'submitted' this long with no client response is a
// stuck-claim alert (SD-007's own business_purpose: "submitted 25 days ago,
// no client response is an immediate action item"). Documented threshold,
// not invented -- construction billing cash-flow risk is the reason SD-002
// calls this "one of the most operationally critical reports".
export const STUCK_CLAIM_THRESHOLD_DAYS = 14

export type ClaimContext = { orgId: string; userId: string }

export type CreateProgressClaimInput = {
  projectId: string
  boqId: string
  customerId: string
  milestoneDescription: string
  scheduledDate: string
  retentionPercent?: number
}

export async function createProgressClaim(ctx: ClaimContext, input: CreateProgressClaimInput) {
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.boqId) throw new ServiceError("boqId is required", 400)
  if (!input.customerId) throw new ServiceError("customerId is required", 400)
  if (!input.milestoneDescription) throw new ServiceError("milestoneDescription is required", 400)
  if (!input.scheduledDate) throw new ServiceError("scheduledDate is required", 400)
  const retentionPercent = input.retentionPercent ?? 0
  if (retentionPercent < 0 || retentionPercent > 100) throw new ServiceError("retentionPercent must be between 0 and 100", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [claim] = await db.insert(constructionProgressClaims).values({
      orgId: ctx.orgId, projectId: input.projectId, boqId: input.boqId, customerId: input.customerId,
      milestoneDescription: input.milestoneDescription, scheduledDate: input.scheduledDate,
      retentionPercent: String(retentionPercent), createdById: ctx.userId,
    }).returning()
    return claim
  })
}

async function transitionClaim(ctx: ClaimContext, claimId: string, to: ClaimStatus, patch: Record<string, unknown> = {}) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.constructionProgressClaims.findFirst({ where: and(eq(constructionProgressClaims.id, claimId), eq(constructionProgressClaims.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Progress claim not found", 404)
    const currentStatus = existing.status as ClaimStatus
    const allowed = CLAIM_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(to)) {
      throw new ServiceError(`Cannot move a '${currentStatus}' claim to '${to}' -- valid next status(es): ${allowed.length ? allowed.join(", ") : "none (terminal)"}`, 409)
    }
    const [updated] = await db.update(constructionProgressClaims)
      .set({ status: to, updatedAt: new Date(), ...patch })
      .where(eq(constructionProgressClaims.id, claimId)).returning()
    return updated
  })
}

/** milestone_achieved -> drafted: the billing team has prepared the claim document. */
export async function draftClaim(ctx: ClaimContext, claimId: string) {
  return transitionClaim(ctx, claimId, "drafted", { draftedAt: new Date() })
}

/** drafted -> submitted: the claim has been sent to the client for approval. */
export async function submitClaim(ctx: ClaimContext, claimId: string) {
  return transitionClaim(ctx, claimId, "submitted", { submittedAt: new Date() })
}

/** submitted -> client_approved: records the client's real-world approval decision (external fact, not an internal control gate -- no self-approval guard applies here, unlike quotation/payment approvals). */
export async function approveClaim(ctx: ClaimContext, claimId: string) {
  return transitionClaim(ctx, claimId, "client_approved", { approvedAt: new Date() })
}

/** submitted -> rejected (queried by the client). Can be redrafted and resubmitted, same bounce-back shape as QUOTATION_TRANSITIONS.pending_approval -> draft. */
export async function rejectClaim(ctx: ClaimContext, claimId: string, rejectionReason?: string) {
  return transitionClaim(ctx, claimId, "rejected", { rejectedAt: new Date(), rejectionReason: rejectionReason || null })
}

export type InvoiceApprovedClaimInput = { billDate: string; taxTemplateId: string }

/**
 * client_approved -> invoiced. Delegates the actual bill computation to
 * generateInterimBill() -- this function's only job is the state
 * transition + linking the resulting interim bill back onto the claim.
 * Deliberately 3 separate withTenantContext calls (read-check, delegate,
 * write-back) rather than one wrapping transaction: withTenantContext opens
 * its own top-level db.transaction() per call, and generateInterimBill()
 * already opens its own -- nesting those would mean two transactions on the
 * same pooled connection, which this codebase's tenant-scoped.ts does not
 * support. Honest tradeoff: a crash between steps 2 and 3 would leave a
 * real interim bill/invoice with no claim pointing at it yet (recoverable --
 * re-run step 3 by interim bill id -- not a lost or duplicated bill, since
 * generateInterimBill's own idempotency comes from billing only the
 * increment over previously-billed amounts).
 */
export async function invoiceApprovedClaim(ctx: ClaimContext & { dbUser: typeof users.$inferSelect }, claimId: string, input: InvoiceApprovedClaimInput) {
  if (!input.billDate) throw new ServiceError("billDate is required", 400)
  if (!input.taxTemplateId) throw new ServiceError("taxTemplateId is required", 400)

  const existing = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.constructionProgressClaims.findFirst({ where: and(eq(constructionProgressClaims.id, claimId), eq(constructionProgressClaims.orgId, ctx.orgId)) })
  )
  if (!existing) throw new ServiceError("Progress claim not found", 404)
  if (existing.status !== "client_approved") throw new ServiceError(`Only a 'client_approved' claim can be invoiced (this one is '${existing.status}')`, 409)

  const { bill, invoice } = await generateInterimBill(
    { orgId: ctx.orgId, userId: ctx.userId, dbUser: ctx.dbUser },
    {
      projectId: existing.projectId, boqId: existing.boqId, customerId: existing.customerId,
      billDate: input.billDate, retentionPercent: Number(existing.retentionPercent), taxTemplateId: input.taxTemplateId,
    }
  )

  const updated = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionProgressClaims)
      .set({ status: "invoiced", invoicedAt: new Date(), updatedAt: new Date(), interimBillId: bill.id })
      .where(eq(constructionProgressClaims.id, claimId)).returning()
    return row
  })
  return { claim: updated, bill, invoice }
}

export type BillingDueQueueItem = Awaited<ReturnType<typeof listBillingDueQueue>>[number]

/**
 * SD-002 "Billing Due List" -> the "Ready to Bill" worklist: every
 * not-yet-invoiced, not-rejected claim for the org (optionally scoped to
 * one project), oldest scheduled_date first, each flagged isOverdue when
 * scheduledDate has passed and the claim is still stuck before
 * client_approved -- matching SD-002's own implementation_notes: "add an
 * alert for claims approaching their scheduled date but not yet actioned."
 */
export async function listBillingDueQueue(ctx: { orgId: string }, projectId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionProgressClaims.findMany({
      where: and(
        eq(constructionProgressClaims.orgId, ctx.orgId),
        projectId ? eq(constructionProgressClaims.projectId, projectId) : undefined
      ),
      orderBy: (t, { asc }) => asc(t.scheduledDate),
    })
    const today = new Date().toISOString().slice(0, 10)
    return rows
      .filter((r) => r.status !== "invoiced")
      .map((r) => ({ ...r, isOverdue: r.status !== "rejected" && r.scheduledDate < today }))
  })
}

export type ClaimTimelineStep = { stage: ClaimStatus | "invoice_sent" | "payment_received"; at: string | null; note?: string }

/**
 * SD-007 "Sales Order Status Overview" -> "Claim Timeline": traces a single
 * claim's real document flow (claim -> interim bill -> sales invoice ->
 * payment), the construction-billing equivalent of SAP's VBFA document-flow
 * read. isStuck flags the current stage when it has sat unresolved past
 * STUCK_CLAIM_THRESHOLD_DAYS, same "submitted 25 days ago, no response"
 * business case SD-007 itself calls out.
 */
export async function getClaimTimeline(ctx: { orgId: string }, claimId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const claim = await db.query.constructionProgressClaims.findFirst({ where: and(eq(constructionProgressClaims.id, claimId), eq(constructionProgressClaims.orgId, ctx.orgId)) })
    if (!claim) throw new ServiceError("Progress claim not found", 404)

    const steps: ClaimTimelineStep[] = [
      { stage: "milestone_achieved", at: claim.createdAt.toISOString() },
      { stage: "drafted", at: claim.draftedAt?.toISOString() ?? null },
      { stage: "submitted", at: claim.submittedAt?.toISOString() ?? null },
      claim.status === "rejected"
        ? { stage: "rejected", at: claim.rejectedAt?.toISOString() ?? null, note: claim.rejectionReason ?? undefined }
        : { stage: "client_approved", at: claim.approvedAt?.toISOString() ?? null },
      { stage: "invoiced", at: claim.invoicedAt?.toISOString() ?? null },
    ]

    let bill: typeof constructionInterimBills.$inferSelect | undefined
    let invoice: typeof erpSalesInvoices.$inferSelect | undefined
    if (claim.interimBillId) {
      bill = await db.query.constructionInterimBills.findFirst({ where: eq(constructionInterimBills.id, claim.interimBillId) })
      if (bill?.salesInvoiceId) {
        invoice = await db.query.erpSalesInvoices.findFirst({ where: eq(erpSalesInvoices.id, bill.salesInvoiceId) })
        if (invoice) {
          steps.push({ stage: "invoice_sent", at: invoice.createdAt.toISOString() })
          const payments = await db.query.erpPaymentEntries.findMany({ where: and(eq(erpPaymentEntries.invoiceType, "sales_invoice"), eq(erpPaymentEntries.invoiceId, invoice.id), eq(erpPaymentEntries.status, "approved")) })
          if (payments.length > 0) {
            const latest = payments.reduce((a, b) => (a.postingDate > b.postingDate ? a : b))
            steps.push({ stage: "payment_received", at: new Date(latest.postingDate).toISOString() })
          }
        }
      }
    }

    const lastStepAt = [...steps].reverse().find((s) => s.at)?.at ?? claim.createdAt.toISOString()
    const daysSinceLastStep = Math.floor((Date.now() - new Date(lastStepAt).getTime()) / (1000 * 60 * 60 * 24))
    const isStuck = claim.status !== "invoiced" && claim.status !== "rejected" && daysSinceLastStep >= STUCK_CLAIM_THRESHOLD_DAYS

    return { claim, bill: bill ?? null, invoice: invoice ?? null, steps, isStuck, daysSinceLastStep }
  })
}
