import { NextResponse } from "next/server"
import { getPublishedKbPageBySlug, ServiceError } from "@/lib/services/public-portal-service"

type RouteContext = { params: Promise<{ orgSlug: string; slug: string }> }

// Helpdesk gap-closure (self-service portal, Phase 0 2026-07-27).
// Intentionally public -- see the sibling list route's comment.
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { orgSlug, slug } = await params
    const page = await getPublishedKbPageBySlug(orgSlug, slug)
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Public portal KB page error:", error)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
