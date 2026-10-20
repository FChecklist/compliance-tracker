// PROJEXA automatic error and action log -- one issue with its latest 20 reports (breadcrumbs included), and the
// write-back of a fix (summary, files changed, commit) by the owner or the owner's Claude Code session.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { ServiceError, getIssueWithDb, patchIssueWithDb, validatePatch } from "@/lib/services/client-log-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "admin", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const found = await withTenantContext({ orgId: ctx.orgId }, (db) => getIssueWithDb(db, ctx.orgId!, id))
    if (!found) return NextResponse.json({ error: "Issue not found" }, { status: 404 })
    return NextResponse.json({ issue: found.issue, events: found.events })
  } catch (error) {
    console.error("v1 projexa client-logs issue read error:", error)
    return NextResponse.json({ error: "Failed to read issue" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "admin", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 })
  }
  const parsed = validatePatch(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 })

  try {
    const { id } = await params
    const defaultFixedBy = ctx.dbUser?.email ?? ctx.apiKey?.name ?? null
    const issue = await withTenantContext({ orgId: ctx.orgId }, (db) => patchIssueWithDb(db, ctx.orgId!, id, parsed.patch, defaultFixedBy))
    return NextResponse.json({ issue })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa client-logs issue update error:", error)
    return NextResponse.json({ error: "Failed to update issue" }, { status: 500 })
  }
}