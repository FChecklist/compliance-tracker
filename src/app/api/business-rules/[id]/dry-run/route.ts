import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { testBusinessRule, listBusinessRuleTestRuns, ServiceError } from "@/lib/services/business-rules-service"

type RouteContext = { params: Promise<{ id: string }> }

// Business Rule Testing Framework finding: dry-run a rule against a
// caller-supplied sample record, no side effects, action never executed.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // Same floor as this file's siblings (business-rules/route.ts's own POST
  // requires "manager" to actually create a rule) -- dry-run doesn't mutate
  // the rule itself, but it does persist a businessRuleTestRuns row and had
  // no role floor at all beyond generic auth.
  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const result = await testBusinessRule({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rule test error:", error)
    return NextResponse.json({ error: "Failed to test business rule" }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const testRuns = await listBusinessRuleTestRuns({ orgId }, id)
    return NextResponse.json({ testRuns })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Business rule test runs list error:", error)
    return NextResponse.json({ error: "Failed to fetch business rule test runs" }, { status: 500 })
  }
}
