import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getProgressEntry, updateProgressEntry, deleteProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

// R67 lane D22 (item D-77, rec R-289): one work-progress entry, by id.
//
// WHAT DID NOT EXIST BEFORE THIS. /api/v1/construction/progress had a list and
// a create and nothing else, so PROJEXA's Work Progress list could show a row
// but had nowhere to send a click -- there was no object page because there
// was no endpoint behind one. The only single-entry route in the whole tree
// was a DELETE on the pre-v1 /api/construction/progress/[id] surface, which
// PROJEXA cannot reach at all (its client calls /api/v1/projexa/*).
//
// GET is org-scoped like every other read here; PATCH and DELETE carry the
// same requireRoleOrScope(ctx, "member", "write") gate as the POST that
// created the row.

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
    console.error("v1 construction progress entry get error:", error)
    return NextResponse.json({ error: "Failed to fetch progress entry" }, { status: 500 })
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
    const entry = await updateProgressEntry({ orgId: ctx.orgId }, id, {
      entryDate: body?.entryDate,
      quantityDone: body?.quantityDone !== undefined ? Number(body.quantityDone) : undefined,
      percentComplete: body?.percentComplete !== undefined ? Number(body.percentComplete) : undefined,
      remarks: body?.remarks,
      entryBasis: body?.entryBasis,
    })
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
