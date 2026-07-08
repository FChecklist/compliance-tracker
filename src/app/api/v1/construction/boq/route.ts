// Wave 119: /api/v1 is the stable external contract PROJEXA (and any other
// external client) targets instead of the internal /api/construction/*
// routes, which can change without notice. Same service calls either way.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listBoqs, createBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ boqs: [] })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
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
