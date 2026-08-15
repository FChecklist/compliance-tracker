import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSlaPolicies, createSlaPolicy, ServiceError } from "@/lib/services/ticket-service"

// Helpdesk gap-closure (tiered SLA + team routing, Phase 0 2026-07-27):
// admin CRUD for the policy table ticket-service.ts's createTicket
// resolves against (see resolveSlaPolicy/scoreSlaPolicyMatch).
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ policies: [] })

  try {
    const policies = await listSlaPolicies({ orgId })
    return NextResponse.json({ policies })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("SLA policies list error:", error)
    return NextResponse.json({ error: "Failed to fetch SLA policies" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const policy = await createSlaPolicy({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(policy, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("SLA policy create error:", error)
    return NextResponse.json({ error: "Failed to create SLA policy" }, { status: 500 })
  }
}
