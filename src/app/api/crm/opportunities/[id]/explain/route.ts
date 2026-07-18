// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// same rationale as the leads/[id]/explain route.
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
    const explanation = await explainCrmAiDecision({ orgId }, "opportunity", id)
    return NextResponse.json({ explanation })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("CRM opportunity explain error:", error)
    return NextResponse.json({ error: "Failed to explain opportunity AI decision" }, { status: 500 })
  }
}
