// Wave (VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, "Objective/Scope/
// Instruction Validation Guardrails"): a structured, mandatory task
// envelope for every task dispatched to an AI Workforce role, replacing a
// single free-text string.
//
// Why this exists, concretely (not hypothetically): every real "AI agent
// missed part of the task" incident this session's own history recorded
// was a loose free-text brief -- ai-workforce-agent.mjs's z.ai dispatches
// twice ran the full MAX_ITERATIONS budget without ever calling `finish`
// because the brief had no explicit file cap or completion definition
// (see ai-workforce-agent.mjs's own MAX_ITERATIONS comment, and
// veridian_docx_constitution_study memory's "Round 2"/"Phase 2 audit"
// entries). Both times the fix was the same: redispatch with an explicit
// scope cap and an explicit definition of done -- "the tightened-brief
// pattern is now the standard fix." This module makes that fix structural
// instead of something a human/AI has to remember to do each time: a task
// without an objective, a bounded scope, and success criteria is rejected
// before it ever reaches a model, matching the Constitution's Objective
// Guardrail (#4), Scope Guardrail (#3), and Instruction Validation
// Guardrail (#5).
//
// Deterministic only -- no LLM call, matching every other gate in this
// codebase (policy-enforcement-engine.ts, high-impact-action-detector.ts,
// guardrail-engine.ts). This does not judge whether a task is a GOOD
// idea, only whether it is specified completely enough to attempt.

export type TightTask = {
  objective: string
  scope: string
  successCriteria: string
  /** Optional: iteration/file/time caps, explicit exclusions, etc. */
  constraints?: string
}

export type TightTaskValidation =
  | { valid: true }
  | { valid: false; reason: string; guidance: string }

const MIN_FIELD_LENGTH = 10

// Real placeholder text seen in practice (copy-pasted templates, "fill me
// in later" stubs) -- rejected even though it technically clears the
// length bar, so the guardrail can't be satisfied by padding a field with
// filler.
const PLACEHOLDER_PATTERNS = [
  /^(tbd|todo|n\/?a|none|null|undefined|xxx+|\.\.\.|fill.?in|same as (above|objective|scope))$/i,
  /^\s*$/,
]

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim()
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed))
}

function checkField(value: string | undefined, label: string, guidanceExample: string): TightTaskValidation | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Add a ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  if (isPlaceholder(trimmed)) {
    return { valid: false, reason: `${label} is a placeholder, not a real value ("${trimmed}").`, guidance: `Replace it with the actual ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return { valid: false, reason: `${label} is too short to be actionable ("${trimmed}").`, guidance: `Be specific -- name the concrete file/behavior/outcome, not just a category. Example: "${guidanceExample}"` }
  }
  return null
}

/**
 * Validates that a task carries enough structure to be dispatched safely.
 * Rejects tasks missing an objective, a bounded scope, or a definition of
 * done -- the exact three properties whose absence caused real dispatch
 * failures in this codebase's history (see module header).
 */
export function validateTightTask(task: Partial<TightTask>): TightTaskValidation {
  const objectiveFailure = checkField(task.objective, "Objective", "Add real PDF/Excel export to the reports dashboard")
  if (objectiveFailure) return objectiveFailure

  const scopeFailure = checkField(task.scope, "Scope", "Only src/app/(app)/reports/page.tsx and package.json -- no other report surface")
  if (scopeFailure) return scopeFailure

  const successFailure = checkField(task.successCriteria, "Success criteria", "Both export buttons produce a file matching the existing CSV export's columns; typecheck and lint pass")
  if (successFailure) return successFailure

  return { valid: true }
}

// Wave 159 (VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, "Customer Task
// Governance" gap closure): the customer-facing `tasks` table has only
// `title`/`description` -- a human creating "Follow up with vendor X" is a
// completely normal, complete task, so requiring the full
// objective/scope/successCriteria TightTask schema at *creation* would
// break real product usage for zero benefit (a human doesn't run out of
// iteration budget the way an unattended AI dispatch does). The real,
// narrower risk is task-execution-engine.ts's free-text LLM-planning path
// (executeTask() when no resolvedWorkerAgentId/engineKey is set) --
// exactly the moment a task's title+description alone drives an
// unattended LLM to invent a plan, the same failure shape as an
// under-specified AI-dispatch brief. validateTaskBrief() is a lighter,
// purpose-fit check for that one entry point, not the full TightTask
// schema forced onto every task a human creates.
export type TaskBrief = { title: string; description?: string | null }

// Deliberately conservative -- this gates a live, real customer product
// with real short task titles ("Follow up", "Call vendor") that must keep
// working. Unlike the AI-dispatch TightTask checks above (which had zero
// production callers to regress), a threshold tuned to "looks incomplete
// to me" without real usage data risks blocking legitimate tasks. This
// catches only the genuinely degenerate case -- empty/near-empty/
// placeholder titles -- not "short but real."
const MIN_PLANNABLE_LENGTH = 4

export function validateTaskBrief(brief: TaskBrief): TightTaskValidation {
  const title = (brief.title ?? "").trim()
  if (!title) {
    return { valid: false, reason: "Task has no title.", guidance: "Add a title before this can be planned." }
  }
  if (isPlaceholder(title)) {
    return { valid: false, reason: `Task title is a placeholder ("${title}"), not real.`, guidance: "Replace the title with what actually needs to happen." }
  }
  if (title.length < MIN_PLANNABLE_LENGTH) {
    return {
      valid: false,
      reason: `Task title ("${title}") is too short for an AI to plan reliably.`,
      guidance: "Add a few more words describing what should happen, or assign the task directly instead of relying on AI planning.",
    }
  }
  return { valid: true }
}

/**
 * Renders a validated TightTask into the text actually sent to a model.
 * Every field is labeled explicitly so the model (and any human reading
 * the dispatch log) sees the same structure the guardrail enforced --
 * this is the "Every Task MUST contain" schema's Input section, narrowed
 * to the fields this codebase can realistically populate and check today.
 */
export function assembleTightTaskPrompt(task: TightTask): string {
  const lines = [
    `Objective: ${task.objective.trim()}`,
    `Scope: ${task.scope.trim()}`,
    `Success Criteria (definition of done -- call finish once these are met): ${task.successCriteria.trim()}`,
  ]
  if (task.constraints?.trim()) {
    lines.push(`Constraints: ${task.constraints.trim()}`)
  }
  lines.push(
    "If any of the above is ambiguous or you find you need to go outside the stated scope, stop and say so in `finish` rather than guessing or silently expanding scope."
  )
  return lines.join("\n")
}
