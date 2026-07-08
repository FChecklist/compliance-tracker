import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateMapping, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function PUT(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { batchId } = await ctx.params
    const body = await req.json()
    if (!body.mapping || typeof body.mapping !== "object") return NextResponse.json({ error: "mapping object is required" }, { status: 400 })

    const result = await updateMapping({ orgId, userId: dbUser.id, dbUser }, batchId, body.mapping)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST mapping update error:", error)
    return NextResponse.json({ error: "Failed to update mapping" }, { status: 500 })
  }
}
