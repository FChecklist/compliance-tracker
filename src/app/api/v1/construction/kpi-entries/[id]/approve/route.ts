// Real-screen conversion (2026-08-30): PROJEXA-reachable alias of
// construction-kpi-service.ts's approveKpiEntry -- had a real, working
// route (../../construction/kpi-entries/[id]/approve/route.ts) but only for
// a real session dbUser, never a Bearer-key caller. approveKpiEntry's own
// self-approval check (`entry.filledById === ctx.userId`) is a real business
// rule, not a bug -- see that function's own comment. It stays fully
// intact here: an entry submitted AND approved through the same shared
// PROJEXA org API key genuinely IS the same actor per this schema (no
// per-user identity bridge exists yet, per this session's other identity-
// bridge findings), so a 403 in that specific case is the correct,
// honest answer, not something to route around. This route only closes
// the previously-missing case where a *different* real actor (a VERIDIAN
// session user submitted, PROJEXA approves, or vice versa) tries to
// approve -- that always worked in principle, it just had no reachable
// route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { approveKpiEntry, ServiceError } from "@/lib/services/construction-kpi-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const entry = await approveKpiEntry({ orgId: ctx.orgId, userId: actorId }, id)
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction KPI entry approve error:", error)
    return NextResponse.json({ error: "Failed to approve KPI entry" }, { status: 500 })
  }
}
