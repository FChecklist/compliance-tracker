import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getBatch, cancelBatch, ServiceError } from "@/lib/services/gst-reconciliation-service"

type Context = { params: Promise<{ batchId: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { batchId } = await ctx.params
    const result = await getBatch({ orgId }, batchId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST batch fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch batch" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { batchId } = await ctx.params
    const result = await cancelBatch({ orgId, userId: dbUser.id, dbUser }, batchId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST batch cancel error:", error)
    return NextResponse.json({ error: "Failed to cancel batch" }, { status: 500 })
  }
}
