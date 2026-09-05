import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
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

// R75 Part 2 Phase 5 (G3-email-conv): this had NO gate at all beyond
// requireAuth() -- any authenticated org member (including viewer/stage_0/
// client_viewer/external_auditor) could start a brand-new conversation
// naming arbitrary other org members as participants. Once a conversation
// exists, this codebase's real access model is participant-based
// (assertParticipant() in chat-service.ts, used by getMessages/sendMessage/
// markConversationRead/setVeriGroupParticipant) -- but the sibling CREATE
// flow in this exact file (createWorkflowThread(), POST
// /api/conversations/workflow-thread) has that same "no rank gate" shape,
// so it isn't a real precedent to copy. The closest ACTUALLY-gated
// create-a-new-object sibling is POST /api/documents (requireRole(dbUser,
// "member")) -- matches the general floor this codebase uses everywhere a
// session user creates a new work object (also POST /api/tasks via
// requireRoleOrScope(ctx, "member")). "member" is applied here for the
// same reason: it excludes the view-only tiers (viewer/stage_0/
// client_viewer/external_auditor, rank 1) from starting conversations,
// while every real working role can still start one.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

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
