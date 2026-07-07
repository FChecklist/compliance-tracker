import { NextRequest, NextResponse } from "next/server"
import { recordVisitorEvent, type TrackPayload } from "@/lib/services/visitor-intelligence-service"

// Wave 113: public visitor-analytics beacon. Deliberately unauthenticated —
// it exists to observe anonymous visitors on the public product pages, so
// requireAuth() would defeat it. Safety posture instead of auth: the service
// whitelists event types and product keys, truncates every string, and the
// payload can only ever INSERT analytics rows (no reads, no updates beyond
// the visitor's own session row). Always 204s — analytics must never surface
// an error to a visitor's browser.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TrackPayload
    await recordVisitorEvent({
      ...body,
      referrer: body.referrer ?? request.headers.get("referer") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    })
  } catch {
    // swallow — see note above
  }
  return new NextResponse(null, { status: 204 })
}
