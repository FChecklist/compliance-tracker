import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addContractNegotiationRound, listContractNegotiationRounds, ServiceError } from "@/lib/services/erp-contract-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { id } = await params
  const rounds = await listContractNegotiationRounds({ orgId }, id)
  return NextResponse.json(rounds)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const round = await addContractNegotiationRound({ orgId, userId: dbUser.id }, id, body)
    return NextResponse.json(round, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contract negotiation round create error:", error)
    return NextResponse.json({ error: "Failed to add negotiation round" }, { status: 500 })
  }
}
