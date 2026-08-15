// VERIDIAN_Architecture_v2.0 phase_2: engine-confidence, deepened to
// multi-signal. classifier.py's own confidence is a single keyword-ratio
// float; this composite combines that with three real signals the gap
// analysis names explicitly (cache match, intent clarity, model readiness)
// plus context completeness (needed once context assembly became
// multi-source in this phase). Pure function -- callers resolve each raw
// signal (a DB-backed cache lookup, an env-var-backed API-key check, etc.)
// before calling this; the weighting/combination logic itself has zero I/O.
import type { AssembledContext, Classification, ConfidenceBreakdown, IntentLevel } from "./types"

export type ConfidenceInputs = {
  classification: Classification
  intent: IntentLevel
  context: AssembledContext
  // 0 when no semantic-cache hit was found (findSemanticCacheHit()
  // returned null); the match's own score otherwise.
  cacheMatchScore: number
  // true when a platform API key is configured for the provider this
  // request would route to (orchestra-model-resolver.ts's
  // platformApiKeyFor) -- resolved by the caller, not this module.
  modelReady: boolean
}

const WEIGHTS = {
  intentClarity: 0.35,
  cacheMatch: 0.25,
  contextCompleteness: 0.2,
  modelReadiness: 0.2,
}

function intentClarityScore(classification: Classification, intent: IntentLevel): number {
  // classifier.py's own confidence float already captures keyword-ratio
  // clarity; a resolved (non-UNKNOWN) primary intent is a second, distinct
  // clarity signal -- average the two rather than trusting either alone.
  const intentResolved = intent.primary !== "UNKNOWN" ? 1 : 0
  return Math.min(1, (classification.confidence + intentResolved) / 2)
}

function contextCompletenessScore(context: AssembledContext): number {
  let present = 0
  const total = 3
  if (context.business.orgId) present++
  if (context.user.userId) present++
  if (context.sessionMessages.length > 0) present++
  return present / total
}

/**
 * Multi-signal confidence composite -- engine-confidence's own requirement
 * text: "combining cache match, intent clarity, model readiness" (context
 * completeness added since this phase made context assembly multi-source).
 * Weighted sum, each signal already normalized to [0,1].
 */
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceBreakdown {
  const signals = [
    { name: "intent_clarity", weight: WEIGHTS.intentClarity, value: intentClarityScore(inputs.classification, inputs.intent) },
    { name: "cache_match", weight: WEIGHTS.cacheMatch, value: Math.max(0, Math.min(1, inputs.cacheMatchScore)) },
    { name: "context_completeness", weight: WEIGHTS.contextCompleteness, value: contextCompletenessScore(inputs.context) },
    { name: "model_readiness", weight: WEIGHTS.modelReadiness, value: inputs.modelReady ? 1 : 0 },
  ]
  const composite = signals.reduce((sum, s) => sum + s.weight * s.value, 0)
  return { composite: Math.round(composite * 10000) / 10000, signals }
}
