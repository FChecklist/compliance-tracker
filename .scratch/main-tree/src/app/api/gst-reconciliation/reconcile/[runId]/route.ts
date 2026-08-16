import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getReconciliationRun, ServiceError } from "@/lib/services/gst-reconciliation-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { runId } = await ctx.params
    const result = await getReconciliationRun({ orgId }, runId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST reconciliation fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch reconciliation run" }, { status: 500 })
  }
}
