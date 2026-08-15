// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-portability
// (not_implemented -- llm-client.ts calls a single configured model per
// request with no cross-provider adaptation layer). This module is that
// adaptation layer: it reshapes one already-compiled prompt into each real
// provider's own request-message shape (llm-client.ts's own LLMProvider
// union), a deterministic formatting transform -- it never calls any
// provider itself (that stays llm-client.ts's callLLM()).
import type { LLMProvider } from "@/lib/llm-client"

export type PortablePromptRequest =
  | { provider: "openai" | "groq" | "openrouter" | "cerebras"; messages: { role: "system" | "user"; content: string }[] }
  | { provider: "anthropic"; system: string | undefined; messages: { role: "user"; content: string }[] }
  | { provider: "google"; systemInstruction: string | undefined; contents: { role: "user"; parts: { text: string }[] }[] }

/**
 * Adapts one compiled system prompt + user message into each real
 * provider's own request shape. OpenAI-compatible providers (openai/groq/
 * openrouter/cerebras) share one messages-array shape; Anthropic splits
 * system out; Google uses systemInstruction + contents/parts. Matches the
 * exact shapes llm-client.ts's own callOpenAiCompatible/callAnthropic/
 * callGoogle already send today -- this function only builds the payload,
 * it does not send it.
 */
export function adaptPromptForProvider(provider: LLMProvider, systemPrompt: string, userMessage: string): PortablePromptRequest {
  switch (provider) {
    case "anthropic":
      return { provider: "anthropic", system: systemPrompt || undefined, messages: [{ role: "user", content: userMessage }] }
    case "google":
      return {
        provider: "google",
        systemInstruction: systemPrompt || undefined,
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
      }
    case "openai":
    case "groq":
    case "openrouter":
    case "cerebras":
    default: {
      const messages: { role: "system" | "user"; content: string }[] = []
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt })
      messages.push({ role: "user", content: userMessage })
      return { provider, messages }
    }
  }
}

/** Adapts the same compiled prompt for every given provider -- for A/B/portability comparisons across providers. */
export function adaptPromptForAllProviders(providers: LLMProvider[], systemPrompt: string, userMessage: string): Record<string, PortablePromptRequest> {
  const out: Record<string, PortablePromptRequest> = {}
  for (const p of providers) out[p] = adaptPromptForProvider(p, systemPrompt, userMessage)
  return out
}
