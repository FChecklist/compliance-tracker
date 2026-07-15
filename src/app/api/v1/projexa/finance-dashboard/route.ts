// Priority 15 (PROJEXA Accounting module): thin ALIASING route over
// erp-invoicing-service.ts's getFinanceDashboard -- cash position, AR
// aging summary + top overdue invoices, this-month vs last-month revenue.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getFinanceDashboard, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const dashboard = await getFinanceDashboard({ orgId: ctx.orgId })
    return NextResponse.json(dashboard)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa finance-dashboard error:", error)
    return NextResponse.json({ error: "Failed to generate finance dashboard" }, { status: 500 })
  }
}
