// Wave 143: real PDF export for a Minutes of Meeting -- same posture as
// quotations/[id]/pdf/route.ts (thin GET, generates+streams a real binary
// PDF, no requireRoleOrScope gate beyond auth since it's read-only).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"
import { generateMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const meeting = await getVeriMeeting({ orgId: ctx.orgId }, id)
    const pdfBuffer = generateMeetingMinutesPdf({
      systemId: meeting.systemId,
      title: meeting.title,
      meetingType: meeting.meetingType,
      scheduledAt: meeting.scheduledAt,
      status: meeting.status,
      attendees: (meeting.attendees ?? []) as string[],
      agenda: (meeting.agenda ?? []) as string[],
      minutes: meeting.minutes,
      aiSummary: meeting.aiSummary,
      aiKeyDecisions: (meeting.aiKeyDecisions ?? []) as string[],
      aiSuggestedActionItems: (meeting.aiSuggestedActionItems ?? []) as { title: string; assignee: string | null; dueDateHint: string | null }[],
    })
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="mom-${meeting.systemId ?? meeting.id}.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting pdf error:", error)
    return NextResponse.json({ error: "Failed to generate meeting PDF" }, { status: 500 })
  }
}
