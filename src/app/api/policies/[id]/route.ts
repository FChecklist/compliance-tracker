import { policies, approvalRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> }

// action='edit': bumps the minor version and appends to history, never
// overwrites. action='request_publish': does NOT publish directly -- it
// creates a pending approval_requests row; the status only actually flips
// to 'published' when POST /api/approvals/[id]/decide approves it. This is
// the real maker-checker demo, same as the mockup.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { action, note } = body

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.policies.findFirst({ where: eq(policies.id, id) })
      if (!existing) return null

      if (action === "edit") {
        const [major, minor] = existing.version.replace("v", "").split(".").map(Number)
        const newVersion = `v${major}.${(minor || 0) + 1}`
        const history = Array.isArray(existing.history) ? existing.history : []
        const [updated] = await db.update(policies).set({
          version: newVersion,
          history: [{ version: newVersion, date: new Date().toLocaleDateString("en-IN"), editedBy: dbUser.name, note: note || "Updated" }, ...history],
          updatedAt: new Date(),
        }).where(eq(policies.id, id)).returning()
        await logActivity({ tx: db, action: "update", entityType: "Policy", entityId: id, details: `"${existing.title}" updated to ${newVersion}`, orgId, dbUser, request })
        return updated
      }

      if (action === "request_publish") {
        if (existing.status === "published") return existing
        const [approval] = await db.insert(approvalRequests).values({
          requestType: "policy_publish", entityType: "Policy", entityId: id,
          description: `${existing.title} (${existing.version})`, requestedById: dbUser.id, orgId,
        }).returning()
        await db.update(policies).set({ status: "under_review", updatedAt: new Date() }).where(eq(policies.id, id))
        await logActivity({ tx: db, action: "update", entityType: "Policy", entityId: id, details: `Publish requested for "${existing.title}" — approval #${approval.id}`, orgId, dbUser, request })
        return { ...existing, status: "under_review" }
      }

      return existing
    })

    if (!result) return NextResponse.json({ error: "Policy not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, version: result.version, status: result.status })
  } catch (error) {
    console.error("Policy PATCH error:", error)
    return NextResponse.json({ error: "Failed to update policy" }, { status: 500 })
  }
}
