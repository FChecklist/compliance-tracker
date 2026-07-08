import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { completeDeliverable, ServiceError } from "@/lib/services/firm-engagement-service"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ deliverableId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { deliverableId } = await ctx.params
    const deliverable = await completeDeliverable({ orgId }, deliverableId)
    return NextResponse.json(deliverable)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Complete deliverable error:", error)
    return NextResponse.json({ error: "Failed to complete deliverable" }, { status: 500 })
  }
}
