import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { classifyTask, runRole, runGuardrailLevel, getRole } from "@/lib/ai-team/team-service"
import { RoleNotCallableError } from "@/lib/ai-team/team-service"
import { evaluateGuardrails, recordGuardrailViolation } from "@/lib/guardrail-engine"
import { registerAllGuardrails, AI_TEAM_DISPATCH_LEAF } from "@/lib/guardrail-registrations"
import { assembleTightTaskPrompt, type TightTask } from "@/lib/task-tightening"
import { checkTierEligibility } from "@/lib/model-tier-eligibility"
import { detectLowConfidenceResponse } from "@/lib/floor-tier-escalation"
import { recordActivity } from "@/lib/activity-log-service"

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

  try {
    const body = await request.json()
    const { objective, scope, successCriteria, complexityTier, expectedOutput, constraints, touchesProduct, touchesAccount, touchesUser, role: forcedRole } = body as Partial<TightTask> & {
      touchesProduct?: boolean
      touchesAccount?: boolean
      touchesUser?: boolean
      role?: string // skip classification and force a specific AI Workforce role
    }

    // Wave 160 (UNIVERSAL_TASK_WRAPPER_DESIGN.md, Phase 1): AI Dev Team
    // dispatch was, before this wave, the one real activity type in
    // VERIDIAN that left NO persisted record anywhere at all -- not even
    // an orchestraExecutions row, since runRole()'s own LLM call logging
    // is token-usage-ledger-only. Fire-and-forget, never blocks dispatch.
    if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "requested", objective })

    const tightness = evaluateGuardrails(AI_TEAM_DISPATCH_LEAF, "input", { objective, scope, successCriteria, complexityTier, expectedOutput, constraints })
    if (!tightness.passed) {
      void recordGuardrailViolation("ai_team_dispatch", AI_TEAM_DISPATCH_LEAF, "input", tightness)
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective })
      return NextResponse.json({
        status: "blocked",
        blockedBy: { reason: tightness.reason, guidance: tightness.guidance },
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
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective })
      return NextResponse.json({
        status: "blocked",
        classification,
        blockedBy: { reason: `Role "${classification.role}" could not be resolved to a callable model.`, guidance: "Check the role_key -- it must be a real, LLM-backed role in roster.ts (not human-only or code-only)." },
      }, { status: 422 })
    }
    const tierCheck = checkTierEligibility(targetRole.model, complexityTier!)
    if (!tierCheck.eligible) {
      if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: "failed", objective })
      return NextResponse.json({
        status: "blocked",
        classification,
        blockedBy: { reason: tierCheck.reason, guidance: tierCheck.guidance },
      }, { status: 422 })
    }

    const platformGuardrails = await runGuardrailLevel("GUARDRAIL_PLATFORM", task)
    const blocked = platformGuardrails.find((g) => /\bBLOCK\b/i.test(g.verdict) || /\bFAIL\b/i.test(g.verdict))
    if (blocked) {
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
    const requiresAudit = lowConfidence.detected

    const guardrails: Record<string, unknown> = { platform: platformGuardrails }
    if (touchesProduct || requiresAudit) guardrails.product = await runGuardrailLevel("GUARDRAIL_PRODUCT", execution.content)
    if (touchesAccount) guardrails.account = await runGuardrailLevel("GUARDRAIL_ACCOUNT", execution.content)
    if (touchesUser) guardrails.user = await runGuardrailLevel("GUARDRAIL_USER", execution.content)

    if (orgId) recordActivity({ orgId, userId: dbUser.id, activityType: "ai_team_dispatch", lifecycleStage: requiresAudit ? "reviewing" : "completed", objective })

    return NextResponse.json({
      status: "completed",
      classification,
      executedBy: { roleKey: execution.role.roleKey, title: execution.role.title, model: execution.role.model },
      output: execution.content,
      usage: execution.usage,
      requiresAudit,
      lowConfidenceSignal: lowConfidence.detected ? lowConfidence.matchedPhrase : null,
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
