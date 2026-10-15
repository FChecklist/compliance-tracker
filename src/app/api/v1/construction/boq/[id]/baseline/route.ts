// Sumeet R-100 ("Profit and loss analysis for the project") / R-99 (one combined analysis view). The P&L "answer" on Project 360 is computed from
// the FIRST confirmed baseline of the project's governing BOQ -- and confirmBaseline() (boq-baseline-service.ts) had NO caller anywhere in src/app:
// the service shipped, no route ever exposed it, so every project read "Not yet baselined" for ever and no profit could ever be shown (UAT 2026-10-12).
// This is the explicit, human-triggered call that service's header demands ("an explicit call a route makes off a real user action (a button), never a
// side effect"). It requires an evidence reference (D88: a PO, proforma, agreed proposal, email, ...) and answers with METADATA only: a baseline's
// line snapshot carries the project-side (cost) rate and quantity, which a customer-facing caller must not receive through this route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireActingPerson } from "@/lib/supabase/auth-guard"
import { confirmBaseline, listBaselineVersions, ServiceError, type BoqBaseline } from "@/lib/services/boq-baseline-service"

type RouteContext = { params: Promise<{ id: string }> }

function metadata(b: BoqBaseline) {
  return {
    id: b.id,
    boqId: b.boqId,
    version: b.version,
    confirmedById: b.confirmedById,
    confirmedAt: b.confirmedAt,
    evidenceArtefactRef: b.evidenceArtefactRef,
    lineCount: b.lineSnapshot.length,
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  try {
    const { id } = await params
    const versions = await listBaselineVersions({ orgId: ctx.orgId }, id)
    return NextResponse.json({ baselines: versions.map(metadata) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ baseline list error:", error)
    return NextResponse.json({ error: "Failed to list baselines" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { evidenceArtefactRef?: unknown }
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const baseline = await confirmBaseline({ orgId: ctx.orgId, userId: acting.person.id }, id, String(body.evidenceArtefactRef ?? ""))
    return NextResponse.json(metadata(baseline), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ baseline confirm error:", error)
    return NextResponse.json({ error: "Failed to confirm the baseline" }, { status: 500 })
  }
}
