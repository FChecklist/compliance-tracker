// Wave 55 (VERI ERP gap-fill, Tier 3 #10): Procurement Workflow above the
// PO -- Purchase Requisition + RFQ + Supplier Quotation. Every PO was
// previously a standalone document with no upstream authorization trail.
// Submitting a requisition is deliberately wired to the shared Approval
// Workflow Engine (see approval-workflow-service.ts) as its SECOND real
// consumer after erp_journal_entry -- proving the engine generalizes
// rather than being a single-use abstraction disguised as generic.
import {
  erpPurchaseRequisitions, erpPurchaseRequisitionItems,
  erpRfqs, erpRfqItems, erpRfqSuppliers,
  erpSupplierQuotations, erpSupplierQuotationItems,
  erpRfqScoringCriteria, erpRfqQuotationScores, erpRfqNegotiationRounds,
  erpRfqReverseAuctions, erpRfqAuctionBids, erpSupplierPortalLinks,
  erpSuppliers, users, db as rawDb,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { startApprovalWorkflow } from "./approval-workflow-service"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Priority 17 Wave 1 (PROJEXA Procurement workflow exposure): widened to the
// same dbUser-or-apiKey actor union already precedented by erp-invoicing-
// service.ts's createSalesInvoice / erp-accounting-service.ts's
// createJournalEntry -- PROJEXA's callVeridian() proxy always calls
// server-to-server with a shared Bearer API key, never a session cookie.
// submitPurchaseRequisition deliberately keeps requiring a real dbUser
// (unchanged, not exported here) since it drives startApprovalWorkflow's
// WorkflowContext, which itself requires a real user -- same "requires a
// real session, not an API key" precedent already used for quotation
// approval elsewhere in this codebase; the route layer surfaces that as an
// honest 400 rather than silently working around it.
export type ActorCtx = { orgId: string; userId: string } & (
  | { dbUser: typeof users.$inferSelect; apiKey?: never }
  | { dbUser?: never; apiKey: { id: string; name: string } }
)

type RequisitionItemInput = { itemId?: string; description: string; quantity?: number; estimatedRate?: number }

// ============================================================
// Purchase Requisitions
// ============================================================

export async function listPurchaseRequisitions(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpPurchaseRequisitions.findMany({
      where: eq(erpPurchaseRequisitions.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true },
    })
  })
}

export async function getPurchaseRequisition(ctx: { orgId: string }, requisitionId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const req = await db.query.erpPurchaseRequisitions.findFirst({
      where: and(eq(erpPurchaseRequisitions.id, requisitionId), eq(erpPurchaseRequisitions.orgId, ctx.orgId)),
      with: { items: true },
    })
    if (!req) throw new ServiceError("Purchase requisition not found", 404)
    return req
  })
}

export async function createPurchaseRequisition(
  ctx: ActorCtx,
  input: { departmentId?: string; purpose?: string; postingDate: string; items: RequisitionItemInput[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseRequisitions.requisitionNumber}), 0)` })
      .from(erpPurchaseRequisitions).where(eq(erpPurchaseRequisitions.orgId, ctx.orgId))

    const [req] = await db.insert(erpPurchaseRequisitions).values({
      orgId: ctx.orgId, requisitionNumber: Number(maxNumber) + 1, requestedById: ctx.userId,
      departmentId: input.departmentId, purpose: input.purpose, postingDate: input.postingDate,
    }).returning()

    await db.insert(erpPurchaseRequisitionItems).values(
      input.items.map((i) => ({
        requisitionId: req.id, itemId: i.itemId, description: i.description,
        quantity: (i.quantity ?? 1).toString(), estimatedRate: i.estimatedRate?.toString(),
      }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_purchase_requisition.created", entityType: "erp_purchase_requisition", entityId: req.id })
    return req
  })
}

/**
 * Submits a draft requisition: starts an approval-workflow instance if the
 * org has configured one for 'erp_purchase_requisition', otherwise moves
 * straight to 'approved' -- matching the no-approval-configured default
 * behavior established by submitJournalEntry.
 */
export async function submitPurchaseRequisition(ctx: ErpContext, requisitionId: string) {
  await requireErpEnabled(ctx.orgId)
  const req = await getPurchaseRequisition(ctx, requisitionId)
  if (req.status !== "draft") throw new ServiceError("Only draft requisitions can be submitted", 409)

  const estimatedTotal = req.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.estimatedRate ?? 0), 0)

  const instance = await startApprovalWorkflow(ctx, {
    entityType: "erp_purchase_requisition",
    entityId: requisitionId,
    entityData: { estimatedTotal },
  })

  if (!instance) {
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "approved" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.approved", entityType: "erp_purchase_requisition", entityId: requisitionId })
      return { ...updated, pendingApproval: false }
    })
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "submitted" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.submitted", entityType: "erp_purchase_requisition", entityId: requisitionId })
    return { ...updated, pendingApproval: true, approvalInstanceId: instance.id }
  })
}

/** Called from the approval-decide route once a requisition's workflow instance reaches 'approved'. */
export async function markPurchaseRequisitionApprovedFromApproval(ctx: { orgId: string; userId: string; dbUser: typeof users.$inferSelect }, requisitionId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(erpPurchaseRequisitions).set({ status: "approved" }).where(eq(erpPurchaseRequisitions.id, requisitionId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_purchase_requisition.approved", entityType: "erp_purchase_requisition", entityId: requisitionId })
    return updated
  })
}

// ============================================================
// RFQs
// ============================================================

export async function listRfqs(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpRfqs.findMany({
      where: eq(erpRfqs.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true, suppliers: true },
    })
  })
}

export async function createRfq(
  ctx: ActorCtx,
  input: { requisitionId?: string; postingDate: string; items: { itemId?: string; description: string; quantity?: number }[]; supplierIds: string[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)
  if (!input.supplierIds?.length) throw new ServiceError("At least one supplier is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.requisitionId) {
      const req = await db.query.erpPurchaseRequisitions.findFirst({ where: and(eq(erpPurchaseRequisitions.id, input.requisitionId), eq(erpPurchaseRequisitions.orgId, ctx.orgId)) })
      if (!req) throw new ServiceError("Purchase requisition not found", 404)
    }

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpRfqs.rfqNumber}), 0)` })
      .from(erpRfqs).where(eq(erpRfqs.orgId, ctx.orgId))

    const [rfq] = await db.insert(erpRfqs).values({
      orgId: ctx.orgId, rfqNumber: Number(maxNumber) + 1, requisitionId: input.requisitionId,
      postingDate: input.postingDate, createdById: ctx.userId,
    }).returning()

    await db.insert(erpRfqItems).values(
      input.items.map((i) => ({ rfqId: rfq.id, itemId: i.itemId, description: i.description, quantity: (i.quantity ?? 1).toString() }))
    )
    await db.insert(erpRfqSuppliers).values(input.supplierIds.map((supplierId) => ({ rfqId: rfq.id, supplierId })))

    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_rfq.created", entityType: "erp_rfq", entityId: rfq.id })
    return rfq
  })
}

export async function sendRfq(ctx: ActorCtx, rfqId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rfq = await db.query.erpRfqs.findFirst({ where: and(eq(erpRfqs.id, rfqId), eq(erpRfqs.orgId, ctx.orgId)) })
    if (!rfq) throw new ServiceError("RFQ not found", 404)
    if (rfq.status !== "draft") throw new ServiceError("Only draft RFQs can be sent", 409)
    const [updated] = await db.update(erpRfqs).set({ status: "sent" }).where(eq(erpRfqs.id, rfqId)).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_rfq.sent", entityType: "erp_rfq", entityId: rfqId })
    return updated
  })
}

// ============================================================
// Supplier Quotations
// ============================================================

export async function listSupplierQuotations(ctx: { orgId: string }, rfqId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpSupplierQuotations.findMany({
      where: rfqId
        ? and(eq(erpSupplierQuotations.orgId, ctx.orgId), eq(erpSupplierQuotations.rfqId, rfqId))
        : eq(erpSupplierQuotations.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.postingDate),
      with: { items: true, supplier: true },
    })
  })
}

export async function createSupplierQuotation(
  ctx: ActorCtx,
  input: { rfqId?: string; supplierId: string; postingDate: string; validTill?: string; items: { itemId?: string; description: string; quantity?: number; rate?: number }[] }
) {
  await requireErpEnabled(ctx.orgId)
  if (!input.supplierId) throw new ServiceError("supplierId is required", 400)
  if (!input.items?.length) throw new ServiceError("At least one line item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const supplier = await db.query.erpSuppliers.findFirst({ where: and(eq(erpSuppliers.id, input.supplierId), eq(erpSuppliers.orgId, ctx.orgId)) })
    if (!supplier) throw new ServiceError("Supplier not found", 404)

    const [{ maxNumber }] = await db.select({ maxNumber: sql<number>`coalesce(max(${erpSupplierQuotations.quotationNumber}), 0)` })
      .from(erpSupplierQuotations).where(eq(erpSupplierQuotations.orgId, ctx.orgId))

    const [quotation] = await db.insert(erpSupplierQuotations).values({
      orgId: ctx.orgId, rfqId: input.rfqId, supplierId: input.supplierId,
      quotationNumber: Number(maxNumber) + 1, postingDate: input.postingDate, validTill: input.validTill,
      createdById: ctx.userId,
    }).returning()

    await db.insert(erpSupplierQuotationItems).values(
      input.items.map((i) => ({ quotationId: quotation.id, itemId: i.itemId, description: i.description, quantity: (i.quantity ?? 1).toString(), rate: (i.rate ?? 0).toString() }))
    )

    await logActivity({ tx: db, orgId: ctx.orgId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }), action: "erp_supplier_quotation.created", entityType: "erp_supplier_quotation", entityId: quotation.id })
    return quotation
  })
}

/** Side-by-side comparison of all quotations received against one RFQ, ranked by total. */
export async function compareQuotationsForRfq(ctx: { orgId: string }, rfqId: string) {
  await requireErpEnabled(ctx.orgId)
  const quotations = await listSupplierQuotations(ctx, rfqId)
  const weighted = await getWeightedScoresForRfq(ctx, rfqId)
  return quotations
    .map((q) => ({
      ...q,
      total: q.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.rate), 0),
      weightedScore: weighted.get(q.id) ?? null,
    }))
    .sort((a, b) => a.total - b.total)
}

// ============================================================
// Wave 83 (RFQ enhancements, COMPARISON_CSV_GAP_ANALYSIS.md backlog #4):
// weighted scoring, negotiation-round log, reverse auction.
// ============================================================

export async function addScoringCriterion(ctx: { orgId: string; userId: string }, rfqId: string, input: { name: string; weight: number }) {
  await requireErpEnabled(ctx.orgId)
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rfq = await db.query.erpRfqs.findFirst({ where: and(eq(erpRfqs.id, rfqId), eq(erpRfqs.orgId, ctx.orgId)) })
    if (!rfq) throw new ServiceError("RFQ not found", 404)
    const [criterion] = await db.insert(erpRfqScoringCriteria).values({ orgId: ctx.orgId, rfqId, name, weight: input.weight.toString() }).returning()
    return criterion
  })
}

export async function listScoringCriteria(ctx: { orgId: string }, rfqId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpRfqScoringCriteria.findMany({ where: and(eq(erpRfqScoringCriteria.orgId, ctx.orgId), eq(erpRfqScoringCriteria.rfqId, rfqId)) })
  )
}

export async function scoreQuotation(ctx: { orgId: string; userId: string }, quotationId: string, criterionId: string, score: number, notes?: string) {
  await requireErpEnabled(ctx.orgId)
  if (score < 0 || score > 10) throw new ServiceError("score must be between 0 and 10", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const quotation = await db.query.erpSupplierQuotations.findFirst({ where: and(eq(erpSupplierQuotations.id, quotationId), eq(erpSupplierQuotations.orgId, ctx.orgId)) })
    if (!quotation) throw new ServiceError("Quotation not found", 404)
    const criterion = await db.query.erpRfqScoringCriteria.findFirst({ where: and(eq(erpRfqScoringCriteria.id, criterionId), eq(erpRfqScoringCriteria.orgId, ctx.orgId)) })
    if (!criterion) throw new ServiceError("Scoring criterion not found", 404)

    const [entry] = await db.insert(erpRfqQuotationScores).values({
      orgId: ctx.orgId, quotationId, criterionId, score: score.toString(), scoredById: ctx.userId, notes: notes ?? null,
    }).returning()
    return entry
  })
}

/** Weighted-average score (0-10 scale) per quotation for an RFQ, keyed by quotationId. Returns an empty map if no criteria/scores exist yet -- never fabricates a score. */
async function getWeightedScoresForRfq(ctx: { orgId: string }, rfqId: string): Promise<Map<string, number>> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const criteria = await db.query.erpRfqScoringCriteria.findMany({ where: and(eq(erpRfqScoringCriteria.orgId, ctx.orgId), eq(erpRfqScoringCriteria.rfqId, rfqId)) })
    if (criteria.length === 0) return new Map()
    const criterionWeights = new Map(criteria.map((c) => [c.id, Number(c.weight)]))
    const totalWeight = criteria.reduce((sum, c) => sum + Number(c.weight), 0)

    const quotations = await db.query.erpSupplierQuotations.findMany({ where: and(eq(erpSupplierQuotations.orgId, ctx.orgId), eq(erpSupplierQuotations.rfqId, rfqId)) })
    const result = new Map<string, number>()
    for (const q of quotations) {
      const scores = await db.query.erpRfqQuotationScores.findMany({ where: and(eq(erpRfqQuotationScores.orgId, ctx.orgId), eq(erpRfqQuotationScores.quotationId, q.id)) })
      if (scores.length === 0 || totalWeight === 0) continue
      const weightedSum = scores.reduce((sum, s) => sum + Number(s.score) * (criterionWeights.get(s.criterionId) ?? 0), 0)
      result.set(q.id, weightedSum / totalWeight)
    }
    return result
  })
}

export async function listQuotationScores(ctx: { orgId: string }, quotationId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpRfqQuotationScores.findMany({ where: and(eq(erpRfqQuotationScores.orgId, ctx.orgId), eq(erpRfqQuotationScores.quotationId, quotationId)) })
  )
}

// ─── Negotiation-round log ─────────────────────────────────────────────
export async function addNegotiationRound(ctx: { orgId: string; userId: string }, quotationId: string, input: { proposedRate: number; notes?: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const quotation = await db.query.erpSupplierQuotations.findFirst({ where: and(eq(erpSupplierQuotations.id, quotationId), eq(erpSupplierQuotations.orgId, ctx.orgId)) })
    if (!quotation) throw new ServiceError("Quotation not found", 404)

    const existing = await db.query.erpRfqNegotiationRounds.findMany({ where: eq(erpRfqNegotiationRounds.quotationId, quotationId) })
    const [round] = await db.insert(erpRfqNegotiationRounds).values({
      orgId: ctx.orgId, quotationId, roundNumber: existing.length + 1,
      proposedRate: input.proposedRate.toString(), notes: input.notes ?? null, createdById: ctx.userId,
    }).returning()
    return round
  })
}

export async function listNegotiationRounds(ctx: { orgId: string }, quotationId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpRfqNegotiationRounds.findMany({
      where: and(eq(erpRfqNegotiationRounds.orgId, ctx.orgId), eq(erpRfqNegotiationRounds.quotationId, quotationId)),
      orderBy: (t, { asc }) => asc(t.roundNumber),
    })
  )
}

// ─── Reverse auction ────────────────────────────────────────────────────
// Suppliers bid via their existing vendor-portal token (Wave 80) -- no
// second invite/token mechanism. Each bid is server-enforced to actually
// undercut the current lowest; the auction's currentLowestBid/
// currentLeaderSupplierId are updated atomically with the bid insert.
export async function createReverseAuction(ctx: { orgId: string; userId: string }, rfqId: string, input: { startAt: string; endAt: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rfq = await db.query.erpRfqs.findFirst({ where: and(eq(erpRfqs.id, rfqId), eq(erpRfqs.orgId, ctx.orgId)) })
    if (!rfq) throw new ServiceError("RFQ not found", 404)
    const [auction] = await db.insert(erpRfqReverseAuctions).values({
      orgId: ctx.orgId, rfqId, startAt: new Date(input.startAt), endAt: new Date(input.endAt), status: "active", createdById: ctx.userId,
    }).returning()
    return auction
  })
}

export async function listReverseAuctions(ctx: { orgId: string }, rfqId?: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpRfqReverseAuctions.findMany({
      where: rfqId ? and(eq(erpRfqReverseAuctions.orgId, ctx.orgId), eq(erpRfqReverseAuctions.rfqId, rfqId)) : eq(erpRfqReverseAuctions.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function closeReverseAuction(ctx: { orgId: string; userId: string }, auctionId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const auction = await db.query.erpRfqReverseAuctions.findFirst({ where: and(eq(erpRfqReverseAuctions.id, auctionId), eq(erpRfqReverseAuctions.orgId, ctx.orgId)) })
    if (!auction) throw new ServiceError("Auction not found", 404)
    if (auction.status === "closed") throw new ServiceError("Auction is already closed", 409)
    const [updated] = await db.update(erpRfqReverseAuctions)
      .set({ status: "closed", closedAt: new Date(), winningSupplierId: auction.currentLeaderSupplierId })
      .where(eq(erpRfqReverseAuctions.id, auctionId)).returning()
    return updated
  })
}

export async function listAuctionBids(ctx: { orgId: string }, auctionId: string) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpRfqAuctionBids.findMany({
      where: and(eq(erpRfqAuctionBids.orgId, ctx.orgId), eq(erpRfqAuctionBids.auctionId, auctionId)),
      orderBy: (t, { asc }) => asc(t.submittedAt),
    })
  )
}

// Public (no auth) -- resolves the supplier's existing vendor-portal token,
// same RLS-bypass rationale as getSupplierPortalData()/getGuestConversation().
async function resolveSupplierFromPortalToken(token: string) {
  const link = await rawDb.query.erpSupplierPortalLinks.findFirst({ where: eq(erpSupplierPortalLinks.token, token) })
  if (!link || link.revokedAt || link.expiresAt < new Date()) throw new ServiceError("This vendor portal link is invalid or has expired", 404)
  return link.supplierId
}

export async function getActiveAuctionsForSupplierPortal(token: string) {
  const supplierId = await resolveSupplierFromPortalToken(token)
  const invitedRfqs = await rawDb.query.erpRfqSuppliers.findMany({ where: eq(erpRfqSuppliers.supplierId, supplierId) })
  const rfqIds = invitedRfqs.map((r) => r.rfqId)
  if (rfqIds.length === 0) return []

  const auctions = await rawDb.query.erpRfqReverseAuctions.findMany({ where: eq(erpRfqReverseAuctions.status, "active") })
  return auctions
    .filter((a) => rfqIds.includes(a.rfqId))
    .map((a) => ({
      id: a.id, rfqId: a.rfqId, startAt: a.startAt, endAt: a.endAt,
      currentLowestBid: a.currentLowestBid, isCurrentLeader: a.currentLeaderSupplierId === supplierId,
    }))
}

export async function submitAuctionBid(token: string, auctionId: string, bidAmount: number) {
  const supplierId = await resolveSupplierFromPortalToken(token)
  if (!(bidAmount > 0)) throw new ServiceError("bidAmount must be a positive number", 400)

  const auction = await rawDb.query.erpRfqReverseAuctions.findFirst({ where: eq(erpRfqReverseAuctions.id, auctionId) })
  if (!auction) throw new ServiceError("Auction not found", 404)
  if (auction.status !== "active" || auction.endAt < new Date()) throw new ServiceError("This auction is not currently accepting bids", 409)

  const invited = await rawDb.query.erpRfqSuppliers.findFirst({ where: and(eq(erpRfqSuppliers.rfqId, auction.rfqId), eq(erpRfqSuppliers.supplierId, supplierId)) })
  if (!invited) throw new ServiceError("This supplier is not invited to the underlying RFQ", 403)

  if (auction.currentLowestBid != null && bidAmount >= Number(auction.currentLowestBid)) {
    throw new ServiceError(`Your bid must be lower than the current lowest bid (${auction.currentLowestBid})`, 409)
  }

  const [bid] = await rawDb.insert(erpRfqAuctionBids).values({
    orgId: auction.orgId, auctionId, supplierId, bidAmount: bidAmount.toString(),
  }).returning()
  await rawDb.update(erpRfqReverseAuctions)
    .set({ currentLowestBid: bidAmount.toString(), currentLeaderSupplierId: supplierId })
    .where(eq(erpRfqReverseAuctions.id, auctionId))

  return bid
}
