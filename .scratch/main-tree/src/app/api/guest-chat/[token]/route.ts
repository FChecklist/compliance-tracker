// Intentionally public -- no requireAuth() call. Token-gated instead (see
// getGuestConversation()'s expiry/revocation check). Mirrors
// /api/shared/conversation/[token]'s exact rationale (PLATFORM_STRATEGY.md
// §16.2), extended for external guests who need to reply, not just read
// (§17.8-17.9) -- never add requireAuth() here, that would defeat the point
// of a guest link for someone with no VERIDIAN account.
import { NextResponse } from "next/server"
import { getGuestConversation, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const result = await getGuestConversation(token)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Guest conversation error:", error)
    return NextResponse.json({ error: "This guest link is invalid or has expired" }, { status: 404 })
  }
}
