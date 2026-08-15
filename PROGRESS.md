# PROGRESS -- task-20260718-122002-retry-1--ai-engineering-quality--techni

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
Debt & Complexity (5 findings). Verified each finding against the live
codebase before writing code -- all 5 were still real gaps (nothing had
been quietly closed since the framework evaluation was written).

## Completed

- [x] **Dead Code Detection** (Medium). Added `knip` (devDependency),
  `knip.json` (entry globs tuned for this repo's Next.js App Router pages,
  `scripts/*.{mjs,ts}` invoked only from CI/package.json, and the various
  root `*.config.*` files), and `scripts/check-dead-code.mjs`, matching the
  existing `check-*.mjs` guardrail pattern. Wired into CI (`ci.yml`,
  `dead-code` job). It's a **ratchet** against `scripts/dead-code-baseline.json`
  (files=38, exports=222, types=106, dependencies=29, devDependencies=2,
  unlisted=11 as of this PR), not a zero-findings gate -- a raw first run
  before entry-tuning reported 158 "unused files", most of them false
  positives (CI-only scripts, dynamic Next.js entry points knip's defaults
  don't reliably resolve). See the script's own header for the full honest
  limitation.

- [x] **Duplicate Code Detection** (High). Added `jscpd` (devDependency),
  `.jscpd.json` (threshold 7%, `src/**/*.{ts,tsx}`, `schema.ts` and
  `*.test.ts` excluded), and `scripts/check-duplicate-code.mjs`. Wired into
  CI (`duplicate-code` job). Measured baseline duplication today is 5.74% --
  the 7% threshold is a real buffer, not a no-op ceiling; jscpd's own
  `--threshold` flag does the actual gating (non-zero exit on breach),
  verified directly (`--threshold 1` fails, `--threshold 7` passes).

- [x] **Technical Debt Score** (Medium). Added `scripts/compute-tech-debt-score.mjs`
  -- a simple composite from the three trackers the recommended approach
  named: open `MASTER-TRACKER.yaml` items (owner_blocked +
  needs_owner_decision + real_gaps_not_yet_built, currently 18), empty-
  guardrail % (of the 9 LEAF constants in `guardrail-registrations.ts`, the
  % with zero call sites elsewhere in `src/`/`scripts/`, computed live via
  `git grep` each run -- currently 0%, all 9 are real wired guardrails, a
  genuinely good finding worth stating rather than inventing a worse
  number), and stale-doc count (`ai-os/registry/stale-doc-manifest.yaml`'s
  `moved` + `already_archived`, currently 44). Current score: **80** (18x2 +
  0x1 + 44x1). Deliberately **not** wired as a CI hard-gate -- there's no
  defensible pass/fail threshold for a first-run composite; it runs
  informationally in CI (`tech-debt-score` job, `|| true`) so the number is
  visible on every PR without blocking anyone on an unagreed threshold.

- [x] **Code Complexity Score** (Medium). Added ESLint's `complexity` rule
  (`eslint.config.mjs`, threshold 20, `"warn"` not `"error"` -- see the
  inline comment for why: this repo's largest orchestration files predate
  the rule and immediately produced 76 real warnings, most strikingly
  `task-execution-engine.ts`'s `dispatchEngine` at cyclomatic complexity
  **372** and `dispatchTool` at **121** -- confirming rather than inventing
  the "no measured complexity score" gap). `bun run lint` (no
  `--max-warnings` flag) does not fail the build on warnings, so this is
  measurement-first and non-blocking, verified by an actual `bun run lint`
  run (`0 errors, 79 warnings`, exit 0).

- [x] **Refactoring Readiness** (Medium). Added
  `scripts/check-refactoring-readiness.mjs` -- ranks every `src/lib` file
  with no sibling `*.test.ts` by (line count x commit count touching it),
  informational only (`debt:refactoring-readiness` script, non-blocking CI
  step). As concrete progress off that list (not just tooling), added
  **`src/lib/supabase/auth-guard.test.ts`** -- direct unit tests (19 tests,
  43 assertions, all passing) for `ROLE_RANK`/`hasRole`/`requireRole`/
  `hasScope`/`requireRoleOrScope`, the pure gate functions every
  `requireAuth()`-protected route in the app ultimately depends on
  (CLAUDE.md: "All API routes MUST call `requireAuth()`"). This file had
  **zero** test coverage before this PR despite being the single most
  load-bearing security gate in the codebase -- picked over the raw #1
  line-count x churn ranking (`erp-invoicing-service.ts`, entirely DB-
  coupled functions with no pure logic to unit test without DB mocking,
  matching this repo's own established "skip DB-touching functions" test
  convention) because it's genuinely testable *and* higher real risk.
  `ROLE_RANK` tests also regression-guard the specific historical bug
  documented in `auth-guard.ts`'s own comments (6 roles silently falling
  through to rank 0 and getting locked out of every gate).

Full local verification before commit: `bun test` (1440 pass, 0 fail, 104
files), `bunx tsc --noEmit` (0 errors, needed `NODE_OPTIONS=--max-old-space-size=6144`
in this sandbox -- an environment memory ceiling, not a real regression:
confirmed clean at default memory too until OOM, unrelated to any file this
PR touches), `bun run lint` (0 errors, 79 warnings, all from the new
`complexity` rule as designed).

Scope respected: did not touch `src/lib/services/permission-service.ts`'s
`ERP_ACTION_ROLES` table structure (not touched at all -- the new test file
targets `auth-guard.ts`, a different file `permission-service.ts` itself
calls into).

**Confirmed CI-wiring blocker**: this session's `gh` token lacks the
`workflow` OAuth scope -- pushing the branch with `ci.yml`'s new
`dead-code`/`duplicate-code`/`tech-debt-score` jobs included was rejected
by GitHub (`refusing to allow an OAuth App to create or update workflow
.github/workflows/ci.yml without workflow scope`), confirmed by isolating
it into its own commit and re-testing. Per the known workaround for this
constraint: the `ci.yml` diff is split into its own commit, NOT pushed by
this session. Everything else (all 5 findings' actual scripts/config/tests/
package.json wiring) is pushed and PR'd normally -- the tooling and tests
are real and complete without the CI job wiring; `bun run check:dead-code` /
`bun run check:duplicate-code` / `bun run debt:score` /
`bun run debt:refactoring-readiness` all work standalone today. The
`ci.yml` commit is left in this branch's local history for the owner (or a
session with `workflow` scope) to cherry-pick/push as a tiny follow-up --
see that commit's own message for the exact 4 lines to add.

## Remaining

- [ ] None of the 5 findings are open. Follow-on / explicitly out of scope
  for this PR (recorded here, not attempted): (a) the 38 dead-code /
  222+106 unused-export/type findings in the current knip baseline are
  real, existing debt -- this PR adds detection, not a cleanup of the
  backlog it surfaces; (b) `check-refactoring-readiness.mjs`'s ranked list
  has 246 more untested `src/lib` files after `auth-guard.ts` -- adding
  tests to the rest is real future work the tool now makes visible, not a
  one-PR job.
