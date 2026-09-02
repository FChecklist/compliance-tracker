// R67 lane D22 (item D-58, rec R-187): the org directory PROJEXA's people
// pickers had no source for. Read-only, so it is gated on authentication
// alone (requireAuthOrApiKey) like this surface's other reads -- the org
// scope comes from the caller's own API key / session, never from a query
// parameter, so one org can never enumerate another's staff.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { listOrgDirectory, resolveDirectoryLimit, ServiceError } from "@/lib/services/org-directory-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const q = request.nextUrl.searchParams.get("q") ?? undefined
    const limit = resolveDirectoryLimit(request.nextUrl.searchParams.get("limit"))
    const users = await listOrgDirectory({ orgId: ctx.orgId }, { q, limit })
    return NextResponse.json({ users })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa org-users list error:", error)
    return NextResponse.json({ error: "Failed to load the organisation directory" }, { status: 500 })
  }
}
