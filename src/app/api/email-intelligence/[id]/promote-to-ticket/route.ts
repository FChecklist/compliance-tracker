import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createTicketFromEmailIntelligenceItem, ServiceError } from "@/lib/services/ticket-service"

type RouteContext = { params: Promise<{ id: string }> }

// Helpdesk gap-closure (email-to-ticket, Phase 0 2026-07-27) -- whole email
// becomes one ticket, unlike the sibling promote/route.ts (per-suggested-
// work-item -> task). Human-gated by construction, same posture as every
// other promotion route in this codebase.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const ticket = await createTicketFromEmailIntelligenceItem({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(ticket, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email-to-ticket promote error:", error)
    return NextResponse.json({ error: "Failed to promote email to ticket" }, { status: 500 })
  }
}
