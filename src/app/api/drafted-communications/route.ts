import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
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
