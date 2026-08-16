import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { workerAgents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

type RouteContext = { params: Promise<{ id: string }> }

// Wave 16: publish is deliberately a separate, explicit action from
// approve -- an approved proposal isn't dispatchable until published (see
// discoverWorkerAgent's default lifecycleStatus filter), matching the
// constitution's distinct "approve, publish, version" verbs. veridian_admin
// only, same authority bar as approving the proposal in the first place.
export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requireRole(dbUser, "veridian_admin")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const updated = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const agent = await db.query.workerAgents.findFirst({ where: eq(workerAgents.id, id) })
      if (!agent || agent.lifecycleStatus !== "approved") return null
      const [result] = await db.update(workerAgents).set({ lifecycleStatus: "published", updatedAt: new Date() }).where(eq(workerAgents.id, id)).returning()
      return result
    })

    if (!updated) return NextResponse.json({ error: "Worker agent not found or not in 'approved' state" }, { status: 404 })
    return NextResponse.json({ id: updated.id, lifecycleStatus: updated.lifecycleStatus })
  } catch (error) {
    console.error("Worker agent publish error:", error)
    return NextResponse.json({ error: "Failed to publish worker agent" }, { status: 500 })
  }
}
