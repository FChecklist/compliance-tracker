import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listScoringCriteria, addScoringCriterion, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ criteria: [] })

  try {
    const { id } = await params
    const criteria = await listScoringCriteria({ orgId }, id)
    return NextResponse.json({ criteria })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQ scoring criteria list error:", error)
    return NextResponse.json({ error: "Failed to fetch scoring criteria" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const criterion = await addScoringCriterion({ orgId, userId: dbUser.id }, id, { name: body.name, weight: Number(body.weight) || 1 })
    return NextResponse.json(criterion, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQ scoring criterion create error:", error)
    return NextResponse.json({ error: "Failed to add scoring criterion" }, { status: 500 })
  }
}
