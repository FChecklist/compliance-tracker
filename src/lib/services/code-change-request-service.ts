// Wave 19 (VAIOS Code-Change-Request workflow) service layer.
//
// Reuses the generic approvalRequests maker-checker (same one Wave 8's
// Policy-publish and Wave 16's worker_agent_proposal flows already use) --
// codeChangeRequests is a satellite table holding the extra fields a
// code-change request needs, since approvalRequests.entityId assumes a
// pre-existing entity to point at and a code-change request has none.
//
// CRITICAL, stated here and enforced by omission: nothing in this file (or
// anywhere else) makes an approved request actually change code.
// Implementation/Testing/Deployment remain a human directing a coding
// session outside the running app -- this is an intake + audit trail.
import { codeChangeRequests, approvalRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, desc } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const VALID_ORIGINATING_LAYERS = new Set(["personal", "enterprise", "product"])

export type CodeChangeContext = { orgId: string; userId: string }

export async function submitCodeChangeRequest(
  ctx: CodeChangeContext,
  input: { originatingLayer: string; requestedChange: string; justification?: string }
) {
  if (!VALID_ORIGINATING_LAYERS.has(input.originatingLayer)) {
    throw new ServiceError(`originatingLayer must be one of: ${[...VALID_ORIGINATING_LAYERS].join(", ")}`, 400)
  }
  const requestedChange = input.requestedChange?.trim()
  if (!requestedChange) throw new ServiceError("requestedChange is required", 400)

  // Pre-generate both ids so each row can reference the other directly on
  // insert -- avoids an awkward empty-then-backfilled entityId, since
  // approvalRequests.entityId is NOT NULL and a code-change request has no
  // pre-existing entity to point at until this satellite row exists.
  const requestId = createId()
  const approvalId = createId()

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await db.insert(approvalRequests).values({
      id: approvalId,
      requestType: "code_change_request",
      entityType: "code_change_requests",
      entityId: requestId,
      description: requestedChange.slice(0, 200),
      requestedById: ctx.userId,
      orgId: ctx.orgId,
    })

    const [request] = await db.insert(codeChangeRequests).values({
      id: requestId,
      approvalRequestId: approvalId,
      originatingLayer: input.originatingLayer,
      requestedChange,
      justification: input.justification?.trim() || null,
      orgId: ctx.orgId,
    }).returning()

    return {
      id: request.id, approvalRequestId: approvalId, originatingLayer: request.originatingLayer,
      requestedChange: request.requestedChange, status: request.status, createdAt: request.createdAt.toISOString(),
    }
  })
}

export async function listCodeChangeRequests(ctx: CodeChangeContext) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const rows = await db.query.codeChangeRequests.findMany({
      where: eq(codeChangeRequests.orgId, ctx.orgId),
      orderBy: desc(codeChangeRequests.createdAt),
    })
    return {
      requests: rows.map((r) => ({
        id: r.id, approvalRequestId: r.approvalRequestId, originatingLayer: r.originatingLayer,
        requestedChange: r.requestedChange, justification: r.justification, status: r.status,
        implementedAt: r.implementedAt?.toISOString() ?? null, implementationNote: r.implementationNote,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })
}
