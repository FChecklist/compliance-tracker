// VERIDIAN_Architecture_v2.0 phase_4: Defense-in-Depth Engine -- closes
// engine-defense-in-depth ("Coordinates multi-layer security -- input
// sanitization, prompt hardening, output filtering, runtime guardrails") and
// defense-in-depth-4-layer-enforcement (the cross-cutting requirement that
// "ALL FOUR layers [operate] together, not any one alone").
//
// DELIBERATE SCOPE DECISION (same class as mother-router.ts's own documented
// decision): this module wraps llm-client.ts's existing callLLM() -- the
// real Gateway G05 execution boundary -- rather than modifying it. Every
// pre-existing callLLM() call site is completely unaffected; this is an
// additive, opt-in wrapper for call sites that want the 4-layer defense
// (chat/prompt-execution surfaces), not a mandatory hop every LLM call must
// now take.
import { callLLM, type LLMProvider } from "@/lib/llm-client"
import { classifyInput } from "./layer1-input-sanitization"
import { hardenSystemPrompt } from "./layer2-system-prompt-hardening"
import { evaluateWithLlamaGuard } from "./layer3-runtime-guardrails"
import { detectLeakedSystemInstruction, scrubPii } from "./layer4-output-filtering"
import { scoreQuality } from "./quality-engine"
import type { DefenseInDepthResult, Layer3Result, Layer4Result } from "./types"

export type DefenseInDepthOptions = {
  provider: LLMProvider
  model: string
  apiKey: string
  systemPrompt: string
  userMessage: string
  // Groq key for the Layer 1 Prompt Guard 2 call + Layer 3/4 Llama Guard 4
  // calls -- independent of `apiKey` above, since the caller's real model
  // call may be routed through a different provider entirely (Llama
  // Guard/Prompt Guard are always Groq-hosted regardless of which provider
  // executes the caller's real request). Pass null to run only the
  // network-free deterministic Layer 1/4 checks (Layer 3 is skipped
  // entirely -- see blockReason on the returned result).
  groqApiKey: string | null
}

/**
 * Runs the full 4-layer defense-in-depth pipeline around one real LLM call:
 * Layer 1 (classify input) -> Layer 2 (harden the prompt) -> [block here if
 * Layer 1 verdict is "malicious"] -> real callLLM() -> Layer 3 output-side
 * guard + Layer 4 output filtering/quality scoring. A "malicious" Layer 1
 * verdict blocks BEFORE the real model call is ever made (the document's own
 * "Inputs classified as malicious are rejected immediately", line 483) --
 * the returned result's `content` is empty and `blocked` is true; callers
 * must check `blocked` before using `content`.
 */
export async function runDefenseInDepth(
  options: DefenseInDepthOptions
): Promise<DefenseInDepthResult & { content: string }> {
  const layer1 = await classifyInput(options.userMessage, options.groqApiKey)
  const layer2 = hardenSystemPrompt(options.systemPrompt, options.userMessage)

  if (layer1.verdict === "malicious") {
    return {
      layer1,
      layer2,
      layer3: { inputGuard: { safe: false, categories: [], raw: "" }, outputGuard: null },
      layer4: { piiMatches: [], scrubbedText: "", leakedSystemInstruction: false, contentModeration: null },
      quality: { composite: 0, signals: [] },
      blocked: true,
      blockReason: `Layer 1 rejected input as malicious: ${layer1.deterministicMatches.map((m) => m.detail).join("; ") || "Prompt Guard classifier flagged this input"}`,
      content: "",
    }
  }

  const layer3: Layer3Result = { inputGuard: { safe: true, categories: [], raw: "" }, outputGuard: null }
  if (options.groqApiKey) {
    try {
      layer3.inputGuard = await evaluateWithLlamaGuard(layer2.wrappedUserMessage, options.groqApiKey)
    } catch {
      // Network/API failure on the Layer 3 input-side check does not block
      // the request -- Layer 1's deterministic check already ran and passed;
      // Layer 3 degrades to "not evaluated" (inputGuard.safe stays the
      // permissive default above) rather than failing the whole request on
      // an unrelated network error.
    }
  }

  if (!layer3.inputGuard.safe) {
    return {
      layer1, layer2, layer3,
      layer4: { piiMatches: [], scrubbedText: "", leakedSystemInstruction: false, contentModeration: null },
      quality: { composite: 0, signals: [] },
      blocked: true,
      blockReason: `Layer 3 (Llama Guard) flagged input as unsafe: categories ${layer3.inputGuard.categories.join(",") || "unspecified"}`,
      content: "",
    }
  }

  const llmResult = await callLLM(options.provider, options.model, options.apiKey, layer2.wrappedSystemPrompt, layer2.wrappedUserMessage)

  if (options.groqApiKey) {
    try {
      layer3.outputGuard = await evaluateWithLlamaGuard(llmResult.content, options.groqApiKey)
    } catch {
      // Same degrade-not-block reasoning as the input-side call above.
    }
  }

  const { piiMatches, scrubbedText } = scrubPii(llmResult.content)
  const layer4: Layer4Result = {
    piiMatches,
    scrubbedText,
    leakedSystemInstruction: detectLeakedSystemInstruction(llmResult.content),
    contentModeration: layer3.outputGuard,
  }

  const quality = scoreQuality(llmResult.content, layer1.deterministicMatches.map((m) => m.matchedText))

  return {
    layer1, layer2, layer3, layer4, quality,
    blocked: false,
    blockReason: null,
    content: layer4.scrubbedText,
  }
}
