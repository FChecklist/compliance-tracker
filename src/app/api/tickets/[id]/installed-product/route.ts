import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setTicketInstalledProduct, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const ticket = await setTicketInstalledProduct({ orgId, userId: dbUser.id }, id, body.installedProductId ?? null)
    return NextResponse.json(ticket)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ticket installed-product link error:", error)
    return NextResponse.json({ error: "Failed to link installed product" }, { status: 500 })
  }
}
