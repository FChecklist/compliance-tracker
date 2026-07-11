import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getGovernanceHealthCounts } from "@/lib/activity-log-service"
import { computeGovernanceHealthScore } from "@/lib/monitoring-engine"

// tree4-unified/50-completion-plan area 6 "Monitoring", the one remaining
// item: Reasoning Quality / Dependency Health / Instruction-Policy-Security
// Compliance as individually tracked metrics. veridian_admin-gated, same
// posture as /api/ai/team/re-audit -- platform-internal governance, not a
// customer workflow. See monitoring-engine.ts's computeGovernanceHealthScore
// header for why these 3 scores are derived from real, already-persisted
// independent-reviewer outcomes rather than an LLM self-grade.
export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Governance health is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) return NextResponse.json({ error: "No organisation context" }, { status: 400 })

  const counts = await getGovernanceHealthCounts(orgId)
  const scores = computeGovernanceHealthScore(counts)
  return NextResponse.json({ ...scores, counts })
}
