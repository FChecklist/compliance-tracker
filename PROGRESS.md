# PROGRESS -- task-20260718-070005-ai-maintainability--ai-safe-change-capab

VERIDIAN Review Framework gap-closure: AI Maintainability / AI Safe-Change
Capability. All 5 findings verified against current code (not the stale
framework evaluation) before any change; findings 2-4 share one root cause
(near-zero test coverage tooling/gating) and are closed together.

## Completed

- [x] **[Medium] "AI Can Safely Modify Module"** -- CI gate does not include
  comprehensive behavioral test coverage.
  - Re-verified against current code: real gap, AND found a second, more
    concrete instance of the same gap while investigating -- `bunfig.toml`'s
    `[test] root = "src"` (added 2026-07-27 to stop bun test colliding with
    Playwright's e2e/ specs) had the unintended side effect of silently
    excluding every `scripts/*.test.ts` file from CI's bare `bun test` ever
    since. 5 real, pre-existing test files (audit-asset-registry.test.ts,
    backfill-platform-assets.test.ts, check-reviewer-not-author.test.ts,
    check-sec07-ocid-lock.test.ts, report-cognitive-brain-coverage.test.ts,
    107 tests total) have not run in CI since that commit. Fixed by changing
    CI's unit-tests step to `bun test ./src ./scripts` (explicit paths
    override bunfig's root-scoped default discovery without reintroducing
    the e2e/ collision -- verified locally, 2656 pass / 0 fail / 230 files).
  - Added `scripts/check-test-coverage-gate.mjs`, a new CI job ("Test
    Coverage Gate") implementing the "(or at least one new test)" arm of the
    recommendation: fails if a PR changes a `src/lib/services/*.ts` or
    `src/app/api/**/route.ts` file that had no sibling `*.test.ts` on the
    base branch and still has none at HEAD. Scoped to those two directories
    deliberately (they're where this repo's own existing tests already
    establish a real convention) rather than all of src/ -- see the script's
    own header for why a repo-wide gate would be a de facto blanket freeze
    (only ~51-327 of 1793 non-test src/ files have any test coverage today).
    Did not implement the full coverage-delta arm (would roughly double CI
    time for a Medium-severity tooling gap); documented as an honest
    limitation in the script header, same discipline as the other check-*
    scripts.
  - Verified: fabricated a temp untested service file, gate failed;
    committed a sibling test on top, gate passed; reset both commits away.

- [x] **[Medium] "AI Can Generate Tests for Module"** -- no systematic
  test-generation tooling.
  - Added `scripts/report-maintainability-gaps.ts` (+ `.test.ts`, 16 unit
    tests, all passing): runs `bun test --coverage --coverage-reporter=lcov`
    and cross-references every non-test src/ file against it, producing a
    priority-ranked coverage-gap list (`lines x traffic-weight`, services/
    routes weighted highest). This is a report/prioritization tool, not a
    test generator itself -- the recommendation asked for "a coverage-gap
    report ... to prioritize which untested files to target next", which is
    exactly what this produces. Bun's native lcov coverage was used instead
    of vitest (the recommendation's "e.g." example) because this repo's real
    test runner is bun:test, not vitest -- same substitution precedent as
    check-terminology-guardrail.mjs adapting a .py original to this repo's
    actual toolchain.
  - Committed a generated snapshot at `ai-os/registry/coverage-gap-report.md`
    (regenerate via `bun run report:coverage-gaps`), and added that script
    entry to package.json.
  - Cross-linked from `ai-os/registry/maintainability-scorecard.md` (the
    existing org-level scorecard from a separate, already-closed AI
    Architecture/Governance task) noting this is a related but separate,
    static per-file report -- not merged into that live DB-driven score.

- [x] **[Medium] "AI Can Refactor Module"** -- refactor safety net is
  incomplete; same recommendation as row 69 (raise coverage before large
  refactors, starting with highest-traffic untested files).
  - Closed by the same `report-maintainability-gaps.ts` tool above -- its
    coverage-gap section IS the "highest-traffic untested files" priority
    list this finding asks for (traffic-weighted: services + API routes
    ranked above lib utilities, ranked above components/pages). No separate
    tool needed; this and the previous finding were never two different
    problems, just two different reasons to ask the same question.

- [x] **[Low] "AI Can Safely Understand Module"** -- understanding quality
  varies with file size; recommended prioritizing splitting the largest
  files.
  - The `report-maintainability-gaps.ts` tool's other section is exactly
    this: files >500 lines, largest first. Real current largest:
    `src/lib/db/schema.ts` (11,495 lines -- but this is a Drizzle table
    registry, not a God-object service; splitting it is a different,
    lower-risk shape of refactor than the service files below it and out of
    this PR's scope to attempt unreviewed), then `src/lib/task-execution-
    engine.ts` (2,584), `report-engine-service.ts` (1,791), `erp-invoicing-
    service.ts` (1,599), `capability-tree-service.ts` (1,559).
  - Did NOT attempt to actually split any of these files in this PR. The
    recommendation's verb is "prioritize" -- a Low-severity finding whose
    own text asks for a priority list, not an unreviewed multi-thousand-line
    refactor bundled into a tooling PR. The committed report is that
    priority list; splitting the top candidates is real follow-up work,
    intentionally left as a separate, focused task per file (each split is
    its own reviewable diff, not bundleable with this PR's scope).

- [x] **[Low] "AI Can Explain Module Accurately"** -- framework itself
  recorded no gap; recommended approach was "maintain the existing
  header-comment discipline for new files."
  - Verified against current code, not assumed: spot-checked the 6 most
    recently added service/route files (`git log --diff-filter=A` over
    `src/lib/services/*.ts` and `src/app/api/**/route.ts`) plus
    `src/lib/errors/error-catalog.ts` (merged same day this task started).
    All carry real, substantive header comments explaining what/why, not
    boilerplate. This finding is genuinely a no-op -- no code change made,
    documenting the verification here per this task's own instruction not
    to make an unnecessary change.

## Verification

- `bun test ./src ./scripts`: 2656 pass, 0 fail, 230 files (was silently
  230-107=123 files short of this before the bunfig fix above).
- `bun run lint`: 0 errors (3 pre-existing warnings, unrelated to this PR's
  files).
- `bunx tsc --noEmit`: exit 0, no type errors.
- `node scripts/check-test-coverage-gate.mjs --base origin/main`: passes on
  this PR's own diff (no in-scope service/route file touched).

## Remaining

- None of this task's 5 findings need further code -- all substantive work
  (the two new scripts, the coverage-gap report, the scorecard cross-link)
  is committed and pushed.
- **One CI-wiring step is NOT in this PR/push, and needs a follow-up from
  someone with `workflow` OAuth scope**: this session's `gh` token (scopes
  `gist, read:org, repo`, no `workflow`) cannot push any branch that touches
  `.github/workflows/*.yml` -- GitHub rejects it outright ("refusing to
  allow an OAuth App to create or update workflow ... without `workflow`
  scope"). `.github/workflows/ci.yml` was edited locally, verified working
  (both changes tested directly against this repo, see Verification above),
  then reverted out of this commit/push specifically because of that
  constraint -- committing a change that can't reach the remote would be
  silently misleading. The two edits needed in `.github/workflows/ci.yml`,
  to be applied by the Owner (or a session with `workflow` scope) as a tiny
  follow-up PR:
  1. In the `unit-tests` job, change `- run: bun test` to
     `- run: bun test ./src ./scripts` (fixes the real, pre-existing gap
     found during this task: `bunfig.toml`'s `root="src"` has silently
     excluded all `scripts/*.test.ts` from CI since commit 6318fc77 --
     5 pre-existing test files + this task's new one, 107 tests, never
     run in CI. Verified locally: `bun test ./src ./scripts` passes clean,
     2656/2656, 230 files, no e2e/Playwright collision reintroduced).
  2. Add a new `test-coverage-gate` job (any position after `build` is
     fine) running `node scripts/check-test-coverage-gate.mjs --base
     origin/main`, with `actions/checkout@v7` using `fetch-depth: 0` (same
     pattern as `terminology-guardrail-check`/`migration-collision-check`
     already in that file, for the same reason -- the script's git
     merge-base/diff needs full history to resolve `origin/main`).
  Both scripts exist and are already committed in this PR
  (`scripts/check-test-coverage-gate.mjs`); only the workflow YAML wiring
  is outstanding.
