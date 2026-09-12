// Wave 127 (task-20260727-190032): revision comparison was internal-only --
// PROJEXA had no v1 endpoint to fetch "what changed between Rev0 and Rev2"
// for its own revisions screen. ?against=<boqId> compares any two revisions
// in the project, not just adjacent ones; defaults to the immediate parent.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { compareBoq, ServiceError } from "@/lib/services/construction-boq-service"
// R85 Addendum 3 v4 Phase 6 (gates 6-01/6-03a): THE ONE GATE, see
// cost-visibility-service.ts's own header. compareBoq's added/removed/
// changed line items carry the same raw qtyProject/rateProject columns as
// getBoq/listBoqs, so this surface needs exactly the same redaction.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const against = request.nextUrl.searchParams.get("against") ?? undefined
    const comparison = await compareBoq({ orgId: ctx.orgId }, id, { against })
    const role = (ctx.dbUser?.role as UserRole | undefined) ?? null
    const responseBody = await applyCostVisibility({ orgId: ctx.orgId }, role, comparison)
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ compare error:", error)
    return NextResponse.json({ error: "Failed to compare BOQ revisions" }, { status: 500 })
  }
}
