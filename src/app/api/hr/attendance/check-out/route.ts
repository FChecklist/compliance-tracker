import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { checkOut, ServiceError } from "@/lib/services/hr-attendance-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const result = await checkOut({ orgId, userId: dbUser.id }, body.date)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Check-out error:", error)
    return NextResponse.json({ error: "Failed to check out" }, { status: 500 })
  }
}
