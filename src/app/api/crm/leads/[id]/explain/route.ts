// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain AI Decisions" -- a general-purpose read endpoint the shared
// AiDecisionExplanationCard component calls, instead of each caller
// re-deriving the AiDecisionExplanation shape from raw lead columns by hand.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { explainCrmAiDecision, ServiceError, serviceErrorBody } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const explanation = await explainCrmAiDecision({ orgId }, "lead", id)
    return NextResponse.json({ explanation })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("CRM lead explain error:", error)
    return NextResponse.json({ error: "Failed to explain lead AI decision" }, { status: 500 })
  }
}
