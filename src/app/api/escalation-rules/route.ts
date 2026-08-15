import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listEscalationRules, createEscalationRule, ServiceError } from "@/lib/services/ticket-service"

// Helpdesk gap-closure (tiered SLA + team routing, Phase 0 2026-07-27):
// admin CRUD for the escalation chain checkTicketEscalations() (the
// escalation cron) fires against.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const slaPolicyId = request.nextUrl.searchParams.get("slaPolicyId") || undefined
    const rules = await listEscalationRules({ orgId }, slaPolicyId)
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Escalation rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch escalation rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const rule = await createEscalationRule({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Escalation rule create error:", error)
    return NextResponse.json({ error: "Failed to create escalation rule" }, { status: 500 })
  }
}
