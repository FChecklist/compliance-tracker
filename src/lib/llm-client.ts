/**
 * Provider-agnostic LLM client -- supports the 5 providers in the
 * `ai_provider` enum (groq/openai/anthropic/google/openrouter, the last
 * added Wave 45), so `customer_model_config` (Wave 4) can actually route
 * requests to whichever provider a customer has configured per Orchestra
 * Layer, not just the platform-default Groq key.
 *
 * Groq, OpenAI, and OpenRouter share the same request/response shape
 * (OpenAI's chat completions API, which OpenRouter proxies to 340+ models
 * behind); Anthropic and Google each have their own shape.
 *
 * Wave 23 (AI Observability, Langfuse-inspired): every call now also
 * returns token usage, parsed from each provider's own response shape --
 * previously discarded entirely, meaning no LLM call anywhere in this
 * codebase could report real cost/token data. This is a breaking change to
 * callLLM/callLLMJson's return shape; every call site was updated in the
 * same wave (see orchestra-execution-logger.ts, the shared consumer).
 */

// Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26):
// OpenRouter is OpenAI-compatible (same chat completions shape as Groq/
// OpenAI already handled by callOpenAICompatible), so adding it here is a
// one-branch addition, not a new code path.
export type LLMProvider = "groq" | "openai" | "anthropic" | "google" | "openrouter";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type CallLLMOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  // Wave 37 (VERI Chat Intelligence Engine, PLATFORM_STRATEGY.md §18): prior
  // turns in the conversation, oldest first, NOT including the final
  // `userMessage` (that's still passed separately, unchanged). Optional and
  // additive -- every pre-existing call site passes no history and gets the
  // exact same single-turn request as before.
  history?: ChatTurn[];
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
  // OpenRouter (Wave 45) -- verified live via https://openrouter.ai/api/v1/models
  // 2026-07-04. Per-token in that API; converted to per-1k here to match this
  // table's existing unit. The ":free" variant is $0 and used for testing.
  "meta-llama/llama-3.3-70b-instruct": { promptPer1k: 0.0001, completionPer1k: 0.00032 },
  "meta-llama/llama-3.3-70b-instruct:free": { promptPer1k: 0, completionPer1k: 0 },
  // Verified live via https://openrouter.ai/api/v1/models 2026-07-04 --
  // vision-capable (input_modalities includes "image"), used as the
  // OpenRouter entry in document-extraction-service.ts's VISION_MODEL_OVERRIDES.
  "openai/gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
};

export function estimateCostUsd(model: string, usage: LLMUsage): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (usage.promptTokens / 1000) * pricing.promptPer1k + (usage.completionTokens / 1000) * pricing.completionPer1k;
}

// Wave 45: OpenRouter recommends (not requires) HTTP-Referer/X-Title for
// attribution and its own rate-limit/ranking purposes -- added only for the
// openrouter baseUrl, harmless no-ops for Groq/OpenAI which ignore unknown headers.
function extraHeadersFor(baseUrl: string): Record<string, string> {
  if (!baseUrl.includes("openrouter.ai")) return {}
  return { "HTTP-Referer": "https://veridian-compliance-ai.vercel.app", "X-Title": "VERIDIAN AI OS" }
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
      ...(options?.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2048,
  };
  if (options?.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...extraHeadersFor(baseUrl) },
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
      messages: [...(options?.history ?? []), { role: "user", content: userMessage }],
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
        contents: [
          // Google uses "model" not "assistant" for the AI's own turns.
          ...(options?.history ?? []).map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
          { role: "user", parts: [{ text: prompt }] },
        ],
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
    case "openrouter":
      return callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "anthropic":
      return callAnthropic(apiKey, model, systemPrompt, userMessage, options);
    case "google":
      return callGoogle(apiKey, model, systemPrompt, userMessage, options);
  }
}

// Wave 35 (Document AI, VOAC evaluation -- PLATFORM_STRATEGY.md §17): a
// dedicated vision function, not a change to callLLM's existing signature,
// so every pre-existing call site is completely untouched. Resolves the
// gap where `documents.extractedData` (M-02) has existed since Wave 7 with
// zero consumers -- confirmed no OCR/vision pipeline exists anywhere in
// this codebase. Deliberately NOT built on any external OCR library
// (Marker/Docling/Unstructured/GLM-OCR/Ollama-OCR) -- all Python, several
// needing GPU, none fitting a Vercel serverless Next.js deployment. Uses
// the 4 providers already wired into this file, which all support vision
// natively via simple HTTP (no new dependency, no new infrastructure).
async function callVisionOpenAICompatible(
  baseUrl: string, apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [
        { type: "text", text: instructionText },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ] },
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

async function callVisionAnthropic(
  apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<LLMResult> {
  const system = options?.jsonMode ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.` : systemPrompt;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.2,
      system,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
        { type: "text", text: instructionText },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    content: data.content[0].text as string,
    usage: { promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0 },
  };
}

async function callVisionGoogle(
  apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<LLMResult> {
  const prompt = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.\n\n${instructionText}`
    : `${systemPrompt}\n\n${instructionText}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }] }],
        generationConfig: { temperature: options?.temperature ?? 0.2, maxOutputTokens: options?.maxTokens ?? 2048 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    content: data.candidates[0].content.parts[0].text as string,
    usage: { promptTokens: data.usageMetadata?.promptTokenCount ?? 0, completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

/** Vision-capable counterpart to callLLM -- imageBase64 has no data: prefix, mimeType is e.g. "image/jpeg". */
export async function callLLMVision(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  imageBase64: string,
  mimeType: string,
  instructionText: string,
  options?: CallLLMOptions
): Promise<LLMResult> {
  switch (provider) {
    case "groq":
      return callVisionOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "openai":
      return callVisionOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "openrouter":
      return callVisionOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "anthropic":
      return callVisionAnthropic(apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "google":
      return callVisionGoogle(apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
  }
}

// Wave 46 testing pass: some models routed through OpenRouter (confirmed
// live with meta-llama/llama-3.3-70b-instruct, VERI FDE's evaluation call)
// wrap their JSON output in a markdown code fence even when jsonMode/
// response_format=json_object is requested -- response_format is passed
// through best-effort by OpenRouter and isn't uniformly honored by every
// upstream provider it routes to. Strips a leading/trailing ``` fence
// (with or without a "json" language tag) before parsing, so a
// spec-compliant model's untouched output and a fenced one both parse.
function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
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
  return { data: JSON.parse(stripJsonFence(content)) as T, usage };
}
