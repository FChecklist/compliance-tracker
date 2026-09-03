import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId } from "@/lib/supabase/auth-guard"
import { listProgressEntries, createProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest) {
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

export async function POST(request: NextRequest) {
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
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry create error:", error)
    return NextResponse.json({ error: "Failed to create progress entry" }, { status: 500 })
  }
}
