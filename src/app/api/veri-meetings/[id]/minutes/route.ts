import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { updateMeetingMinutes, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (typeof body.minutes !== "string") return NextResponse.json({ error: "minutes is required" }, { status: 400 })
    const result = await updateMeetingMinutes({ orgId, userId: dbUser.id, dbUser }, id, body.minutes)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings update minutes error:", error)
    return NextResponse.json({ error: "Failed to update minutes" }, { status: 500 })
  }
}
