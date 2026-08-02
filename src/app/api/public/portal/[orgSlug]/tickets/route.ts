import { NextRequest, NextResponse } from "next/server"
import { submitPublicTicket, ServiceError } from "@/lib/services/public-portal-service"

type RouteContext = { params: Promise<{ orgSlug: string }> }

function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? "unknown"
}

// Helpdesk gap-closure (self-service portal, Phase 0 2026-07-27).
// Intentionally public -- no requireAuth() call, the whole point of this
// route. This is this surface's one write-capable endpoint, so unlike the
// two read-only KB routes it's rate-limited (checkPublicTicketRateLimit
// inside submitPublicTicket, same IP-keyed windowed-count pattern
// org-join-code-service.ts's checkJoinCodeRateLimit already established --
// see extractIp's identical precedent in join-code/preview/route.ts).
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { orgSlug } = await params
    const body = await request.json().catch(() => ({}))
    const ipAddress = extractIp(request)
    const result = await submitPublicTicket(orgSlug, ipAddress, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Public portal ticket submission error:", error)
    return NextResponse.json({ error: "Failed to submit ticket" }, { status: 500 })
  }
}
