import { NextResponse } from "next/server"
import { listPublishedKbPages, ServiceError } from "@/lib/services/public-portal-service"

type RouteContext = { params: Promise<{ orgSlug: string }> }

// Helpdesk gap-closure (self-service portal, Phase 0 2026-07-27).
// Intentionally public -- no requireAuth() call. Read-only, org-scoped by
// orgSlug (organisations.slug), and only ever returns pages a staff member
// explicitly marked isPublished -- every other knowledge_base_pages row
// stays invisible here, same as it always was.
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { orgSlug } = await params
    const pages = await listPublishedKbPages(orgSlug)
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Public portal KB list error:", error)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
