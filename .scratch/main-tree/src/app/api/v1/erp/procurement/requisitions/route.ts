import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listPurchaseRequisitions, createPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ requisitions: [] })

  try {
    const requisitions = await listPurchaseRequisitions({ orgId: ctx.orgId })
    return NextResponse.json({ requisitions })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp purchase requisitions list error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase requisitions" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not an API key" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createPurchaseRequisition({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 erp purchase requisition create error:", error)
    return NextResponse.json({ error: "Failed to create purchase requisition" }, { status: 500 })
  }
}
