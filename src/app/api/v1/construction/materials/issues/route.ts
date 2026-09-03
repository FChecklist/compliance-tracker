// R67 D-40: material ISSUES -- what left the store, the half of Sumeet's
// "material database. material inbound, spec, cost, qty" that had no ledger.
// GET+POST, the same requireAuthOrApiKey shape as the sibling receipts route
// (PROJEXA calls this with a Bearer API key).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg } from "@/lib/supabase/auth-guard"
import { listMaterialIssues, createMaterialIssue, ServiceError } from "@/lib/services/construction-materials-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const issues = await listMaterialIssues({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ issues })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material issues list error:", error)
    return NextResponse.json({ error: "Failed to fetch material issues" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id
  if (!ctx.orgId || !actorId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const issue = await createMaterialIssue({ orgId: ctx.orgId }, { ...body, createdById: actorId })
    return NextResponse.json(issue, { status: 201 })
  } catch (error) {
    // The on-hand refusal is a ServiceError(400) carrying the real figure and
    // the real unit ("Only 120 bag on hand") -- it reaches the form verbatim.
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction material issues create error:", error)
    return NextResponse.json({ error: "Failed to record material issue" }, { status: 500 })
  }
}
