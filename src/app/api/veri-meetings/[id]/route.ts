import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const meeting = await getVeriMeeting({ orgId }, id)
    return NextResponse.json(meeting)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings get error:", error)
    return NextResponse.json({ error: "Failed to fetch meeting" }, { status: 500 })
  }
}
