// Wave 127 (task-20260727-190032): revision comparison was internal-only --
// PROJEXA had no v1 endpoint to fetch "what changed between Rev0 and Rev2"
// for its own revisions screen. ?against=<boqId> compares any two revisions
// in the project, not just adjacent ones; defaults to the immediate parent.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { compareBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const against = request.nextUrl.searchParams.get("against") ?? undefined
    const comparison = await compareBoq({ orgId: ctx.orgId }, id, { against })
    return NextResponse.json(comparison)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ compare error:", error)
    return NextResponse.json({ error: "Failed to compare BOQ revisions" }, { status: 500 })
  }
}
