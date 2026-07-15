// Priority 15 (Sales & CRM depth wave): "Customer 360" -- thin alias over
// erp-selling-service.ts's getCustomerOverview. Backs a customer detail
// page showing opportunities/quotations/sales orders/sales invoices/linked
// projects for one customer in a single fetch.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getCustomerOverview, ServiceError } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const overview = await getCustomerOverview({ orgId: ctx.orgId }, id)
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customer overview error:", error)
    return NextResponse.json({ error: "Failed to fetch customer overview" }, { status: 500 })
  }
}
