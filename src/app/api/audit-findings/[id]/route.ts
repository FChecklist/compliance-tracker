import { auditFindings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const CAPA_STATUSES = ["open", "in_progress", "closed"]
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await context.params
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const existing = await db.query.auditFindings.findFirst({ where: eq(auditFindings.id, id) })
    if (!existing) return null
    const idx = CAPA_STATUSES.indexOf(existing.capaStatus)
    const nextStatus = CAPA_STATUSES[Math.min(idx + 1, CAPA_STATUSES.length - 1)]
    const [updated] = await db.update(auditFindings).set({ capaStatus: nextStatus, retestResult: nextStatus === "closed" ? "passed" : existing.retestResult, updatedAt: new Date() }).where(eq(auditFindings.id, id)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "AuditFinding", entityId: id, details: `CAPA for "${existing.title}" moved to ${nextStatus}`, orgId, dbUser, request })
    return updated
  })
  if (!result) return NextResponse.json({ error: "Finding not found" }, { status: 404 })
  return NextResponse.json({ id: result.id, capaStatus: result.capaStatus })
}
