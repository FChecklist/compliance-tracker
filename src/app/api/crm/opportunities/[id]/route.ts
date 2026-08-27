import { NextRequest, NextResponse } from "next/server"
import { requireAuth, type UserRole } from "@/lib/supabase/auth-guard"
import { getOpportunity, updateOpportunity, deleteOpportunity, ServiceError } from "@/lib/services/crm-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const opportunity = await getOpportunity({ orgId }, id)
    if (!opportunity) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 })
    return NextResponse.json(opportunity)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunity get error:", error)
    return NextResponse.json({ error: "Failed to fetch opportunity" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    // actorRole feeds updateOpportunity()'s isValidStageTransition() check
    // (Sales Pipeline closure, 2026-08-07) -- without it, actorRank
    // defaults to 0 and no caller could ever reopen a closed deal, even a
    // manager/admin. See permission-service.ts's UserRole for the value set.
    // role feeds the separate own-record-or-manager RBAC gate (merged in
    // from main's own-record-or-manager closure landed the same window) --
    // both are independently optional on CrmContext, see crm-service.ts.
    const opportunity = await updateOpportunity({ orgId, userId: dbUser.id, actorRole: dbUser.role as UserRole, role: dbUser.role }, id, body)
    return NextResponse.json(opportunity)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunity update error:", error)
    return NextResponse.json({ error: "Failed to update opportunity" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await deleteOpportunity({ orgId, userId: dbUser.id, role: dbUser.role }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM opportunity delete error:", error)
    return NextResponse.json({ error: "Failed to delete opportunity" }, { status: 500 })
  }
}
