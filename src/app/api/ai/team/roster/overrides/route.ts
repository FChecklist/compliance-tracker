import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listRosterWithOverrides, knownModels } from "@/lib/ai-team/roster-overrides"

// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18): the read side of the admin roster-override UI -- every
// roster role joined against its current override (if any), plus the
// allowlist of models an override is actually permitted to point at. Model
// mutation itself is PATCH /api/ai/team/dispatch (see that route's own
// comment for why it lives there).
export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  const [roster, models] = await Promise.all([listRosterWithOverrides(), knownModels()])
  return NextResponse.json({ roster, knownModels: models })
}
