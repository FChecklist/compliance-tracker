// R85 Addendum 3 v4, Phase 10 -- gates 10-05/10-06/10-13. GET returns the
// scenario record plus the full BASE | SCENARIO | DELTA view (per line and
// in total) and the set of lines flagged negative (10-06). Read-only --
// never touches the live BOQ (10-08).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { getScenario, computeScenarioView, ServiceError } from "@/lib/services/boq-scenario-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const [scenario, view] = [await getScenario({ orgId: ctx.orgId }, id), await computeScenarioView({ orgId: ctx.orgId }, id)]
    return NextResponse.json({ scenario, view })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios get error:", error)
    return NextResponse.json({ error: "Failed to fetch scenario" }, { status: 500 })
  }
}
