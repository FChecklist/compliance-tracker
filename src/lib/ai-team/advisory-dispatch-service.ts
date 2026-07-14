// Priority 12/OPEN-07 decision (a) (Owner directive 2026-07-14, quoted
// verbatim in ai-os/MASTER-TRACKER.yaml): "make sure its working" re:
// GITHUB_DISPATCH_PAT. Decision: do NOT create a new PAT -- switch
// capability-audit-service.ts's dispatchProposalToHigherAI() from
// dispatch-repo.ts's repository_dispatch (PAT-gated, GITHUB_DISPATCH_PAT
// never configured on Vercel, confirmed never fired) to the already-live
// advisory-only path /api/ai/team/dispatch's route already uses for a
// human veridian_admin: runRole() + the same tier-eligibility and
// GUARDRAIL_PLATFORM checks, no GitHub PAT required at all.
//
// Deliberately narrower than a full extraction of that route's handler: the
// route's guardrail-tightness/response-vocabulary/QA-precompletion-gate/
// activity-log machinery exists to validate a HUMAN caller's raw HTTP input
// and produce a human-facing dispatch record -- capability-audit's own
// TightTask is already well-formed by construction (buildTightTaskFromFindings()
// in capability-audit-service.ts), and task_capabilities has no owning org
// to attribute activity_log rows to (orgId nullable by design, a platform-
// wide catalog). Reusing exactly the two guardrails that are substantively
// about safety (tier eligibility, platform-level guardrail review) keeps
// this narrow and reviewable rather than duplicating ~250 lines of
// HTTP-input-shaped logic this caller doesn't need.
import { runRole, runGuardrailLevel, getRole } from "./team-service"
import { assembleTightTaskPrompt, type TightTask } from "../task-tightening"
import { checkTierEligibility } from "../model-tier-eligibility"

export type AdvisoryDispatchResult =
  | { dispatched: true; roleKey: string; output: string }
  | { dispatched: false; reason: string }

/**
 * Dispatches a pre-built TightTask to a specific (not classified) AI
 * Workforce role via the advisory-only runRole() path -- never touches
 * repository_dispatch/dispatch-repo.ts, never requires GITHUB_DISPATCH_PAT.
 * Never throws: every failure mode returns `{ dispatched: false, reason }`
 * so a caller like dispatchProposalToHigherAI() can degrade gracefully
 * (leave the proposal 'open' for a later retry) exactly as it already does
 * around the repo-write path it replaces.
 */
export async function dispatchAdvisoryTask(roleKey: string, task: TightTask): Promise<AdvisoryDispatchResult> {
  const role = getRole(roleKey)
  if (!role?.model) {
    return { dispatched: false, reason: `Role '${roleKey}' could not be resolved to a callable model.` }
  }

  const tierCheck = checkTierEligibility(role.model, task.complexityTier)
  if (!tierCheck.eligible) {
    return { dispatched: false, reason: `${tierCheck.reason} ${tierCheck.guidance}` }
  }

  const prompt = assembleTightTaskPrompt(task)

  // Same platform-level guardrail review /api/ai/team/dispatch runs for
  // every dispatch, regardless of who's calling.
  const platformGuardrails = await runGuardrailLevel("GUARDRAIL_PLATFORM", prompt)
  const blockedVerdict = platformGuardrails.find((g) => /\bBLOCK\b/i.test(g.verdict) || /\bFAIL\b/i.test(g.verdict))
  if (blockedVerdict) {
    return { dispatched: false, reason: `GUARDRAIL_PLATFORM (${blockedVerdict.title}) blocked this dispatch: ${blockedVerdict.verdict}` }
  }

  const execution = await runRole(roleKey, prompt)
  return { dispatched: true, roleKey, output: execution.content }
}
