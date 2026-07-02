import { hrComplianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await context.params
  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const existing = await db.query.hrComplianceItems.findFirst({ where: eq(hrComplianceItems.id, id) })
    if (!existing) return null
    const [updated] = await db.update(hrComplianceItems).set({ status: "filed", updatedAt: new Date() }).where(eq(hrComplianceItems.id, id)).returning()
    await logActivity({ tx: db, action: "status_change", entityType: "HrComplianceItem", entityId: id, details: `Marked filed: "${existing.item}"`, orgId, dbUser, request })
    return updated
  })
  if (!result) return NextResponse.json({ error: "Item not found" }, { status: 404 })
  return NextResponse.json({ id: result.id, status: result.status })
}
