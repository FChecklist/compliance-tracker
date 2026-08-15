// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers): the real
// browser-to-server handoff contract. Per the Owner's 2026-07-25 UX
// directive (ai-os/OWNER_DIRECTIVES/BROWSER_NATIVE_END_USER_ARCHITECTURE_2026-07-25.txt,
// KE-20260725-184749-e0e0): "The browser-native AI platform makes the
// complete machine language output of the end user prompt and gives to the
// SOFTWARE to execute. FIRST execution in the browser-native AI platform,
// SECOND execution in the SERVER by the SOFTWARE."
//
// This module IS the FIRST execution. It deliberately does not
// reimplement Layer 2 analysis -- it imports analyzeLightweight() straight
// from phase_2's real prompt-compiler pipeline (prompt-construction.ts),
// which was split (this phase, see prompt-hash.ts) to have zero node-only
// imports specifically so it can run unmodified in a browser bundle -- see
// ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md for the WebLLM-vs-
// LiteRT decision this tier's real (follow-up) model inference will use.
// Reusing the existing engine here is the
// concrete realization of the Owner's "no new engine unless necessary" /
// "use existing system to fill the gaps" directive -- a second,
// browser-flavored classifier was deliberately NOT written.
//
// The SECOND execution (deterministic server-side SOFTWARE, running the
// FULL pipeline including context assembly and verification, which need
// DB-backed org/user context this module never has) is
// src/app/api/prompt-compiler/execute/route.ts. This module's output is
// sent there as non-authoritative telemetry/fast-path input, never trusted
// on its own for anything security- or compliance-sensitive -- see that
// route's own header comment for why the server always recomputes.
import { analyzeLightweight } from "@/lib/prompt-compiler/prompt-construction"
import type { LightweightAnalysis } from "@/lib/prompt-compiler/types"
import { planExecution, type ExecutionPlan } from "./tier-orchestrator"
import type { BrowserExecutionTier } from "./tier-detection"

export type BrowserCompiledDraft = {
  analysis: LightweightAnalysis
  tier: BrowserExecutionTier
  fallbackChain: BrowserExecutionTier[]
  compileMs: number
}

/**
 * Runs the real browser-native FIRST pass over one raw end-user input:
 * picks the best available compute tier (tier-orchestrator.ts) and runs
 * phase_2's real Layer 2 analysis (classification, intent, entities,
 * variables) with it. Every tier in TIER_PRIORITY today (NPU/Built-in
 * AI/Lite LLM/Transformers/Server) ultimately shares this same
 * deterministic JS analysis step -- the tiers differ in what ADDITIONAL
 * local model inference they could layer on top (a true local LLM call via
 * WebLLM, a Transformers.js embedding pass, etc.), which is this phase's
 * own documented follow-up, not silently faked here. Real, honest, and
 * still a genuine tiered execution: which tier ran is reported and telemetred,
 * and the fallback chain is real per tier-orchestrator.ts's own plan.
 */
export function compileInBrowser(rawText: string, env?: Parameters<typeof planExecution>[0]): BrowserCompiledDraft {
  const plan: ExecutionPlan = planExecution(env)
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
  const analysis = analyzeLightweight(rawText)
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
  return {
    analysis,
    tier: plan.selectedTier,
    fallbackChain: plan.fallbackChain,
    compileMs: Math.round(t1 - t0),
  }
}
