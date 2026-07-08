import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setBillableRate, ServiceError } from "@/lib/services/firm-billing-service"

export async function POST(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await req.json()
    const rate = await setBillableRate({ orgId }, body)
    return NextResponse.json(rate, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Set billable rate error:", error)
    return NextResponse.json({ error: "Failed to set billable rate" }, { status: 500 })
  }
}
