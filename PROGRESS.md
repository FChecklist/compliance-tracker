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
... more files changed
