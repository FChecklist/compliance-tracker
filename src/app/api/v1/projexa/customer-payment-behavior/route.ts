// FI-AR-006 (Customer Payment Behavior / DSO): thin aliasing route over
// erp-invoicing-service.ts's customerPaymentBehaviorReport -- per-customer
// real average days-to-pay, aggregate DSO, and a payment-reliability
// classification. Mirrors ar-aging/route.ts and dunning-list/route.ts's
// shape exactly. Optional query params: periodDays (default 90),
// asOfDate (default today).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { customerPaymentBehaviorReport, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const periodDaysParam = request.nextUrl.searchParams.get("periodDays")
    const periodDays = periodDaysParam ? Number(periodDaysParam) : undefined
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await customerPaymentBehaviorReport({ orgId: ctx.orgId }, { periodDays, asOfDate })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa customer-payment-behavior error:", error)
    return NextResponse.json({ error: "Failed to generate customer payment behavior report" }, { status: 500 })
  }
}
