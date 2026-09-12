// R85 Addendum 3 v4, Phase 10 -- gate 10-07. "Compare side by side, one
// column each." Read-only. `?ids=` is a comma-separated list of scenario
// ids (all must belong to the calling org -- compareScenarios/getScenario
// enforce that per-id, the same way every other read in this file does).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { compareScenarios, ServiceError } from "@/lib/services/boq-scenario-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr

  const idsRaw = request.nextUrl.searchParams.get("ids")
  if (!idsRaw) return NextResponse.json({ error: "ids is required (comma-separated scenario ids)" }, { status: 400 })
  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean)

  try {
    const result = await compareScenarios({ orgId: ctx.orgId }, ids)
    return NextResponse.json({ scenarios: result })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios compare error:", error)
    return NextResponse.json({ error: "Failed to compare scenarios" }, { status: 500 })
  }
}
