import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateTaxCaseStage, ServiceError } from "@/lib/services/firm-tax-case-service"

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ caseId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { caseId } = await ctx.params
    const body = await req.json()
    if (!body.stage) return NextResponse.json({ error: "stage is required" }, { status: 400 })
    const taxCase = await updateTaxCaseStage({ orgId }, caseId, body.stage, body.outcome)
    return NextResponse.json(taxCase)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Update tax case stage error:", error)
    return NextResponse.json({ error: "Failed to update tax case stage" }, { status: 500 })
  }
}
