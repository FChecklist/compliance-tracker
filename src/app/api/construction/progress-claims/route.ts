import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { createProgressClaim, listBillingDueQueue, ServiceError } from "@/lib/services/construction-billing-workflow-service"

// SD-002 "Billing Due List" -> the "Ready to Bill" worklist.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ claims: [] })

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined

  try {
    const claims = await listBillingDueQueue({ orgId }, projectId)
    return NextResponse.json({ claims })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim billing-due queue error:", error)
    return NextResponse.json({ error: "Failed to fetch billing-due queue" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const claim = await createProgressClaim({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(claim, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Progress claim create error:", error)
    return NextResponse.json({ error: "Failed to create progress claim" }, { status: 500 })
  }
}
