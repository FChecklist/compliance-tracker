// audit198 RULE-053 gap closure -- mirrors
// /api/veri-meetings/[id]/share-links/route.ts exactly.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createReportShareLink, listReportShareLinks, ServiceError } from "@/lib/services/report-share-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ links: [] })

  try {
    const { id } = await params
    const links = await listReportShareLinks({ orgId }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report list share links error:", error)
    return NextResponse.json({ error: "Failed to fetch share links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const link = await createReportShareLink({ orgId, userId: dbUser.id, dbUser }, id)
    // Route layer derives the outbound URL, mirroring /api/veri-meetings/
    // [id]/share-links/route.ts's exact convention (only the route knows
    // the request origin).
    const origin = request.nextUrl.origin
    const shareUrl = `${origin}/shared/report/${link.token}`
    return NextResponse.json({ ...link, shareUrl }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Report create share link error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
