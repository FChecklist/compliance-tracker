import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createReferralLink, ServiceError } from "@/lib/services/sales-engine-service"

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response

  try {
    const body = await request.json()
    const link = await createReferralLink({ dbUser }, body)
    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Referral link create error:", error)
    return NextResponse.json({ error: "Failed to create referral link" }, { status: 500 })
  }
}
