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
//
// Gap closure, 2026-08-07 (VERIDIAN Review Framework, Cache & Synchronization
// / "Cache Integrity & Security", 2 of its 3 findings -- see PROGRESS.md for
// the third, "Offline Cache Support", which does not apply to this file):
//
// 1. "Cache Security & Encryption" (High) -- `content` is now encrypted at
//    rest with the same pgcrypto (pgp_sym_encrypt) helper
//    src/lib/ai-config-crypto.ts already uses for BYOK provider API keys and
//    erp-vendor-master-service.ts already uses for vendor bank account
//    numbers -- this file is a third caller of that same established
//    encryption-at-rest primitive, not a new one. No real KMS integration
//    exists anywhere in this codebase to "evaluate" (confirmed by grep: zero
//    aws-sdk/@aws-sdk/client-kms or equivalent anywhere in package.json);
//    this symmetric-key pgcrypto approach *is* VERIDIAN's existing at-rest
//    encryption mechanism for comparably sensitive server-side secrets, so
//    reusing it here (rather than inventing a second, parallel encryption
//    scheme) is the honest scope for this gap. Reuses AI_CONFIG_ENCRYPTION_KEY
//    rather than introducing a new required env var -- it's already
//    provisioned in every environment that runs this app (already in
//    CLAUDE.md's "Env Vars Required" lineage and already checked by
//    /api/internal/secrets-audit/run) and a cache row is not more sensitive
//    than a raw provider API key or a bank account number, so a dedicated
//    second key would add deployment risk (a second secret that can be
//    forgotten) without a matching security benefit.
//    Both read and write are best-effort around encryption specifically:
//    a decrypt failure (a pre-encryption legacy plaintext row, a rotated
//    key, or corrupt ciphertext) is treated as a cache miss, never as a
//    thrown error -- the caller falls through to a fresh LLM call, and the
//    write path below then overwrites that row with a freshly encrypted
//    value. An encrypt failure on write is swallowed exactly like the
//    pre-existing insert-race .catch(() => {}) below -- caching is always
//    best-effort, never allowed to block the real LLM response reaching
//    the caller.
//
// 2. "Automatic Cache Invalidation" (Medium) -- gap was "no event-driven
//    invalidation"; per that finding's own recommended approach ("Selective
//    TTL tuning by data volatility"), the fix implemented is TTL tuning,
//    not a full event-bus invalidation system. Previously every caller was
//    forced onto one hardcoded module-level 24h constant with no way to
//    say a given prompt's answer is safe for longer, or must not outlive an
//    hour. `ttlMs` is now a per-call option, with CACHE_TTL exporting named
//    presets so a future caller can pick semantically instead of
//    hardcoding a raw millisecond number. Both of today's real callers
//    (orchestrate/route.ts, fde-service.ts) were re-checked against their
//    own already-documented volatility reasoning -- both already fit
//    CACHE_TTL.STANDARD (their existing implicit 24h) and are left on the
//    default rather than given a fabricated override; the value delivered
//    here is that TTL is no longer an unconfigurable constant for whatever
//    caller comes next.
import { db, llmResponseCache } from "@/lib/db";
import { eq, lt } from "drizzle-orm";
import { createHash } from "crypto";
import { encryptApiKey, decryptApiKey } from "@/lib/ai-config-crypto";
import { callLLM, stripJsonFence, LLMVerificationError, type LLMProvider, type CallLLMOptions, type LLMFallback, type LLMResult, type LLMUsage } from "@/lib/llm-client";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours -- business-data answers go stale, unlike static embedded text

/**
 * Named TTL presets a caller can pick by data volatility instead of
 * hardcoding a raw millisecond number. STANDARD matches this module's
 * long-standing default (unchanged, so existing callers that pass no
 * `ttlMs` keep their current behavior exactly).
 */
export const CACHE_TTL = {
  /** Fast-moving inputs (e.g. live counters, near-real-time status) that should not be trusted stale for long. */
  HIGH_VOLATILITY: 60 * 60 * 1000, // 1 hour
  /** Default -- fine for answers driven by data that changes at most once or twice a day (e.g. day-granularity overdue/deadline counters). */
  STANDARD: DEFAULT_TTL_MS, // 24 hours
  /** Slow-moving reference-style answers (e.g. resolved against a catalog that itself is baked into the cache key, so a catalog change already mints a new key) safe to keep longer. */
  LOW_VOLATILITY: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

function buildCacheKey(orgId: string, provider: LLMProvider, model: string, systemPrompt: string, userMessage: string): string {
  return createHash("sha256").update(`${orgId}|${provider}|${model}|${systemPrompt}|${userMessage}`).digest("hex");
}

type CacheLookup = { content: string; promptTokens: number; completionTokens: number } | null;

/** Looks up a live (unexpired), decryptable cache row. Returns null on a miss, an expired row, OR an undecryptable row -- all three are treated identically by callers (fall through to a fresh LLM call). */
async function lookupCache(cacheKey: string, now: Date): Promise<{ lookup: CacheLookup; rowExists: boolean }> {
  const hit = await db.query.llmResponseCache.findFirst({ where: eq(llmResponseCache.cacheKey, cacheKey) });
  if (!hit) return { lookup: null, rowExists: false };
  if (hit.expiresAt <= now) return { lookup: null, rowExists: true };
  try {
    const content = await decryptApiKey(hit.content);
    return { lookup: { content, promptTokens: hit.promptTokens, completionTokens: hit.completionTokens }, rowExists: true };
  } catch {
    return { lookup: null, rowExists: true };
  }
}

/** Encrypts and upserts a cache row. Best-effort around the whole operation -- see this file's header for why a caching failure must never propagate to the caller. */
async function writeCache(cacheKey: string, rowExists: boolean, content: string, promptTokens: number, completionTokens: number, expiresAt: Date): Promise<void> {
  try {
    const encrypted = await encryptApiKey(content);
    if (rowExists) {
      await db.update(llmResponseCache).set({ content: encrypted, promptTokens, completionTokens, expiresAt }).where(eq(llmResponseCache.cacheKey, cacheKey));
    } else {
      await db.insert(llmResponseCache).values({ cacheKey, content: encrypted, promptTokens, completionTokens, expiresAt });
    }
  } catch {
    // best-effort -- encryption unavailable, a duplicate-key race losing to
    // a concurrent identical call, or any other write failure is harmless
    // to swallow here; never fail the caller's real LLM response over it.
  }
}

export async function callLLMCached(
  ctx: { orgId: string },
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions & { ttlMs?: number },
  fallback?: LLMFallback
): Promise<LLMResult & { cached: boolean }> {
  const cacheKey = buildCacheKey(ctx.orgId, provider, model, systemPrompt, userMessage);
  const now = new Date();

  const { lookup, rowExists } = await lookupCache(cacheKey, now);
  if (lookup) {
    // durationMs: 0 -- a cache hit made no real provider call, so there is
    // no latency to report (distinct from a genuinely instant 0ms call).
    return { content: lookup.content, usage: { promptTokens: lookup.promptTokens, completionTokens: lookup.completionTokens }, durationMs: 0, cached: true };
  }

  const result = await callLLM(provider, model, apiKey, systemPrompt, userMessage, options, fallback);

  const expiresAt = new Date(now.getTime() + (options?.ttlMs ?? DEFAULT_TTL_MS));
  await writeCache(cacheKey, rowExists, result.content, result.usage.promptTokens, result.usage.completionTokens, expiresAt);

  return { ...result, cached: false };
}

// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, AI Cost Optimization
// section): this whole module existed with zero callers -- its own header
// comment already named VERI FDE's task-similarity evaluation as the
// intended first caller, which never happened. That call site uses
// callLLMJson (JSON mode + expectedKeys verification), not the plain
// callLLM callLLMCached wraps, so a JSON-aware variant was the missing
// piece, not a design flaw in this file.
export async function callLLMJsonCached<T>(
  ctx: { orgId: string },
  provider: LLMProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: CallLLMOptions & { expectedKeys?: string[]; ttlMs?: number },
  fallback?: LLMFallback
): Promise<{ data: T; usage: LLMUsage; cached: boolean }> {
  const { content, usage, cached } = await (async () => {
    const cacheKey = buildCacheKey(ctx.orgId, provider, model, systemPrompt, userMessage);
    const now = new Date();
    const { lookup, rowExists } = await lookupCache(cacheKey, now);
    if (lookup) {
      return { content: lookup.content, usage: { promptTokens: lookup.promptTokens, completionTokens: lookup.completionTokens }, cached: true };
    }
    const result = await callLLM(provider, model, apiKey, systemPrompt, userMessage, { ...options, jsonMode: true }, fallback);
    const expiresAt = new Date(now.getTime() + (options?.ttlMs ?? DEFAULT_TTL_MS));
    await writeCache(cacheKey, rowExists, result.content, result.usage.promptTokens, result.usage.completionTokens, expiresAt);
    return { ...result, cached: false };
  })();

  const data = JSON.parse(stripJsonFence(content)) as T;
  if (options?.expectedKeys?.length) {
    const missing = options.expectedKeys.filter((key) => !(data && typeof data === "object" && key in (data as object)));
    if (missing.length > 0) throw new LLMVerificationError(missing);
  }
  return { data, usage, cached };
}

/** Opportunistic cleanup of expired entries -- called from the existing daily loop infrastructure, not a new cron. */
export async function purgeExpiredLlmResponseCache(): Promise<number> {
  const deleted = await db.delete(llmResponseCache).where(lt(llmResponseCache.expiresAt, new Date())).returning({ id: llmResponseCache.id });
  return deleted.length;
}
