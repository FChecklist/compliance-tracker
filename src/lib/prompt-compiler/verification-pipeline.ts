// VERIDIAN_Architecture_v2.0 phase_2: pipeline-verification (Layer 5,
// Stages 19-25) -- not_implemented in the gap analysis (no verification
// layer existed around prompt_gateway's output at all). Business/workflow/
// capability/permission checks + cost estimation + model selection, wired
// onto real existing mechanisms (llm-client.ts's estimateCostUsd,
// ComplexityTier from task-tightening.ts) rather than new parallel ones.
import { estimateCostUsd } from "@/lib/llm-client"
import { computeConfidence, type ConfidenceInputs } from "./confidence-engine"
import type { AssembledContext, Classification, CompiledPrompt, IntentLevel, ModelSelection, VerificationCheck, VerificationResult } from "./types"

// Same "platform default floor tier" model orchestra-model-resolver.ts
// resolves to by default (Wave 2026-07-10) -- used only as the reference
// model for this stage's cost ESTIMATE, never to actually invoke it (this
// module makes zero LLM calls, per this phase's own "software first"
// design note in prompt-construction.ts).
const DEFAULT_COST_ESTIMATE_MODEL = "openai/gpt-oss-120b"

// Intents whose real-world effect (deleting/deploying/overwriting
// something) warrants a real permission check before execution -- mirrors
// prompt-os-service.ts's own veridian_admin gate for platform-governed
// write operations, rather than inventing a new permission tier.
const SENSITIVE_INTENTS: Record<string, string> = {
  DELETE: "veridian_admin",
  DEPLOY: "veridian_admin",
}

function checkBusinessRules(compiled: CompiledPrompt, analysis: { variables: { defaultValue: string | null; boundElsewhere: boolean }[] }): VerificationCheck {
  const unresolved = analysis.variables.filter((v) => v.defaultValue === null && !v.boundElsewhere)
  return {
    name: "business_rule.variables_resolved",
    passed: unresolved.length === 0,
    detail: unresolved.length === 0 ? "all variables resolved or intentionally bound" : `${unresolved.length} unresolved variable(s)`,
  }
}

function checkWorkflow(context: AssembledContext): VerificationCheck {
  const ok = context.pruneStats.tokensAfter <= context.pruneStats.tokensBefore
  return { name: "workflow.context_assembled", passed: ok, detail: ok ? "context assembled within budget" : "context assembly exceeded its own budget" }
}

function checkCapability(cacheMatchScore: number, compiled: CompiledPrompt, threshold = 0.5): VerificationCheck {
  const matched = compiled.matchedTemplate !== null || cacheMatchScore >= threshold
  return {
    name: "capability.recognized_pattern",
    passed: matched,
    detail: matched ? "matched a known template or a similar prior compiled prompt" : "no template match and no similar prior prompt",
  }
}

function checkPermission(intent: IntentLevel, userRoles: string[]): VerificationCheck {
  const requiredRole = SENSITIVE_INTENTS[intent.primary]
  if (!requiredRole) return { name: "permission.role_check", passed: true, detail: `intent '${intent.primary}' is not permission-gated` }
  const passed = userRoles.includes(requiredRole)
  return {
    name: "permission.role_check",
    passed,
    detail: passed ? `caller holds required role '${requiredRole}'` : `intent '${intent.primary}' requires role '${requiredRole}', caller has none`,
  }
}

/**
 * Deterministic complexity-tier estimate for this compiled prompt --
 * reuses ComplexityTier's own three-tier vocabulary (task-tightening.ts)
 * rather than inventing a fourth taxonomy. This is NOT the real
 * provider/model resolution (that stays Gateway G05 / mother-router.ts's
 * resolveModel(), untouched by this phase) -- it is the signal a caller
 * hands to that resolver.
 */
export function selectModelTier(classification: Classification, intent: IntentLevel): ModelSelection {
  if (SENSITIVE_INTENTS[intent.primary]) {
    return { complexityTier: "judgment", reason: `intent '${intent.primary}' is permission-gated -- treat as judgment-tier` }
  }
  if (classification.category === "CODE" || classification.category === "OPS") {
    return { complexityTier: "integrative", reason: `category '${classification.category}' typically spans multiple files/systems` }
  }
  return { complexityTier: "mechanical", reason: `category '${classification.category}' is a single well-defined operation` }
}

export type VerificationInputs = {
  analysis: { variables: { defaultValue: string | null; boundElsewhere: boolean }[] }
  classification: Classification
  intent: IntentLevel
  context: AssembledContext
  compiled: CompiledPrompt
  cacheMatchScore: number
  modelReady: boolean
  userRoles: string[]
}

/**
 * Layer 5 orchestrator: runs every verification check, the multi-signal
 * confidence composite (confidence-engine.ts), a cost estimate (reusing
 * llm-client.ts's estimateCostUsd against a rough token-count heuristic
 * derived from the compiled prompt -- not a real LLM call), and the
 * deterministic model-tier selection above. Pure, no I/O.
 */
export function verify(inputs: VerificationInputs): VerificationResult {
  const checks = [
    checkBusinessRules(inputs.compiled, inputs.analysis),
    checkWorkflow(inputs.context),
    checkCapability(inputs.cacheMatchScore, inputs.compiled),
    checkPermission(inputs.intent, inputs.userRoles),
  ]

  const confidenceInputs: ConfidenceInputs = {
    classification: inputs.classification,
    intent: inputs.intent,
    context: inputs.context,
    cacheMatchScore: inputs.cacheMatchScore,
    modelReady: inputs.modelReady,
  }
  const confidence = computeConfidence(confidenceInputs)

  // Rough heuristic: machine-prompt token count as the "prompt" side,
  // doubled as a stand-in "completion" estimate (this stage never calls an
  // LLM to find out the real completion length) -- an ESTIMATE for
  // pre-execution budget checks, not a billing figure.
  const promptTokens = inputs.compiled.tokenReduction.estimatedMachineTokens
  const estimatedCostUsd = estimateCostUsd(DEFAULT_COST_ESTIMATE_MODEL, { promptTokens, completionTokens: promptTokens * 2 })

  return {
    confidence,
    checks,
    allPassed: checks.every((c) => c.passed),
    estimatedCostUsd,
    modelSelection: selectModelTier(inputs.classification, inputs.intent),
  }
}
