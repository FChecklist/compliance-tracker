// R42 seq15 (M26 P6): the one real place a human (L3 -- Rajat today)
// approves an L2-proposed phrase_map candidate into something L0 will
// actually match. Gated to manager+ -- an approval action, same posture as
// the timesheet approve route (R39/R-C12).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRole, resolveActingUser } from "@/lib/supabase/auth-guard"
import { promotePhraseMapCandidate } from "@/lib/ai/batch/analyse"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.actorEmail)
  if (actingUserErr) return actingUserErr
  const roleErr = requireRole(actingUser, "manager")
  if (roleErr) return roleErr

  const { id } = await params
  const row = await promotePhraseMapCandidate(ctx.orgId, id, actingUser!.id)
  if (!row) return NextResponse.json({ error: "candidate not found, or already promoted" }, { status: 404 })
  return NextResponse.json(row)
}
