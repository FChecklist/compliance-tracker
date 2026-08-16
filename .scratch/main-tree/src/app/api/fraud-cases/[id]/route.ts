import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getFraudCase, updateFraudCaseStatus, ServiceError } from "@/lib/services/fraud-case-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const fraudCase = await getFraudCase({ orgId }, id)
    return NextResponse.json(fraudCase)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fraud case fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch fraud case" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })
    const fraudCase = await updateFraudCaseStatus({ orgId, userId: dbUser.id, dbUser }, id, body.status, body.resolutionSummary)
    return NextResponse.json(fraudCase)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Fraud case status update error:", error)
    return NextResponse.json({ error: "Failed to update fraud case" }, { status: 500 })
  }
}
