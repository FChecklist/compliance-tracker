import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { listProgressEntries, createProgressEntry, ProgressRuleError, ServiceError } from "@/lib/services/construction-progress-service"
import { withRouteTiming } from "@/lib/route-timing"

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
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const entries = await listProgressEntries({ orgId: ctx.orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      activityId: request.nextUrl.searchParams.get("activityId") ?? undefined,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress list error:", error)
    return NextResponse.json({ error: "Failed to fetch progress entries" }, { status: 500 })
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

  try {
    const body = await request.json()
    // R42 seq22 live-audit finding: `ctx.apiKey!.id` is an api_keys.id, not a
    // real compliance.users.id -- the exact E-class FK-mismatch bug fixed
    // independently 3 times elsewhere this run (see resolveActingUser()'s
    // own doc comment in auth-guard.ts). PROJEXA's real proxy always
    // authenticates with a shared per-org API key, so this path was live
    // for every real progress entry PROJEXA has ever logged.
    //
    // R67 WS-H (D-05): the same call now also reads the X-Acting-User header
    // PROJEXA sends, so a work-progress entry is attributed by the stronger
    // id binding where the account is linked, falling back to actorEmail
    // exactly as before where it is not.
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail, readActingUserId(request))
    if (actingUserErr) return actingUserErr
    const result = await createProgressEntry({ orgId: ctx.orgId, userId: actingUser!.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    // R67 B-09 (D-03): the one rule that governs BOTH the Daily Entry form
    // and the composer answers with a CODE, not a sentence. Both clients
    // render it through projexa's src/lib/task-errors.ts, which is why they
    // produce the same words -- "Pick a BOQ line", never "itemCode".
    if (error instanceof ProgressRuleError) {
      return NextResponse.json({ code: error.code, missing: error.missing }, { status: 400 })
    }
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry create error:", error)
    return NextResponse.json({ error: "Failed to create progress entry" }, { status: 500 })
  }
}
