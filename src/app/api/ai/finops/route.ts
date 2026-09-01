import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getFinOpsDashboard, getForecastForOrg } from "@/lib/services/ai-cost-finops-service"

// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps):
// the Finance / FinOps dashboard surface. Surfaces anomaly detection,
// forecast-vs-actual, FinOps reconciliation, and unused/idle AI capacity in
// one call -- the four findings this gap-closure closes, gathered for a
// veridian_admin (Finance) reviewer.
//
// Mirrors /api/ai/team/token-usage's gate (veridian_admin-only -- this is a
// platform-wide Finance view across every tenant's spend, not a single org's
// own cost-guard.ts status, which /api/settings/org-limits already serves).
// Uses the raw `db` client inside the service for the same reason
// token-usage-service.ts does: the ledger spans platform-internal + per-org
// rows and this view reconciles across every org, so withTenantContext's
// single-org model was never a fit.
//
// The Finance ledger figure (financeLedgerUsd) is an independent INPUT, not
// something the platform persists: no external Finance-system integration
// exists, and the finding's own recommendation is to defer building a second
// independent estimate unless spend scale or an audit requirement justifies
// it. A Finance admin enters the month's invoice total to see the
// reconciliation against the platform's engineering claim; leaving it unset
// returns a no_finance_figure verdict honestly rather than inventing a number.
export async function GET(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "FinOps dashboard is veridian_admin-only" }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  // Billing month defaults to the current month. Accepts YYYY-MM or a full
  // ISO date; normalized to the first moment of that month UTC.
  const monthParam = sp.get("month")
  const monthStartIso = normalizeMonthStart(monthParam)
  if (!monthStartIso) {
    return NextResponse.json({ error: "month must be YYYY-MM or an ISO date" }, { status: 400 })
  }

  const financeLedgerParam = sp.get("financeLedgerUsd")
  let financeLedgerUsd: number | null = null
  if (financeLedgerParam !== null) {
    const parsed = Number(financeLedgerParam)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json({ error: "financeLedgerUsd must be a non-negative number" }, { status: 400 })
    }
    financeLedgerUsd = parsed
  }

  try {
    const dashboard = await getFinOpsDashboard(monthStartIso, financeLedgerUsd)
    // The dashboard's forecast is platform-wide month spend; also surface
    // the current (Finance admin's own) org's run-rate forecast alongside,
    // since that's the per-org view a Finance admin watching their own org
    // most wants -- both, no second round-trip.
    const orgForecast = orgId ? await getForecastForOrg(orgId) : null
    return NextResponse.json({ dashboard, orgForecast })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load FinOps dashboard"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function normalizeMonthStart(input: string | null): string | null {
  if (!input) return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  // YYYY-MM
  const ym = /^(\d{4})-(\d{2})$/.exec(input)
  if (ym) {
    const y = Number(ym[1])
    const m = Number(ym[2])
    if (m < 1 || m > 12) return null
    return new Date(Date.UTC(y, m - 1, 1)).toISOString()
  }
  // Full ISO date -- pin to first of that month.
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}
