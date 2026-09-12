import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
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

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all -- matches this same helpdesk module's own sibling config
  // resource, /api/sla-policies (POST and PATCH both require "admin"): the
  // escalation chain this rule adds to is the exact table
  // checkTicketEscalations() (the escalation cron) fires against, keyed
  // off slaPolicyId, so it sits at the same admin-CRUD bar as the policy
  // it belongs to, not a lower one.
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

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
