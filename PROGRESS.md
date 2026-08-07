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

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (`active:`
      section, file-scoped).
- [x] Added `closed_priorities` Priority 26 entry to
      `ai-os/MASTER-TRACKER.yaml` documenting this closure, including the
      tsc-not-independently-confirmed caveat below, honestly.
- [x] All 3 governance YAML files (`CONSTITUTION.yaml`,
      `MASTER-TRACKER.yaml`, `ACTIVE-CLAIMS.yaml`) confirmed still
      `yaml.safe_load`-parseable after edits.
- [x] Push branch + open PR (per AGENTS.md Rule 6 -- no direct push to
      `main`): https://github.com/FChecklist/compliance-tracker/pull/1017 --
      CI's own Type Check job will give the real tsc answer this session's
      sandbox couldn't.
- [x] (2026-08-07, later invocation) PR #1017 had gone `CONFLICTING`/`DIRTY`
      against `main` (this repo's `main` had moved 788 commits ahead since
      this branch's last merge-base; this branch's own worktree turned out
      to be shallow, which is why `git merge-base` initially failed silently
      -- fixed with `git fetch --unshallow`). Merged `origin/main` into this
      branch; 4 real conflicts, all resolved by hand and independently
      re-verified, not blindly auto-resolved:
      - `PROGRESS.md` -- kept this task's own content; main's conflicting
        version was a **different, unrelated task's** progress file
        (`task-20260805-151445-...`, an OCID-064 PR-closure task) that
        happened to collide on this shared root-level filename.
      - `ai-os/CONSTITUTION.yaml` -- pure append conflict in
        `amendment_log` (kept both entries) and a `related_ops_infrastructure`
        section main added (purely additive, kept as-is). Re-validated
        `yaml.safe_load`-parseable after resolution.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- pure append conflict in the
        `active:` list (this branch's copy was from an old merge-base and
        was missing ~15 entries main had already added); kept this task's
        own claim entry plus all of main's entries, dropped nothing.
        Re-validated `yaml.safe_load`-parseable after resolution.
      - `src/lib/llm-client.ts` -- **real logic collision**: another
        session had independently added `estimateCacheSavingsUsd()` to
        `main` (gross read-side-only savings, already wired into
        `token-usage-service.ts` + its own test file) while this branch
        added `estimatePromptCacheSavingsUsd()` (net of read savings minus
        write overhead, wired into `prompt-cache/utilization.ts`).
        Different call signatures, different callers, both already live on
        their respective branches -- kept **both** functions rather than
        collapsing them into one (lower risk than a same-session rewrite of
        another session's already-wired code), with a comment on the new
        one cross-referencing the sibling and explaining why they differ
        (gross vs. net). `bun test src/lib/llm-client.test.ts
        src/lib/prompt-cache/utilization.test.ts` -- 22 pass / 0 fail after
        the merge. `bunx eslint` clean on all 3 resolved files.
      - Caught and fixed a self-inflicted truncation bug mid-resolution:
        an earlier `git show :2:PROGRESS.md > PROGRESS.md` redirect via the
        Bash tool silently truncated the file from 77 to 31 lines (known
        class of issue, see this session's own memory note on Bash-tool
        redirect truncation) -- caught by an unexpectedly-short `Read`,
        confirmed against the pre-merge blob via `git cat-file -p` +
        `git cat-file -s` (byte count matched exactly), restored in full.
      - Pushed the merge commit; PR #1017 is now `MERGEABLE`/`BLOCKED`
        (blocked on required CI checks re-running post-push, not on
        conflicts). Not self-merging -- CI result + eventual audit remains
        the next step for a future/supervising session, per this task's
        original plan.

## Remaining
- [ ] Full-project `tsc --noEmit` -- attempted twice earlier this session
      (foreground w/ 6GB heap: OOM in ~14s; background w/ 8GB heap:
      process vanished with no log output, also consistent with an OOM
      kill), both consistent with this box's own resource pressure that day
      rather than a defect in the new code (Priority 25's own note
      confirms a full tsc run normally completes here with 21
      pre-existing unrelated-package errors as baseline). Per this
      session's own stop-after-2-failures rule, not attempting a 3rd
      time -- flagged honestly in MASTER-TRACKER.yaml Priority 26 rather
      than silently claimed clean. Risk assessed low: every new query
      shape mirrors an already-compiling precedent 1:1. CI's own Type
      Check job on PR #1017 is the real, authoritative answer -- check its
      result before assuming either way.
- [ ] Confirm CI goes green on PR #1017 post-merge-commit (just pushed,
      checks were still `pending` at push time) and get it merged/audited.
