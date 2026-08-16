import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { confirmBatch, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function POST(_req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { batchId } = await ctx.params
    const result = await confirmBatch({ orgId, userId: dbUser.id, dbUser }, batchId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST confirm error:", error)
    return NextResponse.json({ error: "Failed to confirm batch" }, { status: 500 })
  }
}
