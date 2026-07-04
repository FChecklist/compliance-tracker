import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokeShareLink, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await revokeShareLink({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat revoke share link error:", error)
    return NextResponse.json({ error: "Failed to revoke share link" }, { status: 500 })
  }
}
