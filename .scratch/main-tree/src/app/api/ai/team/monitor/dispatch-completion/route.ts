import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { runDispatchCompletionSweep } from "@/lib/monitors/dispatch-completion-monitor"

// PLATFORM_STRATEGY.md 29.3 Phase 1+2 / 31.4 Phase B: the real call site for
// dispatch-completion-monitor.ts -- this repo has a documented pattern of
// library code shipping with no live caller (audit-protocol.ts before PR
// #248), and this route is what avoids repeating that here. veridian_admin
// -gated, same posture as every other /api/ai/team/* platform-governance
// route (governance-health, re-audit) -- this observes OTHER AI agents'
// dispatch work, never a customer workflow.
//
// Pull-based on purpose, not by default: this codebase has no existing cron
// convention for AI-team-internal work specifically (audit-cadence-scan.ts's
// L2 scan is the one exception, wired to a real Vercel cron at
// /api/internal/audit-cadence/run -- see that route if a future pass wants
// to wire THIS monitor the same way). A plain, independently-triggerable
// route is simpler for this pass and makes the monitor callable by a human,
// a script, or a future cron without deciding "how does this get scheduled"
// as part of this change.
//
// STUCK_THRESHOLD_MS defaults to governance-health route's own 24h default
// (same constant value, not imported -- that route's constant is private)
// so GET (no body) behaves identically to what /api/ai/team/governance-
// health already reports as `stuckActivities`; POST lets a caller override
// it for testing a tighter/looser window without redeploying.
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

async function runSweep(request: NextRequest, staleAfterMsOverride?: number) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Dispatch-completion monitor is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const staleAfterMs =
    typeof staleAfterMsOverride === "number" && Number.isFinite(staleAfterMsOverride) && staleAfterMsOverride > 0
      ? staleAfterMsOverride
      : DEFAULT_STALE_THRESHOLD_MS

  const sweep = await runDispatchCompletionSweep(orgId, dbUser, staleAfterMs, request)

  return NextResponse.json({
    staleThresholdHours: staleAfterMs / (60 * 60 * 1000),
    checked: sweep.checked,
    ok: sweep.ok,
    escalated: sweep.escalated,
    invalidReports: sweep.invalidReports,
    results: sweep.results.map((r) => ({
      activityId: r.activityId,
      status: r.report.status,
      action: r.report.action,
      confidence: r.report.confidence,
      protocol: r.report.protocol,
      modelCallFailed: r.modelCallFailed,
      reportValid: r.reportValid,
      escalation: r.claim,
    })),
  })
}

/** GET: run the sweep with the default 24h staleness threshold -- safe to hit from a browser, a script, or a future cron with no body. */
export async function GET(request: NextRequest) {
  return runSweep(request)
}

/** POST: same sweep, with an optional { staleAfterMs } override for testing a tighter/looser window. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { staleAfterMs } = body as { staleAfterMs?: number }
  return runSweep(request, staleAfterMs)
}
