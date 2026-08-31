# PROGRESS -- rebase-sweep2-529 (replacement for PR #529)

## Scope

Replacement PR for #529 ("audit198 gap closure: SOFTWARE_FIRST_AI_SECOND/
CONFIDENCE_ROUTING/REUSE_COMPONENTIZATION cluster"). Triage confirmed real,
additive work: a genuinely new file (`memory-tier-registry.ts`, ARTICLE-050
OPERATIONAL vs LONG_TERM_KNOWLEDGE metadata contract) and a real,
non-blocking wiring of `classifyExecutionWithReliability` /
`findOrCreateCapability` / `findApprovedPackage` / `recordExecutionOutcome`
into `team-service.ts`'s `runRole()` (fire-and-forget, errors swallowed so
it can never block a real dispatch). PR's branch (`mergeable: CONFLICTING`)
was rebased onto current `main` here and re-opened as a fresh PR.

## Completed

- [x] Worktree: merged PR #529's real branch
      (`audit198-gap-wave3-software-first`, head `284aa488`) onto fresh
      `origin/main` (`d25f54d1`). 5 real conflicts resolved by hand:
      - `src/lib/ai-team/team-service.ts` -- import-line conflict only.
        `origin/main` had independently grown a large, unrelated Stage 12
        dispatch-outcomes/BYOB feature (`resolveDispatchModel`,
        `TenantAiOverride`, `DispatchOutcomeContext`,
        `checkForDuplicateDispatch`/`recordDispatchOutcome`) in the same
        import block PR #529 touched. The real body of the file (both
        features' actual call sites inside `runRoleAndRecord()`) had
        already auto-merged cleanly with no overlap -- confirmed by
        grepping for every new symbol from both sides post-merge and
        finding exactly one clean usage site each. Merged the import block
        additively: kept both `resolveDispatchModel` and
        `classifyExecutionWithReliability`/capability-learning-service
        imports, plus both new exported types.
      - `ai-os/scripts/audit198/category-checkers.mjs` -- add/add conflict;
        merge-base had no `ai-os/scripts/audit198/` directory at all, so
        both branches "added" this file independently. Diffed PR #529's
        version against `origin/main`'s and found the *entire* difference
        was one additive block: PR #529's own new `REUSE_COMPONENTIZATION`
        category entry (referencing the 3 pre-existing services plus the
        new `memory-tier-registry.ts`). Took `origin/main`'s file as base
        and re-inserted that one block at its original position (right
        after `CONFIDENCE_ROUTING`, before `MONITORING_INFRA`). Verified
        with `node --check` and a full re-diff against both parents.
      - `ai-os/scripts/audit198/run-audit.mjs` -- add/add conflict but
        byte-identical blob on both sides (confirmed via `git ls-tree`:
        same SHA, `100755` on PR #529's side vs `100644` on `main`'s) --
        pure file-mode conflict, no content difference. Kept `100755`
        (matches what was already on disk) and staged as-is.
      - `ai-os/scripts/audit198/results/audit198-results.json` +
        `.../results/audit198-summary.md` -- both stale generated
        snapshots from two different real runs of the script (PR #529's
        own 2026-07-21T11:59:04.919Z run vs `main`'s older
        2026-07-21T09:30:15.219Z run, before PR #529's
        REUSE_COMPONENTIZATION improvements existed on `main`'s side).
        Did not hand-splice -- ran `node ai-os/scripts/audit198/
        run-audit.mjs` for real against the fully merged tree. Started 3
        background attempts total (evidence-engine.mjs's `grepRepo()`
        shells out to a real `grep` per keyword, ~1,600 calls for 198
        items with zero caching -- genuinely slow in this shell, not
        hung: confirmed by watching one single `grep` child process
        accumulate 71 CPU-seconds before I killed attempts #2/#3 as
        redundant once #3's kill made that clear). Attempt #1 (the very
        first one launched) kept running in the background the whole
        time and completed naturally ~52 real minutes later
        (`generated_at: 2026-08-31T18:05:51.911Z`,
        `completed_at: 2026-08-31T18:57:05.155Z`, 198/198 items, valid
        JSON) -- its notification just arrived late. Took that genuinely
        fresh, complete, live-generated output (ENFORCED 27 /
        PARTIALLY_ENFORCED 146 / NOT_YET_BUILT 20 / NEEDS_HUMAN_JUDGMENT
        5) over the two older, more-stale committed snapshots. No CI job
        in `.github/workflows/ci.yml` gates freshness of these two files
        (confirmed by reading every job in that file -- unlike `docs/
        master/TEST_COVERAGE_GAP.md`, which `test-coverage-gap-report`
        DOES gate and which WAS regenerated for real, see below), so this
        wasn't a hard requirement, but the real live run finishing meant
        there was no need to fall back to hand-resolution after all.
      - `PROGRESS.md` -- replaced wholesale with this file (per-task
        scratch doc, this repo's documented convention -- not
        concatenated with the stale `#1020` rebase entry `origin/main`
        carried in).
- [x] No drizzle/ migrations touched by PR #529 relative to the
      merge-base (`git diff <merge-base> PR#529-head -- drizzle/` is
      empty) -- no migration renumbering needed, `drizzle/meta/
      _journal.json` was not even in the conflicted-file set.
- [x] `bun install` clean (1167 packages).
- [x] `New Test Coverage Check` CI gate: `src/lib/services/memory-tier-
      registry.ts` is a brand-new file with no sibling test at any
      merge-base, so this gate would fail as PR #529 was originally
      authored (its own diff adds zero `*.test.ts` files). Added
      `src/lib/services/memory-tier-registry.test.ts` (pure-function
      coverage of `classifyMemoryTier`/`tablesForTier` + registry
      structural invariants, same convention as `exception-taxonomy.
      test.ts`).
- [x] `Test Coverage Gap Report Check` CI gate: `docs/master/
      TEST_COVERAGE_GAP.md` is stale relative to the two new
      `src/lib/services` files above. `scripts/report-test-coverage-
      gap.mjs`'s normal invocation has a known `isMain` self-invocation
      bug in this shell (silently no-ops, exit 0) -- worked around by
      importing `buildStats`/`renderReport` directly via a `file://` URL
      and doing the fs read/write manually (matching this task's own
      instructions for this exact script). Regenerated: 101/229 service
      files now have a sibling test (was 100/228).
