import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { revokeMeetingShareLink, ServiceError } from "@/lib/services/veri-meeting-service"

type RouteContext = { params: Promise<{ linkId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { linkId } = await params
    const result = await revokeMeetingShareLink({ orgId, userId: dbUser.id, dbUser }, linkId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Meetings revoke share link error:", error)
    return NextResponse.json({ error: "Failed to revoke share link" }, { status: 500 })
  }
}
