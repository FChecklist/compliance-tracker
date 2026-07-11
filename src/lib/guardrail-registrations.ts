// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md: the first real consumer of
// guardrail-engine.ts's Wave 157 registry, which has held zero registered
// leaves since it shipped (confirmed empty in production per
// veridian_veri_rebrand_and_ai_routing_2026-07-10 memory and this repo's
// own FOLLOWUPS.md FOLLOWUP-1). Deliberately does NOT retrofit
// high-impact-action-detector.ts through this framework -- FOLLOWUP-1
// explicitly says that retrofit "should ship as its own wave with its own
// audit, not bundled into unrelated work," and it changes a live,
// already-audited safety gate for no functional gain. This wave adds a
// genuinely new, additive consumer instead: task-dispatch tightening
// (task-tightening.ts), proving the registry is real infrastructure
// without touching what already works.
//
// Call registerAllGuardrails() once at process startup before any task
// dispatch can occur. Idempotent-safe to call more than once in the same
// process (registerGuardrail is additive, so calling this twice would
// double-register -- callers should only invoke it once; see call sites).
import { registerGuardrail } from "./guardrail-engine"
import { validateTightTask, validateTaskBrief, type TightTask, type TaskBrief } from "./task-tightening"
import { checkLoopBudget, type LoopBudgetContext } from "./loop-prevention"
import { validateHandoverFields, type HandoverFields } from "./handover-protocol"

export const AI_TEAM_DISPATCH_LEAF = "ai_team.dispatch"
export const AI_WORKFORCE_DISPATCH_LEAF = "ai_workforce.dispatch"
export const TASK_FREE_TEXT_PLANNING_LEAF = "task_execution.free_text_planning"
export const AI_WORKFORCE_LOOP_BUDGET_LEAF = "ai_workforce.loop_budget"
// Wave 165 (tree4-unified/50-completion-plan U-D12.B4.S3): gates the
// /api/ai/team/review endpoint's input, not the dispatch itself -- a
// low-confidence AI Team dispatch already landed in activity_log's
// 'reviewing' stage; this leaf validates the REVIEW submission that closes
// it out (real reviewer comments + an explicit decision), before
// recordPeerReview()'s own fail-closed checks (not_found/not_in_review/
// self_review_not_allowed) run.
export const AI_TEAM_CLOSURE_REVIEW_LEAF = "ai_team.closure_review"
// Wave 167 (ai-os/tree4-unified/10-merged-governance-layer U-D17.B1.S1,
// confirmed_gap): gates the handover SUBMISSION itself (all 9 required
// fields present, real, unambiguous) before submitHandover()
// (handover-protocol.ts) writes it onto a task_agent_executions row --
// same "input phase validates the submission, not the surrounding
// lifecycle stage" posture as AI_TEAM_CLOSURE_REVIEW_LEAF just above.
export const HANDOVER_PROTOCOL_LEAF = "task_execution.handover"

function tightTaskCheck(context: Record<string, unknown>) {
  // Wave 163 audit finding (chief_audit_officer's first real dispatch,
  // CAO-001): complexityTier/expectedOutput were added to TightTask but
  // never read here -- every real dispatch would have failed this gate
  // regardless of what the caller sent, since validateTightTask requires
  // them. Fails closed (blocks everything) rather than open, but still a
  // real bug, not just an incomplete feature -- fixed same pass it was found.
  const task: Partial<TightTask> = {
    objective: context.objective as string | undefined,
    scope: context.scope as string | undefined,
    successCriteria: context.successCriteria as string | undefined,
    complexityTier: context.complexityTier as TightTask["complexityTier"] | undefined,
    expectedOutput: context.expectedOutput as string | undefined,
    constraints: context.constraints as string | undefined,
  }
  const result = validateTightTask(task)
  if (result.valid) return { passed: true as const }
  return { passed: false as const, reason: result.reason, guidance: result.guidance }
}

function taskBriefCheck(context: Record<string, unknown>) {
  const brief: TaskBrief = { title: context.title as string, description: context.description as string | null | undefined }
  const result = validateTaskBrief(brief)
  if (result.valid) return { passed: true as const }
  return { passed: false as const, reason: result.reason, guidance: result.guidance }
}

function loopBudgetCheck(context: Record<string, unknown>) {
  return checkLoopBudget(context as unknown as LoopBudgetContext)
}

const MIN_REVIEW_NOTES_LENGTH = 10
const VALID_REVIEW_DECISIONS = ["approved", "rejected"]

function closureReviewCheck(context: Record<string, unknown>) {
  const reviewNotes = context.reviewNotes as string | undefined
  const reviewDecision = context.reviewDecision as string | undefined
  if (!reviewNotes || reviewNotes.trim().length < MIN_REVIEW_NOTES_LENGTH) {
    return {
      passed: false as const,
      reason: "review_notes_missing_or_too_short",
      guidance: `A peer review must include real, substantive comments (at least ${MIN_REVIEW_NOTES_LENGTH} characters) -- this becomes the permanent record of why the reviewer approved or rejected the work, not a rubber stamp.`,
    }
  }
  if (!reviewDecision || !VALID_REVIEW_DECISIONS.includes(reviewDecision)) {
    return {
      passed: false as const,
      reason: "review_decision_missing_or_invalid",
      guidance: `reviewDecision must be one of: ${VALID_REVIEW_DECISIONS.join(", ")}.`,
    }
  }
  return { passed: true as const }
}

function handoverCheck(context: Record<string, unknown>) {
  const fields: Partial<HandoverFields> = {
    taskStatus: context.taskStatus as string | undefined,
    outputProduced: context.outputProduced as string | undefined,
    validationPassed: context.validationPassed as string | undefined,
    knownRisks: context.knownRisks as string | undefined,
    pendingItems: context.pendingItems as string | undefined,
    confidence: context.confidence as string | undefined,
    nextResponsibleAi: context.nextResponsibleAi as string | undefined,
    requiredAction: context.requiredAction as string | undefined,
    escalationRequired: context.escalationRequired as string | undefined,
  }
  const result = validateHandoverFields(fields)
  if (result.valid) return { passed: true as const }
  return { passed: false as const, reason: result.reason, guidance: result.guidance }
}

let registered = false

// Wave 167 real bug found while reviewing the Handover Protocol PR: CI
// failed 4 unrelated closureReviewCheck tests in this file, not because of
// anything in that PR's own code, but because guardrail-engine.test.ts's
// beforeEach() calls _clearAllGuardrailsForTests() (wiping the shared,
// module-level REGISTRY Map every other test file's guardrails live in),
// while this file's own `registered` guard is a SEPARATE module-level flag
// that clear function has no way to reset. Once any test file has called
// registerAllGuardrails() once, `registered` stays true for the rest of the
// bun test process (all test files share one process/module graph) -- so a
// later clear leaves the registry genuinely empty while this function's
// idempotency guard silently no-ops on every subsequent call, and
// evaluateGuardrails() on an unregistered leaf always passes by design
// ("not rigid" -- see guardrail-engine.ts's header). Adding a new test file
// that also calls registerAllGuardrails() (handover-protocol.test.ts) just
// shifted bun's file-load/interleaving order enough to expose a
// pre-existing fragility, not introduce a new one. Fix: a matching reset
// export, wired into guardrail-engine.test.ts's existing beforeEach so a
// clear always allows the next registerAllGuardrails() call to actually
// re-populate the registry, in this file or any other test file that
// depends on it being populated.
export function _resetRegisteredForTests(): void {
  registered = false
}

export function registerAllGuardrails(): void {
  if (registered) return
  registered = true

  // Both dispatch surfaces (the Next.js /api/ai/team/dispatch endpoint and
  // the standalone ai-workforce-agent.mjs CI script) use the same input
  // shape and the same check -- one guardrail definition, two leaves,
  // because they are two independent entry points into task execution and
  // the Guardrail Engine is keyed per capability-tree leaf, not globally.
  registerGuardrail(AI_TEAM_DISPATCH_LEAF, { phase: "input", check: tightTaskCheck })
  registerGuardrail(AI_WORKFORCE_DISPATCH_LEAF, { phase: "input", check: tightTaskCheck })

  // Customer task free-text LLM planning (task-execution-engine.ts's
  // executeTask(), the branch taken when no resolvedWorkerAgentId/engineKey
  // is set) -- lighter check than tightTaskCheck, see task-tightening.ts's
  // validateTaskBrief() header for why the full TightTask schema isn't
  // appropriate for customer-created tasks.
  registerGuardrail(TASK_FREE_TEXT_PLANNING_LEAF, { phase: "input", check: taskBriefCheck })

  // Infinite Loop Prevention (Guardrail #20) -- "logic" phase, since it's
  // about ongoing execution behavior, not initial input. Registered here so
  // any future pipeline with DB access (unlike ai-workforce-agent.mjs,
  // which calls checkLoopBudget() directly -- see that script's own
  // comment for why it can't route through recordGuardrailViolation) gets
  // a consistent, reusable budget check + CLEE feed for free.
  registerGuardrail(AI_WORKFORCE_LOOP_BUDGET_LEAF, { phase: "logic", check: loopBudgetCheck })

  // Self-Assessment / Peer Review closure gate (Wave 165, U-D12.B4.S3) --
  // "input" phase since it validates the review SUBMISSION itself, before
  // recordPeerReview()'s separate not_found/not_in_review/self_review
  // checks run against the actual activity_log row.
  registerGuardrail(AI_TEAM_CLOSURE_REVIEW_LEAF, { phase: "input", check: closureReviewCheck })

  // Mandatory Structured Handover gate (Wave 167, U-D17.B1.S1) -- "input"
  // phase since it validates the handover SUBMISSION itself, before
  // submitHandover()'s separate not_found check runs against the actual
  // task_agent_executions row (and well before acceptHandover()'s own
  // fail-closed not_found/not_submitted/already_accepted/
  // self_acceptance_not_allowed checks, which run at a later, separate
  // step -- ownership only transfers on that explicit accept call).
  registerGuardrail(HANDOVER_PROTOCOL_LEAF, { phase: "input", check: handoverCheck })
}
