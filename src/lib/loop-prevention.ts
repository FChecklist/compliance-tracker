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
    guidance: "This usually means the task's scope was too broad for one dispatch -- split it into smaller, more tightly scoped tasks (see task-tightening.ts's Scope field), or raise the budget deliberately if the task is genuinely large and that's expected.",
  }
}
