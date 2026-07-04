import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listVeriMeetings, createVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ meetings: [] })

  try {
    const meetings = await listVeriMeetings({ orgId })
    return NextResponse.json({ meetings })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings list error:", error)
    return NextResponse.json({ error: "Failed to fetch meetings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createVeriMeeting({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings create error:", error)
    return NextResponse.json({ error: "Failed to create meeting" }, { status: 500 })
  }
}
