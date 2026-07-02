import { approvalRequests, policies } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> }

// Only someone with 'admin' rank (the closest real-role equivalent to the
// mockup's "Approve" right) can decide a request -- and the underlying
// state change (e.g. policy.status -> published) only happens HERE, never
// at request time. Extensible to other requestTypes as they're added; the
// switch below is the one place that maps a request type to its effect.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { decision, rejectionReason } = body
    if (decision !== "approve" && decision !== "reject") return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const req_ = await db.query.approvalRequests.findFirst({ where: eq(approvalRequests.id, id) })
      if (!req_ || req_.status !== "pending") return null

      if (decision === "reject") {
        if (!rejectionReason?.trim()) throw new Error("rejectionReason is required")
        const [updated] = await db.update(approvalRequests).set({ status: "rejected", approvedById: dbUser.id, rejectionReason: rejectionReason.trim(), resolvedAt: new Date() }).where(eq(approvalRequests.id, id)).returning()
        await logActivity({ tx: db, action: "reject", entityType: "ApprovalRequest", entityId: id, details: `Rejected — ${req_.requestType}: "${req_.description}" (${rejectionReason.trim()})`, orgId, dbUser, request })
        return updated
      }

      // approve -- apply the real effect for this requestType
      if (req_.requestType === "policy_publish") {
        await db.update(policies).set({ status: "published", updatedAt: new Date() }).where(eq(policies.id, req_.entityId))
      }
      const [updated] = await db.update(approvalRequests).set({ status: "approved", approvedById: dbUser.id, resolvedAt: new Date() }).where(eq(approvalRequests.id, id)).returning()
      await logActivity({ tx: db, action: "approve", entityType: "ApprovalRequest", entityId: id, details: `Approved — ${req_.requestType}: "${req_.description}"`, orgId, dbUser, request })
      return updated
    })

    if (!result) return NextResponse.json({ error: "Approval request not found or already resolved" }, { status: 404 })
    return NextResponse.json({ id: result.id, status: result.status })
  } catch (error) {
    console.error("Approval decision error:", error)
    const message = error instanceof Error ? error.message : "Failed to process decision"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
