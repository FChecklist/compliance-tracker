import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listNegotiationRounds, addNegotiationRound, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rounds: [] })

  try {
    const { id } = await params
    const rounds = await listNegotiationRounds({ orgId }, id)
    return NextResponse.json({ rounds })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Negotiation rounds list error:", error)
    return NextResponse.json({ error: "Failed to fetch negotiation rounds" }, { status: 500 })
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
    const round = await addNegotiationRound({ orgId, userId: dbUser.id }, id, { proposedRate: Number(body.proposedRate), notes: body.notes })
    return NextResponse.json(round, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Negotiation round create error:", error)
    return NextResponse.json({ error: "Failed to add negotiation round" }, { status: 500 })
  }
}
