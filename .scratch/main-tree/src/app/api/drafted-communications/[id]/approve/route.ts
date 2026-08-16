import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { approveCommunication, ServiceError } from "@/lib/services/communication-drafting-service"

type RouteContext = { params: Promise<{ id: string }> }

// D10.B3.S1's approval step + D10.B4.S1's send-time guardrail gate (see
// communication-guardrails.ts) -- never sends without this explicit call
// (or an always_approve preference reaching the same code path).
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await approveCommunication({ orgId, userId: dbUser.id, dbUser }, id, { savePreference: body.savePreference })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Drafted communication approve error:", error)
    return NextResponse.json({ error: "Failed to approve communication" }, { status: 500 })
  }
}
