// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-optimizer (not_implemented
// -- prompt_gateway's noise-reduction was a fixed regex-strip, no metric-
// guided loop) + engine-prompt-expansion (not_implemented -- prompt_gateway
// is one-directional, compress-only). Both operate on the output of
// prompt-construction.ts's buildCompiledPrompt().
import type { CompiledPrompt, PromptVariable } from "./types"

export type QualitySignal = { passRate: number; sampleSize: number }

/**
 * engine-prompt-optimizer: further token reduction, GATED by a real quality
 * signal rather than applied unconditionally -- "metric-guided" per the gap
 * analysis' own requirement text, as opposed to prompt_gateway's fixed,
 * ungated regex-strip. Callers pass in the template's real pass-rate
 * (compliance.prompt_eval_runs' own `passed` column, aggregated by
 * whichever service already queries it -- this module has no DB access of
 * its own). Below MIN_SAFE_PASS_RATE, optimization is skipped entirely
 * rather than risking a token cut that a low-quality prompt can't absorb.
 */
const MIN_SAFE_PASS_RATE = 0.8
const MIN_SAMPLE_SIZE = 3

export function isSafeToOptimize(signal: QualitySignal | null): boolean {
  if (!signal) return false // no eval history yet -- do not optimize blind
  if (signal.sampleSize < MIN_SAMPLE_SIZE) return false
  return signal.passRate >= MIN_SAFE_PASS_RATE
}

// Segments of a compressed machine_prompt (CATEGORY:INTENT:term_term_term)
// that are safe to drop under further optimization: repeated/generic filler
// terms that don't change meaning. Distinct from prompt-normalizer.ts's
// FILLER_PHRASES (those operate on natural-language input; these operate on
// already-compressed machine-prompt terms).
const GENERIC_TERMS = new Set(["the", "a", "an", "it", "this", "that", "thing", "stuff"])

/**
 * Drops generic filler terms from an already-compressed machine_prompt's
 * term list, IF isSafeToOptimize() says the quality signal supports it.
 * Never runs on the category/intent prefix -- only the term tail.
 */
export function optimizeMachinePrompt(compiled: CompiledPrompt, qualitySignal: QualitySignal | null): { machinePrompt: string; wasOptimized: boolean; termsDropped: number } {
  if (!isSafeToOptimize(qualitySignal)) return { machinePrompt: compiled.machinePrompt, wasOptimized: false, termsDropped: 0 }

  const parts = compiled.machinePrompt.split(":")
  if (parts.length < 3) return { machinePrompt: compiled.machinePrompt, wasOptimized: false, termsDropped: 0 }

  const [category, intent, ...termParts] = parts
  const terms = termParts.join(":").split("_").filter(Boolean)
  const kept = terms.filter((t) => !GENERIC_TERMS.has(t.toLowerCase()))
  const termsDropped = terms.length - kept.length

  if (termsDropped === 0) return { machinePrompt: compiled.machinePrompt, wasOptimized: false, termsDropped: 0 }
  return { machinePrompt: `${category}:${intent}:${kept.join("_")}`, wasOptimized: true, termsDropped }
}

const CATEGORY_EXPANSION_VERB: Record<string, string> = {
  CODE_GEN: "Write a",
  CODE_FIX: "Fix",
  CODE_ADD: "Add",
  ANALYZE: "Analyze",
  COMPARE: "Compare",
  REVIEW: "Review",
  QUERY: "Answer the question:",
  LOOKUP: "Find",
  OPS: "Set up",
  EXPLAIN: "Explain",
  TASK: "Create a task:",
}

/**
 * engine-prompt-expansion: the inverse of compression -- hydrate a
 * compressed machine_prompt (CATEGORY_ACTION:arg1:arg2 shape, prompt_engine.py
 * template-matched output) back into a readable natural-language
 * instruction, restoring known variable defaults along the way. Genuinely
 * new (prompt_gateway never had an expansion direction at all), so this is
 * a best-effort reconstruction, not a lossless inverse -- the exact
 * original wording is never recoverable from a compressed form by design
 * (that's the whole point of compression).
 */
export function expandMachinePrompt(machinePrompt: string, variables: PromptVariable[] = []): string {
  // Variable substitution runs BEFORE the underscore->space rewrite below,
  // since a compressed term like "pr_number" only matches a variable named
  // `pr_number` while its underscores are still intact.
  let withVars = machinePrompt
  for (const v of variables) {
    if (v.defaultValue) withVars = withVars.replace(new RegExp(`\\b${v.name}\\b`, "gi"), v.defaultValue)
  }

  const [action, ...rest] = withVars.split(":")
  const verb = CATEGORY_EXPANSION_VERB[action]
  const body = rest.join(":").replace(/_/g, " ").trim()

  if (!verb) {
    // Fallback shape from compressToMachinePrompt(): CATEGORY:INTENT:term_term
    const [category, intent, ...terms] = withVars.split(":")
    const words = terms.join(":").replace(/_/g, " ").trim()
    return [intent && intent !== "UNKNOWN" ? intent.toLowerCase() : null, words || null, category ? `(${category.toLowerCase()})` : null]
      .filter(Boolean)
      .join(" ")
  }

  return `${verb} ${body}`.trim()
}
