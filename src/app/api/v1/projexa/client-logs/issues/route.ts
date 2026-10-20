// PROJEXA automatic error and action log -- the owner's list of grouped issues, each with its full sample report.
// Owner/admin only (an API key needs read scope; PROJEXA's own proxy applies the owner check for its users).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { ISSUE_STATUSES, listIssuesWithDb } from "@/lib/services/client-log-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "admin", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const sp = request.nextUrl.searchParams
  const status = sp.get("status") ?? "open"
  if (status !== "all" && !(ISSUE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `status must be one of ${ISSUE_STATUSES.join(", ")}, all` }, { status: 400 })
  }
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 200)
  const projectId = sp.get("projectId")?.trim() || null

  try {
    const issues = await withTenantContext({ orgId: ctx.orgId }, (db) => listIssuesWithDb(db, ctx.orgId!, { status, projectId, limit }))
    return NextResponse.json({ issues })
  } catch (error) {
    console.error("v1 projexa client-logs issues list error:", error)
    return NextResponse.json({ error: "Failed to list issues" }, { status: 500 })
  }
}