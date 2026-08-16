import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, conversations } from "@/lib/db"
import { eq } from "drizzle-orm"
import { assertActiveStage0Membership } from "@/lib/services/stage0-service"
import { getMessages, sendMessage, ServiceError } from "@/lib/services/chat-service"

// Priority 18b (Owner directive 2026-07-15, Option B): a stage-0 user's
// requireAuth().orgId is ALWAYS null (no real home org) -- the existing
// org-scoped /api/conversations/[id]/messages route is single-org by
// construction and not usable by them as-is. This route resolves the
// conversation's REAL orgId directly, checks assertActiveStage0Membership
// for that specific org (the actual authorization boundary), then
// delegates to chat-service.ts's existing getMessages/sendMessage with that
// resolved orgId -- reusing the exact same read/write logic (including
// assertParticipant, RLS via withTenantContext) a real member's own replies
// already go through, per the design doc section 2.3 "Posting" note.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, id) })
    if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    await assertActiveStage0Membership(dbUser.id, convo.orgId)
    const result = await getMessages({ orgId: convo.orgId, userId: dbUser.id }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stage-0 messages list error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, id) })
    if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

    await assertActiveStage0Membership(dbUser.id, convo.orgId)
    const body = await request.json()
    // A stage-0 user can never send an instruction/assignment -- that's a
    // real-member-only action, not just a UX nicety (role: 'stage_0' rank 1
    // would already reject most such actions elsewhere, but this route is
    // narrower still: strip isInstruction/assigneeId defensively so a
    // crafted request body can't create a commitment via this path).
    const result = await sendMessage({ orgId: convo.orgId, userId: dbUser.id }, id, { content: body.content })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stage-0 message send error:", error)
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
}
