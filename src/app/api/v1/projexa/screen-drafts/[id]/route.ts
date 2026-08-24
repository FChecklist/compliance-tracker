import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { autosaveDraft, discardDraft } from "@/lib/screens/draft-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id
  if (!actorId) return NextResponse.json({ error: "A real user session is required to autosave a draft" }, { status: 400 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const row = await autosaveDraft({ orgId: ctx.orgId, userId: actorId }, id, body.payload ?? {})
  if (!row) return NextResponse.json({ error: "Draft not found (or not yours)" }, { status: 404 })
  return NextResponse.json(row)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id
  if (!actorId) return NextResponse.json({ error: "A real user session is required to discard a draft" }, { status: 400 })

  const { id } = await params
  await discardDraft({ orgId: ctx.orgId, userId: actorId }, id)
  return NextResponse.json({ discarded: true, id })
}
