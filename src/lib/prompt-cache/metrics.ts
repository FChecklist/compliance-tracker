// Prompt & Cache Management Framework, Phase 1 (2026-07-14). Fire-and-forget
// metrics write, same posture as orchestra-execution-logger.ts's
// recordOrchestraExecution() (this module's direct sibling/precedent):
// observability logging must never block or fail the real AI call it's
// recording. A failure here is caught and warned, never thrown.
import { promptCacheMetrics } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import type { LLMUsage } from "@/lib/llm-client";

export type RecordPromptCacheMetricInput = {
  orgId: string;
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
}
