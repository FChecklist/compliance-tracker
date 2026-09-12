// R85 Addendum 3 v4, Phase 10 -- gate 10-04. TARGET-SEEK: SOLVE AND SHOW,
// NEVER APPLY. This route (and both functions it calls) never writes
// anything -- no scenario, no BOQ. `mode` selects which of the two solvers
// runs; `boqId` + the target figure are the only other inputs.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { previewTargetSeekRateForProfit, previewTargetSeekQtyForContractValue, ServiceError } from "@/lib/services/boq-scenario-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr

  try {
    const body = (await request.json()) as { mode?: "rate_for_profit" | "qty_for_contract_value"; boqId?: string; targetProfitPercent?: number; targetContractValue?: number }
    if (!body.boqId) return NextResponse.json({ error: "boqId is required" }, { status: 400 })

    if (body.mode === "qty_for_contract_value") {
      if (typeof body.targetContractValue !== "number") return NextResponse.json({ error: "targetContractValue is required for mode qty_for_contract_value" }, { status: 400 })
      const result = await previewTargetSeekQtyForContractValue({ orgId: ctx.orgId }, body.boqId, body.targetContractValue)
      return NextResponse.json(result)
    }

    if (typeof body.targetProfitPercent !== "number") return NextResponse.json({ error: "targetProfitPercent is required for mode rate_for_profit" }, { status: 400 })
    const result = await previewTargetSeekRateForProfit({ orgId: ctx.orgId }, body.boqId, body.targetProfitPercent)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios target-seek error:", error)
    return NextResponse.json({ error: "Failed to solve target-seek" }, { status: 500 })
  }
}
