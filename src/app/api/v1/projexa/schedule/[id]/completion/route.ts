// R67 lane D22 (item D-49, rec R-125): one activity's completion, and where
// it came from.
//
// A SEPARATE ROUTE FROM ../route.ts's ordinary PATCH, on purpose. That PATCH
// takes completionPercentage among a dozen other fields, which is right for an
// activity nobody has linked to a BOQ line. Once an activity IS linked, typing
// over the derived figure is a different act with a different requirement -- a
// reason -- and giving it its own endpoint is what makes that requirement
// enforceable server-side instead of a rule the UI is trusted to remember.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import {
  getActivityCompletionProvenance, setActivityCompletionManually, ServiceError,
} from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const { id } = await params

  try {
    return NextResponse.json(await getActivityCompletionProvenance({ orgId: ctx.orgId }, id))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa activity completion provenance error:", error)
    return NextResponse.json({ error: "Failed to load this activity's progress source" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const { id } = await params

  try {
    const body = await request.json()
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const updated = await setActivityCompletionManually(
      { orgId: ctx.orgId, userId: acting.person.id },
      id,
      { completionPercentage: Number(body.completionPercentage), note: typeof body.note === "string" ? body.note : "" },
      // The actor snapshot the audit row records. U-20b: always a named person
      // -- the session user, or the person an API-key caller acts for together
      // with the key (requireActingPerson's `actor`) -- never the key alone.
      acting.actor
    )
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa activity completion override error:", error)
    return NextResponse.json({ error: "Failed to set this activity's completion" }, { status: 500 })
  }
}
