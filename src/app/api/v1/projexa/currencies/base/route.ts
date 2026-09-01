// R53 / R48_NO_CURRENCY_UI_01 -- the organisation's BASE CURRENCY, readable
// and settable in one place.
//
// THE FAULT ROW'S PREMISE IS HALF RIGHT AND THE HALF THAT IS WRONG MATTERS.
// It says "compliance.organisations has no currency column at all". True --
// and not the gap. compliance.erp_currencies already holds the org's
// currency with an is_base_currency flag, and provisioning already writes it
// (PR #1382). Adding organisations.currency would create a SECOND source of
// truth for the same fact, and the two would drift the first time anyone
// wrote only one of them -- which is precisely the R-62/R-63 failure being
// fixed. So this exposes what already exists rather than duplicating it.
//
// WHY A DEDICATED ROUTE RATHER THAN PUT ON /currencies: that endpoint lists
// every currency an org can transact in. This is a single org SETTING with
// exactly one value. Overloading PUT on a collection to mean "promote one
// member of it" reads as an edit to the list, which is not what it does.
//
// *** NOT GATED ON requireErpEnabled. *** listCurrencies() is, deliberately,
// because reading a transactional currency list is an ERP concern. A brand
// new org needs a currency BEFORE ERP is enabled -- gating this the same way
// would make the setting unreachable for exactly the tenants that most need
// it (a fresh UAE org with no base row, which is the R-63 condition).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getBaseCurrency, setBaseCurrency, ServiceError } from "@/lib/services/erp-accounting-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr

  try {
    const result = await getBaseCurrency({ orgId: ctx.orgId })
    // baseCurrency is null when the org genuinely has none. That is REPORTED,
    // never defaulted to a guess -- R-62/R-63's whole point is that a
    // currency must be an explicit setting or a visible config error, and a
    // silent fallback to INR is the defect, not the fix.
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa base currency read error:", error)
    return NextResponse.json({ error: "Failed to read the organisation currency" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  // ADMIN, not member. Changing the base currency re-denominates every figure
  // in the product; it is not a preference.
  const roleErr = requireRoleOrScope(ctx, "admin", "write")
  if (roleErr) return roleErr

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : ""
  if (!code) return NextResponse.json({ error: "code is required, e.g. \"AED\"" }, { status: 400 })

  try {
    const result = await setBaseCurrency(
      { orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id },
      code,
      typeof body.name === "string" ? body.name : undefined,
      typeof body.symbol === "string" ? body.symbol : undefined
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa base currency write error:", error)
    return NextResponse.json({ error: "Failed to set the organisation currency" }, { status: 500 })
  }
}
