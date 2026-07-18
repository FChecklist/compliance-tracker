import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getControlsHealthSnapshot } from "@/lib/controls-health-audit"

// Continuous Internal Controls Monitoring -- L3 Rolling Health Audit
// (VERIDIAN Review Framework gap closure, 2026-07-18). See
// controls-health-audit.ts's header for the full reasoning (what this
// aggregates, and the honest Vercel Hobby-plan cron-ceiling limitation on
// why this is on-demand rather than scheduled). veridian_admin-gated, same
// posture as the sibling /governance-health route -- platform-internal
// controls monitoring, not a customer workflow.
export async function GET(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Controls health is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const windowParam = request.nextUrl.searchParams.get("windowMinutes")
  const parsedWindow = windowParam ? Number(windowParam) : NaN
  const windowMinutes = Number.isFinite(parsedWindow) ? parsedWindow : undefined

  const snapshot = await getControlsHealthSnapshot(orgId, windowMinutes)
  return NextResponse.json(snapshot)
}
