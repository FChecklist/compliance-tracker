import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listShareLinks, createShareLink, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ links: [] })

  try {
    const { id } = await params
    const links = await listShareLinks({ orgId, userId: dbUser.id }, id)
    return NextResponse.json({ links })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat list share links error:", error)
    return NextResponse.json({ error: "Failed to fetch share links" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const link = await createShareLink({ orgId, userId: dbUser.id }, id)
    const origin = request.nextUrl.origin
    const shareUrl = `${origin}/shared/conversation/${link.token}`
    return NextResponse.json({
      ...link,
      shareUrl,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(`View this VERIDIAN AI conversation: ${shareUrl}`)}`,
      telegramHref: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("View this VERIDIAN AI conversation")}`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat create share link error:", error)
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 })
  }
}
