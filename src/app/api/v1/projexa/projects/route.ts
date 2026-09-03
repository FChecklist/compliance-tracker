import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createProject, listProjectsForSelection, ServiceError, type SelectableProject } from "@/lib/services/construction-dashboard-service"

// R67 F-03 (R-041/R-046). Until now this route was POST-only: GET /projects
// answered 405, so every one of PROJEXA's ~50 project-scoped pages resolved
// "which project am I on" by calling GET /dashboard -- getOrgDashboard(), the
// earned-value/BOQ/invoice aggregate measured at 1.4-4.0 s -- before sending
// a single byte of HTML (/documents TTFB 1951 ms, /moms 1983 ms, against a
// /budgets page that paints at 580 ms because it does not do this).
//
// The 60 s per-org cache is a plain in-process Map, deliberately NOT Next's
// fetch/unstable_cache: this is the origin of the data, there is no fetch to
// tag, and the entry is keyed by the caller's already-authorised orgId so it
// can never serve one tenant's list to another. It is per warm instance and
// is simply absent on a cold one -- that is the correct failure mode for a
// latency cache (a miss costs one indexed SELECT), and it is why the TTL is
// short enough that a project created through POST below shows up on the
// picker within a minute without any invalidation plumbing.
const PROJECT_LIST_TTL_MS = 60_000
const projectListCache = new Map<string, { at: number; projects: SelectableProject[] }>()

async function readProjectsCached(orgId: string): Promise<SelectableProject[]> {
  const hit = projectListCache.get(orgId)
  if (hit && Date.now() - hit.at < PROJECT_LIST_TTL_MS) return hit.projects
  const projects = await listProjectsForSelection({ orgId })
  projectListCache.set(orgId, { at: Date.now(), projects })
  return projects
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    return NextResponse.json({ projects: await readProjectsCached(ctx.orgId) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa projects list error:", error)
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 })
  }
}

// Closes the one real gap in PROJEXA's otherwise-complete per-module CRUD
// surface: every other entity (RFIs, submittals, punch list, ...) already
// has a create path -- Projects, the entity everything else nests under,
// did not. See construction-dashboard-service.ts's createProject() for the
// full context (2026-07-18 production-readiness pass).
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const project = await createProject({ orgId: ctx.orgId, userId: actorId, isRealUser: Boolean(ctx.dbUser) }, body)
    // R67 F-03: a project the caller just created must be on their own next
    // picker read, not up to 60 s later -- drop this org's cached list rather
    // than waiting the TTL out.
    projectListCache.delete(ctx.orgId)
    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa projects create error:", error)
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
