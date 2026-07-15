import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listPolicies, createPolicy, ServiceError } from "@/lib/services/risk-register-service"

// Priority 15: logic extracted verbatim into risk-register-service.ts so
// PROJEXA's /api/v1/projexa/policies alias can call the exact same
// implementation instead of duplicating it.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ policies: [] })
  const policies = await listPolicies({ orgId })
  return NextResponse.json({ policies })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const policy = await createPolicy({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json({ id: policy.id }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Policy create error:", error)
    return NextResponse.json({ error: "Failed to create policy" }, { status: 500 })
  }
}
