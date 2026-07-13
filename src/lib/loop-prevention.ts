// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md §7 / Guardrail #20 (Loop
// Prevention): generalizes ai-workforce-agent.mjs's MAX_ITERATIONS pattern
// -- previously a bespoke local constant with no shared definition of what
// "budget exhausted" means or how to report it -- into a reusable,
// registerable check any pipeline can adopt via guardrail-engine.ts's
// "logic" phase, instead of every pipeline reinventing its own iteration
// cap and its own ad-hoc "stopped after N iterations" message.
//
// Deliberately scoped to iteration/retry budgets only -- the Constitution's
// broader Infinite Loop Prevention section also names duplicate-task
// detection and circular-dependency detection, which need a real task
// graph to check against. That graph doesn't exist yet (see the deferred
// "universal Task wrapper" design work); adding a fake detector with
// nothing real to detect against would be worse than naming the gap
// honestly. This module covers the one form of loop prevention this
// codebase already has real, working precedent for.
//
// GAP-UNIFIED-SOT-REMAINDER (c), 2026-07-13: `shouldPromptSelfCheck()`
// below is an additive sibling, not a loop-prevention check -- it answers
// a different question ("is it time to re-surface ai-os/SELF-CHECK.md's
// standing questions") from checkLoopBudget's ("has the iteration budget
// run out"). Grouped in this file because it is the same shape (pure,
// deterministic, no DB, no LLM) and the same constitutional section (§7)
// covers both as forms of keeping a long-running loop honest to itself.
// See VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md's "Mid-Session Self-Check"
// section for what this does and does not guarantee.

export type LoopBudgetContext = {
  iteration: number
  maxIterations: number
}

export type LoopBudgetResult =
  | { passed: true }
  | { passed: false; reason: string; guidance: string }

/**
 * Deterministic check: has this iteration count exhausted the budget?
 * No LLM call, matching every other gate in this codebase. Pass this
 * directly as a guardrail-engine.ts `check` function, or call it standalone
 * from a context (like ai-workforce-agent.mjs) that has no DB access to
 * register through the Guardrail Engine's CLEE-feeding path.
 */
export function checkLoopBudget(context: LoopBudgetContext): LoopBudgetResult {
  if (context.iteration < context.maxIterations) return { passed: true }
  return {
    passed: false,
    reason: `Iteration budget exhausted (${context.iteration}/${context.maxIterations}) without completing.`,
    guidance: "This usually means the task's scope was too broad for one dispatch. It may help to split it into smaller, more tightly scoped tasks (see task-tightening.ts's Scope field), or you can raise the budget deliberately if the task is genuinely large and that's expected.",
  }
}

/**
 * Deterministic cadence check: is this the iteration a caller should
 * re-surface ai-os/SELF-CHECK.md's standing questions? Pure boolean, no
 * DB, no LLM, same discipline as checkLoopBudget above -- this function
 * only answers "is it time," it does not read the file, format a prompt,
 * or know anything about SELF-CHECK.md's content. Callers (e.g.
 * ai-workforce-agent.mjs) decide what to do with a `true` result.
 *
 * Does not fire at iteration 0 -- a fresh dispatch already gets
 * fetchGovernancePreamble()'s CLAUDE.md/AGENTS.md content prepended once;
 * firing this on the very first iteration too would be redundant with
 * that, not an additional signal. Fires on every exact multiple of
 * `everyN` after that (everyN, 2*everyN, ...). `everyN <= 0` is treated as
 * "never prompt" rather than throwing on a caller-computed value of 0 --
 * consistent with checkLoopBudget never throwing on its inputs either.
 */
export function shouldPromptSelfCheck(iteration: number, everyN: number): boolean {
  if (everyN <= 0) return false
  return iteration > 0 && iteration % everyN === 0
}
