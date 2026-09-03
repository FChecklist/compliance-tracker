// R67 D-28 (R-069) + R67 lane D22 (item D-77, rec R-289): a single
// work-progress entry -- read, correct, delete.
//
// WHAT DID NOT EXIST BEFORE THIS. /api/v1/construction/progress had a list and
// a create and nothing else on the wire, so PROJEXA's Work Progress list could
// show a row but had nowhere to send a click -- there was no object page
// because there was no endpoint behind one, and a mis-keyed quantity could only
// be fixed by a DELETE (itself unreachable, no route existed) and a full
// re-entry. The only single-entry route in the whole tree was a DELETE on the
// pre-v1 /api/construction/progress/[id] surface, which PROJEXA cannot reach at
// all (its client calls /api/v1/projexa/*).
//
// GET/PATCH run through the SAME service functions the list and the create path
// use, so the percent range, the entry-basis vocabulary, the project-scoped
// activity lookup and the parent-BOQ-line refusal are one implementation, not
// two.
//
// Same auth posture as ../route.ts: requireAuthOrApiKey for the read (org-scoped
// like every other read here), requireRoleOrScope(member/write) for both writes
// -- the same gate as the POST that created the row. PROJEXA reaches these with
// a per-org Bearer key.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getProgressEntry, updateProgressEntry, deleteProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const entry = await getProgressEntry({ orgId: ctx.orgId }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry read error:", error)
    return NextResponse.json({ error: "Failed to load progress entry" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    // Only fields the caller actually sent are forwarded -- an absent field
    // means "leave it alone", never "clear it".
    const patch: Parameters<typeof updateProgressEntry>[2] = {}
    if (body.activityId !== undefined) patch.activityId = body.activityId
    if (body.boqLineItemId !== undefined) patch.boqLineItemId = body.boqLineItemId || null
    if (body.entryDate !== undefined) patch.entryDate = body.entryDate
    if (body.quantityDone !== undefined) patch.quantityDone = Number(body.quantityDone)
    if (body.percentComplete !== undefined) patch.percentComplete = Number(body.percentComplete)
    if (body.remarks !== undefined) patch.remarks = body.remarks || null
    if (body.entryBasis !== undefined) patch.entryBasis = body.entryBasis

    const entry = await updateProgressEntry({ orgId: ctx.orgId }, id, patch)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry update error:", error)
    return NextResponse.json({ error: "Failed to update progress entry" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteProgressEntry({ orgId: ctx.orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry delete error:", error)
    return NextResponse.json({ error: "Failed to delete progress entry" }, { status: 500 })
  }
}
