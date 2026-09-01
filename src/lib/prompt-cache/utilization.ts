// Prompt & Cache Management Framework, Phase 2 (Cache & Synchronization:
// Cache Utilization & Prediction task, 2026-08-07). Phase 1 (CACHE-01
// through CACHE-04, 2026-07-14) wired prompt_cache_metrics INSERTs into
// chat-service.ts but built no reader anywhere -- confirmed via
// `git grep promptCacheMetrics`: only schema.ts (table def), metrics.ts
// (the writer), and chat-service.ts (the one call site) matched. The table
// was a write-only sink with zero API routes or aggregation querying it.
// This file is that reader: CACHE-05 (utilization reporting) and CACHE-06
// (a lightweight historical-trend prediction), scoped to what the real
// per-row data actually supports -- no ML model, no external forecasting
// library, a documented trailing moving average over real daily buckets,
// honest about its own low-data-volume limitation via the `confidence`
// field rather than presenting a point estimate as precise.
//
// Platform-wide report, not org-scoped: promptCacheMetrics spans every
// org's calls on a shared, small set of layerKeys (currently just
// chat-service.ts's "user_assistant_oa"), and the consuming route is
// veridian_admin-only -- the same "platform-governed asset" posture
// token-usage-service.ts's getTokenUsageSummary() already uses for the
// same reason, so this uses the raw `db` client rather than
// withTenantContext's org-scoped model.
import { db, promptCacheMetrics } from "@/lib/db";
import { sql, gte } from "drizzle-orm";
import { estimatePromptCacheSavingsUsd } from "@/lib/llm-client";

export type LayerModelAgg = {
  layerKey: string;
  model: string;
  totalCalls: number;
  cacheAttempted: number;
  cacheHits: number;
  totalPromptTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
};

export type DayModelAgg = {
  date: string; // YYYY-MM-DD, UTC (date_trunc('day', ...) at the DB layer)
  model: string;
  totalCalls: number;
  cacheHits: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type CacheLayerSummary = {
  layerKey: string;
  totalCalls: number;
  cacheAttempted: number;
  // A real hit means cacheAttempted AND the provider actually returned
  // cacheReadTokens > 0 -- an attempt alone (e.g. a cold cache write) is
  // not a hit, and this is deliberately distinct from cacheAttempted.
  cacheHits: number;
  hitRate: number; // cacheHits / cacheAttempted; 0 (not NaN) when cacheAttempted is 0
  totalPromptTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  // Sum of estimatePromptCacheSavingsUsd() per (layerKey, model) group.
  // Unpriced models (MODEL_PRICING has no row) contribute $0 here, same
  // convention token-usage-service.ts's coalesce(sum(...), 0) already
  // uses elsewhere -- never silently dropped from totalCalls/tokens, only
  // from the USD estimate.
  estimatedUsdSaved: number;
};

export type DailyCacheBucket = {
  date: string;
  totalCalls: number;
  cacheHits: number;
  cacheReadTokens: number;
  estimatedUsdSaved: number;
};

export type CachePredictionConfidence = "low" | "medium" | "high";

export type CachePrediction = {
  method: string;
  confidence: CachePredictionConfidence;
  dataPointsUsed: number;
  predictedNextDayCacheReadTokens: number;
  predictedNextDayUsdSaved: number;
};

export type CacheUtilizationSummary = {
  sinceDays: number;
  totalCalls: number;
  totalCacheAttempted: number;
  totalCacheHits: number;
  overallHitRate: number;
  totalEstimatedUsdSaved: number;
  byLayer: CacheLayerSummary[];
  byDay: DailyCacheBucket[];
  prediction: CachePrediction;
};

/** Pure aggregation -- exported separately so tests can exercise it without a DB. */
export function buildLayerSummaries(rows: LayerModelAgg[]): CacheLayerSummary[] {
  const byLayer = new Map<string, CacheLayerSummary>();
  for (const row of rows) {
    const existing = byLayer.get(row.layerKey) ?? {
      layerKey: row.layerKey,
      totalCalls: 0,
      cacheAttempted: 0,
      cacheHits: 0,
      hitRate: 0,
      totalPromptTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      estimatedUsdSaved: 0,
    };
    const savedUsd = estimatePromptCacheSavingsUsd(row.model, row.totalCacheReadTokens, row.totalCacheCreationTokens) ?? 0;
    existing.totalCalls += row.totalCalls;
    existing.cacheAttempted += row.cacheAttempted;
    existing.cacheHits += row.cacheHits;
    existing.totalPromptTokens += row.totalPromptTokens;
    existing.totalCacheReadTokens += row.totalCacheReadTokens;
    existing.totalCacheCreationTokens += row.totalCacheCreationTokens;
    existing.estimatedUsdSaved += savedUsd;
    byLayer.set(row.layerKey, existing);
  }
  for (const summary of byLayer.values()) {
    summary.hitRate = summary.cacheAttempted > 0 ? summary.cacheHits / summary.cacheAttempted : 0;
    summary.estimatedUsdSaved = Number(summary.estimatedUsdSaved.toFixed(6));
  }
  return Array.from(byLayer.values()).sort((a, b) => b.totalCalls - a.totalCalls);
}

/** Pure aggregation -- exported separately so tests can exercise it without a DB. */
export function buildDailyBuckets(rows: DayModelAgg[]): DailyCacheBucket[] {
  const byDay = new Map<string, DailyCacheBucket>();
  for (const row of rows) {
    const existing = byDay.get(row.date) ?? { date: row.date, totalCalls: 0, cacheHits: 0, cacheReadTokens: 0, estimatedUsdSaved: 0 };
    const savedUsd = estimatePromptCacheSavingsUsd(row.model, row.cacheReadTokens, row.cacheCreationTokens) ?? 0;
    existing.totalCalls += row.totalCalls;
    existing.cacheHits += row.cacheHits;
    existing.cacheReadTokens += row.cacheReadTokens;
    existing.estimatedUsdSaved += savedUsd;
    byDay.set(row.date, existing);
  }
  for (const bucket of byDay.values()) {
    bucket.estimatedUsdSaved = Number(bucket.estimatedUsdSaved.toFixed(6));
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Deliberately NOT a trained ML model or an external forecasting library --
// a trailing moving average over the real daily buckets this module already
// computes. Honest about its own limitation: this is a short-horizon
// (1-day-ahead) point estimate from whatever history exists, not a
// validated time-series model; `confidence` is a data-volume signal (how
// many real days of history back it), not a statistical error bound.
export function predictNextDayCacheSavings(byDay: DailyCacheBucket[]): CachePrediction {
  const totalDays = byDay.length;
  if (totalDays === 0) {
    return { method: "no_data", confidence: "low", dataPointsUsed: 0, predictedNextDayCacheReadTokens: 0, predictedNextDayUsdSaved: 0 };
  }
  const windowSize = Math.min(7, totalDays);
  const window = byDay.slice(-windowSize);
  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;
  const confidence: CachePredictionConfidence = totalDays >= 14 ? "high" : totalDays >= 5 ? "medium" : "low";
  return {
    method: `trailing_${windowSize}_day_moving_average`,
    confidence,
    dataPointsUsed: windowSize,
    predictedNextDayCacheReadTokens: Math.round(avg(window.map((d) => d.cacheReadTokens))),
    predictedNextDayUsdSaved: Number(avg(window.map((d) => d.estimatedUsdSaved)).toFixed(6)),
  };
}

const LAYER_MODEL_AGG_COLUMNS = {
  totalCalls: sql<number>`count(*)::int`,
  cacheAttempted: sql<number>`count(*) filter (where ${promptCacheMetrics.cacheAttempted})::int`,
  cacheHits: sql<number>`count(*) filter (where coalesce(${promptCacheMetrics.cacheReadTokens}, 0) > 0)::int`,
  totalPromptTokens: sql<number>`coalesce(sum(${promptCacheMetrics.promptTokens}), 0)::int`,
  totalCacheReadTokens: sql<number>`coalesce(sum(${promptCacheMetrics.cacheReadTokens}), 0)::int`,
  totalCacheCreationTokens: sql<number>`coalesce(sum(${promptCacheMetrics.cacheCreationTokens}), 0)::int`,
};

/** Real report: is the Phase 1 prompt-cache wiring actually saving anything, broken down by layer and by day, plus a short-horizon forecast. veridian_admin-gated at the route level. */
export async function getCacheUtilizationSummary(sinceDays = 30): Promise<CacheUtilizationSummary> {
  const clampedSinceDays = Math.max(1, Math.min(90, sinceDays));
  const since = new Date(Date.now() - clampedSinceDays * 86400_000);

  const [byLayerModelRows, byDayModelRows] = await Promise.all([
    db.select({ layerKey: promptCacheMetrics.layerKey, model: promptCacheMetrics.model, ...LAYER_MODEL_AGG_COLUMNS })
      .from(promptCacheMetrics)
      .where(gte(promptCacheMetrics.createdAt, since))
      .groupBy(promptCacheMetrics.layerKey, promptCacheMetrics.model),
    db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
             model,
             count(*)::int AS "totalCalls",
             count(*) filter (where coalesce(cache_read_tokens, 0) > 0)::int AS "cacheHits",
             coalesce(sum(cache_read_tokens), 0)::int AS "cacheReadTokens",
             coalesce(sum(cache_creation_tokens), 0)::int AS "cacheCreationTokens"
      FROM compliance.prompt_cache_metrics
      WHERE created_at >= ${since}
      GROUP BY 1, 2 ORDER BY 1
    `) as unknown as { date: string; model: string; totalCalls: number; cacheHits: number; cacheReadTokens: number; cacheCreationTokens: number }[],
  ]);

  const byLayer = buildLayerSummaries(byLayerModelRows);
  const byDay = buildDailyBuckets(byDayModelRows);

  const totalCalls = byLayer.reduce((sum, l) => sum + l.totalCalls, 0);
  const totalCacheAttempted = byLayer.reduce((sum, l) => sum + l.cacheAttempted, 0);
  const totalCacheHits = byLayer.reduce((sum, l) => sum + l.cacheHits, 0);
  const totalEstimatedUsdSaved = Number(byLayer.reduce((sum, l) => sum + l.estimatedUsdSaved, 0).toFixed(6));

  return {
    sinceDays: clampedSinceDays,
    totalCalls,
    totalCacheAttempted,
    totalCacheHits,
    overallHitRate: totalCacheAttempted > 0 ? totalCacheHits / totalCacheAttempted : 0,
    totalEstimatedUsdSaved,
    byLayer,
    byDay,
    prediction: predictNextDayCacheSavings(byDay),
  };
}
