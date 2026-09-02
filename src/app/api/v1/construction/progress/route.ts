import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { listProgressEntries, createProgressEntry, ServiceError } from "@/lib/services/construction-progress-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    // R67 F-13 (R-193/R-217): dateFrom/dateTo are forwarded. listProgressEntries
    // has always supported the window; nothing exposed it, so every caller --
    // including PROJEXA's Work Progress Report, which only ever looks at
    // entries up to its own `to` date -- had to pull a project's entire logging
    // history and discard most of it. Both bounds stay optional, so every
    // existing caller behaves exactly as before.
    const entries = await listProgressEntries({ orgId: ctx.orgId }, {
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      activityId: request.nextUrl.searchParams.get("activityId") ?? undefined,
      dateFrom: request.nextUrl.searchParams.get("dateFrom") ?? undefined,
      dateTo: request.nextUrl.searchParams.get("dateTo") ?? undefined,
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
    const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
    if (actingUserErr) return actingUserErr
    const result = await createProgressEntry({ orgId: ctx.orgId, userId: actingUser!.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction progress entry create error:", error)
    return NextResponse.json({ error: "Failed to create progress entry" }, { status: 500 })
  }
}
