// Prompt & Cache Management Framework, Phase 1 (2026-07-14). Fire-and-forget
// metrics write, same posture as orchestra-execution-logger.ts's
// recordOrchestraExecution() (this module's direct sibling/precedent):
// observability logging must never block or fail the real AI call it's
// recording. A failure here is caught and warned, never thrown.
import { promptCacheMetrics } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import type { LLMUsage } from "@/lib/llm-client";
import { logTokenUsage } from "@/lib/services/token-usage-service";

export type RecordPromptCacheMetricInput = {
  orgId: string;
  userId?: string;
  layerKey: string;
  fingerprint: string;
  provider: string;
  model: string;
  usage: LLMUsage;
};

export function recordPromptCacheMetric(params: RecordPromptCacheMetricInput): void {
  // "Attempted" means the provider adapter actually honored enablePromptCache
  // (currently only callAnthropic, and only above its minimum cacheable
  // size) -- LLMUsage's own contract is that cacheReadTokens/
  // cacheCreationTokens stay undefined (not 0) when no attempt was made,
  // which is exactly the signal used here rather than re-deriving provider/
  // size logic a second time in this file.
  const cacheAttempted = params.usage.cacheReadTokens !== undefined || params.usage.cacheCreationTokens !== undefined;

  withTenantContext({ orgId: params.orgId }, async (db) => {
    await db.insert(promptCacheMetrics).values({
      orgId: params.orgId,
      layerKey: params.layerKey,
      fingerprint: params.fingerprint,
      provider: params.provider,
      model: params.model,
      cacheAttempted,
      promptTokens: params.usage.promptTokens ?? null,
      cacheReadTokens: params.usage.cacheReadTokens ?? null,
      cacheCreationTokens: params.usage.cacheCreationTokens ?? null,
    });
  }).catch((err) => console.warn(`prompt_cache_metrics logging failed for layer '${params.layerKey}' (non-fatal):`, err));

  // VERIDIAN Review Framework remediation (AI Cost Governance & FinOps,
  // 2026-07-18): prompt_cache_metrics above is cache-effectiveness
  // observability only -- cost-guard.ts's spend-cap check and
  // getTokenUsageSummary()'s Finance report both read token_usage_ledger,
  // not this table, so cache-driven savings (and this call site's spend at
  // all) were invisible to both. Log alongside it here so the one ledger
  // Finance actually reads gets both the real spend and the real savings
  // for every call this layer makes, not just the cache-specific subset.
  void logTokenUsage({
    scope: "product_orchestra",
    orgId: params.orgId,
    userId: params.userId ?? null,
    layerKey: params.layerKey,
    provider: params.provider,
    model: params.model,
    usage: params.usage,
  });
}
