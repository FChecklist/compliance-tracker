import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSupplierScorecards, ServiceError } from "@/lib/services/erp-buying-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ scorecards: [] })

  try {
    const scorecards = await listSupplierScorecards({ orgId })
    return NextResponse.json({ scorecards })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier scorecards list error:", error)
    return NextResponse.json({ error: "Failed to fetch supplier scorecards" }, { status: 500 })
  }
}
