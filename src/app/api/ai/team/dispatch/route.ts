import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { classifyTask, runRole, runGuardrailLevel, getRole } from "@/lib/ai-team/team-service"
import { resolveEffectiveModel } from "@/lib/ai-team/roster-overrides"
import { RoleNotCallableError } from "@/lib/ai-team/team-service"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"
import { registerAllGuardrails, AI_TEAM_DISPATCH_LEAF, HANDOVER_PROTOCOL_LEAF } from "@/lib/guardrail-registrations"
import { assembleTightTaskPrompt, type TightTask } from "@/lib/task-tightening"
import { checkTierEligibility } from "@/lib/model-tier-eligibility"
import { detectLowConfidenceResponse } from "@/lib/floor-tier-escalation"
import { recordActivity } from "@/lib/activity-log-service"
import { estimateCostUsd } from "@/lib/llm-client"
import { classifyRisk, type BlastRadius } from "@/lib/risk-classification"
import { detectHighImpactAction } from "@/lib/high-impact-action-detector"
import { buildDispatchSelfAssessment, checkQaPreCompletionGate } from "@/lib/qa-precompletion-gate"
import { checkResponseVocabulary, checkVocabularyDispatchEligibility, type VocabularyDispatchType } from "@/lib/response-vocabulary-gate"

registerAllGuardrails()

// VERIDIAN Cognitive AI OS Development Team — dispatch endpoint.
// Platform-internal (builds/governs VERIDIAN itself, never a customer
// workflow), so this is veridian_admin-gated, not merely authenticated —
// same posture as prompt-os-service.ts's createPromptVersion.
//
// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, Objective/Scope/Instruction
// Validation Guardrails: the request body is now a structured TightTask
// (objective/scope/successCriteria/constraints), not a free-text string.
// This is the "make tightened tasks mandatory" enforcement point -- a
// task missing any required field is blocked here, before classification
// or any model is ever called, and the violation feeds the CLEE loop the
// same way a policy-guardrail block does.
//
// Flow: validate task structure (Guardrail Engine) -> classify (AI
// Router) -> execute (assigned AI Workforce role) -> guardrail (platform
// level always; product/account/user only if the caller says that layer
// is touched). Returns every step's output so a human can audit exactly
// what happened, not just the final answer.
export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "AI Dev Team dispatch is veridian_admin-only" }, { status: 403 })
  }

  // Wave 172 (area 12 "Loop Engineering"): real wall-clock duration for the
  // reflection/directory pipeline -- measured here, not derived from
  // activity_log's created_at/updated_at (those can span several
  // stage-transition writes within this same request).
  const dispatchStartedAt = Date.now()

  try {
    const body = await request.json()
    const { objective, scope, successCriteria, complexityTier, expectedOutput, constraints, touchesProduct, touchesAccount, touchesUser, role: forcedRole, responseVocabulary } = body as Partial<TightTask> & {
      touchesProduct?: boolean
      touchesAccount?: boolean
      touchesUser?: boolean
      role?: string // skip classification and force a specific AI Workforce role
      // GAP-RESPONSE-VOCABULARY: opt-in constrained-vocabulary reply mode
      // for genuinely simple mechanical-tier dispatches (see
      // response-vocabulary-gate.ts). Omitted on every dispatch that
      // doesn't declare it -- ordinary free-form reply, unchanged.
      responseVocabulary?: VocabularyDispatchType
    }

    // Wave 160 (UNIVERSAL_TASK_WRAPPER_DESIGN.md, Phase 1): AI Dev Team
    // dispatch was, before this wave, the one real activity type in
    // VERIDIAN that left NO persisted record anywhere at all -- not even
    // an orchestraExecutions row, since runRole()'s own LLM call logging
    // is token-usage-ledger-only. Fire-and-forget, never blocks dispatch.
    if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "requested", objective, complexityTier })

    const tightness = evaluateGuardrails(AI_TEAM_DISPATCH_LEAF, "input", { objective, scope, successCriteria, complexityTier, expectedOutput, constraints })
    if (!tightness.passed) {
      void recordGuardrailViolation("ai_team_dispatch", AI_TEAM_DISPATCH_LEAF, "input", tightness)
      // No role resolved yet -- rejected before classification even runs.
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective, complexityTier, errorReason: tightness.reason, durationMs: Date.now() - dispatchStartedAt })
      return NextResponse.json({
        status: "blocked",
        blockedBy: { reason: tightness.reason, guidance: tightness.guidance },
      }, { status: 422 })
    }

    // GAP-RESPONSE-VOCABULARY: fail closed on a mismatched tier/vocabulary
    // pairing before any model is ever called -- same posture as the tier
    // check below. complexityTier is guaranteed valid here (tightness just
    // passed, and tightTaskCheck's validateTightTask requires it).
    const vocabEligibility = checkVocabularyDispatchEligibility(complexityTier!, responseVocabulary)
    if (!vocabEligibility.eligible) {
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective, errorReason: vocabEligibility.reason, durationMs: Date.now() - dispatchStartedAt })
      return NextResponse.json({
        status: "blocked",
        blockedBy: { reason: vocabEligibility.reason, guidance: vocabEligibility.guidance },
      }, { status: 422 })
    }

    const task = assembleTightTaskPrompt({ objective: objective!, scope: scope!, successCriteria: successCriteria!, complexityTier: complexityTier!, expectedOutput: expectedOutput!, constraints })

    const classification = forcedRole
      ? { role: forcedRole, reasoning: "Caller-specified role, classification skipped.", confidence: 1 }
      : await classifyTask(task)

    // Wave 163 (Boss directive: "based on complexity given to the AI
    // model"): the tightness check above validates the tier is a real
    // value; this checks it's the RIGHT value for the role classification/
    // forcedRole actually resolved to. Checked before any guardrail-team
    // review or execution -- a judgment-tier task routed to a mechanical-
    // only model is rejected here, not discovered after the fact.
    // Audit finding (chief_audit_officer's first real dispatch, CAO-001):
    // the original `if (targetRole?.model)` guard was fail-OPEN -- an
    // unresolvable role or a role with no model silently skipped the tier
    // check entirely and fell through toward execution (RoleNotCallableError
    // would eventually catch it inside runRole(), but only after a real
    // GUARDRAIL_PLATFORM LLM call had already run, and with no tier-specific
    // reason surfaced). Fixed to fail closed: an unresolvable role is
    // rejected HERE, before any guardrail review or model call.
    const targetRole = getRole(classification.role)
    if (!targetRole?.model) {
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective, roleKey: classification.role, complexityTier, errorReason: `Role "${classification.role}" could not be resolved to a callable model.`, durationMs: Date.now() - dispatchStartedAt })
      return NextResponse.json({
        status: "blocked",
        classification,
        blockedBy: { reason: `Role "${classification.role}" could not be resolved to a callable model.`, guidance: "Check the role_key -- it must be a real, LLM-backed role in roster.ts (not human-only or code-only)." },
      }, { status: 422 })
    }
    // VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
    // 2026-07-18): checked against the EFFECTIVE model (DB override if an
    // admin set one, else targetRole.model) -- runRole() below resolves the
    // exact same value for the actual call, so this gate can never pass a
    // static model that isn't the one that actually runs. Checking
    // targetRole.model here while an override silently ran a different,
    // ineligible model would be a real guardrail bypass, not just a stale
    // check.
    const effectiveModel = (await resolveEffectiveModel(classification.role)) ?? targetRole.model
    const tierCheck = checkTierEligibility(effectiveModel, complexityTier!)
    if (!tierCheck.eligible) {
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective, roleKey: classification.role, complexityTier, errorReason: tierCheck.reason, durationMs: Date.now() - dispatchStartedAt })
      return NextResponse.json({
        status: "blocked",
        classification,
        blockedBy: { reason: tierCheck.reason, guidance: tierCheck.guidance },
      }, { status: 422 })
    }

    const platformGuardrails = await runGuardrailLevel("GUARDRAIL_PLATFORM", task)
    const blocked = platformGuardrails.find((g) => /\bBLOCK\b/i.test(g.verdict) || /\bFAIL\b/i.test(g.verdict))
    if (blocked) {
      // Pre-existing gap closed in passing: this branch previously exited
      // without ever writing activity_log at all, leaving a platform-
      // guardrail block invisible to both the reflection pipeline and the
      // per-agent directory's failure/common-errors data.
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective, roleKey: classification.role, complexityTier, errorReason: `GUARDRAIL_PLATFORM: ${blocked.verdict}`, durationMs: Date.now() - dispatchStartedAt })
      return NextResponse.json({
        status: "blocked",
        classification,
        guardrails: { platform: platformGuardrails },
        blockedBy: blocked,
      }, { status: 422 })
    }

    const execution = await runRole(classification.role, task)

    // VERIDIAN_AUDIT_ORGANIZATION.md, "L1 Real-Time Audit": the source
    // document requires audit before completion whenever confidence is
    // low. No numeric confidence score exists anywhere in this codebase
    // (see that document's own honest note) -- fabricating one just to
    // compare it to 95% would be worse than not gating at all. Reusing
    // detectLowConfidenceResponse() (already proven on the customer-facing
    // floor tier, floor-tier-escalation.ts) as the deterministic proxy: if
    // the executing role's own output hedges, a product-level review runs
    // automatically, even if the caller never set touchesProduct. This is
    // the one new mandatory trigger this wave adds -- previously the
    // Guardrail levels below only ran when a caller explicitly opted in.
    const lowConfidence = detectLowConfidenceResponse(execution.content)

    // GAP-RESPONSE-VOCABULARY: for a dispatch that declared a fixed
    // vocabulary (only possible here at all because of the mechanical-tier
    // eligibility gate above), validate the model's raw reply against it.
    // A non-matching reply is NEVER silently coerced or discarded -- it
    // becomes its own independent requiresAudit trigger below, exactly
    // like lowConfidence/riskLevel, so a mechanical-tier model that ignored
    // the constrained-reply instruction still gets a real human/higher-tier
    // review instead of its off-vocabulary text quietly reaching the caller
    // as if it had been validated.
    const vocabularyCheck = responseVocabulary ? checkResponseVocabulary(responseVocabulary, execution.content) : null

    // tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16
    // re-scoped item (d) "Risk Classification" (Guardrail 10: "risk level
    // determines review requirements"): a second, independent trigger for
    // review alongside the low-confidence-text proxy above -- a task can
    // read as perfectly confident and still be a payment/deletion/
    // compliance filing that deserves scrutiny regardless of how sure the
    // model sounded. blastRadius is derived from the caller's own
    // touchesAccount/touchesUser/touchesProduct flags (already the
    // existing signal for "how far does this reach"), not invented new
    // input the caller doesn't already provide.
    const blastRadius: BlastRadius = touchesAccount || touchesUser ? "platform" : touchesProduct ? "org" : "single"
    const riskLevel = classifyRisk({ highImpactCategory: detectHighImpactAction(objective ?? "").category, blastRadius })
    const requiresAudit = lowConfidence.detected || riskLevel === "high" || riskLevel === "critical" || (vocabularyCheck !== null && !vocabularyCheck.allowed)

    const guardrails: Record<string, unknown> = { platform: platformGuardrails }
    if (touchesProduct || requiresAudit) guardrails.product = await runGuardrailLevel("GUARDRAIL_PRODUCT", execution.content)
    if (touchesAccount) guardrails.account = await runGuardrailLevel("GUARDRAIL_ACCOUNT", execution.content)
    if (touchesUser) guardrails.user = await runGuardrailLevel("GUARDRAIL_USER", execution.content)

    // Wave 165 (U-D12.B4.S3 finding): this write used to be fire-and-forget
    // with no way to reference it again -- 'reviewing' was a dead end, and
    // the response below said status:"completed" unconditionally even when
    // requiresAudit was true. Now awaited so the activity_log id can be
    // handed back to the caller, and the reported status honestly reflects
    // that a low-confidence dispatch is NOT done until an independent
    // reviewer calls POST /api/ai/team/review (see that route + guardrail-
    // registrations.ts's AI_TEAM_CLOSURE_REVIEW_LEAF for the actual gate).
    // tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16
    // original item (f), "QA pre-completion gate distinct from GOV-08":
    // two prior passes (04-implementation-log.yaml, 2026-07-11 x2) found
    // Handover Protocol (handover-protocol.ts, PR #170) had zero live
    // callers -- this is the real call site. Every field is derived from
    // signals this route already computed for its own requiresAudit
    // decision above (never fabricated -- see qa-precompletion-gate.ts's
    // own header for why outputSummary is a factual descriptor, not the
    // raw response text).
    const selfAssessmentFields = buildDispatchSelfAssessment({
      requiresAudit,
      riskLevel,
      lowConfidenceDetected: lowConfidence.detected,
      lowConfidenceMatchedPhrase: lowConfidence.matchedPhrase,
      outputSummary: `${execution.content.length}-character response from ${execution.role.title} (${execution.role.roleKey})`,
    })
    // GOV-08 (HANDOVER_PROTOCOL_LEAF) reused unmodified to validate the
    // SUBMISSION itself, exactly as it already does for
    // submitHandover()'s task_agent_executions rows. A failure here is
    // code-derivation trouble, not a real handover defect (every field
    // above is code-controlled, not user input) -- it degrades to "no
    // self_assessment recorded" rather than blocking a successful
    // dispatch's response.
    const handoverFieldCheck = evaluateGuardrails(HANDOVER_PROTOCOL_LEAF, "input", selfAssessmentFields)
    if (!handoverFieldCheck.passed) {
      console.warn(`AI Team dispatch self-assessment failed GOV-08 field validation (non-fatal): ${handoverFieldCheck.reason}`)
    }
    // The actual QA pre-completion gate (PLAN-16 item (f), distinct from
    // GOV-08 above): GOV-08 only checks the submission is well-formed;
    // this checks whether its reported Validation Passed VALUE permits a
    // 'completed' lifecycle_stage at all. lifecycleStage below mirrors
    // requiresAudit exactly today (validationPassed is derived FROM
    // requiresAudit in buildDispatchSelfAssessment), but the gate -- not
    // the ad hoc boolean -- is now the thing that actually decides it, so
    // a future caller with a more granular validationPassed signal is
    // honored automatically instead of needing this route rewritten.
    const qaGate = checkQaPreCompletionGate({ handoverValidationPassed: selfAssessmentFields.validationPassed })
    const lifecycleStage = qaGate.passed ? "completed" : "reviewing"

    const activityRow = orgId
      ? await recordActivity({
          orgId, userId: dbUser.id, activityType: "ai_team_dispatch",
          lifecycleStage,
          objective, roleKey: classification.role, complexityTier,
          durationMs: Date.now() - dispatchStartedAt,
          // Real cost when this model's pricing is known (estimateCostUsd
          // returns null for an unpriced model) -- forwarded to the
          // reflection row's cost verdict, never fabricated.
          // execution.role.model (not targetRole.model) -- reflects the
          // model actually called, in case an override was in effect.
          costUsd: estimateCostUsd(execution.role.model!, execution.usage) ?? undefined,
          riskLevel,
          selfAssessment: handoverFieldCheck.passed ? selfAssessmentFields : undefined,
        })
      : null

    return NextResponse.json({
      status: requiresAudit ? "pending_review" : "completed",
      classification,
      executedBy: { roleKey: execution.role.roleKey, title: execution.role.title, model: execution.role.model },
      output: execution.content,
      usage: execution.usage,
      requiresAudit,
      riskLevel,
      lowConfidenceSignal: lowConfidence.detected ? lowConfidence.matchedPhrase : null,
      // GAP-RESPONSE-VOCABULARY: null when responseVocabulary wasn't
      // declared (ordinary free-form dispatch, unchanged). When declared,
      // always surfaced -- both the match and the honest mismatch case --
      // so a caller/reviewer can see exactly why requiresAudit fired.
      vocabularyCheck,
      reviewActivityId: requiresAudit ? (activityRow?.id ?? null) : null,
      guardrails,
    })
  } catch (error) {
    if (error instanceof RoleNotCallableError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("AI Team dispatch error:", error)
    const message = error instanceof Error ? error.message : "Dispatch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }
  const { AI_TEAM_ROSTER } = await import("@/lib/ai-team/roster")
  return NextResponse.json({ roster: AI_TEAM_ROSTER })
}

// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18): the roster.ts role->model mapping admin edit surface --
// GET .../roster/overrides for the joined roster+override view (see the
// dedicated route below), PATCH here to set or clear one role's override.
// Kept on this same dispatch route file rather than a new one -- this IS
// the AI Dev Team dispatch surface these overrides govern, same
// veridian_admin gate as GET above.
export async function PATCH(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { roleKey, model, reason } = body as { roleKey?: string; model?: string | null; reason?: string }
    if (!roleKey) return NextResponse.json({ error: "roleKey is required" }, { status: 400 })

    const { setRoleOverride, clearRoleOverride } = await import("@/lib/ai-team/roster-overrides")
    if (model === null || model === undefined) {
      await clearRoleOverride(roleKey)
      return NextResponse.json({ status: "cleared", roleKey })
    }
    await setRoleOverride(roleKey, model, dbUser.id, reason)
    return NextResponse.json({ status: "set", roleKey, model })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to set role override"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
