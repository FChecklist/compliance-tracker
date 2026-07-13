import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getGovernanceHealthCounts, listStuckActivities } from "@/lib/activity-log-service"
import { computeGovernanceHealthScore } from "@/lib/monitoring-engine"

// tree4-unified/50-completion-plan area 6 "Monitoring", the one remaining
// item: Reasoning Quality / Dependency Health / Instruction-Policy-Security
// Compliance as individually tracked metrics. veridian_admin-gated, same
// posture as /api/ai/team/re-audit -- platform-internal governance, not a
// customer workflow. See monitoring-engine.ts's computeGovernanceHealthScore
// header for why these 3 scores are derived from real, already-persisted
// independent-reviewer outcomes rather than an LLM self-grade.

// Gap closure, 2026-07-13 (Boss directive, metadata/drift investigation):
// the 3 scores above are all computed from TERMINAL rows only (by design --
// see computeGovernanceHealthScore's header) and say nothing about a
// dispatch that is currently stuck mid-flight, never reaching a terminal
// stage at all. stuckActivities is that separate, complementary signal --
// deliberately not blended into the 0-100 scores, since "was the outcome
// good" and "is something stuck right now" are different questions.
// 24h is a stated, adjustable default, not a hidden magic number -- a
// dispatch that hasn't moved in a day is worth a human/agent looking at,
// even though nothing here claims that specific threshold is provably
// correct.
const STUCK_THRESHOLD_MS = 24 * 60 * 60 * 1000

export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Governance health is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const [counts, stuckActivities] = await Promise.all([
    getGovernanceHealthCounts(orgId),
    listStuckActivities(orgId, STUCK_THRESHOLD_MS),
  ])
  const scores = computeGovernanceHealthScore(counts)
  return NextResponse.json({
    ...scores,
    counts,
    stuckActivities: stuckActivities.map((a) => ({
      id: a.id,
      objective: a.objective,
      lifecycleStage: a.lifecycleStage,
      roleKey: a.roleKey,
      updatedAt: a.updatedAt,
    })),
    stuckThresholdHours: STUCK_THRESHOLD_MS / (60 * 60 * 1000),
  })
}
