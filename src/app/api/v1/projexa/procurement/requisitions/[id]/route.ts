// Priority 17 Wave 1 (PROJEXA Procurement workflow depth): single-
// requisition read, thin alias over getPurchaseRequisition.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getPurchaseRequisition, ServiceError } from "@/lib/services/erp-procurement-workflow-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const requisition = await getPurchaseRequisition({ orgId: ctx.orgId }, id)
    return NextResponse.json(requisition)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa procurement requisition get error:", error)
    return NextResponse.json({ error: "Failed to fetch purchase requisition" }, { status: 500 })
  }
}
