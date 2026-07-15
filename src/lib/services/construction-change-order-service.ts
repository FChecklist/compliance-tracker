// Wave 141 (PROJEXA gap analysis): Change Orders. Reuses the real,
// existing e-signature workflow (esignature-service.ts, Wave 86) for
// client approval instead of a bespoke approval mechanism -- see that
// file's `linkedEntityType: "change_order"` branch (added alongside this).
import { constructionChangeOrders } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, count } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { createSignatureRequest } from "./esignature-service"

export type ChangeOrderInput = {
  projectId: string; title: string; description?: string; reason?: string
  costImpact?: number; scheduleImpactDays?: number
}

export async function createChangeOrder(ctx: { orgId: string; userId: string }, input: ChangeOrderInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [{ value: existing }] = await db.select({ value: count() }).from(constructionChangeOrders).where(and(eq(constructionChangeOrders.orgId, ctx.orgId), eq(constructionChangeOrders.projectId, input.projectId)))
    const [row] = await db.insert(constructionChangeOrders).values({
      orgId: ctx.orgId, projectId: input.projectId, number: existing + 1,
      title: input.title.trim(), description: input.description ?? null, reason: input.reason ?? null,
      costImpact: String(input.costImpact ?? 0), scheduleImpactDays: input.scheduleImpactDays ?? 0,
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

// Called from the e-signature completion path (or manually) once every
// signer has signed -- marks the change order approved. Rejection is a
// separate explicit action (a signer declining isn't auto-detected here;
// see esignature-service.ts's own signer-status tracking for that detail).
export async function markChangeOrderApproved(ctx: { orgId: string; userId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(constructionChangeOrders).set({
      status: "approved", approvedById: ctx.userId, approvedAt: new Date(),
    }).where(and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Change order not found", 404)
    return row
  })
}

export async function markChangeOrderRejected(ctx: { orgId: string }, changeOrderId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(constructionChangeOrders).set({ status: "rejected" })
      .where(and(eq(constructionChangeOrders.id, changeOrderId), eq(constructionChangeOrders.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Change order not found", 404)
    return row
  })
}
