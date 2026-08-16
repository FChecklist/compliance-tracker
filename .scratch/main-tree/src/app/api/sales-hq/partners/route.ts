import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createSalesPartner, listSalesPartners, ServiceError } from "@/lib/services/sales-engine-service"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const partners = await listSalesPartners({ dbUser })
    return NextResponse.json({ partners })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales partners list error:", error)
    return NextResponse.json({ error: "Failed to fetch sales partners" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const body = await request.json()
    const partner = await createSalesPartner({ dbUser }, body)
    return NextResponse.json(partner, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Sales partner create error:", error)
    return NextResponse.json({ error: "Failed to create sales partner" }, { status: 500 })
  }
}
