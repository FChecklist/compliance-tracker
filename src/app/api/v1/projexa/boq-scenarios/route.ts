// R85 Addendum 3 v4, Phase 10 -- THE WHAT-IF / SCENARIO ENGINE (spec Part F,
// gates 10-01/10-03/10-07/10-13). GET lists every scenario held against one
// BOQ (10-07 "save, name and hold several"); POST creates a new one (10-01).
//
// 10-13 "Scenario routes REFUSE a client role" -- gated at "manager"
// (rank 3), the SAME minimum role construction-boq-service.ts's own
// /approve route already uses for a comparably sensitive BOQ action -- well
// above viewer/client_viewer/external_auditor/stage_0 (rank 1, role-rank.ts).
// This whole surface reads/writes rate_project (D91 B1: "the most sensitive
// field in the product"), so every route in this directory uses the same
// floor, not just the commit path.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { createScenario, listScenarios, ServiceError } from "@/lib/services/boq-scenario-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "read")
  if (roleErr) return roleErr

  const boqId = request.nextUrl.searchParams.get("boqId")
  if (!boqId) return NextResponse.json({ error: "boqId is required" }, { status: 400 })

  try {
    const scenarios = await listScenarios({ orgId: ctx.orgId }, boqId)
    return NextResponse.json({ scenarios })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios list error:", error)
    return NextResponse.json({ error: "Failed to list scenarios" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr

  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!actorId) return NextResponse.json({ error: "No actor identity on this request" }, { status: 400 })

  try {
    const body = (await request.json()) as { boqId?: string; name?: string; baseBaselineVersion?: number | null }
    if (!body.boqId) return NextResponse.json({ error: "boqId is required" }, { status: 400 })
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const scenario = await createScenario(
      { orgId: ctx.orgId, userId: actorId },
      { boqId: body.boqId, name: body.name, baseBaselineVersion: body.baseBaselineVersion ?? null }
    )
    return NextResponse.json(scenario, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa boq-scenarios create error:", error)
    return NextResponse.json({ error: "Failed to create scenario" }, { status: 500 })
  }
}
