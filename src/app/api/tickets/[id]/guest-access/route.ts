import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { inviteGuestToTicket, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const guest = await inviteGuestToTicket({ orgId, userId: dbUser.id }, id, { guestName: body.guestName, guestEmail: body.guestEmail })
    const origin = request.nextUrl.origin
    const guestUrl = `${origin}/guest-chat/${guest.token}`
    return NextResponse.json({ ...guest, guestUrl }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket guest invite error:", error)
    return NextResponse.json({ error: "Failed to invite guest" }, { status: 500 })
  }
}
