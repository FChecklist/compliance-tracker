import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMeetingAuditLog, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })

  try {
    const { id } = await params
    const entries = await listMeetingAuditLog({ orgId }, id)
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings audit-log error:", error)
    return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 })
  }
}
