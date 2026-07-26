// VERIDIAN_Architecture_v2.0 phase_5 (2026-07-26): extracted out of
// llm-client.ts so this pure pricing lookup can be imported by
// src/lib/prompt-compiler/verification-pipeline.ts (phase_2's
// pipeline-verification stage, part of the machine-language-output
// contract phase_5's browser-execution engine calls directly from the
// client) WITHOUT pulling llm-client.ts's ~750-line, 5-provider HTTP call
// surface into a client bundle. Zero imports, zero I/O -- safe in both
// server and browser contexts. llm-client.ts re-exports every name below
// (including the LLMUsage type, moved here since estimateCostUsd/
// estimateCacheSavingsUsd are its only real producers/consumers) unchanged,
// so no existing server-side import site needed to change.
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

// Approximate, manually-maintained reference pricing (USD per 1K tokens) --
// no live pricing API exists for any of these 4 providers, so this is an
// honest-limitation constant like others in this codebase, not a precise
// billing source. Returns null for any unrecognized model rather than
// guessing at a cost.
export const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
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
// callAnthropic's cache_control comment in llm-client.ts for the write-side
// premium (1.25x, a cost rather than a saving on the call that populates
// the cache). Only the read-side discount is counted as "savings" here;
// estimateCostUsd above already excludes cache tokens from promptTokens
// entirely (Anthropic's input_tokens does not include them), so this is
// additive, not a correction to an existing charge.
export const ANTHROPIC_CACHE_READ_DISCOUNT = 0.9;

/** Real $ saved on this call from Anthropic prompt-cache reads. null when caching wasn't attempted or the model has no pricing row -- never 0 standing in for "not attempted", same LLMUsage contract as cacheReadTokens itself. */
export function estimateCacheSavingsUsd(model: string, usage: LLMUsage): number | null {
  if (usage.cacheReadTokens === undefined) return null;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (usage.cacheReadTokens / 1000) * pricing.promptPer1k * ANTHROPIC_CACHE_READ_DISCOUNT;
}
