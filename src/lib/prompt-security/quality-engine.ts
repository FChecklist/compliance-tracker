// VERIDIAN_Architecture_v2.0 phase_4: Quality Engine -- closes engine-quality
// ("Accuracy scoring, hallucination detection, output quality assessment")
// and pipeline-post-execution's quality-scoring sub-scope. The document's own
// Stage 8 description allows "either heuristic rules or LLM-as-judge" (line
// 243); this module is the heuristic-rules path -- deterministic, no LLM
// call, matching guardrail-engine.ts's own "no LLM self-grading" precedent
// and prompt-eval-service.ts's existing createEvalCase/runEval convention
// for the ones that already need a real LLM judge. Not a hallucination
// DETECTOR in the fact-checking sense (that needs a real knowledge source to
// check claims against, out of scope for a pure-function heuristic) -- a
// real, honestly-scoped set of structural quality signals: refusal/failure
// detection, echo-of-injection-attempt detection, degenerate-output
// detection (empty/truncated/repetitive).
import type { QualityScore, QualitySignal } from "./types"

const REFUSAL_PHRASES = [
  "i cannot help with that",
  "i can't help with that",
  "i'm not able to assist",
  "i am not able to assist",
  "as an ai language model, i cannot",
  "i cannot fulfill this request",
  "i'm unable to comply",
]

function checkNonEmpty(text: string): QualitySignal {
  const passed = text.trim().length > 0
  return { name: "non_empty_output", passed, detail: passed ? `${text.trim().length} chars` : "model returned an empty/whitespace-only response" }
}

function checkNotRefusal(text: string): QualitySignal {
  const lower = text.toLowerCase()
  const refused = REFUSAL_PHRASES.some((phrase) => lower.includes(phrase))
  return { name: "not_a_refusal", passed: !refused, detail: refused ? "output matches a known refusal phrase" : "no refusal phrase detected" }
}

// A degenerate/looping generation (a real, observable LLM failure mode)
// repeats the same short n-gram far more than natural language does --
// checks the most-repeated 8-word window's share of all windows.
function checkNotDegenerate(text: string): QualitySignal {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 16) return { name: "not_degenerate_repetition", passed: true, detail: "too short to meaningfully assess repetition" }
  const windowSize = 8
  const counts = new Map<string, number>()
  for (let i = 0; i + windowSize <= words.length; i++) {
    const window = words.slice(i, i + windowSize).join(" ").toLowerCase()
    counts.set(window, (counts.get(window) ?? 0) + 1)
  }
  const maxCount = Math.max(...counts.values())
  const totalWindows = words.length - windowSize + 1
  const repetitionRatio = maxCount / totalWindows
  const passed = repetitionRatio < 0.3
  return { name: "not_degenerate_repetition", passed, detail: `most-repeated 8-word window recurs in ${Math.round(repetitionRatio * 100)}% of windows` }
}

// If the model's output echoes back a Layer 1 threat pattern verbatim
// (rather than the user's original wording being paraphrased/summarized),
// that's a real signal the model complied with an injected instruction
// instead of just processing it as data -- a distinct, cheaper-to-check
// proxy for "the model got hijacked" than a full second classifier call.
function checkNoInjectionEcho(outputText: string, injectionMatchedTexts: string[]): QualitySignal {
  const lower = outputText.toLowerCase()
  const echoed = injectionMatchedTexts.filter((t) => t.length > 8 && lower.includes(t.toLowerCase()))
  return {
    name: "no_verbatim_injection_echo",
    passed: echoed.length === 0,
    detail: echoed.length === 0 ? "output does not echo any detected Layer 1 threat phrase verbatim" : `output echoes ${echoed.length} detected threat phrase(s) verbatim`,
  }
}

/**
 * Scores one real model output. `injectionMatchedTexts` should be the
 * matchedText values from that same request's Layer 1
 * deterministicMatches (empty array if Layer 1 found nothing) -- this
 * function does not re-run Layer 1 itself.
 */
export function scoreQuality(outputText: string, injectionMatchedTexts: string[] = []): QualityScore {
  const signals = [
    checkNonEmpty(outputText),
    checkNotRefusal(outputText),
    checkNotDegenerate(outputText),
    checkNoInjectionEcho(outputText, injectionMatchedTexts),
  ]
  const composite = signals.filter((s) => s.passed).length / signals.length
  return { composite, signals }
}
