import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listRisks, createRisk, ServiceError } from "@/lib/services/risk-register-service"

// Priority 15: logic extracted verbatim into risk-register-service.ts
// (same Wave-11-style refactor compliance-service.ts itself went through)
// so PROJEXA's /api/v1/projexa/risks alias can call the exact same
// implementation instead of duplicating it. This route's own request/
// response shape is unchanged.
export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ risks: [] })

  const result = await listRisks({ orgId, dbUser })
  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const risk = await createRisk({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json({ id: risk.id }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Risk create error:", error)
    return NextResponse.json({ error: "Failed to create risk" }, { status: 500 })
  }
}
