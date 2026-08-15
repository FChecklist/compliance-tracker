// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explains Workflow Decisions" -- surfaces one orchestra_executions row's
// routingRationale (and basic identifying fields) on request.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrchestraExecutionRationale } from "@/lib/services/orchestra-analytics-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const execution = await getOrchestraExecutionRationale({ orgId }, id)
    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 })
    return NextResponse.json(execution)
  } catch (error) {
    console.error("Orchestra execution rationale fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch execution" }, { status: 500 })
  }
}
