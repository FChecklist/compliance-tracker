// Priority 16 Part 2 (PROJEXA-WORKPROGRESS-NO-ACTIVITY-PICKER): thin alias
// over construction-progress-service.ts's listActivities()/createActivity()
// -- Work Progress's "Log Progress" dialog previously had no way to
// discover or create an activity id at all (a free-text box with
// placeholder "Paste the activity's ID from VERIDIAN"), and zero PROJEXA
// route referenced "activity" anywhere, despite construction_activities
// being a real, populated table for pre-existing projects. Consequence: any
// brand-new project (created through PROJEXA signup, or this test's own
// project creation) has zero activities and no way to create one, making
// Work Progress logging completely unusable on it. See
// control/priority16_e2e_testing_plan.md "GAP -- Work Progress" for the
// full evidence trail. No requireErpEnabled()-style gate here --
// construction_activities lives under the always-enabled `construction`
// branch (confirmed by PROJEXA-MODULE-ENTITLEMENT-01's "Confirmed NOT
// affected" list in that same plan: all construction/field modules already
// work without an entitlement gate).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import {
  listCategories, createCategory, listActivities, createActivity, ServiceError,
} from "@/lib/services/construction-progress-service"

const DEFAULT_CATEGORY_NAME = "General"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ activities: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const activities = await listActivities({ orgId: ctx.orgId }, { projectId })
    return NextResponse.json({ activities })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress activities list error:", error)
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    // categoryId is required by createActivity() (construction_activities'
    // Category -> Activity hierarchy) but a brand-new project has none yet
    // and PROJEXA's picker doesn't want to force full category management
    // just to unblock logging progress -- auto-provision a single "General"
    // category on first use, per-project, idempotently (find existing
    // before creating another).
    let categoryId = body.categoryId as string | undefined
    if (!categoryId) {
      const categories = await listCategories({ orgId: ctx.orgId }, body.projectId)
      const existingDefault = categories.find((c) => c.name === DEFAULT_CATEGORY_NAME) ?? categories[0]
      categoryId = existingDefault
        ? existingDefault.id
        : (await createCategory({ orgId: ctx.orgId }, { projectId: body.projectId, name: DEFAULT_CATEGORY_NAME })).id
    }

    const activity = await createActivity({ orgId: ctx.orgId }, {
      projectId: body.projectId,
      categoryId,
      name: body.name,
      unit: body.unit,
      plannedQuantity: body.plannedQuantity,
    })
    return NextResponse.json(activity, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa work-progress activity create error:", error)
    return NextResponse.json({ error: "Failed to create activity" }, { status: 500 })
  }
}
