import { frameworkControls } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const STATUSES = ["not_started", "in_progress", "implemented", "verified"]
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await context.params
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const existing = await db.query.frameworkControls.findFirst({ where: eq(frameworkControls.id, id) })
    if (!existing) return null
    const idx = STATUSES.indexOf(existing.status)
    const nextStatus = STATUSES[Math.min(idx + 1, STATUSES.length - 1)]
    const [updated] = await db.update(frameworkControls).set({ status: nextStatus, updatedAt: new Date() }).where(eq(frameworkControls.id, id)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "FrameworkControl", entityId: id, details: `"${existing.title}" moved to ${nextStatus}`, orgId, dbUser, request })
    return updated
  })
  if (!result) return NextResponse.json({ error: "Control not found" }, { status: 404 })
  return NextResponse.json({ id: result.id, status: result.status })
}
