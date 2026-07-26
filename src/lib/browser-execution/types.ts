// VERIDIAN_Architecture_v2.0 phase_5_browser_execution_tiers (2026-07-26):
// shared types for the tiered Browser Execution Engine (NPU -> Built-in AI
// -> Lite LLM -> Transformers.js -> Server, each with real fallback).
// "deterministic" is a 6th, always-attempted-first pseudo-tier: phase_2's
// runPipeline() compiler (src/lib/prompt-compiler/pipeline.ts) is a pure,
// zero-ML, zero-cost pass that produces a real machine-language output for
// every request with no AI tier involved at all -- the concrete
// realization of registries.credit_spend_governance's "software first, AI
// second" rule. The 4 on-device AI tiers only run when that deterministic
// pass reports low confidence; "server" means the browser hands off its
// best-effort machine-language output to the existing server dispatch
// path (task-service.ts), which still only escalates to Gateway G05
// (Tier-5, llm-client.ts) if that specific request needs it -- never a new
// mandatory AI hop.
export type BrowserExecutionTierName = "deterministic" | "npu" | "builtin-ai" | "lite-llm" | "transformers" | "server"

export type TierCapability = {
  tier: BrowserExecutionTierName
  available: boolean
  reason: string
}

export type BrowserCapabilityReport = {
  npu: TierCapability
  builtinAi: TierCapability
  webgpu: TierCapability
  liteLlm: TierCapability
  transformers: TierCapability
  server: TierCapability
  detectedAt: number
}

export type TierAttempt = {
  tier: BrowserExecutionTierName
  attempted: boolean
  succeeded: boolean
  ms: number
  detail: string
}

export type BrowserExecutionOutcome = {
  machinePrompt: string
  contentHash: string
  fingerprint: string
  complexityTier: "mechanical" | "integrative" | "judgment"
  tierUsed: BrowserExecutionTierName
  attempts: TierAttempt[]
  cacheHit: boolean
  totalMs: number
}
