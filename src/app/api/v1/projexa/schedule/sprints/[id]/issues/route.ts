// Priority 17 Wave 1: thin alias over pms-sprint-service.ts's
// listSprintIssues()/addIssueToSprint()/removeIssueFromSprint(). No
// requirePmsEnabled() gate -- see ../../route.ts header for the full
// reasoning.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSprintIssues, addIssueToSprint, removeIssueFromSprint, ServiceError } from "@/lib/services/pms-sprint-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(_request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ issues: [] })

  try {
    const { id } = await params
    const issues = await listSprintIssues({ orgId: ctx.orgId }, id)
    return NextResponse.json({ issues })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprint-issues list error:", error)
    return NextResponse.json({ error: "Failed to fetch sprint issues" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 })
    const result = await addIssueToSprint({ orgId: ctx.orgId }, id, body.issueId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprint-issue add error:", error)
    return NextResponse.json({ error: "Failed to add issue to sprint" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const issueId = request.nextUrl.searchParams.get("issueId")
  if (!issueId) return NextResponse.json({ error: "issueId query param is required" }, { status: 400 })

  try {
    const { id } = await params
    const result = await removeIssueFromSprint({ orgId: ctx.orgId }, id, issueId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa sprint-issue remove error:", error)
    return NextResponse.json({ error: "Failed to remove issue from sprint" }, { status: 500 })
  }
}
