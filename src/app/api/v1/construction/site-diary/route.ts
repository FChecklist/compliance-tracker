import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSiteDiaries, createSiteDiary, ServiceError } from "@/lib/services/construction-site-diary-service"

// A4S14_sitediary_01 (production incident): GET /api/v1/projexa/site-diary
// (this route's alias, see ../../projexa/site-diary/route.ts) produced
// "Vercel Runtime Timeout Error: Task timed out after 300 seconds" as
// recently as 2026-08-25T04:26:04Z (confirmed live via
// get_runtime_errors/get_runtime_logs) -- AFTER both the R46 DB-client-
// timeout fix (tenant-scoped.ts/db/index.ts: connect_timeout/idle_timeout/
// statement_timeout, live since 2026-08-25T03:40Z) and the R36/E-122
// requireAuth() fast-path fix (PR #1327, merged 2026-08-23) were already
// deployed. So this isn't explained by either of those: construction_site_
// diaries has 76 live rows and api_keys 24 (confirmed via Supabase
// pg_stat_user_tables), nowhere near large enough for any real query here
// to take more than milliseconds, and this is a GET with no body, so it's
// not exposed to the request.json()-read gap R43_MGR_02 found on sibling
// write routes either.
//
// What's still true regardless of exactly which internal step wedges (a
// stuck DB connection acquisition, a rare Supavisor-side hang, etc.):
// every timeout already in this chain (25s statement_timeout, 10s
// connect_timeout) only bounds an operation ONCE POSTGRES IS ACTUALLY
// EXECUTING IT -- nothing bounds the OUTER, whole-handler wall-clock time,
// so the one ceiling left is Vercel's own 300s function cap, ~15x longer
// than PROJEXA's own 20s fetch timeout (veridian-client.ts). That gap
// matters twice over: (1) the caller gives up and even retries once (R52)
// long before this function would ever answer, so the remaining 280+
// seconds are pure waste, and (2) this function goes on holding one of
// only 5 app_runtime pool connections (tenant-scoped.ts, `max: 5`) for
// that whole waste window, making the same wedge more likely to also catch
// the very retry the caller just sent.
//
// Fix: bound the whole handler (auth + query) to REQUEST_TIMEOUT_MS, safely
// under PROJEXA's 20s ceiling, using the same Promise.race pattern already
// established in this codebase for exactly this class of gap (see
// ../../projexa/timesheets/route.ts's readJsonBody). A hang now returns a
// real, honest 504 in ~15s -- fast enough that PROJEXA gets OUR structured
// error instead of its own generic AbortError (often skipping the 20s+20s
// client-side retry entirely), and short enough that this function stops
// holding its DB connection ~20x sooner than before.
const REQUEST_TIMEOUT_MS = 15_000

async function withRequestTimeout<T>(fn: () => Promise<T>): Promise<T> {
  const timedOut = Symbol("timed-out")
  let timer: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    fn(),
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), REQUEST_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer!)
  if (result === timedOut) throw new ServiceError("Site diary request did not respond in time", 504)
  return result as T
}

export async function GET(request: NextRequest) {
  try {
    return await withRequestTimeout(async () => {
      const ctx = await requireAuthOrApiKey(request)
      if (ctx.response) return ctx.response
      if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

      const projectId = request.nextUrl.searchParams.get("projectId")
      if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

      const diaries = await listSiteDiaries({ orgId: ctx.orgId }, projectId)
      return NextResponse.json({ diaries })
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site diary list error:", error)
    return NextResponse.json({ error: "Failed to fetch site diaries" }, { status: 500 })
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
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await createSiteDiary({ orgId: ctx.orgId, userId: actorId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction site diary create error:", error)
    return NextResponse.json({ error: "Failed to create site diary entry" }, { status: 500 })
  }
}
