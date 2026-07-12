import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createWorkflowThread, ServiceError } from "@/lib/services/chat-service"

// Wave 148 (Phase4_Implementation_Plan.md, "multi-thread conversations"):
// distinct from POST /api/conversations (createConversation, which requires
// at least one other human participant -- a different feature). This always
// creates a brand-new AI thread, never finds-or-reuses one, unlike the
// singleton ensureAiThread() behind GET /api/conversations.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    // Priority 5 item E1: optional modePill/pathKeys threaded through
    // unchanged when a caller sends them (none does yet -- see chat-
    // service.ts's createWorkflowThread() comment for what's deferred).
    const conversationId = await createWorkflowThread(
      { orgId, userId: dbUser.id },
      { workflowId: body.workflowId, title: body.title, modePill: body.modePill, pathKeys: body.pathKeys }
    )
    return NextResponse.json({ id: conversationId }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workflow thread create error:", error)
    return NextResponse.json({ error: "Failed to create workflow thread" }, { status: 500 })
  }
}
