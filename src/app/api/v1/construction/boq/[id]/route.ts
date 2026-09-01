// Wave 127 (task-20260727-190032): v1 (PROJEXA-facing) surface only had
// list+create for BOQs -- a single BOQ (with its line items) was only
// reachable at the internal /api/construction/boq/[id] route. Same service
// call, same auth pattern as the sibling v1/construction/boq/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getBoq, deleteBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const boq = await getBoq({ orgId: ctx.orgId }, id)
    return NextResponse.json(boq)
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
