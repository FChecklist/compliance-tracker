// Sumeet requirement #3 ("BILLING MILESTONES"). construction-billing-
// workflow-service.ts's progress-claim state machine (milestone_achieved ->
// drafted -> submitted -> client_approved -> invoiced, or rejected) has
// existed with zero PROJEXA-reachable WRITE route since it shipped -- GET
// here answered listBillingDueQueue() only (SD-002's "Ready to Bill"
// worklist, read-only). POST creates a new claim; the per-claim status
// transitions live in [id]/route.ts's PATCH.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listBillingDueQueue, listClaims, createProgressClaim, ServiceError } from "@/lib/services/construction-billing-workflow-service"
import { withRouteTiming } from "@/lib/route-timing"

export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined
  // "all=true": Sumeet requirement #3's own billing-milestones screen, which
  // needs the FULL history (invoiced included) -- see listClaims()'s own
  // header for why that must be a separate function from the due-queue.
  // Omitted/false: the original SD-002 "Ready to Bill" worklist, unchanged,
  // still what Project360Client.tsx's summary tile reads.
  const all = request.nextUrl.searchParams.get("all") === "true"

  try {
    const claims = all
      ? await listClaims({ orgId: ctx.orgId }, projectId ?? "")
      : await listBillingDueQueue({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ claims })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa billing-claims list error:", error)
    return NextResponse.json({ error: "Failed to fetch billing claims" }, { status: 500 })
  }
}

export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const body = await request.json()
    const claim = await createProgressClaim({ orgId: ctx.orgId, userId: acting.person.id }, {
      projectId: body.projectId, boqId: body.boqId, customerId: body.customerId,
      milestoneDescription: body.milestoneDescription, scheduledDate: body.scheduledDate,
      retentionPercent: body.retentionPercent === undefined ? undefined : Number(body.retentionPercent),
    })
    return NextResponse.json(claim, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa billing-claim create error:", error)
    return NextResponse.json({ error: "Failed to create billing milestone" }, { status: 500 })
  }
}
