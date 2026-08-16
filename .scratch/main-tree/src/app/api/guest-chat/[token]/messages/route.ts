// Intentionally public -- the one write-capable unauthenticated route in
// this codebase. See veri-chat-service.ts's postGuestMessage() for the
// narrow-scope rationale (content only, token-expiry-limited).
import { NextResponse } from "next/server"
import { postGuestMessage, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const body = await request.json()
    const message = await postGuestMessage(token, body.content)
    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Guest message error:", error)
    return NextResponse.json({ error: "This guest link is invalid or has expired" }, { status: 404 })
  }
}
