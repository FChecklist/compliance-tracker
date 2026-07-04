// Intentionally public -- no requireAuth() call. Token-gated instead (see
// getMeetingByShareToken()'s expiry/revocation check). Mirrors
// /api/guest-chat/[token]'s exact rationale (PLATFORM_STRATEGY.md §25) --
// never add requireAuth() here, that would defeat the point of a share link.
import { NextResponse } from "next/server"
import { getMeetingByShareToken, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { token } = await params
    const result = await getMeetingByShareToken(token)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Shared meeting error:", error)
    return NextResponse.json({ error: "This share link is invalid or has expired" }, { status: 404 })
  }
}
