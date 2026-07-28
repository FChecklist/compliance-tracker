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
// Wave (2026-07-10, founder directive): "cerebras" added the same way --
// OpenAI-compatible chat completions, confirmed live against
// api.cerebras.ai/v1/chat/completions. Deliberately NOT added to the real
// Postgres `ai_provider` enum (schema.ts's aiProviderEnum, which constrains
// customer-facing BYO config tables only) -- this value only ever flows
// through the in-memory ResolvedModelConfig/LLMFallback types as the
// platform floor tier's own same-model failover target
// (orchestra-model-resolver.ts), never through a customer's own config row.
export type LLMProvider = "groq" | "openai" | "anthropic" | "google" | "openrouter" | "cerebras";

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
  // Wave 110: only consumed by callLLMJson -- if supplied, the parsed JSON
  // is checked for these top-level keys before being returned; a missing
  // key throws LLMVerificationError instead of handing the caller
  // malformed data to discover later. Optional and additive.
  expectedKeys?: string[];
  // Prompt & Cache Management Framework, Phase 1 (2026-07-14): opt-in --
  // every pre-existing call site passes nothing and behaves identically.
  // Consumed by callAnthropic only (the one provider in this file needing
  // an explicit cache_control breakpoint). OpenAI's own caching is
  // automatic above ~1024 tokens with no request-shape change required --
  // deliberately not touched this slice. Groq/OpenRouter/Cerebras/Google
  // get no special handling this slice either.
  enablePromptCache?: boolean;
  // Super Boss v2 plan task V2-5 (BYOB bring-your-own-AI-model, 2026-07-20):
  // optional OpenAI-compatible chat-completions endpoint that, when set,
  // overrides dispatchLLM()'s per-provider default URL for the groq/openai/
  // openrouter/cerebras (callOpenAICompatible) branches ONLY. Used by the
  // software_team-scope tenant-override path (runRole in team-service.ts)
  // so an org pointing its BYO model at a self-hosted OpenRouter-compatible
  // gateway can do so with no code change. Undefined for every pre-existing
  // call site -> dispatchLLM uses its hardcoded provider URL exactly as
  // before (zero behavior change). Not honored for anthropic/google
  // (their request shapes are not OpenAI-compatible).
  baseUrl?: string;
};

export type LLMUsage = {
  promptTokens: number;
  completionTokens: number;
  // Prompt & Cache Management Framework, Phase 1 (2026-07-14): only ever
  // populated by callAnthropic when enablePromptCache was honored (real
  // cache_control breakpoint sent AND Anthropic's own response reported
  // these fields). Undefined for every other provider/call, and undefined
  // on Anthropic calls below the minimum cacheable size -- absence means
  // "not attempted," not "zero."
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type LLMResult = {
  content: string;
  usage: LLMUsage;
  // AI Architecture / Performance & Cost Efficiency gap-closure (2026-07-18,
  // "No systematic latency tracking or SLA enforcement"): wall-clock time
  // from the first provider attempt through any retries/fallback, measured
  // centrally in callLLM/callLLMJson/callLLMVision -- see LLM_LATENCY_SLA_MS
  // below. Previously each call site tracked its own Date.now() before/after
  // (or, e.g. the pre-fix api/help/ask/route.ts, didn't track it at all), so
  // there was no guaranteed source of latency data; this field is populated
  // for every call, no caller opt-in required.
  durationMs: number;
};

// Wave 72 (AI_OS_CERTIFICATION.md §2.5, "Model Switching / Fallback -- NOT_BUILT"):
// a secondary provider/model/key to try if the primary exhausts its retries.
// Optional and additive -- every pre-existing callLLM/callLLMJson call site
// keeps working with zero changes; callers that want resilience pass one in
// (orchestra-model-resolver.ts's three resolvers now populate this with the
// platform's OpenRouter default when available).
export type LLMFallback = { provider: LLMProvider; model: string; apiKey: string };

/** Carries the HTTP status (when known) so retry logic can distinguish transient (429/5xx/network) from permanent (4xx auth/bad-request) failures. */
export class LLMHttpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LLMHttpError";
    this.status = status;
  }
}

// Wave 110 (AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md, "output verification
// engineering" -- confirmed absent anywhere in this codebase prior).
// Deliberately narrow: checks JSON *shape* (are the keys the caller
// actually needs present?), not a claim against a business fact -- that's
// a much larger undertaking with no existing primitive to build on yet.
// Thrown as its own type so a caller can log/handle a malformed-output
// case distinctly from a network/provider failure (LLMHttpError).
export class LLMVerificationError extends Error {
  missingKeys: string[];
  constructor(missingKeys: string[]) {
    super(`LLM JSON response missing expected key(s): ${missingKeys.join(", ")}`);
    this.name = "LLMVerificationError";
    this.missingKeys = missingKeys;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LLMHttpError) {
    // 429 (rate limit) and 5xx (upstream/provider trouble) are worth retrying;
    // 4xx otherwise (bad key, bad request) will just fail identically again.
    return error.status === 429 || (error.status !== undefined && error.status >= 500);
  }
  return true; // network errors (fetch threw before a response existed) are always worth one retry
}

const RETRY_DELAYS_MS = [300, 900]; // 2 retries total per attempt (3 tries), short exponential backoff

async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (i === RETRY_DELAYS_MS.length || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }
  throw lastError;
}

// Approximate, manually-maintained reference pricing (USD per 1K tokens) --
// no live pricing API exists for any of these 4 providers, so this is an
// honest-limitation constant like others in this codebase, not a precise
// billing source. Returns null for any unrecognized model rather than
// guessing at a cost.
const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  "llama-3.3-70b-versatile": { promptPer1k: 0.00059, completionPer1k: 0.00079 }, // Groq
  "llama-3.1-8b-instant": { promptPer1k: 0.00005, completionPer1k: 0.00008 }, // Groq
  // Groq (Wave 2026-07-10, new platform-default floor -- orchestra-model-
  // resolver.ts's PLATFORM_DEFAULT_MODEL) -- verified live via
  // openrouter.ai/api/v1/models 2026-07-10 as a reference point (Groq is
  // itself a listed provider there for this model).
  "openai/gpt-oss-120b": { promptPer1k: 0.000036, completionPer1k: 0.00018 }, // Groq
  // Cerebras (Wave 2026-07-10): same underlying model as the Groq entry
  // above, but Cerebras's own API returns it under a different id -- no
  // "openai/" prefix (confirmed live via api.cerebras.ai/v1/models) -- so
  // this needs its own pricing row, not a shared key. Verified via
  // openrouter.ai/api/v1/models/openai%2Fgpt-oss-120b/endpoints, which
  // lists Cerebras's own per-provider rate (paid, unlike Groq's free tier
  // for this model -- see orchestra-model-resolver.ts's platformFallbackFor
  // for why this exists at all: same-model failover, not a cost swap).
  "gpt-oss-120b": { promptPer1k: 0.00035, completionPer1k: 0.00075 }, // Cerebras
  // Groq (Wave A, VERIDIAN Review Framework remediation, 2026-07-17): the
  // vision-capable model newly registered in orchestra-model-resolver.ts's
  // SOURCE_TYPE_MODEL_OVERRIDES.vision_document_extraction for "groq" --
  // without this row, estimateCostUsd() would silently return null for
  // every document-extraction call that resolves to it, the same class of
  // gap the z-ai/glm-* rows below were added to close. Verified live via
  // console.groq.com/docs/vision + groq.com/pricing 2026-07-17: $0.11 /
  // $0.34 per 1M prompt/completion tokens.
  "meta-llama/llama-4-scout-17b-16e-instruct": { promptPer1k: 0.00011, completionPer1k: 0.00034 }, // Groq
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
  // z-ai/glm-* (AI Dev Team roster, src/lib/ai-team/roster.ts) -- verified live
  // via openrouter.ai's model pages 2026-07-09. Added before AI_TEAM_LOG_SECRET
  // goes live in Vercel; without these rows, estimateCostUsd() silently returns
  // null for every one of the ~25 AI Dev Team roles that use these models.
  "z-ai/glm-5.2": { promptPer1k: 0.00042, completionPer1k: 0.00132 },
  "z-ai/glm-5v-turbo": { promptPer1k: 0.0012, completionPer1k: 0.004 },
  "z-ai/glm-5-turbo": { promptPer1k: 0.0012, completionPer1k: 0.004 },
  // VERIDIAN Review Framework remediation (AI Failover, 2026-07-18):
  // orchestra-model-resolver.ts's platformFallbackFor() now uses this model
  // as the escalated tier's own same-quality-class failover target -- a new
  // consumer outside ai-team/roster.ts's existing AI Dev Team usage, so
  // without this row estimateCostUsd() would silently return null for every
  // customer-facing call that lands on this fallback branch, the same class
  // of gap SOURCE_TYPE_MODEL_OVERRIDES' groq entry closed above. Verified
  // live via openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints
  // 2026-07-18, DeepSeek provider: $0.435 / $0.87 per 1M prompt/completion
  // tokens.
  "deepseek/deepseek-v4-pro": { promptPer1k: 0.000435, completionPer1k: 0.00087 },
};

export function estimateCostUsd(model: string, usage: LLMUsage): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (usage.promptTokens / 1000) * pricing.promptPer1k + (usage.completionTokens / 1000) * pricing.completionPer1k;
}

// Anthropic's documented cache-hit discount: a cache read is billed at 10%
// of the base input price (a 90% saving on those tokens) -- see
// callAnthropic's cache_control comment above for the write-side premium
// (1.25x, a cost rather than a saving on the call that populates the
// cache). Only the read-side discount is counted as "savings" here;
// estimateCostUsd above already excludes cache tokens from promptTokens
// entirely (Anthropic's input_tokens does not include them), so this is
// additive, not a correction to an existing charge.
const ANTHROPIC_CACHE_READ_DISCOUNT = 0.9;

/** Real $ saved on this call from Anthropic prompt-cache reads. null when caching wasn't attempted or the model has no pricing row -- never 0 standing in for "not attempted", same LLMUsage contract as cacheReadTokens itself. */
export function estimateCacheSavingsUsd(model: string, usage: LLMUsage): number | null {
  if (usage.cacheReadTokens === undefined) return null;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (usage.cacheReadTokens / 1000) * pricing.promptPer1k * ANTHROPIC_CACHE_READ_DISCOUNT;
}

// Wave 45: OpenRouter recommends (not requires) HTTP-Referer/X-Title for
// attribution and its own rate-limit/ranking purposes -- added only for the
// openrouter baseUrl, harmless no-ops for Groq/OpenAI which ignore unknown headers.
function extraHeadersFor(baseUrl: string): Record<string, string> {
  if (!baseUrl.includes("openrouter.ai")) return {}
  return { "HTTP-Referer": "https://veridian-compliance-ai.vercel.app", "X-Title": "VERIDIAN AI OS" }
}

// Wave (2026-07-10, founder directive): pin specific OpenRouter models to a
// preferred upstream provider rather than letting OpenRouter pick among
// whichever of the model's ~15-25 listed providers happens to be cheapest/
// fastest at request time -- both confirmed live as real provider options
// via openrouter.ai/api/v1/models/{model}/endpoints 2026-07-10.
// `allow_fallbacks` stays true (OpenRouter's own default): this is a
// preference, not a hard requirement -- a DeepInfra/DeepSeek outage falls
// back to another listed provider rather than failing the whole request.
const OPENROUTER_PROVIDER_PREFERENCE: Record<string, string> = {
  "z-ai/glm-5.2": "DeepInfra",
  "deepseek/deepseek-v4-pro": "DeepSeek",
}

function openRouterProviderFor(baseUrl: string, model: string): { order: string[] } | undefined {
  if (!baseUrl.includes("openrouter.ai")) return undefined
  const preferred = OPENROUTER_PROVIDER_PREFERENCE[model]
  return preferred ? { order: [preferred] } : undefined
}

// TASK 1.2 (Owner directive 2026-07-20): AI Dev Team dispatch
// (task-execution-engine.ts) goes through this function, not
// callAnthropic -- enablePromptCache was silently a no-op here before
// this change (the option was defined on CallLLMOptions and read by
// callAnthropic only; every other provider ignored it). Verified via
// OpenRouter's own docs before writing anything (not assumed):
//  - DeepSeek: caching is fully automatic on OpenRouter, no request
//    field needed -- this function already gets that benefit for free
//    on any DeepSeek-routed call, with or without this change.
//  - Anthropic-family models (routed either directly or via
//    OpenRouter's "anthropic/..." model IDs): OpenRouter passes
//    through the same cache_control content-block shape Anthropic's
//    own API uses -- implemented below, gated to only fire for
//    anthropic/-prefixed model IDs so no other provider ever receives
//    a field it might not understand.
//  - GLM/Zhipu (the AIROUTER-01 default judgment model): OpenRouter's
//    docs do not document caching support one way or the other for
//    this provider. Deliberately NOT guessed at here -- sending an
//    unverified cache_control shape to a live paid API on a guess
//    risks a silently malformed request. Left as a known, honest open
//    item (see ai-os/MASTER_INDEX.yaml) rather than fabricated.
function isAnthropicModelId(model: string): boolean {
  return model.toLowerCase().startsWith("anthropic/") || model.toLowerCase().startsWith("claude-")
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
  const cacheEligible =
    Boolean(options?.enablePromptCache) &&
    isAnthropicModelId(model) &&
    systemPrompt.length >= ANTHROPIC_MIN_CACHEABLE_CHARS
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: cacheEligible ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] : systemPrompt,
      },
      ...(options?.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.maxTokens ?? 2048,
  };
  if (options?.jsonMode) body.response_format = { type: "json_object" };
  const providerPreference = openRouterProviderFor(baseUrl, model);
  if (providerPreference) body.provider = providerPreference;

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...extraHeadersFor(baseUrl) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LLMHttpError(`${baseUrl} error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.choices[0].message.content as string,
    usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
  };
}

// Prompt & Cache Management Framework, Phase 1 (2026-07-14): Anthropic's own
// documented minimum cacheable size is 1024 tokens (Sonnet/Opus) / 2048
// (Haiku) -- below that floor the cache write premium costs more than a
// read ever saves back (see the framework's requirements doc, §3.1/§3.2).
// No live tokenizer is wired into this file, so this is a deliberately
// conservative character-count proxy (~4 chars/token in English prose,
// rounded down), the same class of honest-approximation constant as
// MODEL_PRICING above -- named as approximate, not precise, in the comment
// rather than silently presented as exact.
const ANTHROPIC_MIN_CACHEABLE_CHARS = 3500;

function isHaikuModel(model: string): boolean {
  return model.toLowerCase().includes("haiku");
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
  // Anthropic's Messages API has no response_format=json_object equivalent --
  // ask for JSON-only output in the system prompt instead, same as every
  // other provider does when jsonMode is requested but not natively supported.
  const system = options?.jsonMode
    ? `${systemPrompt}\n\nRespond with ONLY valid JSON, no markdown or extra text.`
    : systemPrompt;

  // Haiku's real minimum is 2048 tokens (~8000 chars), roughly double the
  // Sonnet/Opus floor used above -- checked here rather than baked into the
  // shared constant so the one caller that cares can see why.
  const minChars = isHaikuModel(model) ? ANTHROPIC_MIN_CACHEABLE_CHARS * 2 : ANTHROPIC_MIN_CACHEABLE_CHARS;
  const cacheEligible = Boolean(options?.enablePromptCache) && system.length >= minChars;

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
      // Plain string when not cache-eligible (byte-identical to this
      // function's pre-2026-07-14 behavior -- every existing call site that
      // doesn't opt in sees no request-shape change at all). Anthropic's
      // documented cache_control shape when eligible: system becomes a
      // content-block array, cache_control on the one static block. Only
      // ONE breakpoint is used here (Anthropic allows up to 4) -- this
      // slice caches the whole system prompt as one static unit, matching
      // VERI Chat's real call site where the resolved+substituted template
      // IS the static prefix boundary, not a multi-layer split.
      system: cacheEligible
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system,
      messages: [...(options?.history ?? []), { role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new LLMHttpError(`Anthropic API error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.content[0].text as string,
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      // Only present on the response when a cache_control breakpoint was
      // actually sent -- Anthropic omits these fields entirely on requests
      // that didn't ask for caching, which is why this stays undefined
      // (not 0) for every non-cache-eligible call, per LLMUsage's own
      // "absence means not attempted" contract above.
      ...(cacheEligible ? {
        cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
      } : {}),
    },
  };
}

async function callGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
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
  if (!res.ok) throw new LLMHttpError(`Google API error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.candidates[0].content.parts[0].text as string,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function dispatchLLM(provider: LLMProvider, model: string, apiKey: string, systemPrompt: string, userMessage: string, options?: CallLLMOptions): Promise<{ content: string; usage: LLMUsage }> {
  // Super Boss v2 plan task V2-5 (BYOB): an explicit OpenAI-compatible
  // baseUrl in options overrides the per-provider default for the four
  // callOpenAICompatible branches. The tenant-override path (runRole) is
  // the only caller that sets this today; every existing call site leaves
  // it undefined and gets dispatchLLM's hardcoded provider URL exactly as
  // before. Anthropic/Google keep their own non-OpenAI-compatible shapes
  // and ignore this (a tenant BYO model routed through OpenRouter never
  // lands on those branches anyway).
  const overrideUrl = options?.baseUrl
  switch (provider) {
    case "groq":
      return callOpenAICompatible(overrideUrl ?? "https://api.groq.com/openai/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "openai":
      return callOpenAICompatible(overrideUrl ?? "https://api.openai.com/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "openrouter":
      return callOpenAICompatible(overrideUrl ?? "https://openrouter.ai/api/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "cerebras":
      return callOpenAICompatible(overrideUrl ?? "https://api.cerebras.ai/v1/chat/completions", apiKey, model, systemPrompt, userMessage, options);
    case "anthropic":
      return callAnthropic(apiKey, model, systemPrompt, userMessage, options);
    case "google":
      return callGoogle(apiKey, model, systemPrompt, userMessage, options);
  }
}

// AI Architecture / Performance & Cost Efficiency gap-closure (2026-07-18):
// no live SLA target existed anywhere in this codebase for an LLM call --
// picked as a conservative ceiling for an interactive chat/help reply (the
// two heaviest real callers), above what even a retried call should
// normally take. A breach only warns; it never fails or truncates the
// call -- the reply the user is waiting on has already been paid for, so
// discarding it would waste the exact cost this gap-closure wave is about
// managing, not save it.
const LLM_LATENCY_SLA_MS = 8000;

function attachLatency<T extends { content: string; usage: LLMUsage }>(
  result: T,
  startedAt: number,
  provider: LLMProvider,
  model: string
): T & { durationMs: number } {
  const durationMs = Date.now() - startedAt;
  if (durationMs > LLM_LATENCY_SLA_MS) {
    console.warn(`[llm-client] SLA breach: ${provider}/${model} took ${durationMs}ms (SLA ${LLM_LATENCY_SLA_MS}ms)`);
  }
  return { ...result, durationMs };
}

/**
 * Dispatches to whichever provider is configured. `model` should be a real
 * model name for that provider. Wave 72 (AI_OS_CERTIFICATION.md §2.5): every
 * call now retries transient failures (429/5xx/network) up to twice with
 * short backoff before giving up, and -- only if a `fallback` is supplied --
 * tries a second provider/model/key (also with its own retries) once the
 * primary is fully exhausted. Every pre-existing call site that passes no
 * fallback behaves identically to before except for the added retries.
 */
export async function callLLM(
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions,
  fallback?: LLMFallback
): Promise<LLMResult> {
  const startedAt = Date.now();
  try {
    const result = await withRetry(() => dispatchLLM(provider, model, apiKey, systemPrompt, userMessage, options));
    return attachLatency(result, startedAt, provider, model);
  } catch (primaryError) {
    if (!fallback) throw primaryError;
    const result = await withRetry(() => dispatchLLM(fallback.provider, fallback.model, fallback.apiKey, systemPrompt, userMessage, options));
    return attachLatency(result, startedAt, fallback.provider, fallback.model);
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
): Promise<{ content: string; usage: LLMUsage }> {
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
  const providerPreference = openRouterProviderFor(baseUrl, model);
  if (providerPreference) body.provider = providerPreference;

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LLMHttpError(`${baseUrl} error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.choices[0].message.content as string,
    usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
  };
}

async function callVisionAnthropic(
  apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
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
  if (!res.ok) throw new LLMHttpError(`Anthropic API error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.content[0].text as string,
    usage: { promptTokens: data.usage?.input_tokens ?? 0, completionTokens: data.usage?.output_tokens ?? 0 },
  };
}

async function callVisionGoogle(
  apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
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
  if (!res.ok) throw new LLMHttpError(`Google API error ${res.status}: ${await res.text().catch(() => "")}`, res.status);
  const data = await res.json();
  return {
    content: data.candidates[0].content.parts[0].text as string,
    usage: { promptTokens: data.usageMetadata?.promptTokenCount ?? 0, completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

function dispatchVisionLLM(
  provider: LLMProvider, apiKey: string, model: string, systemPrompt: string,
  imageBase64: string, mimeType: string, instructionText: string, options?: CallLLMOptions
): Promise<{ content: string; usage: LLMUsage }> {
  switch (provider) {
    case "groq":
      return callVisionOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "openai":
      return callVisionOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "openrouter":
      return callVisionOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "cerebras":
      return callVisionOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "anthropic":
      return callVisionAnthropic(apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
    case "google":
      return callVisionGoogle(apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
  }
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
  const startedAt = Date.now();
  const result = await dispatchVisionLLM(provider, apiKey, model, systemPrompt, imageBase64, mimeType, instructionText, options);
  return attachLatency(result, startedAt, provider, model);
}

// Wave 46 testing pass: some models routed through OpenRouter (confirmed
// live with meta-llama/llama-3.3-70b-instruct, VERI FDE's evaluation call)
// wrap their JSON output in a markdown code fence even when jsonMode/
// response_format=json_object is requested -- response_format is passed
// through best-effort by OpenRouter and isn't uniformly honored by every
// upstream provider it routes to. Strips a leading/trailing ``` fence
// (with or without a "json" language tag) before parsing, so a
// spec-compliant model's untouched output and a fenced one both parse.
export function stripJsonFence(content: string): string {
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
  options?: CallLLMOptions,
  fallback?: LLMFallback
): Promise<{ data: T; usage: LLMUsage; durationMs: number }> {
  const { content, usage, durationMs } = await callLLM(provider, model, apiKey, systemPrompt, userMessage, { ...options, jsonMode: true }, fallback);
  const data = JSON.parse(stripJsonFence(content)) as T;

  if (options?.expectedKeys?.length) {
    const missing = options.expectedKeys.filter((key) => !(data && typeof data === "object" && key in (data as object)));
    if (missing.length > 0) throw new LLMVerificationError(missing);
  }

  return { data, usage, durationMs };
}
