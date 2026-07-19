// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md §7 / Guardrail #20 (Loop
// Prevention): generalizes ai-workforce-agent.mjs's MAX_ITERATIONS pattern
// -- previously a bespoke local constant with no shared definition of what
// "budget exhausted" means or how to report it -- into a reusable,
// registerable check any pipeline can adopt via guardrail-engine.ts's
// "logic" phase, instead of every pipeline reinventing its own iteration
// cap and its own ad-hoc "stopped after N iterations" message.
//
// Originally scoped to iteration/retry budgets only -- the Constitution's
// broader Infinite Loop Prevention section also named duplicate-task
// detection and circular-dependency detection, which needed a real task
// graph to check against that didn't exist yet (see the deferred "universal
// Task wrapper" design work). GP-20 Phase 2 (below, wouldCreateCycle())
// closes that half: a real task-dependency-graph cycle detector, wired into
// the one real call site in this codebase where one task's processing
// spawns and dispatches a second, distinct task record
// (crm-service.ts's createChainedTask()) via task-dependency-graph.ts's
// recordTaskEscalationEdge(). See wouldCreateCycle()'s own doc comment for
// the full reasoning and its honest scope limitation.
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

// GP-20 Phase 2 (CONSTITUTION.yaml guardrail_protocols): the gap this
// file's own header named above -- "duplicate-task detection and
// circular-dependency detection, which need a real task graph to check
// against. That graph doesn't exist yet" -- is closed by this function plus
// task-dependency-graph.ts's recordTaskEscalationEdge() (the DB-touching
// wrapper that stores edges in entity_relationships and calls this pure
// check before persisting a new one).
//
// Real edge source: crm-service.ts's createChainedTask() (Wave 78,
// "Multi-Agent Chaining") is the one place in this codebase where one
// task's processing (a lead/opportunity's AI-recommended follow-up) creates
// AND EXECUTES a second, distinct `tasks` row via this file's sibling
// module task-execution-engine.ts's own executeTask() -- the literal
// "Task A dispatches to Task B" the Constitution's gap note describes.
// Honest limitation: that one caller always inserts a brand-new task row as
// its `toTaskId`, so a fresh id can never already have outbound edges back
// to an ancestor -- this specific caller structurally cannot itself land in
// the cycle-refusal branch. wouldCreateCycle() is still the correct,
// general chokepoint: it takes arbitrary (fromTaskId, toTaskId) pairs, not
// just fresh inserts, so any future dispatch surface that CAN target an
// existing task (not just insert a new one) reuses the exact same check
// rather than every caller reinventing its own graph walk -- matching this
// file's own established "reusable, registerable check any pipeline can
// adopt" design for checkLoopBudget above.
//
// Same testing posture as escalation-ladder.ts's evaluateEscalationClaim():
// this pure predicate is unit-tested directly; the DB wrapper around it is
// not (see that file's own doc comment for why).
export type TaskEscalationEdge = {
  fromTaskId: string
  toTaskId: string
}

/**
 * Pure DFS reachability check: would adding a new fromTaskId -> toTaskId
 * edge to the given existing edge set create a cycle? True exactly when
 * toTaskId can already (directly or transitively) reach fromTaskId -- i.e.
 * fromTaskId is already a descendant of toTaskId, so the new edge would
 * close a loop back to it. A self-loop (fromTaskId === toTaskId) is always
 * a cycle, checked without walking the graph.
 */
export function wouldCreateCycle(edges: readonly TaskEscalationEdge[], fromTaskId: string, toTaskId: string): boolean {
  if (fromTaskId === toTaskId) return true

  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = adjacency.get(edge.fromTaskId)
    if (targets) targets.push(edge.toTaskId)
    else adjacency.set(edge.fromTaskId, [edge.toTaskId])
  }

  const visited = new Set<string>()
  const stack = [toTaskId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === fromTaskId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) stack.push(next)
  }
  return false
}
