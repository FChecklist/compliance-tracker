# PROGRESS -- rebase-sweep2-618 (real rebase-merge for PR #618)
## Scope
Real rebase-merge of PR #618 (`worker/task-20260728-051737-owner-engine-phase-8-real-gaps`,
phase_8 prompt translation/localization/marketplace engines) onto current main, per this
repo's standard rebase-sweep protocol. Triage confirmed a real, additive, well-evidenced
gap: independently fetched main and confirmed every new file the PR introduces (4 new
services under src/lib/services/ + their test files, the new prompt-marketplace page, 5
new API routes) is genuinely absent on main; grep of main's full schema.ts for
promptMarketplace/prompt_marketplace/promptTranslation/prompt_translation/
promptLocalization/prompt_localization returned zero matches. CI on #618 itself was fully
clean (`gh pr checks 618`) before this sweep -- notably, the branch's own history already
shows a prior session (task-20260728-160922) had root-caused and fixed the PR's earlier
mergeable=CONFLICTING / audit-FAIL state (an audit-pipeline 60,000-byte diff-truncation
defect in supervisor-entrypoint.sh, not a real defect in the PR's own code) directly on
this branch (commits a3da2c45/2c43f909/faa52ec0/9a80acf7/ec971c5b), so this sweep started
from an already-CI-green branch, not a broken one.
## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2-618` from
      `origin/worker/task-20260728-051737-owner-engine-phase-8-real-gaps`, `bun install`
      (1203 packages).
- [x] `git merge origin/main` -- 4 real conflicts, resolved with genuine per-file judgment,
      not blind ours/theirs:
      - PROGRESS.md: this repo's convention is single-current-entry, not concatenation --
        replaced wholesale with this entry.
      - ai-os/boss/ACTIVE-CLAIMS.yaml: two add/add conflicts (diff3 ancestor empty on both
        sides in both the `active:` and `recently_completed:` blocks) -- this file is an
        append-only rolling log by design, so both sides' entries were kept (union), no
        content dropped. Verified: parses as valid YAML.
      - ai-os/registry/terminology-guardrail-exemptions.yaml: origin/main carried a much
        larger, more current full-repo-regenerated baseline (862 file entries, from PR #554's
        own rebase-sweep on 2026-09-01) that already dominates (>=) every count PR #618's own
        branch had for every file both sides shared -- confirmed programmatically (43
        shared files diffed, origin/main >= ours in every single category on every file, 0
        exceptions). PR #618 itself only adds 9 file entries origin/main had no way to know
        about (its 4 new services + 4 test files + the new marketplace page, each a
        `hardcoded_iso_date: 1` false-positive on the file's own dated header comment).
        Resolution: origin/main's 862-entry baseline plus those 9 new-file entries appended
        = 871 total, verified no duplicate file keys. Then ran
        `node scripts/check-terminology-guardrail.mjs --full-repo` for real post-merge and
        found 22 more files (46 findings) where the true merged tree's content exceeded even
        that combined baseline -- files touched by commits that landed on main after PR
        #554's snapshot, unrelated to #618. Spot-checked: same benign class this manifest
        already exempts throughout (dated changelog/gap-closure/task-ID comments), not
        secrets/PII/example data. Raised to the real current count for all 22 (882 total
        entries); re-ran the checker clean (2771 files scanned, 0 new findings).
      - drizzle/meta/_journal.json: classic migration-number collision -- PR #618's own
        0269/0270 collided with main's own independently-added 0269_construction_progress_
        claims_workflow/0270_register_construction_progress_claims. Checked the TRUE current
        highest via `git ls-tree -r origin/main -- drizzle/` (not the stale local checkout):
        0506_mother_router_roster_memory (idx 328). Renamed PR #618's two migration files
        on disk (0269_prompt_translation_localization_marketplace.sql ->
        0507_..., 0270_register_prompt_marketplace_listings.sql -> 0508_...; no snapshot
        files existed for either number, no internal self-references to fix) and appended
        them to the journal as idx 329/330. Verified: valid JSON, idx sequential, all tags
        unique.
- [x] Re-ran `bun install` after the merge (package.json gained new deps from main, e.g.
      `@axe-core/playwright`, that the pre-merge branch's node_modules lacked).
- [x] Validated for real: `node scripts/check-governance-yaml-parse.mjs` (pass, 5/5),
      `NODE_OPTIONS=--max-old-space-size=8192 bunx tsc --noEmit` (clean, 0 errors -- default
      heap OOMs on this repo's size, matches this repo's own documented gotcha), `bun run
      lint` (0 errors, 138 pre-existing complexity warnings), migration-integrity and
      migration-schema-drift checks (pass locally, no DATABASE_URL here for the live-DB leg).
      Migration-collision and route-error-handling check scripts hit a Windows-only
      `execSync` shell-redirection incompatibility (`2>/dev/null` isn't valid for `cmd.exe`)
      and silently no-op locally -- reproduced both checks' logic by hand instead: no
      migration-number collision, and all 5 new route.ts files have a visible `try {` block.
      New-test-coverage gate reproduced by hand: 4 previously-untested services touched, but
      this PR also changes their 4 sibling test files -- satisfied.
- [x] `bun test --isolate` on every file #618 itself touches -- 93 pass, 0 fail. Full local
      suite (`bun test --isolate`, 3500 tests/300 files) is healthy: one run flagged 2
      flaky/resource-contention failures under heavy local parallel load, a clean rerun
      immediately after showed 0 fail. One specific pre-existing test
      (`prompt-governance-gates.test.ts`'s "blocks the transition when the eval pass rate is
      below the platform threshold") times out locally (5000ms limit, 7-98s here) --
      confirmed via a clean throwaway worktree at plain `origin/main` with zero involvement
      from this PR that it reproduces identically there; pre-existing on main, not
      introduced by this rebase-merge or by #618.
      `bun test --isolate ./scripts` -- 186 pass, 0 fail.
- [x] Regenerated `docs/master/TEST_COVERAGE_GAP.md` by hand (its generator's `isMain`
      self-invocation check silently no-ops on Windows) -- 106/232 -> 110/236 now that the 4
      new prompt-* services ship with sibling tests.
- [x] Committed, pushed `rebase-sweep2-618`, opened PR #1520 citing #618, closed #618 with a
      pointer to #1520.
- [x] Main advanced by one commit (#1519, CRM-007 dashboard, unrelated area) while #1520 was
      open, making it briefly `mergeable=CONFLICTING` -- re-merged `origin/main` a second
      time; same 4 files conflict again for the same structural reasons above (both #1519's
      own rebase-sweep and this one independently touch the rolling-log/baseline/journal
      files), resolved the same way.
## Remaining
- [ ] Check real CI on PR #1520 (retry on transient network errors), merge only when
      genuinely green (modulo documented ambient failures: E2E, Vercel platform-wide block,
      pre-existing Secret Scanning findings, Promptfoo Evals timeout).
