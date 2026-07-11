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
import { validateTightTask, type TightTask } from "./task-tightening"

export const AI_TEAM_DISPATCH_LEAF = "ai_team.dispatch"
export const AI_WORKFORCE_DISPATCH_LEAF = "ai_workforce.dispatch"

function tightTaskCheck(context: Record<string, unknown>) {
  const task: Partial<TightTask> = {
    objective: context.objective as string | undefined,
    scope: context.scope as string | undefined,
    successCriteria: context.successCriteria as string | undefined,
    constraints: context.constraints as string | undefined,
  }
  const result = validateTightTask(task)
  if (result.valid) return { passed: true as const }
  return { passed: false as const, reason: result.reason, guidance: result.guidance }
}

let registered = false

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
}
