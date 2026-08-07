import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import {
  listReconciliations,
  recordActualInvoice,
  CostReconciliationError,
} from "@/lib/services/cost-reconciliation-service"

// Finance-facing: manual monthly reconciliation of estimated AI spend
// (token_usage_ledger) against the real provider invoice, per the AI Cost
// Governance & FinOps gap-closure. Same veridian_admin gate as the report
// this pairs with, /api/ai/team/token-usage.
async function requireVeridianAdmin() {
  const { user, dbUser, response } = await requireAuth()
  if (!user) return { error: response! }
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return { error: NextResponse.json({ error: "Cost reconciliation is veridian_admin-only" }, { status: 403 }) }
  }
  return { dbUser }
}

export async function GET() {
  const auth = await requireVeridianAdmin()
  if (auth.error) return auth.error

  try {
    const reconciliations = await listReconciliations()
    return NextResponse.json({ reconciliations })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cost reconciliations"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireVeridianAdmin()
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  if (!body || typeof body.periodMonth !== "string" || typeof body.provider !== "string" || typeof body.actualInvoiceUsd !== "number") {
    return NextResponse.json(
      { error: "periodMonth ('YYYY-MM'), provider, and actualInvoiceUsd (number) are required" },
      { status: 400 }
    )
  }

  try {
    const row = await recordActualInvoice({
      periodMonth: body.periodMonth,
      provider: body.provider,
      actualInvoiceUsd: body.actualInvoiceUsd,
      notes: typeof body.notes === "string" ? body.notes : null,
      recordedByUserId: auth.dbUser!.id,
    })
    return NextResponse.json({ reconciliation: row }, { status: 201 })
  } catch (error) {
    if (error instanceof CostReconciliationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : "Failed to record invoice"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
