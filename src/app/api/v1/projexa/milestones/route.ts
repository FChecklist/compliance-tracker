// Sumeet requirement #2 ("Timelines AND Milestones of a project -- both are
// different"): pms_milestones/listMilestones/createMilestone already existed
// and already flow into PROJEXA's own Timeline (schedule-service.ts's
// getGanttData() calls listMilestones() and returns it in the Gantt
// payload) -- but the ONLY write path was /api/pms/milestones, gated behind
// requirePmsEnabled(), which PROJEXA has no proxy route to at all. No
// requirePmsEnabled() gate here, matching every other /v1/projexa/schedule/*
// route (gantt/route.ts, route.ts, [id]/route.ts) and /v1/projexa/board --
// pms_issues/pms_milestones are PROJEXA's generic task/schedule substrate,
// not gated behind the separately-purchased PMS product branch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listMilestones, createMilestone, ServiceError } from "@/lib/services/pms-taxonomy-service"
import { withRouteTiming } from "@/lib/route-timing"

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const milestones = await listMilestones({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ milestones })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa milestones list error:", error)
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 })
  }
}

export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { acting, error: actingError } = await requireActingPerson(request, ctx)
  if (actingError) return actingError
  const actorId = acting.person.id

  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const milestone = await createMilestone(
      { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser },
      body.projectId,
      { name: body.name, description: body.description, targetDate: body.targetDate }
    )
    return NextResponse.json(milestone, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa milestone create error:", error)
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 })
  }
}
