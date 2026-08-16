import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { recordSanctionCheck, listSanctionChecks, ServiceError } from "@/lib/services/erp-vendor-master-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ sanctionChecks: [] })

  try {
    const { id } = await params
    const sanctionChecks = await listSanctionChecks({ orgId }, id)
    return NextResponse.json({ sanctionChecks })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier sanction checks list error:", error)
    return NextResponse.json({ error: "Failed to fetch sanction checks" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const check = await recordSanctionCheck({ orgId, userId: dbUser.id }, id, {
      listsChecked: Array.isArray(body.listsChecked) ? body.listsChecked : [],
      matchFound: !!body.matchFound, matchDetails: body.matchDetails, resultStatus: body.resultStatus,
    })
    return NextResponse.json(check, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier sanction check create error:", error)
    return NextResponse.json({ error: "Failed to record sanction check" }, { status: 500 })
  }
}
