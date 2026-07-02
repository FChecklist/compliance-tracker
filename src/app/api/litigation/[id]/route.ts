import { litigationMatters } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const STAGES = ["filed", "hearing_scheduled", "judgment_reserved", "judgment_passed", "appeal_filed", "closed"]
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.litigationMatters.findFirst({ where: eq(litigationMatters.id, id) })
      if (!existing) return null

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (body.stage && STAGES.includes(body.stage)) updates.stage = body.stage
      if (body.nextHearingDate !== undefined) updates.nextHearingDate = body.nextHearingDate ? new Date(body.nextHearingDate) : null
      if (body.counsel !== undefined) updates.counsel = body.counsel

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [updated] = await db.update(litigationMatters).set(updates as any).where(eq(litigationMatters.id, id)).returning()
      await logActivity({ tx: db, action: "status_change", entityType: "LitigationMatter", entityId: id, details: `"${existing.matter}" updated`, orgId, dbUser, request })
      return updated
    })

    if (!result) return NextResponse.json({ error: "Matter not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, stage: result.stage })
  } catch (error) {
    console.error("Litigation PATCH error:", error)
    return NextResponse.json({ error: "Failed to update matter" }, { status: 500 })
  }
}
