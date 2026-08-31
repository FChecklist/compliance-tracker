# PROGRESS -- rebase-sweep2-582 (replacement for PR #582)

## Scope

Replacement PR for #582 ("V2-20: search performance EXPLAIN ANALYZE +
pg_trgm GIN index", branch
`worker/task-20260726-172004-search-performance-explain-analyze---gin`).
Triage confirmed a real, additive, well-evidenced migration+doc PR: no
application code touched, migration is `CREATE INDEX IF NOT EXISTS`
(idempotent), and cites real `EXPLAIN (ANALYZE, BUFFERS)` numbers
(108-147ms Seq Scan -> 0.3-1.3ms Bitmap Heap Scan, 80-140x) from a
rolled-back live-DB transaction. Independently re-confirmed via
`gh api .../contents/drizzle?ref=main` that no pg_trgm/GIN-trgm migration
existed anywhere on main before this merge -- the gap was genuinely real.

`audit-check` had shown FAIL on the original PR, but the posted audit
comment was a confirmed misattribution: it reviewed an unrelated, empty
RCA/watchdog task branch that got auto-linked to PR #582 via the known
`adopted_existing_pr` fuzzy-match bug (same class as the real PR #84
incident), and the audit's own text recommended letting PR #582 be
reviewed/merged under its own correct identity. Not a real rejection of
this PR's content.

## Completed

- [x] Worktree: attempted a real `git merge origin/main` onto PR #582's
      actual branch first, per this repo's standard rebase-sweep protocol.
      The branch's own git history turned out to be genuinely diverged from
      current main -- its merge-base predates roughly 325 subsequent
      migrations and hundreds of unrelated service-layer changes on main.
      A literal merge produced 20+ conflicts in files (erp-*,
      task-execution-engine, webhook-deliver, vercel.json, etc.) this PR
      never touched -- not real, resolvable conflicts, just noise from
      stale ancestry. Aborted that merge. Instead, independently confirmed
      the PR's real content via `gh pr diff 582 --name-only` / `gh pr diff
      582` (GitHub's own computed diff, not local git history): exactly 5
      files -- `PROGRESS.md`, `ai-os/EXPLAIN_ANALYZE_SEARCH_PERF_2026-07-26.md`,
      `ai-os/OS.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml`,
      `drizzle/0264_search_perf_gin_trgm_indexes.sql`. Reset a fresh branch
      to `origin/main` and replayed that real diff by hand.
- [x] **First migration renumbering: 0264 -> 0503.** `drizzle/0264_...` was
      since taken by an unrelated, already-merged migration
      (`0264_helpdesk_tiered_sla_team_routing.sql`). Checked the TRUE
      current highest via `git ls-tree -r origin/main -- drizzle/` (0502,
      328 real migration files) rather than trusting a stale local
      checkout, and renumbered to 0503.
- [x] Pushed, opened replacement PR #1513, closed original #582 as
      superseded. Ran real local validation (see below) and watched real CI
      on #1513 to green (Lint/Type Check/Unit Tests/Build/Migration
      Collision/Migration Integrity/Migration Schema Drift/Governance YAML
      Parse/Test Coverage checks all passed; only the documented-ambient
      Vercel platform-block was red, E2E still running).
- [x] **`gh pr merge 1513 --squash` failed for real**: "not mergeable: the
      merge commit cannot be cleanly created". Re-checked
      `gh pr view 1513 --json mergeable,mergeStateStatus`: `CONFLICTING` /
      `DIRTY`. Root cause: a **different, concurrent rebase-sweep session**
      (working the same repo, doing the identical rebase-merge task for PR
      #576 -> replacement PR #1514, "V2-16 CRM performance-under-load
      composite indexes") had independently computed the same "next free"
      migration number (0503) around the same time, and merged to main
      (`6f748f37`, then `fd30c906` on top) a few minutes before this PR's
      merge attempt -- a real, textbook instance of the exact race
      condition `scripts/check-migration-collision.mjs`'s own header
      already documents as a known, unsolved limitation of concurrent
      agents ("this job only guarantees the collision is caught... not
      that it can never happen"). `git fetch origin main` confirmed
      `drizzle/0503_v2_16_crm_perf_indexes.sql` now real and merged.
- [x] **Second migration renumbering: 0503 -> 0504.** Reset the branch to
      the fresh post-#1514 `origin/main`, re-verified the new true highest
      via `git ls-tree` (0503, now taken), and replayed all 5 real file
      changes again on top of it, renumbering to 0504 (confirmed free).
      Re-added the `ai-os/boss/ACTIVE-CLAIMS.yaml` `recently_completed`
      entry and the `ai-os/OS.yaml` index entry at their same insertion
      points (both files were untouched by the concurrent #1514 merge,
      confirmed via unchanged line counts before/after its merge). Fixed
      the internal `0264`/`0503` self-references in the migration's own
      header and the EXPLAIN doc's header to `0504`, and documented the
      double-renumber (and its real cause) in both files plus in
      `ACTIVE-CLAIMS.yaml`'s claim entry.
      - `PROGRESS.md` (this file): replaced wholesale again, this repo's
        own established convention -- holds only the current active entry.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: re-checked for a live collision
        first (grepped for search-service/search-perf/V2-20/gin_trgm on
        the fresh main -- still none). Entry lives under
        `recently_completed:`, matching this repo's own established
        pattern for other same-day rebase-sweep sessions (e.g. the
        `task-20260718-072002` entry: "rebased onto main and re-opened,
        this rebase session").
      - `ai-os/EXPLAIN_ANALYZE_SEARCH_PERF_2026-07-26.md`: content
        unchanged apart from the migration filename fix.
      - `ai-os/OS.yaml`: same insertion point as before (next to the other
        2026-07-26 V2-* index entries), unaffected by #1514.
- [x] No `search-service.ts` or other application code touched, confirming
      the original triage, on both renumbering passes.

## Validation run

- [x] `node scripts/check-governance-yaml-parse.mjs` -- passed (all 5
      governance YAML files parse cleanly, including the two touched here).
- [x] Migration collision check: `node scripts/check-migration-collision.mjs
      --base origin/main` hit a local-Windows-only artifact (its execSync
      calls use `2>/dev/null`, which `cmd.exe` -- Node's default shell for
      `execSync` on win32 regardless of the invoking shell -- can't parse;
      real CI runs on `ubuntu-latest`, unaffected). Manually replicated its
      actual logic via plain git commands against real `origin/main`
      instead, both renumbering passes: zero collision each time (the real
      0503 collision that DID exist was caught not by this script locally,
      but by the real `gh pr merge` failure -- see above). Real CI's own
      "Migration Number Collision Check" job passed for real on PR #1513's
      first push (10s) -- correctly, since 0503 was still genuinely free at
      that exact moment; the race happened after that check ran and before
      merge, which is exactly the documented gap in what a pre-merge CI
      check alone can catch.
- [x] `bunx tsc --noEmit` (via `node_modules/.bin/tsc.exe --noEmit`, this
      repo's own documented Windows fallback): first attempt hit a JS
      heap OOM after ~392s -- this exact signature is pre-documented in
      this repo's own `.github/workflows/ci.yml` (a real, already-fixed CI
      incident: "R60 T7 follow-up... crashed with the same V8 OOM/core-dump
      signature... under concurrent CI load", fixed via
      `NODE_OPTIONS: --max-old-space-size=8192`) -- not something this PR's
      5-file, zero-`.ts`-touching diff introduces. Retried locally with
      `NODE_OPTIONS=--max-old-space-size=6144`: passed clean, zero errors,
      real exit code 0. Real CI's own "Type Check" job also passed (1m11s).
- [x] `bun test` -- no test files touched by this PR, nothing to run here.
- [x] `docs/master/TEST_COVERAGE_GAP.md` -- not regenerated: this PR does
      not touch `src/lib/services`, so no regeneration is needed. Real CI's
      "Test Coverage Gap Report Check" and "New Test Coverage Check" both
      passed.

## Remaining

- [x] Push `rebase-sweep2-582` (twice -- once per renumbering pass), open
      the replacement PR (https://github.com/FChecklist/compliance-tracker/pull/1513),
      close #582 as superseded.
- [ ] Re-verify real CI fully green on PR #1513's second push (post-0504
      renumber), then merge for real -- confirmed via `gh pr view
      --json state,mergedAt` afterward, not assumed.
- [ ] Owner sign-off + live `apply_migration` of
      `drizzle/0504_search_perf_gin_trgm_indexes.sql` (Tier2 hold -- not
      done by this session; independent of the PR merge since the migration
      file itself is inert until applied).
