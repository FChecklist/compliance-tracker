// FI-AR-004 (Dunning List): thin ALIASING route over erp-invoicing-
// service.ts's dunningList -- every overdue customer invoice grouped by
// aging bucket, with each row's real dunningLevel/lastDunningSentAt plus a
// suggestedDunningLevel. Mirrors ar-aging/route.ts's shape exactly.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { dunningList, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could read a real collections/
  // financial report: every overdue invoice's actual outstanding AR balance
  // (outstandingAmount), the org-wide totalOutstanding and per-bucket dollar
  // totals, plus the customer's name -- not pure reference/lookup data.
  // Matches the exact requireRoleOrScope(ctx, "member", "read") pattern
  // already used identically by 10+ sibling /api/v1/projexa/** and
  // /api/v1/brain/** GET routes, including dashboard/route.ts (org revenue/
  // expenses/budget) and vendors/route.ts (vendor credit limits/payment
  // terms) -- the two routes in this codebase closest in sensitivity to an
  // AR/collections report, both gated at "member", not a higher tier.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const asOfDate = request.nextUrl.searchParams.get("asOfDate") ?? undefined
    const report = await dunningList({ orgId: ctx.orgId }, asOfDate)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa dunning-list error:", error)
    return NextResponse.json({ error: "Failed to generate dunning list" }, { status: 500 })
  }
}
