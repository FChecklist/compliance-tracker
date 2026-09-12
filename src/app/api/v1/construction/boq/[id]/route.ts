// Wave 127 (task-20260727-190032): v1 (PROJEXA-facing) surface only had
// list+create for BOQs -- a single BOQ (with its line items) was only
// reachable at the internal /api/construction/boq/[id] route. Same service
// call, same auth pattern as the sibling v1/construction/boq/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getBoq, updateBoq, deleteBoq, ServiceError } from "@/lib/services/construction-boq-service"
// R85 Addendum 3 v4 Phase 6 (gates 6-01/6-03a): THE ONE GATE, see
// cost-visibility-service.ts's own header.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const boq = await getBoq({ orgId: ctx.orgId }, id)
    const role = (ctx.dbUser?.role as UserRole | undefined) ?? null
    const responseBody = await applyCostVisibility({ orgId: ctx.orgId }, role, boq)
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ get error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQ" }, { status: 500 })
  }
}

// R46/E-126b: previously no DELETE existed for a BOQ at all -- see
// deleteBoq()'s own header comment in construction-boq-service.ts for why
// this was added and why it's restricted to status "draft".
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleCheck = requireRoleOrScope(ctx, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const result = await deleteBoq({ orgId: ctx.orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ delete error:", error)
    return NextResponse.json({ error: "Failed to delete BOQ" }, { status: 500 })
  }
}

// R80/GAP-14: PATCH a BOQ's HEADER. GET and DELETE existed here; there was no
// write path for the header at all, so a BOQ's title was write-once (see
// updateBoq()'s own header comment in construction-boq-service.ts for the
// field allow-list and the superseded-revision block).
//
// Auth/role/error shape copied verbatim from the sibling that already exports
// PATCH, boq/line-items/[id]/route.ts: requireAuthOrApiKey + explicit orgId
// check + requireRoleOrScope(ctx, "member", "write"). Correcting a title is a
// lighter act than DELETE's "manager" -- it is the same object, edited by the
// same people who already edit its lines through that sibling route.
//
// The body is read FIELD BY FIELD rather than spread, and any lineage or
// workflow key present in it is refused with a 400 instead of being silently
// dropped: a caller that believes it just moved a BOQ to another project or
// re-pointed its parent must be told it did not.
const BOQ_HEADER_IMMUTABLE_FIELDS = ["version", "status", "projectId", "parentBoqId", "createdById", "approvedById", "approvedAt"] as const

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const body = await request.json()
    const rejected = BOQ_HEADER_IMMUTABLE_FIELDS.filter((field) => body?.[field] !== undefined)
    if (rejected.length > 0) {
      return NextResponse.json(
        { error: `${rejected.join(", ")} cannot be changed here -- version, parentBoqId and status are the revision lineage (use Create Revision / Submit / Approve), and projectId would separate this BOQ from its own recorded progress. Nothing was saved.` },
        { status: 400 }
      )
    }
    const updated = await updateBoq({ orgId: ctx.orgId }, id, { title: body.title })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ header update error:", error)
    return NextResponse.json({ error: "Failed to update BOQ" }, { status: 500 })
  }
}
