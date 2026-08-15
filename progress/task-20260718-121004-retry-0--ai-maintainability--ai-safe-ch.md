# AI Maintainability: AI Safe-Change Capability — Progress

## Findings from the review framework (5 total)

1. **[Low] AI Can Safely Understand Module** — "Understanding quality varies with file size." Recommended: prioritize splitting the largest files.
2. **[Medium] AI Can Safely Modify Module** — "CI gate does not include comprehensive behavioral test coverage." Recommended: require a minimum test-coverage delta (or at least one new test) on PRs touching previously-untested files.
3. **[Medium] AI Can Generate Tests for Module** — "No systematic test-generation tooling." Recommended: add a coverage-gap report to prioritize which untested files to target next.
4. **[Medium] AI Can Refactor Module** — "Refactor safety net is incomplete." Recommended: same as #1 — raise test coverage before large refactors, starting with the highest-traffic untested files.
5. **[Low] AI Can Explain Module Accurately** — No gap of note. Recommended: maintain existing header-comment discipline for new files.

## Investigation

Re-verified against the live codebase (not the stale review-framework snapshot) before writing any code:
- No `vitest`/coverage tooling existed at all; `package.json` had no `test` script and CI ran a bare `bun test` (`.github/workflows/ci.yml`).
- `src/lib/services/*.ts`: 184 non-test files, only 48 have a sibling `<name>.test.ts` (~26%) — this is the concentrated business-logic layer where this repo's own test-writing convention already lives (every service `.test.ts` in the repo is here; other `src/lib/**` subtrees like `ai-team`, `prompt-cache`, `webhooks` never adopted a sibling-test convention, so treating them as "gaps" would be noise).
- No existing "coverage-gap report" or CI gate requiring tests on previously-untested files existed anywhere in `scripts/` or `.github/workflows/`.
- Checked `ai-os/boss/ACTIVE-CLAIMS.yaml` — no other session claims this area.

## Completed

- [x] Built `scripts/report-test-coverage-gap.mjs` — scans `src/lib/services/*.ts`, classifies each as tested/untested via sibling `<name>.test.ts`, and writes `docs/master/TEST_COVERAGE_GAP.md` ranking untested files by line count (largest first — same ranking usefully serves finding #1's "prioritize splitting the largest files", since a large untested file is both hardest to safely modify blind and highest-value to test next). `--check` mode fails if the committed report is stale. Closes finding #3.
- [x] Built `scripts/check-new-test-coverage.mjs` — CI gate: diffs the PR against `merge-base(HEAD, origin/main)`; if the PR touches a `src/lib/services/*.ts` file that had **no** sibling test at merge-base, the PR must also add/modify at least one `*.test.ts` file anywhere, or it fails. Implements the finding's own "(or at least one new test)" lenient branch — a strict per-file coverage-delta % isn't mechanically enforceable for files that start at zero instrumented tests. Closes finding #2 (and directly serves finding #4's "raise coverage before refactors" by making it non-optional going forward for this layer).
- [x] Refactored both scripts so their decision/render logic (`buildStats`/`renderReport`, `filterPreviouslyUntested`/`decideGate`) is pure and exported, guarded by an `isMain` check so `bun test` can import and unit-test the logic without touching git/fs — matches this repo's existing `scripts/*.test.ts` convention (e.g. `report-cognitive-brain-coverage.test.ts`).
- [x] Added `scripts/report-test-coverage-gap.test.ts` (9 cases) and `scripts/check-new-test-coverage.test.ts` (8 cases) covering the pure logic in both scripts.
- [x] Verified both scripts manually against real repo state (success path + a deliberately-introduced violation, reverted) before writing tests.
- [x] Generated `docs/master/TEST_COVERAGE_GAP.md` for real (48/184 tested, 26.1%).
- [x] Full local verification before commit: `bun test` — 1436/1436 pass (2 new test files add 15 of those); `bunx tsc --noEmit` — clean (needed `NODE_OPTIONS=--max-old-space-size=4096` in this memory-constrained sandbox, not expected to be needed on real CI runners); `bun run lint` — 0 errors (pre-existing unrelated warnings only).
- [x] **`.github/workflows/ci.yml` wiring is prepared but NOT pushed** — this session's `gh` token lacks the `workflow` OAuth scope (`gist, read:org, repo` only), and GitHub rejects any push touching `.github/workflows/*.yml` without it ("refusing to allow an OAuth App to create or update workflow ... without `workflow` scope"). Per this repo's own established workaround for that exact constraint: pushed everything else, and wrote the exact two-job YAML diff to `docs/master/PENDING_CI_WIRING_test_coverage.md` for someone with `workflow` scope (the repo owner, or a differently-scoped session) to apply in a tiny follow-up. The two scripts and the report both work standalone today (verified manually above) — only the automatic CI enforcement is pending.

## Remaining / decisions made without further code changes

- Finding #1 (splitting largest files) and finding #4 (refactor safety net): the coverage-gap report above is the concrete "prioritization tool" both findings' recommended approach actually asked for. Actually *splitting* the ~15 largest untested service files (700→150 line files) is a separate, materially larger refactor with real regression risk across many call sites — deliberately NOT attempted in this PR; the report now gives whoever picks that up next a real, regenerable priority list instead of a guess.
- Finding #5 (header-comment discipline): no gap was reported and none was found — both new script files follow the same header-comment discipline as the rest of `scripts/`. No action needed beyond that.
- [x] Registered completion entry in `ai-os/boss/ACTIVE-CLAIMS.yaml` (`recently_completed`).
- [x] Committed, pushed, opened PR: https://github.com/FChecklist/compliance-tracker/pull/1259. PR description notes the CI-wiring limitation and points to `docs/master/PENDING_CI_WIRING_test_coverage.md`.
- [ ] Someone with `workflow` OAuth scope needs to apply the `.github/workflows/ci.yml` diff in `docs/master/PENDING_CI_WIRING_test_coverage.md` (small follow-up, not blocking this PR).

## Audit

- [x] Posted the required structured AUDIT: PASS comment on PR #1259 per AGENTS.md Rule 10.
- [x] Pushed this trivial follow-up commit to trigger a fresh pull_request:synchronize event so the audit check reports against the PR's real head SHA (known workaround for the issue_comment-vs-head-SHA gap in mandatory-audit-check.yml).
