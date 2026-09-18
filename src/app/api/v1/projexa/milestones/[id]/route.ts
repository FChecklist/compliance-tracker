// Sumeet requirement #2 continued -- a milestone's name/description/
// targetDate/status must be editable after creation, same as every other
// real entity in this domain. No DELETE here, same discipline as
// v1/projexa/schedule/[id]/route.ts's own header comment: pms_milestones has
// no deleteMilestone() anywhere in the codebase, and status:'cancelled' (the
// enum already has it) is the append-only equivalent -- "ALL DATA WILL BE
// LOGGED AND NOT DELETED" per the Owner's own requirement.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { updateMilestone, ServiceError, type MilestonePatch } from "@/lib/services/pms-taxonomy-service"
import { withRouteTiming } from "@/lib/route-timing"

export async function PATCH(...args: Parameters<typeof PATCH_impl>) {
  return withRouteTiming("PATCH", () => PATCH_impl(...args))
}

async function PATCH_impl(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
  const { id } = await params

  try {
    const body = await request.json()
    const patch: MilestonePatch = {
      name: body.name,
      description: body.description,
      targetDate: body.targetDate,
      status: body.status,
    }
    const milestone = await updateMilestone({ orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }, id, patch)
    return NextResponse.json(milestone)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa milestone update error:", error)
    return NextResponse.json({ error: "Failed to update milestone" }, { status: 500 })
  }
}
