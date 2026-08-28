// Priority 15 (PROJEXA Accounting module, Wave 1): thin ALIASING route over
// erp-bank-reconciliation-service.ts -- read-only for this wave: lists bank
// statement imports and, given ?importId=, that import's own lines (with
// matched/unmatched/ignored status). Importing a new statement (file
// upload) and matching/ignoring a line are real write actions in the
// underlying service (importBankStatement/matchLine/ignoreLine) but need a
// file-upload UI PROJEXA doesn't have yet -- deliberately left for a
// follow-up rather than a half-working upload form.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listImports, listLines, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could read another org's real
  // bank-statement-line amounts (debitAmount/creditAmount per transaction,
  // via ?importId=) and import metadata, despite being explicitly the
  // codebase's most-restricted tier. Matches the exact
  // requireRoleOrScope(ctx, "member", "read") pattern already used for
  // every other GET read in this codebase that exposes real financial
  // figures -- including getOrgDashboard's revenue/expenses/budget
  // (dashboard/route.ts, fixed identically in #1399) -- so this stays
  // consistent with the established floor rather than inventing a new,
  // higher one with no precedent anywhere else in /api/v1/projexa/**.
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const importId = request.nextUrl.searchParams.get("importId")
    if (importId) {
      const lines = await listLines({ orgId: ctx.orgId }, importId)
      return NextResponse.json({ lines })
    }
    const imports = await listImports({ orgId: ctx.orgId })
    return NextResponse.json({ imports })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa bank-reconciliation error:", error)
    return NextResponse.json({ error: "Failed to fetch bank reconciliation data" }, { status: 500 })
  }
}
