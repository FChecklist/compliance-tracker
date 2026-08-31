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
import { callLLM, type CallLLMOptions, type LLMFallback, type LLMProvider } from "@/lib/llm-client"
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
  // Forwarded verbatim to the real callLLM() call -- optional and additive,
  // so a caller migrating an existing callLLM() call site onto this wrapper
  // (e.g. api/help/ask/route.ts's enablePromptCache/fallback usage) doesn't
  // lose that behavior by switching.
  llmOptions?: CallLLMOptions
  fallback?: LLMFallback
}

/**
 * Runs the full 4-layer defense-in-depth pipeline around one real LLM call:
 * Layer 1 (classify input) -> Layer 2 (harden the prompt) -> [block here if
 * Layer 1 verdict is "malicious"] -> real callLLM() -> Layer 3 output-side
 * guard [block here if unsafe] -> Layer 4 output filtering/quality scoring
 * [block here if the reply leaks a verbatim system instruction]. Every block
 * path -- Layer 1 malicious input, Layer 3 unsafe input/output (including its
 * own fail-closed-on-network-error case), and Layer 4's leaked-system-
 * instruction detection -- returns `content: ""` with `blocked: true`;
 * callers must check `blocked` before using `content`. Only PII is
 * scrubbed-and-continued rather than blocked (see Layer 4's own comment on
 * why a leaked system prompt doesn't get the same treatment).
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
      usage: null,
    }
  }

  const layer3: Layer3Result = { inputGuard: { safe: true, categories: [], raw: "" }, outputGuard: null }
  if (options.groqApiKey) {
    try {
      layer3.inputGuard = await evaluateWithLlamaGuard(layer2.wrappedUserMessage, options.groqApiKey)
    } catch (err) {
      // Audit fix (phase_4 defense-in-depth, AGENTS.md Rule 9 "no silent
      // guardrail bypass"): a network/API failure here used to leave
      // inputGuard defaulted to permissive "safe" above, silently treating
      // an UNEVALUATED input as though Llama Guard had actually cleared it
      // -- directly contradicting this module's own docstring claim of no
      // silent bypass. Fail CLOSED instead (block the request) and log the
      // failure explicitly, matching evaluateWithLlamaGuard()'s own stated
      // contract (layer3-runtime-guardrails.ts: "Network/API failures throw
      // rather than fail open").
      console.error("[defense-in-depth] Layer 3 input-guard call failed -- failing closed (blocking the request), not defaulting to safe:", err)
      layer3.inputGuard = { safe: false, categories: ["LAYER3_UNAVAILABLE"], raw: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!layer3.inputGuard.safe) {
    const unavailable = layer3.inputGuard.categories.includes("LAYER3_UNAVAILABLE")
    return {
      layer1, layer2, layer3,
      layer4: { piiMatches: [], scrubbedText: "", leakedSystemInstruction: false, contentModeration: null },
      quality: { composite: 0, signals: [] },
      blocked: true,
      blockReason: unavailable
        ? "Layer 3 (Llama Guard) input-side check failed (network/API error) -- failing closed rather than assuming the input is safe"
        : `Layer 3 (Llama Guard) flagged input as unsafe: categories ${layer3.inputGuard.categories.join(",") || "unspecified"}`,
      content: "",
      usage: null,
    }
  }

  const llmResult = await callLLM(
    options.provider,
    options.model,
    options.apiKey,
    layer2.wrappedSystemPrompt,
    layer2.wrappedUserMessage,
    options.llmOptions,
    options.fallback
  )

  if (options.groqApiKey) {
    try {
      layer3.outputGuard = await evaluateWithLlamaGuard(llmResult.content, options.groqApiKey)
    } catch (err) {
      // Same fail-closed reasoning as the input-side call above -- the real
      // model call already happened (its cost is sunk), but that does not
      // mean an un-vetted reply gets to reach the user under a false "safe"
      // label just because the output-side check itself failed.
      console.error("[defense-in-depth] Layer 3 output-guard call failed -- failing closed (blocking the reply), not defaulting to safe:", err)
      layer3.outputGuard = { safe: false, categories: ["LAYER3_UNAVAILABLE"], raw: err instanceof Error ? err.message : String(err) }
    }
  }

  if (layer3.outputGuard && !layer3.outputGuard.safe) {
    const unavailable = layer3.outputGuard.categories.includes("LAYER3_UNAVAILABLE")
    return {
      layer1, layer2, layer3,
      layer4: { piiMatches: [], scrubbedText: "", leakedSystemInstruction: false, contentModeration: layer3.outputGuard },
      quality: { composite: 0, signals: [] },
      blocked: true,
      blockReason: unavailable
        ? "Layer 3 (Llama Guard) output-side check failed (network/API error) -- failing closed rather than assuming the reply is safe"
        : `Layer 3 (Llama Guard) flagged output as unsafe: categories ${layer3.outputGuard.categories.join(",")}`,
      content: "",
      usage: llmResult.usage,
    }
  }

  const { piiMatches, scrubbedText } = scrubPii(llmResult.content)
  const layer4: Layer4Result = {
    piiMatches,
    scrubbedText,
    leakedSystemInstruction: detectLeakedSystemInstruction(llmResult.content),
    contentModeration: layer3.outputGuard,
  }

  // Audit fix (PR #562 round 2, same class as the Layer 3 output-guard
  // enforcement above): a verbatim system-instruction leak in the model's
  // reply is at least as severe as the pre-call equivalent -- Layer 1
  // classifies a *user attempt* to exfiltrate the system prompt as
  // "system_prompt_exfiltration", one of the HIGH_CONFIDENCE_CATEGORIES that
  // gets an outright "malicious" verdict and a full block
  // (layer1-input-sanitization.ts's HIGH_CONFIDENCE_CATEGORIES). The model
  // actually SUCCEEDING at leaking those instructions is a strictly worse
  // outcome than a user merely attempting to, so it gets the same
  // block-entirely treatment, not a strip-and-continue like PII (PII scrubbing
  // handles values that are safe to redact in place; a leaked system prompt is
  // the confidential asset itself, and there is no reliable way to guarantee
  // every verbatim trace of it has been stripped before handing the reply
  // back). blocked stays true and content stays empty here, exactly like
  // every other block path in this file.
  if (layer4.leakedSystemInstruction) {
    return {
      layer1, layer2, layer3, layer4,
      quality: { composite: 0, signals: [] },
      blocked: true,
      blockReason: "Layer 4 detected the model's reply verbatim-leaking system instructions -- blocking the reply rather than returning it (PII-style scrubbing is not sufficient for a leaked system prompt)",
      content: "",
      usage: llmResult.usage,
    }
  }

  const quality = scoreQuality(llmResult.content, layer1.deterministicMatches.map((m) => m.matchedText))

  return {
    layer1, layer2, layer3, layer4, quality,
    blocked: false,
    usage: llmResult.usage,
    blockReason: null,
    content: layer4.scrubbedText,
  }
}
