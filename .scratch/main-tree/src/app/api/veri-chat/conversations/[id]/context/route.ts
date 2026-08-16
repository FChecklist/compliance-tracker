import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setConversationContext, ServiceError } from "@/lib/services/veri-chat-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await setConversationContext({ orgId, userId: dbUser.id }, id, {
      contextEntityType: body.contextEntityType ?? null,
      contextEntityId: body.contextEntityId ?? null,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat set context error:", error)
    return NextResponse.json({ error: "Failed to set conversation context" }, { status: 500 })
  }
}
