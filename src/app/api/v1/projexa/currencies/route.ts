// Priority 17 Wave 1 (multi-currency Selling & Buying): thin alias over
// erp-accounting-service.ts's listCurrencies -- did not exist before this
// wave anywhere under /api/v1/projexa/*, so PROJEXA had no way to populate
// a currency dropdown at all (the native /api/erp/currencies route exists
// but is session-cookie-only, unreachable from PROJEXA's Bearer-key
// callVeridian()). GET only -- creating a new org currency is an org-setup
// action, not something a quotation/sales-order/purchase-order creation
// form needs to do inline.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listCurrencies, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // API_READ_WITHOUT_ROLE_CHECK (R58 Lane 2, 2026-08-27): this read had no
  // floor at all -- rank-1 roles (viewer/client_viewer/external_auditor/
  // stage_0, see ROLE_RANK in auth-guard.ts) could call it despite being the
  // codebase's most-restricted tier. "member" (not higher) because the
  // response is pure reference/lookup data -- id/code/name/symbol/
  // isBaseCurrency, mapped explicitly below, nothing else off the row --
  // same sensitivity tier as cost-centers/fiscal-years and matching the
  // sibling ./base route's own GET, which already gates at "member".
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const currencies = await listCurrencies({ orgId: ctx.orgId })
    return NextResponse.json({ currencies: currencies.map((c) => ({ id: c.id, code: c.code, name: c.name, symbol: c.symbol, isBaseCurrency: c.isBaseCurrency })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa currencies list error:", error)
    return NextResponse.json({ error: "Failed to fetch currencies" }, { status: 500 })
  }
}
