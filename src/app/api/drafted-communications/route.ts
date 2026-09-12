import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listDraftedCommunications, draftCommunication, ServiceError } from "@/lib/services/communication-drafting-service"

// D10 GAP-06: an AI-drafted communication, held for approval before send.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ drafts: [] })

  try {
    const status = request.nextUrl.searchParams.get("status") ?? undefined
    const drafts = await listDraftedCommunications({ orgId }, { status })
    return NextResponse.json({ drafts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drafted communications list error:", error)
    return NextResponse.json({ error: "Failed to fetch drafted communications" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all. Drafting only creates a pending_approval row -- it never
  // sends anything (send only happens via approveCommunication, already
  // gated at "senior_professional" on ./[id]/approve/route.ts) -- so this
  // matches this codebase's own "draft/create = member, approve/finalize =
  // higher" pattern (e.g. erp.fixed_assets.create vs. .dispose,
  // documents/route.ts's own POST floor).
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await draftCommunication({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drafted communications draft error:", error)
    return NextResponse.json({ error: "Failed to draft communication" }, { status: 500 })
  }
}
