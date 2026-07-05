import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getKpiHubSummary } from "@/lib/services/kpi-hub-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const summary = await getKpiHubSummary({ orgId })
    return NextResponse.json(summary)
  } catch (error) {
    console.error("KPI hub fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch KPI hub summary" }, { status: 500 })
  }
}
