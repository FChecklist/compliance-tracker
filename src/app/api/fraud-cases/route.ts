import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listFraudCases, createFraudCase, ServiceError } from "@/lib/services/fraud-case-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ cases: [] })

  const cases = await listFraudCases({ orgId })
  return NextResponse.json({ cases })
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const fraudCase = await createFraudCase({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(fraudCase, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fraud case create error:", error)
    return NextResponse.json({ error: "Failed to create fraud case" }, { status: 500 })
  }
}
