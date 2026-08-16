import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getReturn, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ returnPeriodId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { returnPeriodId } = await ctx.params
    const result = await getReturn({ orgId }, returnPeriodId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST return fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch return" }, { status: 500 })
  }
}
