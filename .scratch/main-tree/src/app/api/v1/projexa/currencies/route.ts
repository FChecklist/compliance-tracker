// Priority 17 Wave 1 (multi-currency Selling & Buying): thin alias over
// erp-accounting-service.ts's listCurrencies -- did not exist before this
// wave anywhere under /api/v1/projexa/*, so PROJEXA had no way to populate
// a currency dropdown at all (the native /api/erp/currencies route exists
// but is session-cookie-only, unreachable from PROJEXA's Bearer-key
// callVeridian()). GET only -- creating a new org currency is an org-setup
// action, not something a quotation/sales-order/purchase-order creation
// form needs to do inline.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listCurrencies, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ currencies: [] })

  try {
    const currencies = await listCurrencies({ orgId: ctx.orgId })
    return NextResponse.json({ currencies: currencies.map((c) => ({ id: c.id, code: c.code, name: c.name, symbol: c.symbol, isBaseCurrency: c.isBaseCurrency })) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa currencies list error:", error)
    return NextResponse.json({ error: "Failed to fetch currencies" }, { status: 500 })
  }
}
