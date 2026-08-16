import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { markConversationRead, ServiceError } from "@/lib/services/chat-service"

export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await markConversationRead({ orgId, userId: dbUser.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Mark read error:", error)
    return NextResponse.json({ error: "Failed to mark conversation read" }, { status: 500 })
  }
}
