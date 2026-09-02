// Wave 119: /api/v1 is the stable external contract PROJEXA (and any other
// external client) targets instead of the internal /api/construction/*
// routes, which can change without notice. Same service calls either way.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBoqs, parseBoqInclude, createBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    // PROJEXA's Work Progress Report needs each line item's rate/amount to
    // compute the report's Amt/Percentage columns, so `lineItems` is always
    // included -- that contract is unchanged.
    //
    // R67 F-23 (R-239). It used to be satisfied with
    // `Promise.all(boqs.map(getBoq))`, and every getBoq() opens its OWN
    // withTenantContext transaction, so an N-revision project fanned out N
    // concurrent transactions on a five-connection pool. listBoqs() now does
    // the whole thing in ONE transaction (see its own header comment), and
    // `?include=variation` adds the per-revision variation figure PROJEXA's
    // /scope screen used to fetch with one /compare request PER ROW.
    const include = request.nextUrl.searchParams.get("include")
    const { variation } = parseBoqInclude(include)
    const boqs = await listBoqs({ orgId: ctx.orgId }, projectId, {
      include: variation ? "lineItems,variation" : "lineItems",
    })
    return NextResponse.json({ boqs })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ list error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQs" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    // External API-key callers have no real user id -- record the key's id
    // so createdById still shows who/what created this row, rather than
    // leaving it null or throwing.
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await createBoq({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ create error:", error)
    return NextResponse.json({ error: "Failed to create BOQ" }, { status: 500 })
  }
}
