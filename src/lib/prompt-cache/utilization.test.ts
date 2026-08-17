import { describe, expect, test } from "bun:test";
import { buildLayerSummaries, buildDailyBuckets, predictNextDayCacheSavings, type LayerModelAgg, type DayModelAgg, type DailyCacheBucket } from "./utilization";

// "claude-sonnet-5" is a real MODEL_PRICING row (promptPer1k: 0.003) --
// used throughout so estimatePromptCacheSavingsUsd() never silently
// returns null and masks a real assertion.
const PRICED_MODEL = "claude-sonnet-5";
const UNPRICED_MODEL = "some-future-model-not-in-pricing-table";

describe("buildLayerSummaries", () => {
  test("aggregates multiple models within one layer and computes hitRate", () => {
    const rows: LayerModelAgg[] = [
      { layerKey: "user_assistant_oa", model: PRICED_MODEL, totalCalls: 10, cacheAttempted: 8, cacheHits: 6, totalPromptTokens: 20000, totalCacheReadTokens: 5000, totalCacheCreationTokens: 1000 },
      { layerKey: "user_assistant_oa", model: "claude-haiku-4-5-20251001", totalCalls: 4, cacheAttempted: 2, cacheHits: 2, totalPromptTokens: 3000, totalCacheReadTokens: 500, totalCacheCreationTokens: 200 },
    ];
    const [summary] = buildLayerSummaries(rows);
    expect(summary.layerKey).toBe("user_assistant_oa");
    expect(summary.totalCalls).toBe(14);
    expect(summary.cacheAttempted).toBe(10);
    expect(summary.cacheHits).toBe(8);
    expect(summary.hitRate).toBeCloseTo(0.8, 5);
    expect(summary.totalCacheReadTokens).toBe(5500);
    // Real Anthropic-shaped savings: (5000/1000*0.003*0.9) - (1000/1000*0.003*0.25)
    // + (500/1000*0.0008*0.9) - (200/1000*0.0008*0.25) > 0 for this mix.
    expect(summary.estimatedUsdSaved).toBeGreaterThan(0);
  });

  test("hitRate is 0, not NaN, when cacheAttempted is 0", () => {
    const rows: LayerModelAgg[] = [
      { layerKey: "never_attempted", model: PRICED_MODEL, totalCalls: 5, cacheAttempted: 0, cacheHits: 0, totalPromptTokens: 1000, totalCacheReadTokens: 0, totalCacheCreationTokens: 0 },
    ];
    const [summary] = buildLayerSummaries(rows);
    expect(summary.hitRate).toBe(0);
    expect(Number.isNaN(summary.hitRate)).toBe(false);
  });

  test("an unpriced model contributes $0 to estimatedUsdSaved without dropping its tokens/calls", () => {
    const rows: LayerModelAgg[] = [
      { layerKey: "layer_a", model: UNPRICED_MODEL, totalCalls: 3, cacheAttempted: 3, cacheHits: 3, totalPromptTokens: 900, totalCacheReadTokens: 900, totalCacheCreationTokens: 100 },
    ];
    const [summary] = buildLayerSummaries(rows);
    expect(summary.estimatedUsdSaved).toBe(0);
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalCacheReadTokens).toBe(900);
  });

  test("sorts layers by totalCalls descending", () => {
    const rows: LayerModelAgg[] = [
      { layerKey: "small", model: PRICED_MODEL, totalCalls: 2, cacheAttempted: 0, cacheHits: 0, totalPromptTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0 },
      { layerKey: "big", model: PRICED_MODEL, totalCalls: 50, cacheAttempted: 0, cacheHits: 0, totalPromptTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0 },
    ];
    const summaries = buildLayerSummaries(rows);
    expect(summaries.map((s) => s.layerKey)).toEqual(["big", "small"]);
  });
});

describe("buildDailyBuckets", () => {
  test("merges same-day rows across models and sorts ascending by date", () => {
    const rows: DayModelAgg[] = [
      { date: "2026-08-02", model: PRICED_MODEL, totalCalls: 5, cacheHits: 3, cacheReadTokens: 1000, cacheCreationTokens: 100 },
      { date: "2026-08-01", model: PRICED_MODEL, totalCalls: 4, cacheHits: 2, cacheReadTokens: 800, cacheCreationTokens: 80 },
      { date: "2026-08-01", model: UNPRICED_MODEL, totalCalls: 1, cacheHits: 1, cacheReadTokens: 200, cacheCreationTokens: 0 },
    ];
    const buckets = buildDailyBuckets(rows);
    expect(buckets.map((b) => b.date)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(buckets[0].totalCalls).toBe(5);
    expect(buckets[0].cacheReadTokens).toBe(1000);
  });
});

describe("predictNextDayCacheSavings", () => {
  test("no data -> zeroed low-confidence prediction, not a crash", () => {
    const prediction = predictNextDayCacheSavings([]);
    expect(prediction.confidence).toBe("low");
    expect(prediction.dataPointsUsed).toBe(0);
    expect(prediction.predictedNextDayCacheReadTokens).toBe(0);
  });

  test("uses a trailing window of at most 7 days and reports confidence by real history length", () => {
    const days: DailyCacheBucket[] = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      totalCalls: 10,
      cacheHits: 5,
      cacheReadTokens: 1000, // constant series -> prediction should equal the constant
      estimatedUsdSaved: 2.5,
    }));
    const prediction = predictNextDayCacheSavings(days);
    expect(prediction.dataPointsUsed).toBe(7);
    expect(prediction.confidence).toBe("high"); // 20 real days of history
    expect(prediction.predictedNextDayCacheReadTokens).toBe(1000);
    expect(prediction.predictedNextDayUsdSaved).toBeCloseTo(2.5, 5);
  });

  test("low confidence with sparse history, still returns a usable point estimate", () => {
    const days: DailyCacheBucket[] = [
      { date: "2026-08-01", totalCalls: 2, cacheHits: 1, cacheReadTokens: 200, estimatedUsdSaved: 0.05 },
      { date: "2026-08-02", totalCalls: 3, cacheHits: 2, cacheReadTokens: 400, estimatedUsdSaved: 0.1 },
    ];
    const prediction = predictNextDayCacheSavings(days);
    expect(prediction.dataPointsUsed).toBe(2);
    expect(prediction.confidence).toBe("low");
    expect(prediction.predictedNextDayCacheReadTokens).toBe(300);
  });
});
