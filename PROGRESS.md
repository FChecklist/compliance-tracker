# PROGRESS -- task-20260718-123004-retry-2--ai-maintainability--ai-safe-ch

VERIDIAN Review Framework gap-closure: AI Maintainability / AI Safe-Change Capability (5 findings, one coherent PR).

## Completed

- [x] Read the current codebase before assuming the 2026-07-18 evaluation is still accurate. Confirmed all 5 findings are still real:
  - `bun test` in CI (`.github/workflows/ci.yml`'s `unit-tests` job) has no gate requiring new tests on PRs that touch previously-untested files.
  - No coverage-gap/prioritization tooling existed anywhere in `scripts/`.
  - Colocated-test coverage is genuinely low: 101/1549 `.ts`/`.tsx` source files (7%) have a colocated `*.test.ts`/`*.test.tsx`.
  - `src/lib/db/schema.ts` (10197 lines) and `src/lib/task-execution-engine.ts` (2438 lines) are real outliers vs. the rest of the codebase.
  - Header-comment discipline (finding 5, "No gap of note") is genuinely being maintained -- every `scripts/*.mjs`/`*.ts` file read while building this PR (`report-cognitive-brain-coverage.ts`, `check-migration-collision.mjs`, `check-doc-cross-references.mjs`, etc.) carries a substantive header comment explaining rationale. No action needed there; the new files this PR adds follow the same convention.

- [x] **[Medium] AI Can Generate Tests for Module** + **[Medium] AI Can Refactor Module** (same recommendation: "raise test coverage starting with the highest-traffic untested files"): built `scripts/report-test-coverage-gap.ts` (+ `scripts/report-test-coverage-gap.test.ts`, 13 unit tests, all pure functions). Deterministic, zero AI/LLM calls, reads only git-tracked files. Two ranked lists:
  - Largest files (split-priority order) -- feeds finding 1 below.
  - Highest-traffic untested files, ranked by relative-import fan-in (a documented heuristic proxy for "traffic", not a real call graph -- see the script's own header for the honest limitation). Top hit: `src/lib/services/compliance-service.ts`, imported by ~124 files, zero test coverage.
  - Wired as `bun run test:coverage-gap` in `package.json`. Not made a CI gate -- it's a prioritization report, not a pass/fail check.
  - A real run's output is checked in at `docs/test-coverage-gap-report.md` as evidence + a concrete starting list (regenerate any time via the script above).

- [x] **[Medium] AI Can Safely Modify Module** ("CI gate does not include comprehensive behavioral test coverage" -- "require a minimum test-coverage delta (or at least one new test) on PRs touching previously-untested files"): built `scripts/check-test-coverage-delta.mjs`, wired into `.github/workflows/ci.yml` as a new `test-coverage-delta` job (with `fetch-depth: 0` so `git merge-base` actually works against a full history, unlike the default shallow checkout). Fails the build if a PR modifies a `.ts` file with no colocated test at the PR's merge-base and adds/modifies zero test files. Deliberately scoped to `.ts` only, not `.tsx` -- confirmed before writing it that this repo has zero `*.test.tsx` files and no `@testing-library/react`/jsdom installed, so gating React components the same way would need a whole new test stack first (out of scope here) and would immediately block unrelated frontend PRs. Verified locally: passes on this PR's own diff (adds `report-test-coverage-gap.ts` + its colocated test in the same commit).

- [x] **[Low] AI Can Safely Understand Module** ("understanding quality varies with file size" -- "prioritize splitting the largest files"): the coverage-gap report's "Largest files" section (`docs/test-coverage-gap-report.md`) is that prioritized list. Actually splitting `src/lib/db/schema.ts` / `task-execution-engine.ts` / etc. is real, large refactor work in its own right (not a small tooling addition) -- deliberately left as follow-up, now that a concrete, regeneratable priority list exists to drive it. Flagging this honestly rather than doing a rushed partial split under this PR's scope.

- [x] **[Low] AI Can Explain Module Accurately** ("No gap of note" -- "maintain the existing header-comment discipline for new files"): confirmed still true, documented above. No code change; the two new files this PR adds follow the convention.

- [x] `bun test` (1434 pass / 0 fail), `bunx tsc --noEmit` (clean, needed `NODE_OPTIONS=--max-old-space-size=4096` in this sandbox -- unrelated to this change, the full 1600+-file project graph is just heavy), `bunx eslint` on the new files (clean).

## Remaining

- [ ] None for this gap-closure. Follow-up (out of scope, tracked via the generated report, not a new gap): actually split `src/lib/db/schema.ts` and `src/lib/task-execution-engine.ts`, and start covering `src/lib/services/compliance-service.ts` (124-file fan-in, currently untested) -- both are large enough to be their own task.
