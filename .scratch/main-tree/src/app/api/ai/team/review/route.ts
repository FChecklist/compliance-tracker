import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"
import { registerAllGuardrails, AI_TEAM_CLOSURE_REVIEW_LEAF, QA_PRECOMPLETION_GATE_LEAF } from "@/lib/guardrail-registrations"
import { recordPeerReview, getActivityRiskLevel, getActivitySelfAssessment } from "@/lib/activity-log-service"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"

registerAllGuardrails()

// D15.B2.S1 named event #6, "AI Escalation -> Escalation Audit". The two
// reasons closureReviewCheck (guardrail-registrations.ts) can fail here --
// "confidence_below_escalation_threshold" and "critical_risk_requires_
// escalation" -- are exactly the two real call sites where
// escalation-ladder.ts's nextEscalationRung() already fires today. This is
// escalation-ladder.ts's own named domain, so it's reused directly rather
// than re-deriving "is this an escalation" a second way.
const ESCALATION_GUARDRAIL_REASONS = new Set(["confidence_below_escalation_threshold", "critical_risk_requires_escalation"])

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
  const { activityLogId, reviewNotes, reviewDecision, selfAssessment, confidencePercentage, qaGateOverrideReason } = body as {
    activityLogId?: string
    reviewNotes?: string
    reviewDecision?: "approved" | "rejected"
    selfAssessment?: Record<string, unknown>
    // D18/PLAN-20 (Guardrail 9 -- Confidence): optional 0-100 self-assessed
    // confidence -- see closureReviewCheck in guardrail-registrations.ts for
    // the actual banding enforcement (bandConfidence()).
    confidencePercentage?: number
    // tree4-unified/50-completion-plan area 3, PLAN-16 item (f): a real,
    // substantive justification for approving despite the dispatch's own
    // recorded handover reporting Validation Passed !== "yes" -- see
    // QA_PRECOMPLETION_GATE_LEAF below. Ignored when no override is
    // actually needed.
    qaGateOverrideReason?: string
  }

  if (!activityLogId) {
    return NextResponse.json({ error: "activityLogId is required" }, { status: 400 })
  }

  // tree4-unified/50-completion-plan area 9 "Auditing" item 1 (audit-
  // cadence.ts): riskLevel is read back from the activity_log row itself,
  // NOT from the request body -- a client-supplied riskLevel could be
  // spoofed to dodge closureReviewCheck's critical-risk escalation gate.
  const riskLevel = await getActivityRiskLevel(orgId, activityLogId)
  const check = evaluateGuardrails(AI_TEAM_CLOSURE_REVIEW_LEAF, "input", { reviewNotes, reviewDecision, confidencePercentage, riskLevel })
  if (!check.passed) {
    void recordGuardrailViolation(activityLogId, AI_TEAM_CLOSURE_REVIEW_LEAF, "input", check)
    if (ESCALATION_GUARDRAIL_REASONS.has(check.reason)) {
      void withTenantContext({ orgId, userId: dbUser.id }, (db) =>
        recordAuditTrigger({
          tx: db, event: "ai_escalation", entityType: "activity_log", entityId: activityLogId, orgId,
          dbUser, details: `${check.reason}: ${check.guidance ?? ""}`.trim(),
        })
      ).catch((err) => console.error(`[audit-trigger] failed to record ai_escalation for activity ${activityLogId}:`, err))
    }
    return NextResponse.json({ status: "blocked", blockedBy: { reason: check.reason, guidance: check.guidance } }, { status: 422 })
  }

  // tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 original
  // item (f): the QA pre-completion gate. Same "read the real value back
  // from the row, never trust the request body" posture as riskLevel
  // just above -- a client-supplied handoverValidationPassed could
  // otherwise be spoofed to dodge this exact gate.
  const storedSelfAssessment = await getActivitySelfAssessment(orgId, activityLogId)
  const handoverValidationPassed = (storedSelfAssessment?.validationPassed as string | undefined) ?? null
  const qaCheck = evaluateGuardrails(QA_PRECOMPLETION_GATE_LEAF, "input", { reviewDecision, handoverValidationPassed, overrideReason: qaGateOverrideReason })
  if (!qaCheck.passed) {
    void recordGuardrailViolation(activityLogId, QA_PRECOMPLETION_GATE_LEAF, "input", qaCheck)
    return NextResponse.json({ status: "blocked", blockedBy: { reason: qaCheck.reason, guidance: qaCheck.guidance } }, { status: 422 })
  }
  const qaGateOverrideNeeded = handoverValidationPassed?.trim().toLowerCase() !== "yes"

  const result = await recordPeerReview({
    orgId,
    activityLogId,
    reviewedBy: dbUser.id,
    reviewNotes: reviewNotes!,
    reviewDecision: reviewDecision!,
    selfAssessment,
    confidencePercentage,
    qaGateOverrideReason: qaGateOverrideNeeded ? qaGateOverrideReason : undefined,
  })

  if (!result.recorded) {
    const messages: Record<typeof result.reason, string> = {
      not_found: "No activity_log row found with that id in this organisation.",
      not_in_review: "This activity is not currently in the 'reviewing' stage -- either it was never flagged for review, or it has already been reviewed.",
      self_review_not_allowed: "The reviewer must be a different user from whoever dispatched the original task -- no self-certification.",
      handover_not_submitted: "No structured handover has been recorded for this dispatch yet -- it cannot be closed out until one exists.",
    }
    return NextResponse.json({ status: "rejected", reason: result.reason, message: messages[result.reason] }, { status: 409 })
  }

  return NextResponse.json({
    status: "recorded",
    lifecycleStage: reviewDecision === "approved" ? "completed" : "failed",
  })
}
