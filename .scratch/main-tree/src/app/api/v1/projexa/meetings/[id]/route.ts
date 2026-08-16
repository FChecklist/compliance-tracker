// Wave 141: thin alias over pms-meeting-service.ts's getMeeting() (returns
// the meeting plus its agenda items, outcomes, and participants in one
// call). No requirePmsEnabled() gate -- see meetings/route.ts's header.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getMeeting, ServiceError } from "@/lib/services/pms-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const meeting = await getMeeting({ orgId: ctx.orgId }, id)
    return NextResponse.json(meeting)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa meeting get error:", error)
    return NextResponse.json({ error: "Failed to fetch meeting" }, { status: 500 })
  }
}
