# PROGRESS -- Cache & Synchronization: Cache Utilization & Prediction

Task: `ai-os/CONSTITUTION.yaml`'s `prompt_cache_framework` (CACHE-01..04,
built 2026-07-14) wired `prompt_cache_metrics` INSERTs into
`chat-service.ts` but built zero readers -- the table was a write-only
sink. No prior spec doc named "Cache Utilization & Prediction" existed
anywhere in this repo (checked `ai-os/MASTER-TRACKER.yaml`, `control/`
[does not exist in this repo], and grepped the whole tree) -- this task's
title is interpreted as: close that gap, honestly, scoped to what real
data supports.

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md) and
      `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no existing/overlapping active
      claim on `prompt_cache_metrics` or `src/lib/prompt-cache/*`;
      registered this task's own claim.
- [x] Confirmed via `git grep promptCacheMetrics` that the table had
      exactly 3 matches in `src/`: `schema.ts` (table def), `metrics.ts`
      (the Phase 1 writer), `chat-service.ts` (the one call site) -- zero
      readers, zero API routes, zero aggregation. This is the real gap
      "Cache Utilization" names.
- [x] Added `estimatePromptCacheSavingsUsd()` to `src/lib/llm-client.ts`
      (additive, next to the existing `estimateCostUsd()`) -- Anthropic's
      published cache pricing (read = 0.1x base price, write = 1.25x base
      price), net savings estimate, `null` for unpriced models (same
      honest-limitation convention as `estimateCostUsd`).
- [x] Built `src/lib/prompt-cache/utilization.ts` (CACHE-05 utilization
      report, CACHE-06 prediction):
      - `getCacheUtilizationSummary(sinceDays)` -- platform-wide report
        (mirrors `token-usage-service.ts`'s own reasoning for using the
        raw `db` client instead of `withTenantContext`), grouped by
        layer and by day: total calls, cache-attempted, real hits
        (`cacheReadTokens > 0`, not just attempted), hit rate, tokens,
        estimated USD saved.
      - `predictNextDayCacheSavings(byDay)` -- a documented trailing
        (<=7-day) moving average over real daily buckets, NOT a trained
        model. `confidence` is a data-volume signal, stated honestly as
        such, not a statistical error bound.
      - `buildLayerSummaries()`/`buildDailyBuckets()` exported as pure
        functions specifically so they're unit-testable without a DB.
- [x] `src/app/api/ai/team/cache-utilization/route.ts` -- GET, `veridian_admin`-gated,
      same posture as the sibling `/api/ai/team/token-usage` route it
      mirrors.
- [x] `src/lib/prompt-cache/utilization.test.ts` -- 8 tests covering
      multi-model aggregation, zero-division hit-rate safety, unpriced-model
      $0-not-dropped behavior, sort order, empty-history prediction, and
      confidence-by-history-length. `bun test` -- 8 pass / 0 fail.
- [x] `bunx eslint` clean on all 4 changed/new files.
- [x] Updated `ai-os/CONSTITUTION.yaml`: added CACHE-05/CACHE-06 to
      `prompt_cache_framework`, logged in `amendment_log`.

## Remaining
- [ ] Full-project `tsc --noEmit` -- attempted twice, both times the
      sandbox killed it on OOM/timeout before completion (this repo's
      full type-check appears to need more time/memory than this box
      reliably gives a single foreground command; a background run was
      started, result pending). New code closely mirrors
      `token-usage-service.ts`'s already-compiling pattern (same
      `db.select().groupBy()` shape, same `db.execute(sql...)` +
      `as unknown as {...}[]` cast convention as
      `report-engine-service.ts`'s `computeSnagTrendAnalysis`) -- low risk,
      but not independently confirmed by a completed tsc run yet.
- [ ] Update `ai-os/boss/ACTIVE-CLAIMS.yaml` (register claim, then move to
      `recently_completed` once the PR is up).
- [ ] Add a `closed_priorities` entry to `ai-os/MASTER-TRACKER.yaml`
      documenting this closure.
- [ ] Commit, push, open PR (per AGENTS.md Rule 6 -- no direct push to
      `main`).
