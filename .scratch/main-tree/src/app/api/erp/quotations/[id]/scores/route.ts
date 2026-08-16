import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listQuotationScores, scoreQuotation, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ scores: [] })

  try {
    const { id } = await params
    const scores = await listQuotationScores({ orgId }, id)
    return NextResponse.json({ scores })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Quotation scores list error:", error)
    return NextResponse.json({ error: "Failed to fetch scores" }, { status: 500 })
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
    const entry = await scoreQuotation({ orgId, userId: dbUser.id }, id, body.criterionId, Number(body.score), body.notes)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Quotation score create error:", error)
    return NextResponse.json({ error: "Failed to score quotation" }, { status: 500 })
  }
}
