import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOrgChart, ServiceError } from "@/lib/services/hr-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ employees: [], roots: [] })

  try {
    const chart = await getOrgChart({ orgId })
    return NextResponse.json(chart)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Org chart error:", error)
    return NextResponse.json({ error: "Failed to fetch org chart" }, { status: 500 })
  }
}
