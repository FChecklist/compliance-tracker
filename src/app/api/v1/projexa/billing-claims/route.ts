// Sumeet requirement #7 ("for a project: analysis combining change of BOQ,
// change of scope, billing, milestones, timelines"). construction-billing-
// workflow-service.ts's listBillingDueQueue() (billing milestones -- item
// #3, already built: constructionProgressClaims's real state machine) has
// existed with zero PROJEXA-reachable route since it shipped -- this is the
// read-only surface for it, GET-only by design, matching
// v1/projexa/reports/boq-analysis/route.ts's own precedent (analysis/status
// screens are read-only; the write actions -- draft/submit/approve/reject/
// invoice -- are a separate, larger, not-yet-scoped UI decision, not
// something to bolt onto a summary route).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { listBillingDueQueue } from "@/lib/services/construction-billing-workflow-service"
import { ServiceError } from "@/lib/services/compliance-service"
import { withRouteTiming } from "@/lib/route-timing"

export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined

  try {
    const claims = await listBillingDueQueue({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ claims })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa billing-claims list error:", error)
    return NextResponse.json({ error: "Failed to fetch billing claims" }, { status: 500 })
  }
}
