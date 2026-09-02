// R67 D-21. Intentionally public -- no requireAuth() call, exactly like its
// sibling /api/veri-meetings/share/[token] (see that file's header for the
// same rationale). Token-gated instead: getMeetingByShareToken() already
// refuses a revoked, expired or soft-deleted meeting with a 404 that does not
// distinguish "expired" from "never existed".
//
// WHY THIS EXISTS: Sumeet asked for the PDF, not a page link, at the end of a
// WhatsApp share. The authenticated PDF route (v1/projexa/veri-meetings/[id]/
// pdf) needs an org API key, which the recipient of a share link does not
// have, so the public share page had no way to offer a download at all. This
// reuses the SHIPPED generateMeetingMinutesPdf() byte for byte -- no second
// PDF renderer, and PROJEXA still gains no PDF library (it relays these bytes).
import { NextResponse } from "next/server"
import { getMeetingByShareToken, ServiceError } from "@/lib/services/veri-meeting-service"
import { generateMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const meeting = await getMeetingByShareToken(token)
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
    console.error("Shared meeting PDF error:", error)
    return NextResponse.json({ error: "This share link is invalid or has expired" }, { status: 404 })
  }
}
