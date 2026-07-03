import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAutomationRuleRuns, ServiceError } from "@/lib/services/automation-rule-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ runs: [] })

  try {
    const { id } = await params
    const runs = await listAutomationRuleRuns({ orgId }, id)
    return NextResponse.json({ runs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Automation rule runs error:", error)
    return NextResponse.json({ error: "Failed to fetch rule runs" }, { status: 500 })
  }
}
