import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { workerAgents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"

type RouteContext = { params: Promise<{ id: string }> }

const VALID_LIFECYCLE = new Set(["draft", "proposed", "approved", "published", "retired"])

// Wave 16: modify/version/retire a worker agent -- constitution §4: "only
// Layer 1 may... modify, version, or retire" -- veridian_admin is the
// in-app stand-in (see worker-agent-service.ts's header note on why).
//
// Global-tier rows are untouched by this route by construction, not by
// omission: RLS's app_runtime_update policy on worker_agents only covers
// tier IN (customer, client, user) -- a global row simply matches zero
// rows here regardless of caller role, since only service_role can touch
// it. That's the honest, existing enforcement of "only Layer 1 creates
// platform agents autonomously" already in place before this wave.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requireRole(dbUser, "veridian_admin")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const updates: Partial<typeof workerAgents.$inferInsert> = { updatedAt: new Date() }

    if (body.lifecycleStatus !== undefined) {
      if (!VALID_LIFECYCLE.has(body.lifecycleStatus)) {
        return NextResponse.json({ error: `lifecycleStatus must be one of: ${[...VALID_LIFECYCLE].join(", ")}` }, { status: 400 })
      }
      updates.lifecycleStatus = body.lifecycleStatus
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null
    if (body.promptTemplate !== undefined) {
      updates.promptTemplate = body.promptTemplate?.trim() || null
      // Any prompt change is a real version bump -- workerAgentVersions
      // already exists for exactly this (Wave 3), just never written here
      // before since no edit path existed at all.
      updates.version = (await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
        db.query.workerAgents.findFirst({ where: eq(workerAgents.id, id), columns: { version: true } })
      ))?.version
      if (updates.version) updates.version += 1
    }
    if (body.supervisorWorkerAgentId !== undefined) updates.supervisorWorkerAgentId = body.supervisorWorkerAgentId || null

    const updated = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.update(workerAgents).set(updates).where(eq(workerAgents.id, id)).returning()
    )

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Worker agent not found, or it's a global-tier agent (only modifiable at the platform level, not through this org-scoped endpoint)" },
        { status: 404 }
      )
    }

    const [agent] = updated
    return NextResponse.json({ id: agent.id, lifecycleStatus: agent.lifecycleStatus, version: agent.version, updatedAt: agent.updatedAt.toISOString() })
  } catch (error) {
    console.error("Worker agent update error:", error)
    return NextResponse.json({ error: "Failed to update worker agent" }, { status: 500 })
  }
}
