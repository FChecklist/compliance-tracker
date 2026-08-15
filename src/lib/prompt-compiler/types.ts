// VERIDIAN_Architecture_v2.0 phase_2 (2026-07-25): shared types for the
// Prompt Compiler Pipeline (Layers 2-5) + Intelligence/Matching engines.
// Ports scripts/prompt_gateway/engine/{classifier,prompt_engine,
// context_engine}.py's real algorithms into compliance-tracker's own
// application code -- see each sibling file's header for which gap-analysis
// engine/pipeline item it deepens or closes.

export const CHAT_CATEGORIES = ["CODE", "ANALYSIS", "OPS", "QUERY", "TASK", "GENERAL"] as const
export type ChatCategory = (typeof CHAT_CATEGORIES)[number]

export type Classification = {
  category: ChatCategory
  confidence: number
  scores: Record<string, number>
  keywordsFound: string[]
  patternsMatched: string[]
}

// engine-intent, deepened to multi-level (primary/secondary/implicit) --
// classifier.py's own extract_intent() is single-level (one action-verb
// match). Primary = the action-verb intent, secondary = a second, weaker
// action-verb signal found later in the text (a compound instruction),
// implicit = a signal not stated as a verb at all (e.g. a bare question
// with no action verb implies QUERY; an entity-only sentence implies
// TASK/reference).
export type IntentLevel = {
  primary: string
  secondary: string | null
  implicit: string | null
}

export const ENTITY_TYPES = [
  "FILE_PATH", "URL", "CODE_REF", "MEASUREMENT", "VERSION",
  // Domain-specific additions (compliance-tracker's own domain, not in
  // classifier.py's chat-generic set) -- engine-entity's own requirement
  // text explicitly calls for "domain-specific entity types".
  "DEADLINE_DATE", "MONEY_AMOUNT", "REGULATION_REF", "EMAIL",
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export type Entity = { type: EntityType; value: string }

// engine-variable: a `{{token}}` placeholder (the same convention
// prompt-eval-service.ts's renderTemplate() already substitutes into), with
// a type inferred from naming/context and an optional resolved default.
export type VariableType = "string" | "number" | "date" | "boolean" | "unknown"

export type PromptVariable = {
  name: string
  inferredType: VariableType
  defaultValue: string | null
  // true if this variable's name also appears as plain text elsewhere in
  // the prompt (a signal it was meant to be a literal, not a binding) --
  // surfaced so a caller can flag likely-mistaken variable usage.
  boundElsewhere: boolean
}

export type LightweightAnalysis = {
  originalText: string
  classification: Classification
  intent: IntentLevel
  entities: Entity[]
  variables: PromptVariable[]
  wordCount: number
  charCount: number
  estimatedTokens: number
}

export type ContextMessage = { role: string; content: string; id: string }

export type BusinessContext = {
  orgId: string | null
  orgName: string | null
  // e.g. "IN" | "AE" -- reuses whatever the caller's own org-country
  // config already resolved; this module never re-derives it.
  country: string | null
}

export type UserContext = {
  userId: string
  displayName: string | null
  roles: string[]
}

export type AssembledContext = {
  business: BusinessContext
  user: UserContext
  sessionMessages: ContextMessage[]
  pruneStats: {
    messagesBefore: number
    messagesAfter: number
    tokensBefore: number
    tokensAfter: number
    reductionPct: number
  }
  hydratedTemplate: string | null
}

export type CompiledPrompt = {
  cleanedText: string
  machinePrompt: string
  contentHash: string
  fingerprint: string
  noiseReductionPct: number
  tokenReduction: {
    estimatedOriginalTokens: number
    estimatedMachineTokens: number
    reductionPct: number
  }
  matchedTemplate: string | null
}

export type ConfidenceSignal = { name: string; weight: number; value: number }

export type ConfidenceBreakdown = {
  composite: number
  signals: ConfidenceSignal[]
}

export type VerificationCheck = { name: string; passed: boolean; detail: string }

export type ModelSelection = {
  complexityTier: "mechanical" | "integrative" | "judgment"
  reason: string
}

export type VerificationResult = {
  confidence: ConfidenceBreakdown
  checks: VerificationCheck[]
  allPassed: boolean
  estimatedCostUsd: number | null
  modelSelection: ModelSelection
}

export type PipelineStageTiming = { stage: string; durationMs: number; budgetMs: number; withinBudget: boolean }

export type PipelineResult = {
  analysis: LightweightAnalysis
  context: AssembledContext
  compiled: CompiledPrompt
  verification: VerificationResult
  timings: PipelineStageTiming[]
}
