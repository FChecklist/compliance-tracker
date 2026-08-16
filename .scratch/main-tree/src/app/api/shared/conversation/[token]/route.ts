// Intentionally public -- no requireAuth() call. Token-gated instead (see
// getSharedConversation()'s expiry/revocation check). This is the one
// legitimate unauthenticated read surface in this codebase, existing
// specifically to back the wa.me/t.me share-out links (PLATFORM_STRATEGY.md
// §16.2) -- never add requireAuth() here, that would defeat the point of a
// share link a recipient with no VERIDIAN account can open.
import { NextResponse } from "next/server"
import { getSharedConversation, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const result = await getSharedConversation(token)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Shared conversation error:", error)
    return NextResponse.json({ error: "This share link is invalid or has expired" }, { status: 404 })
  }
}
