// R39/R-C04: the Bearer-key-callable twin of /api/veri-meetings/[id]/
// share-links (cookie-only requireAuth, unreachable from PROJEXA's
// callVeridian() client) -- same requireAuthOrApiKey pattern as this
// surface's sibling routes. Reuses createMeetingShareLink/listMeetingShareLinks
// unchanged (Wave 44) -- no second share mechanism, matching R-C15's own
// precedent (compliance-tracker#1331) this row explicitly says to reuse.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createMeetingShareLink, listMeetingShareLinks, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ links: [] })

  try {
    const { id } = await params
    const links = await listMeetingShareLinks({ orgId: ctx.orgId }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting share links list error:", error)
    return NextResponse.json({ error: "Failed to fetch share links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  // R39/R-C04: ctx.apiKey?.id is not a real compliance.users row -- see
  // veriMeetings.createdById's schema.ts comment. veriMeetingShareLinks'
  // createdById was already made nullable in R38 (PR #1331) for the same
  // reason on the reports-share surface.
  const actorId = ctx.dbUser?.id ?? null
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const link = await createMeetingShareLink(
      { orgId: ctx.orgId, userId: actorId, ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }) },
      id
    )
    const origin = request.nextUrl.origin
    const shareUrl = `${origin}/shared/meeting/${link.token}`
    return NextResponse.json({
      ...link,
      shareUrl,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(`View these VERIDIAN AI meeting minutes: ${shareUrl}`)}`,
      telegramHref: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("View these VERIDIAN AI meeting minutes")}`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting create share link error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
