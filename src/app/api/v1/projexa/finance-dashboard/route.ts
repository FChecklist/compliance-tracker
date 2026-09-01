// Priority 15 (PROJEXA Accounting module): thin ALIASING route over
// erp-invoicing-service.ts's getFinanceDashboard -- cash position, AR
// aging summary + top overdue invoices, this-month vs last-month revenue.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getFinanceDashboard, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, found via R43_EXEC_01-style
  // investigation, 2026-08-27): this read had no floor at all -- rank-1
  // roles (viewer/client_viewer/external_auditor/stage_0, see ROLE_RANK in
  // auth-guard.ts) could read the org's real cash position (aggregate
  // bank/cash GL balance), AR aging totals, named customers' top overdue
  // invoice amounts, and this-month/last-month revenue -- see
  // getFinanceDashboard() in erp-invoicing-service.ts for the exact
  // response shape. Matches the exact requireRoleOrScope(ctx, "member",
  // "read") pattern already used identically by 10+ sibling
  // /api/v1/projexa/** and /api/v1/brain/** GET routes (e.g. employees/,
  // vendors/, dashboard/route.ts) -- "member" is this codebase's
  // established floor for every gated GET read (no GET route anywhere in
  // this repo is gated above "member"; "manager"+ is reserved for writes),
  // and dashboard/route.ts already set the precedent for gating this same
  // class of money-revealing aggregate report at "member" rather than
  // inventing a new finance-only tier that doesn't exist in ROLE_RANK.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
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
