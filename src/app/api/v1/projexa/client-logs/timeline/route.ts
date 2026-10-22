// PROJEXA automatic error and action log -- one project's record from start to end: every action and error in time
// order. Optional ?order=desc and ?after=<ISO time> (a cursor: later events when asc, earlier when desc) let a long
// project be read in pages. Breadcrumbs/stack are left out here (they are on the issue); owner/admin only.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { timelineWithDb } from "@/lib/services/client-log-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "admin", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const sp = request.nextUrl.searchParams
  const projectId = sp.get("projectId")?.trim()
  if (!projectId) return NextResponse.json({ error: "projectId is required", field: "projectId" }, { status: 400 })
  const after = sp.get("after")
  if (after && Number.isNaN(new Date(after).getTime())) return NextResponse.json({ error: "after must be a valid timestamp", field: "after" }, { status: 400 })
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "200", 10) || 200, 1), 1000)
  const order = sp.get("order") === "desc" ? "desc" : "asc"

  try {
    const events = await withTenantContext({ orgId: ctx.orgId }, (db) => timelineWithDb(db, ctx.orgId!, { projectId, limit, order, after }))
    return NextResponse.json({ projectId, events })
  } catch (error) {
    console.error("v1 projexa client-logs timeline error:", error)
    return NextResponse.json({ error: "Failed to read timeline" }, { status: 500 })
  }
}