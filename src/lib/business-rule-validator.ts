// VERIDIAN Review Framework gap-closure ("Business Rule Validation Before
// Execution"): wires guardrail-engine.ts (Wave 157's already-existing
// generic, deterministic rule engine) as a genuine PRE-EXECUTION gate for
// VCEL calculation dispatch -- the missing half of dispatch-output-
// validator.ts's POST-execution sanity check. That file only catches a
// NaN/Infinity RESULT after a calculation already ran; this catches an
// INPUT that violates a known business rule before the calculation runs at
// all (e.g. a GST rate typed as a whole fraction instead of a percentage,
// or a loan tenure entered in days instead of months).
//
// Same "opt-in, empty by default" posture as guardrail-engine.ts itself:
// dispatchEngine()/dispatchTool() (task-execution-engine.ts) call this
// unconditionally for every engineKey/codeReference, but an unregistered
// key always passes (see guardrail-engine.ts's own evaluateGuardrails()
// header) -- so wiring this in is safe for the ~100 engines that don't need
// a business-rule gate, and real for the financially material ones
// registered in guardrail-registrations.ts (GST rate bounds, EMI/loan
// bounds, gratuity/commission bounds).
import { evaluateGuardrails } from "@/lib/guardrail-engine"

export class BusinessRuleViolationError extends Error {}

/**
 * Throws BusinessRuleViolationError if any guardrail registered for this
 * leaf key at the "process" phase rejects `inputs`. A no-op (never throws)
 * for any leaf key with no registered rules -- see guardrail-engine.ts.
 */
export function assertBusinessRulesBeforeExecution(leafKey: string, inputs: Record<string, unknown>): void {
  const result = evaluateGuardrails(leafKey, "process", inputs)
  if (!result.passed) {
    throw new BusinessRuleViolationError(`${result.reason} -- ${result.guidance}`)
  }
}
