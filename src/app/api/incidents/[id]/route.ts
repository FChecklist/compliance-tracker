import { incidents, risks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const STAGES = ["logged", "triaged", "investigating", "contained", "notified", "remediated", "closed"]
type RouteContext = { params: Promise<{ id: string }> }

// action='advance' | 'mark_notified' | 'flag_as_risk' -- flag_as_risk
// mirrors the mockup's cross-linking: an incident that reveals a systemic
// exposure becomes a real Risk Register entry, not a note left to go stale.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { action } = body

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.incidents.findFirst({ where: eq(incidents.id, id) })
      if (!existing) return null

      if (action === "advance") {
        const idx = STAGES.indexOf(existing.stage)
        if (idx >= STAGES.length - 1) return existing
        const nextStage = STAGES[idx + 1]
        const [updated] = await db.update(incidents).set({ stage: nextStage as never, closedDate: nextStage === "closed" ? new Date() : null, updatedAt: new Date() }).where(eq(incidents.id, id)).returning()
        await logActivity({ tx: db, action: "status_change", entityType: "Incident", entityId: id, details: `"${existing.title}" moved to ${nextStage}`, orgId, dbUser, request })
        return updated
      }

      if (action === "mark_notified") {
        const [updated] = await db.update(incidents).set({ notified: true, updatedAt: new Date() }).where(eq(incidents.id, id)).returning()
        await logActivity({ tx: db, action: "update", entityType: "Incident", entityId: id, details: `Regulator notified for incident "${existing.title}"`, orgId, dbUser, request })
        return updated
      }

      if (action === "flag_as_risk") {
        if (existing.linkedRiskId) return existing
        const [risk] = await db.insert(risks).values({
          title: `Risk from incident: ${existing.title}`, category: "operational", ownerId: dbUser.id, ownerDept: dbUser.departmentId, orgId,
        }).returning()
        const [updated] = await db.update(incidents).set({ linkedRiskId: risk.id, updatedAt: new Date() }).where(eq(incidents.id, id)).returning()
        await logActivity({ tx: db, action: "create", entityType: "Risk", entityId: risk.id, details: `Risk created from incident "${existing.title}"`, orgId, dbUser, request })
        return updated
      }

      return existing
    })

    if (!result) return NextResponse.json({ error: "Incident not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, stage: result.stage })
  } catch (error) {
    console.error("Incident PATCH error:", error)
    return NextResponse.json({ error: "Failed to update incident" }, { status: 500 })
  }
}
