import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listConversations, createConversation, ServiceError } from "@/lib/services/chat-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ conversations: [] })

  try {
    const result = await listConversations({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Conversations list error:", error)
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createConversation({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Conversation create error:", error)
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 })
  }
}
