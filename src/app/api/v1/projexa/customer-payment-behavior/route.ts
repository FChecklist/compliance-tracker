// FI-AR-006 (Customer Payment Behavior / DSO): thin aliasing route over
// erp-invoicing-service.ts's customerPaymentBehaviorReport -- per-customer
// real average days-to-pay, aggregate DSO, and a payment-reliability
// classification. Mirrors ar-aging/route.ts and dunning-list/route.ts's
// shape exactly. Optional query params: periodDays (default 90),
// asOfDate (default today).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { customerPaymentBehaviorReport, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could read every named
  // customer's real financial figures (outstandingAR, creditSalesInPeriod,
  // DSO, avgDaysToPay, payment-reliability classification), the same class
  // of financial/commercial-terms data ar-aging.ts's dashboard and
  // vendors/route.ts flag in their own identical fixes. Matches the exact
  // requireRoleOrScope(ctx, "member", "read") pattern already used
  // identically by 10+ sibling /api/v1/projexa/** and /api/v1/brain/** GET
  // routes -- this codebase has no established higher read floor anywhere
  // (even dashboard's revenue/expenses/budget and vendors' commercial terms
  // are gated at "member"), so "member" is the consistent choice here too.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
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
