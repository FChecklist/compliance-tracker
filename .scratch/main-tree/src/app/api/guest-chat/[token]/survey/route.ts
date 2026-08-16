import { NextRequest, NextResponse } from "next/server"
import { submitTicketSurveyByToken, ServiceError } from "@/lib/services/ticket-service"

// Intentionally public -- no requireAuth(), same rationale as
// /api/guest-chat/[token] itself. Token-gated via submitTicketSurveyByToken's
// own resolveActiveGuestAccess() check.
type RouteContext = { params: Promise<{ token: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { token } = await params
    const body = await request.json()
    const survey = await submitTicketSurveyByToken(token, {
      csatScore: body.csatScore != null ? Number(body.csatScore) : undefined,
      npsScore: body.npsScore != null ? Number(body.npsScore) : undefined,
      comment: body.comment,
    })
    return NextResponse.json(survey, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket survey submission error:", error)
    return NextResponse.json({ error: "Failed to submit survey" }, { status: 500 })
  }
}
