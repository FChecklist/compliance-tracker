import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { regenerateAiReply, ServiceError } from "@/lib/services/chat-service"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const aiMessage = await regenerateAiReply({ orgId, userId: dbUser.id }, id)
    return NextResponse.json({ aiReply: aiMessage })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Regenerate AI reply error:", error)
    return NextResponse.json({ error: "Failed to regenerate reply" }, { status: 500 })
  }
}
