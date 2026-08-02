import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createMeetingShareLink, listMeetingShareLinks, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ links: [] })

  try {
    const { id } = await params
    const links = await listMeetingShareLinks({ orgId }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings list share links error:", error)
    return NextResponse.json({ error: "Failed to fetch share links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const link = await createMeetingShareLink({ orgId, userId: dbUser.id, dbUser }, id)
    // Priority 18a: derive shareUrl/whatsappHref/telegramHref at the route
    // layer, mirroring /api/veri-chat/conversations/[id]/share-links's exact
    // convention (the service returns the raw token row; the route builds
    // the outbound links since only it knows the request origin). Points at
    // /shared/meeting/[token], a public page added alongside this change --
    // the share link itself (createMeetingShareLink, Wave 44) already
    // existed, but nothing before this rendered it publicly the way
    // /shared/conversation/[token] already does for conversations.
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
    console.error("VERI Meetings create share link error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
