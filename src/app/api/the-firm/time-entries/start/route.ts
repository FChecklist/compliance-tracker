import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { startTimer, ServiceError } from "@/lib/services/firm-time-tracking-service"

export async function POST(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await req.json()
    const entry = await startTimer({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Start timer error:", error)
    return NextResponse.json({ error: "Failed to start timer" }, { status: 500 })
  }
}
