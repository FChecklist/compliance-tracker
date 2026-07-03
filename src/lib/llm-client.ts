/**
 * Provider-agnostic LLM client -- supports the 4 providers in the
 * `ai_provider` enum (groq/openai/anthropic/google), so `customer_model_config`
 * (Wave 4) can actually route requests to whichever provider a customer has
 * configured per Orchestra Layer, not just the platform-default Groq key.
 *
 * Groq and OpenAI share the same request/response shape (OpenAI's chat
 * completions API); Anthropic and Google each have their own shape.
 *
 * Wave 23 (AI Observability, Langfuse-inspired): every call now also
 * returns token usage, parsed from each provider's own response shape --
 * previously discarded entirely, meaning no LLM call anywhere in this
 * codebase could report real cost/token data. This is a breaking change to
 * callLLM/callLLMJson's return shape; every call site was updated in the
 * same wave (see orchestra-execution-logger.ts, the shared consumer).
 */

export type LLMProvider = "groq" | "openai" | "anthropic" | "google";

export type CallLLMOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type LLMResult = {
  content: string;
  usage: LLMUsage;
};

// Approximate, manually-maintained reference pricing (USD per 1K tokens) --
// no live pricing API exists for any of these 4 providers, so this is an
// honest-limitation constant like others in this codebase, not a precise
// billing source. Returns null for any unrecognized model rather than
// guessing at a cost.
const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  "llama-3.3-70b-versatile": { promptPer1k: 0.00059, completionPer1k: 0.00079 }, // Groq
  "llama-3.1-8b-instant": { promptPer1k: 0.00005, completionPer1k: 0.00008 }, // Groq
  "gpt-4o": { promptPer1k: 0.0025, completionPer1k: 0.01 },
  "gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "claude-sonnet-5": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "claude-haiku-4-5-20251001": { promptPer1k: 0.0008, completionPer1k: 0.004 },
  "gemini-2.0-flash": { promptPer1k: 0.0001, completionPer1k: 0.0004 },
};

export function estimateCostUsd(model: string, usage: LLMUsage): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (usage.promptTokens / 1000) * pricing.promptPer1k + (usage.completionTokens / 1000) * pricing.completionPer1k;
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2048,
  };
  if (options?.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${baseUrl} error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    content: data.choices[0].message.content as string,
    usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<LLMResult> {
  // Anthropic's Messages API has no response_format=json_object equivalent --
  // ask for JSON-only output in the system prompt instead, same as every
  // other provider does when jsonMode is requested but not natively supported.
  const system = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.`
    : systemPrompt;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.2,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    content: data.content[0].text as string,
    usage: { promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0 },
  };
}

async function callGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<LLMResult> {
  const prompt = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.\n\n${userMessage}`
    : `${systemPrompt}\n\n${userMessage}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.2,
          maxOutputTokens: options?.maxTokens ?? 2048,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    content: data.candidates[0].content.parts[0].text as string,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

/** Dispatches to whichever provider is configured. `model` should be a real model name for that provider. */
export async function callLLM(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<LLMResult> {
  switch (provider) {
    case "groq":
      return callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "openai":
      return callOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "anthropic":
      return callAnthropic(apiKey, model, systemPrompt, userMessage, options);
    case "google":
      return callGoogle(apiKey, model, systemPrompt, userMessage, options);
  }
}

export async function callLLMJson<T>(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<{ data: T; usage: LLMUsage }> {
  const { content, usage } = await callLLM(provider, model, apiKey, systemPrompt, userMessage, { ...options, jsonMode: true });
  return { data: JSON.parse(content) as T, usage };
}
