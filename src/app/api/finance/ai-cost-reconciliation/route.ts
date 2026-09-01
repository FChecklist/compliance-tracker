import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { recordReconciliation, listReconciliations, getReconciliationDriftSummary } from "@/lib/services/cost-reconciliation-service"

// Finance-facing manual monthly reconciliation (AI Cost Governance & FinOps
// gap-closure): real provider invoice totals vs. token_usage_ledger's
// token-count estimate, so "how accurate are our per-action cost figures"
// has an actual, standing answer instead of an unverified assumption.
// veridian_admin-gated, same posture as GET /api/ai/team/token-usage.
export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI cost reconciliation is veridian_admin-only" }, { status: 403 })
  }

  try {
    const [reconciliations, driftSummary] = await Promise.all([
      listReconciliations(),
      getReconciliationDriftSummary(),
    ])
    return NextResponse.json({ reconciliations, driftSummary })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load AI cost reconciliations"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI cost reconciliation is veridian_admin-only" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const periodMonth = typeof body?.periodMonth === "string" ? body.periodMonth : null
  const provider = typeof body?.provider === "string" ? body.provider.trim() : ""
  const actualInvoiceUsd = typeof body?.actualInvoiceUsd === "number" ? body.actualInvoiceUsd : NaN
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 1000) : null

  if (!periodMonth || !/^\d{4}-\d{2}-01$/.test(periodMonth)) {
    return NextResponse.json({ error: "periodMonth must be 'YYYY-MM-01'" }, { status: 400 })
  }
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 })
  }
  if (!Number.isFinite(actualInvoiceUsd) || actualInvoiceUsd < 0) {
    return NextResponse.json({ error: "actualInvoiceUsd must be a non-negative number" }, { status: 400 })
  }

  try {
    const reconciliation = await recordReconciliation({
      periodMonth,
      provider,
      actualInvoiceUsd,
      notes,
      recordedByUserId: dbUser.id,
    })
    return NextResponse.json({ reconciliation }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record AI cost reconciliation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
