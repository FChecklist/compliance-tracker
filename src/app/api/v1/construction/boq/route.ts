// Wave 119: /api/v1 is the stable external contract PROJEXA (and any other
// external client) targets instead of the internal /api/construction/*
// routes, which can change without notice. Same service calls either way.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBoqs, createBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    // PROJEXA's Work Progress Report needs each line item's rate/amount to
    // compute the report's Amt/Percentage columns, and this is the only
    // external-facing BOQ endpoint, so the rows carry `lineItems`.
    //
    // R67 F-04: this used to be `Promise.all(boqs.map(getBoq))` -- and each
    // getBoq() opens its OWN withTenantContext transaction, so a project with
    // eight revisions asked tenant-scoped.ts's five-connection app_runtime
    // pool for eight simultaneous connections. listBoqs() now returns the line
    // items itself, from one transaction and one grouped query, along with
    // totalVariation / totalVariationVsOriginal per revision so the list
    // screen no longer fires a /compare call per row either.
    const boqs = await listBoqs({ orgId: ctx.orgId }, projectId)
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
