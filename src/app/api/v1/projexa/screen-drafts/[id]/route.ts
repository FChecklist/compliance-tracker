import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser } from "@/lib/supabase/auth-guard"
import { autosaveDraft, discardDraft } from "@/lib/screens/draft-service"

// R42 seq21 live-oracle finding: PROJEXA's real proxy authenticates with a
// shared per-org API key (ctx.dbUser is always null there), same root cause
// already fixed on the timesheets submit/approve/reject routes -- see
// resolveActingUser()'s own doc comment in auth-guard.ts. A hard
// `!ctx.dbUser` 400 made every draft autosave/discard from PROJEXA
// unreachable ("A real user session is required...").
type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr

  const row = await autosaveDraft({ orgId: ctx.orgId, userId: actingUser!.id }, id, body.payload ?? {})
  if (!row) return NextResponse.json({ error: "Draft not found (or not yours)" }, { status: 404 })
  return NextResponse.json(row)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr

  await discardDraft({ orgId: ctx.orgId, userId: actingUser!.id }, id)
  return NextResponse.json({ discarded: true, id })
}
