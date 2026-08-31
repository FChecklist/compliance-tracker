// Priority 15 (PROJEXA Invoicing module): thin ALIASING route over
// erp-invoicing-service.ts's arAgingReport -- standard 0-30/31-60/61-90/90+
// day AR aging buckets over every non-fully-paid sales invoice.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { arAgingReport, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, found 2026-08-27): this read had
  // no floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could read every customer's real
  // AR balance (per-invoice outstandingAmount, customerName, days overdue --
  // see arAgingReport in erp-invoicing-service.ts). That is a financial
  // figure, the same commercial-terms sensitivity class already gated at
  // "member" for vendors/route.ts (payment terms, credit limit) and
  // dashboard/route.ts (revenue/expenses/budget) in the identical
  // R43_EXEC_01 investigation -- this route uses the exact
  // requireRoleOrScope(ctx, "member", "read") pattern those routes (and 10+
  // other sibling /api/v1/projexa/** and /api/v1/brain/** GET routes) already
  // use, so the codebase-wide read floor stays consistent rather than
  // inventing a one-off higher tier (no dedicated finance/accounting role
  // exists in ROLE_RANK).
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await arAgingReport({ orgId: ctx.orgId }, asOfDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa ar-aging error:", error)
    return NextResponse.json({ error: "Failed to generate AR aging report" }, { status: 500 })
  }
}
