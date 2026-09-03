// Priority 17 Wave 1: thin alias over pms-time-service.ts's
// listTimeEntriesForProject()/listTimeEntriesForIssue()/logTime(). No
// requirePmsEnabled() gate here -- see
// ../schedule/sprints/route.ts / ../meetings/route.ts for the same
// reasoning already established for pms_* substrate tables reached
// through /v1/projexa/*.
//
// `mine=true` is a route-level filter only (no new service function --
// pms-time-service.ts has no listTimeEntriesForUser()), so PROJEXA's own
// "My Timesheet" view can reuse the existing per-project listing without
// adding business logic here beyond a plain array filter.
//
// R67 WS-H (D-05 identity bridge). Both handlers now read the acting user id
// PROJEXA sends as the X-Acting-User header and hand it to resolveActingUser
// alongside the existing body/query actorEmail -- see that function's own
// comment for the precedence and why the email fallback is kept.
//
// GET changed in one user-visible way, deliberately: `mine=true` from an
// API-key caller used to answer with an EMPTY LIST (ctx.dbUser is always
// null for a key, so `entries.filter` had nothing to match), which is the
// silent-empty-200 fault this repo has an org-guard sweep test for. It now
// resolves the real acting user and surfaces the real reason when it can't.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, requireOrg, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import { listTimeEntriesForProject, listTimeEntriesForIssue, logTime, ServiceError } from "@/lib/services/pms-time-service"
import { withRouteTiming } from "@/lib/route-timing"

// R43_MGR_02 (production incident, live Vercel runtime telemetry): this
// route still produced "Vercel Runtime Timeout Error: Task timed out after
// 300 seconds" with ZERO HTTP response, as recently as 2026-08-25T04:12Z --
// about 33 minutes AFTER the R46 DB-client-timeout fix (tenant-scoped.ts /
// db/index.ts, connect_timeout/idle_timeout/statement_timeout) was already
// live in production (deployment dpl_D88atpNz66DxuhRCtRPFBPLzseB2, created
// 2026-08-25T03:40Z). So the hang is not in the DB layer any more -- every
// real query on this route now runs through a client bounded to ~25-35s.
// `request.json()` is the one remaining unbounded await in this handler
// (GET has no body to read at all, which is exactly why only this
// write path was still exposed) -- Next.js/Vercel impose no timeout of
// their own on reading/parsing the request body, so a stalled or
// incomplete body can ride all the way to Vercel's 300s hard function cap
// with nothing ever sent back, unlike a DB-side failure which now fails
// fast with a real JSON error. This bounds the body read to the same
// ~25s ceiling the rest of the write path already targets, so a stalled
// body fails fast and honestly instead of hanging silently for 300s.
const REQUEST_BODY_READ_TIMEOUT_MS = 25_000

async function readJsonBody(request: NextRequest): Promise<any> {
  const timedOut = Symbol("timed-out")
  let timer: ReturnType<typeof setTimeout>
  const result = await Promise.race([
    request.json().catch(() => ({})),
    new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), REQUEST_BODY_READ_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer!)
  if (result === timedOut) throw new ServiceError("Timed out waiting for the request body", 408)
  return result
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function GET(...args: Parameters<typeof GET_impl>) {
  return withRouteTiming("GET", () => GET_impl(...args))
}

async function GET_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  const projectId = request.nextUrl.searchParams.get("projectId")
  const issueId = request.nextUrl.searchParams.get("issueId")
  const spentOn = request.nextUrl.searchParams.get("spentOn") ?? undefined
  const mine = request.nextUrl.searchParams.get("mine") === "true"
  if (!projectId && !issueId) return NextResponse.json({ error: "projectId or issueId query param is required" }, { status: 400 })

  try {
    let selfId: string | undefined
    if (mine) {
      // Both halves of the acting user's identity arrive as HEADERS, never as
      // query parameters: an email in a query string is written to access logs
      // and rides the Referer header off-site, which is the exact reason the
      // id is a header too. See ACTING_USER_EMAIL_HEADER in auth-guard.ts.
      const { user: actingUser, error: actingUserErr } = await resolveActingUser(
        ctx,
        readActingUserEmail(request),
        readActingUserId(request)
      )
      if (actingUserErr) return actingUserErr
      selfId = actingUser!.id
    }

    let entries = issueId
      ? await listTimeEntriesForIssue({ orgId: ctx.orgId }, issueId)
      : await listTimeEntriesForProject({ orgId: ctx.orgId }, projectId!, { spentOn, userId: selfId })
    // The project path filters in SQL; the issue path is a plain array filter
    // because listTimeEntriesForIssue takes no filters and one issue's
    // entries is a small, bounded set.
    if (issueId) {
      if (selfId) entries = entries.filter((e) => e.userId === selfId)
      if (spentOn) entries = entries.filter((e) => e.spentOn === spentOn)
    }
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheets list error:", error)
    return NextResponse.json({ error: "Failed to fetch time entries" }, { status: 500 })
  }
}

// R67 F-28 (R-249): the exported handler is unchanged in shape -- both CI
// route guards read it with a regex -- and delegates to its original body so
// the response carries Server-Timing: app;dur=<ms> measured HERE. See
// src/lib/route-timing.ts for why the export is not rewritten instead.
export async function POST(...args: Parameters<typeof POST_impl>) {
  return withRouteTiming("POST", () => POST_impl(...args))
}

async function POST_impl(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  // logTime() attributes the entry to ctx.userId (the logging user) --
  // matches the identical requirement already on /v1/pms/time-entries'
  // own POST (a real user, not a shared API key, must own a timesheet
  // entry).
  //
  // R39/R-C12 fix-2 (live-oracle finding): the same `!ctx.dbUser` 400
  // fixed on submit/approve/reject applies here too, and predates R39 --
  // PROJEXA's real POST /api/timesheets has been unreachable end-to-end
  // since Priority 17 Wave 1 for the identical reason (a shared per-org API
  // key, never a per-user identity). Same resolveActingUser() fix.
  try {
    const body = await readJsonBody(request)
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(
      ctx,
      body?.actorEmail ?? readActingUserEmail(request),
      readActingUserId(request)
    )
    if (actingUserErr) return actingUserErr

    const result = await logTime({ orgId: ctx.orgId, userId: actingUser!.id, dbUser: actingUser! }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa timesheet create error:", error)
    return NextResponse.json({ error: "Failed to log time entry" }, { status: 500 })
  }
}
