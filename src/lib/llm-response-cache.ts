// Wave 110 (AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md, "cached answers" cascade
// step -- confirmed absent anywhere in this codebase prior; embedding_cache
// caches embeddings only, never LLM completions).
//
// Deliberately a separate file from llm-client.ts (mirrors why
// orchestra-execution-logger.ts is its own file rather than merged into
// llm-client.ts) -- llm-client.ts stays a pure, framework-agnostic HTTP
// client with no database dependency; this file is the one place that
// combines it with persistence.
//
// Deliberately OPT-IN, not automatic at every existing call site.
// embedding_cache's cache key is a bare content hash because identical
// text always embeds identically regardless of tenant -- a global cache
// is always safe there. An LLM *completion* for the same prompt text is
// NOT guaranteed safe to share across orgs (a system prompt can carry
// implicit per-org context, and a "same" user message from two different
// orgs can expect different answers depending on data referenced within),
// so the cache key here is scoped by orgId, and entries expire (business
// data goes stale in a way static embedded text never does). Only call
// this from a site where the caller has already judged the exact same
// (org, provider, model, systemPrompt, userMessage) tuple is likely to
// repeat and safe to reuse verbatim -- e.g. VERI FDE's task-similarity
// evaluation. Never caches an error or a policy-denied response.
import { db, llmResponseCache } from "@/lib/db";
import { eq, lt } from "drizzle-orm";
import { createHash } from "crypto";
import { callLLM, type LLMProvider, type CallLLMOptions, type LLMFallback, type LLMResult } from "@/lib/llm-client";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours -- business-data answers go stale, unlike static embedded text

function buildCacheKey(orgId: string, provider: LLMProvider, model: string, systemPrompt: string, userMessage: string): string {
  return createHash("sha256").update(`${orgId}|${provider}|${model}|${systemPrompt}|${userMessage}`).digest("hex");
}

export async function callLLMCached(
  ctx: { orgId: string },
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions,
  fallback?: LLMFallback
): Promise<LLMResult & { cached: boolean }> {
  const cacheKey = buildCacheKey(ctx.orgId, provider, model, systemPrompt, userMessage);
  const now = new Date();

  const hit = await db.query.llmResponseCache.findFirst({ where: eq(llmResponseCache.cacheKey, cacheKey) });
  if (hit && hit.expiresAt > now) {
    return { content: hit.content, usage: { promptTokens: hit.promptTokens, completionTokens: hit.completionTokens }, cached: true };
  }

  const result = await callLLM(provider, model, apiKey, systemPrompt, userMessage, options, fallback);

  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
  if (hit) {
    await db.update(llmResponseCache).set({
      content: result.content, promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, expiresAt,
    }).where(eq(llmResponseCache.cacheKey, cacheKey));
  } else {
    await db.insert(llmResponseCache).values({
      cacheKey, content: result.content, promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, expiresAt,
    }).catch(() => {}); // best-effort -- a duplicate-key race losing to a concurrent identical call is harmless, never fail the caller's real response over it
  }

  return { ...result, cached: false };
}

/** Opportunistic cleanup of expired entries -- called from the existing daily loop infrastructure, not a new cron. */
export async function purgeExpiredLlmResponseCache(): Promise<number> {
  const deleted = await db.delete(llmResponseCache).where(lt(llmResponseCache.expiresAt, new Date())).returning({ id: llmResponseCache.id });
  return deleted.length;
}
