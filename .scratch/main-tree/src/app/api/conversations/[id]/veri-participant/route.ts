// Priority 6 item 3 (VERI_CHAT_GOVERNANCE.md section 2, "What ships this
// wave: POST /api/conversations/[id]/invite-veri (or equivalent) adds VERI
// as a recognized participant on a group conversation"). POST invites,
// DELETE removes -- both call the same setVeriGroupParticipant() service
// function, which enforces the type: 'group' restriction and participant
// membership check (a caller who isn't already in the conversation can't
// invite VERI into it).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setVeriGroupParticipant, ServiceError } from "@/lib/services/chat-service"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await setVeriGroupParticipant({ orgId, userId: dbUser.id }, id, true)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Invite VERI error:", error)
    return NextResponse.json({ error: "Failed to add VERI to this conversation" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await setVeriGroupParticipant({ orgId, userId: dbUser.id }, id, false)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Remove VERI error:", error)
    return NextResponse.json({ error: "Failed to remove VERI from this conversation" }, { status: 500 })
  }
}
