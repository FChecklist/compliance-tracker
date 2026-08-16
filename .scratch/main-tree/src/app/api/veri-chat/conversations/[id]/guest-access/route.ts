import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listGuestAccess, createGuestAccess, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ guests: [] })

  try {
    const { id } = await params
    const guests = await listGuestAccess({ orgId, userId: dbUser.id }, id)
    return NextResponse.json({ guests })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat list guest access error:", error)
    return NextResponse.json({ error: "Failed to fetch guest access" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const guest = await createGuestAccess({ orgId, userId: dbUser.id }, id, { guestName: body.guestName, guestEmail: body.guestEmail })
    const origin = request.nextUrl.origin
    const guestUrl = `${origin}/guest-chat/${guest.token}`
    return NextResponse.json({
      ...guest,
      guestUrl,
      whatsappHref: `https://wa.me/?text=${encodeURIComponent(`You have been invited to a VERIDIAN AI conversation: ${guestUrl}`)}`,
      telegramHref: `https://t.me/share/url?url=${encodeURIComponent(guestUrl)}&text=${encodeURIComponent("You have been invited to a VERIDIAN AI conversation")}`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat create guest access error:", error)
    return NextResponse.json({ error: "Failed to create guest access" }, { status: 500 })
  }
}
