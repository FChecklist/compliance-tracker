// Wave 141 (PROJEXA gap analysis): Change Orders. Reuses the real,
// existing e-signature workflow (esignature-service.ts, Wave 86) for
// client approval instead of a bespoke approval mechanism -- see that
// file's `linkedEntityType: "change_order"` branch (added alongside this).
import { constructionChangeOrders, esignatureRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, count, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createSignatureRequest } from "./esignature-service"

export type ChangeOrderInput = {
  projectId: string; title: string; description?: string; reason?: string
  costImpact?: number; scheduleImpactDays?: number
  // R65 gap-closure: free text, no fixed vocabulary -- same convention as
  // constructionLabourRoster.trade/erpSuppliers.trade (e.g. "Carpentry",
  // "Civil", "Electrical"). Lets a caller mark a change order as
  // interior-design-scoped (e.g. "Interior Design") vs civil/MEP/other,
  // which report-engine-service.ts#computeInteriorVariationOrderAnalysis
  // (formulaKey interior_variation_order_analysis) filters on.
  trade?: string
}

export async function createChangeOrder(ctx: { orgId: string; userId: string }, input: ChangeOrderInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionChangeOrders).where(and(eq(constructionChangeOrders.orgId, ctx.orgId), eq(constructionChangeOrders.projectId, input.projectId)))
    const [row] = await db.insert(constructionChangeOrders).values({
      orgId: ctx.orgId, projectId: input.projectId, number: existing + 1,
      title: input.title.trim(), description: input.description ?? null, reason: input.reason ?? null,
      costImpact: String(input.costImpact ?? 0), scheduleImpactDays: input.scheduleImpactDays ?? 0,
      trade: input.trade?.trim() || null,
      requestedById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listChangeOrders(ctx: { orgId: string }, projectId: string, filters: { status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionChangeOrders.orgId, ctx.orgId), eq(constructionChangeOrders.projectId, projectId)]
    if (filters.status) conditions.push(eq(constructionChangeOrders.status, filters.status as typeof constructionChangeOrders.$inferSelect.status))
    return db.query.constructionChangeOrders.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.number) })
  })
}

// Priority 18a (VERI Chat second-screen unification): the panel's Approvals
// tab needs one org-wide "what's waiting on a decision" query -- listChangeOrders
// above requires a projectId because every existing caller (PROJEXA's
// per-project Change Orders page) is already scoped to one project. This is
// the same table/tenant-scope, just without that filter, so a cross-project
// attention feed doesn't need to loop every project the org has.
export async function listChangeOrdersAwaitingApproval(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionChangeOrders.findMany({
      where: and(eq(constructionChangeOrders.orgId, ctx.orgId), eq(constructionChangeOrders.status, "pending_approval")),
      orderBy: (t, { desc }) => desc(t.number),
    })
  )
}

export async function getChangeOrder(ctx: { orgId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const row = await db.query.constructionChangeOrders.findFirst({ where: and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId)) })
    if (!row) throw new ServiceError("Change order not found", 404)
    return row
  })
}

// Sends the change order for real e-signature approval (client/owner) --
// dispatches through the existing signing workflow rather than a flag flip,
// so approval carries the same tamper-evident audit trail (signer identity,
// IP, user agent, document-hash comparison) every other signed document does.
export async function submitChangeOrderForApproval(
  ctx: { orgId: string; userId: string; dbUser: Parameters<typeof createSignatureRequest>[0]["dbUser"] },
  changeOrderId: string,
  signers: { name: string; email: string; order?: number }[]
) {
  if (!signers?.length) throw new ServiceError("At least one signer is required", 400)

  const changeOrder = await getChangeOrder(ctx, changeOrderId)
  if (changeOrder.status !== "draft") throw new ServiceError("Only a draft change order can be submitted for approval", 400)

  const request = await createSignatureRequest(ctx, {
    linkedEntityType: "change_order", linkedEntityId: changeOrderId,
    title: `Change Order #${changeOrder.number}: ${changeOrder.title}`, signers,
  })

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionChangeOrders).set({
      status: "pending_approval", esignatureRequestId: request.id,
    }).where(and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId))).returning()
    return row
  })
}

// NOT called from anywhere as of the e-signature wiring fix below --
// esignature-service.ts's submitSignature() now updates
// constructionChangeOrders directly instead of calling this (it runs on
// the public, tokenized-signer-access path with no real ctx.userId this
// function requires, and importing it would create a circular import with
// this file's own import of createSignatureRequest from esignature-service.ts).
// This function used to be reachable via a v1/projexa PATCH `action:
// "approve"` branch that let ANY caller flip a change order to approved
// with zero signature ever happening -- that branch was removed as a real
// integrity bypass, not just dead-coded here. Left in place (not deleted)
// as a real, correct building block for a possible future *properly
// audited* manual-override path, should one ever be built -- do not wire
// a new unaudited caller to this without an explicit elevated-permission
// gate and a visible "manually overridden" trail distinguishing it from a
// real signature.
export async function markChangeOrderApproved(ctx: { orgId: string; userId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionChangeOrders).set({
      status: "approved", approvedById: ctx.userId, approvedAt: new Date(),
    }).where(and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Change order not found", 404)
    return row
  })
}

// Same "not called from anywhere" note as markChangeOrderApproved() above
// -- esignature-service.ts's declineSignature() updates
// constructionChangeOrders directly instead of calling this now.
export async function markChangeOrderRejected(ctx: { orgId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(constructionChangeOrders).set({ status: "rejected" })
      .where(and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Change order not found", 404)
    return row
  })
}

// lf-b5-ai-crud (owner order 2026-10-02, R7) -- the EDIT and the CANCEL of a
// change order, which did not exist. The conservative rules, chosen here and
// written into ai-os/AI_CRUD_COVERAGE.md for the owner to veto:
//   - EDIT (title, description, reason, cost impact, schedule impact, trade):
//     only while the change order is a DRAFT. Stricter than "draft or pending
//     approval": once it is sent for e-signature the client is signing a hash
//     of exactly these terms (esignature-service.ts computeDocumentHash), so an
//     edit under a live signature would make the signature attest to something
//     the client never saw. To change a pending one: cancel it and raise a new one.
//   - CANCEL: only while draft or pending approval. The status becomes
//     "cancelled" (a value drizzle/0687 adds) and, IN THE SAME TRANSACTION,
//     every e-signature request of this change order that is still pending or
//     partially signed is voided -- a signer who opens the link afterwards is
//     told it was voided (getSigningSession). Nothing is deleted.
//   - an approved, rejected or cancelled change order is immutable (409).
// Every reader that counts change orders already filters on status
// "approved", so a cancelled one counts nowhere.
export const CHANGE_ORDER_EDITABLE_STATUSES = ["draft"] as const
export const CHANGE_ORDER_CANCELLABLE_STATUSES = ["draft", "pending_approval"] as const

export type ChangeOrderPatch = Partial<{
  title: string; description: string | null; reason: string | null; costImpact: number; scheduleImpactDays: number; trade: string | null
}>

export async function updateChangeOrder(ctx: { orgId: string }, changeOrderId: string, patch: ChangeOrderPatch) {
  if (patch.title !== undefined && !patch.title.trim()) throw new ServiceError("title cannot be empty", 400)
  if (patch.costImpact !== undefined && !Number.isFinite(patch.costImpact)) throw new ServiceError("costImpact must be a number", 400)
  if (patch.scheduleImpactDays !== undefined && !Number.isInteger(patch.scheduleImpactDays)) throw new ServiceError("scheduleImpactDays must be a whole number", 400)
  const set = {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
    ...(patch.costImpact !== undefined ? { costImpact: String(patch.costImpact) } : {}),
    ...(patch.scheduleImpactDays !== undefined ? { scheduleImpactDays: patch.scheduleImpactDays } : {}),
    ...(patch.trade !== undefined ? { trade: patch.trade?.trim() || null } : {}),
  }
  if (Object.keys(set).length === 0) throw new ServiceError("Nothing to change", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionChangeOrders.findFirst({ where: and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Change order not found", 404)
    if (!(CHANGE_ORDER_EDITABLE_STATUSES as readonly string[]).includes(existing.status)) {
      throw new ServiceError(`Only a draft change order can be edited (this one is ${existing.status})`, 409)
    }
    const [row] = await db.update(constructionChangeOrders).set(set).where(eq(constructionChangeOrders.id, changeOrderId)).returning()
    return row
  })
}

export async function cancelChangeOrder(ctx: { orgId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionChangeOrders.findFirst({ where: and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Change order not found", 404)
    if (!(CHANGE_ORDER_CANCELLABLE_STATUSES as readonly string[]).includes(existing.status)) {
      throw new ServiceError(`An ${existing.status} change order cannot be cancelled`, 409)
    }
    const voided = await db.update(esignatureRequests).set({ status: "voided" }).where(and(
      eq(esignatureRequests.orgId, ctx.orgId),
      eq(esignatureRequests.linkedEntityType, "change_order"),
      eq(esignatureRequests.linkedEntityId, changeOrderId),
      inArray(esignatureRequests.status, ["pending", "partially_signed"]),
    )).returning({ id: esignatureRequests.id })
    const [row] = await db.update(constructionChangeOrders).set({ status: "cancelled" }).where(eq(constructionChangeOrders.id, changeOrderId)).returning()
    return { changeOrder: row, signatureRequestsVoided: voided.map((v) => v.id) }
  })
}
