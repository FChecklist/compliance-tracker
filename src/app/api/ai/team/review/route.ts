import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"
import { registerAllGuardrails, AI_TEAM_CLOSURE_REVIEW_LEAF } from "@/lib/guardrail-registrations"
import { recordPeerReview } from "@/lib/activity-log-service"

registerAllGuardrails()

// Wave 165 (tree4-unified/50-completion-plan U-D12.B4.S3): closes the gap
// found in /api/ai/team/dispatch/route.ts -- a low-confidence dispatch was
// marked activity_log.lifecycle_stage = 'reviewing' but nothing ever read
// that back, so "review" was a label with no consequence. This endpoint is
// the actual consequence: it's the only place a 'reviewing' row can move to
// 'completed' or 'failed', and it requires real reviewer comments plus an
// explicit decision, both stored permanently on the row (VERIDIAN_TASK_
// GOVERNANCE_CONSTITUTION.md's "comments part of permanent record").
//
// veridian_admin-gated, same posture as dispatch -- this is platform-
// internal governance, not a customer workflow. Does NOT check that the
// reviewer is a DIFFERENT specific person from the dispatcher via role
// hierarchy (no such hierarchy exists among veridian_admins today) -- it
// enforces the narrower, mechanically checkable half of "no self-
// certification": recordPeerReview() rejects a reviewedBy identical to the
// activity's own userId. A full "independent reviewer" role system is
// PLAN-16's broader, still-open Authority/Delegation gap, not solved here.
export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI Dev Team closure review is veridian_admin-only" }, { status: 403 })
  }
  if (!orgId) {
    return NextResponse.json({ error: "No organisation context" }, { status: 400 })
  }

  const body = await request.json()
  const { activityLogId, reviewNotes, reviewDecision, selfAssessment } = body as {
    activityLogId?: string
    reviewNotes?: string
    reviewDecision?: "approved" | "rejected"
    selfAssessment?: Record<string, unknown>
  }

  if (!activityLogId) {
    return NextResponse.json({ error: "activityLogId is required" }, { status: 400 })
  }

  const check = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes, reviewDecision })
  if (!check.passed) {
    void recordGuardrailViolation(activityLogId, AI_TEAM_CLOSURE_REVIEW_LEAF, "input", check)
    return NextResponse.json({ status: "blocked", blockedBy: { reason: check.reason, guidance: check.guidance } }, { status: 422 })
  }

  const result = await recordPeerReview({
    orgId,
    activityLogId,
    reviewedBy: dbUser.id,
    reviewNotes: reviewNotes!,
    reviewDecision: reviewDecision!,
    selfAssessment,
  })

  if (!result.recorded) {
    const messages: Record<typeof result.reason, string> = {
      not_found: "No activity_log row found with that id in this organisation.",
      not_in_review: "This activity is not currently in the 'reviewing' stage -- either it was never flagged for review, or it has already been reviewed.",
      self_review_not_allowed: "The reviewer must be a different user from whoever dispatched the original task -- no self-certification.",
    }
    return NextResponse.json({ status: "rejected", reason: result.reason, message: messages[result.reason] }, { status: 409 })
  }

  return NextResponse.json({
    status: "recorded",
    lifecycleStage: reviewDecision === "approved" ? "completed" : "failed",
  })
}
