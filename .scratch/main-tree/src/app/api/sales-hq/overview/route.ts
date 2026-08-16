import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getPlatformSalesOverview, ServiceError } from "@/lib/services/sales-engine-service"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const overview = await getPlatformSalesOverview({ dbUser })
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales overview fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch sales overview" }, { status: 500 })
  }
}
