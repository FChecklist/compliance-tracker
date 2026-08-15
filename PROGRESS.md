# PROGRESS -- task-20260718-070004-ai-engineering-quality--technical-debt

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
Debt & Complexity (5 findings). Re-checked each finding against current
code before touching anything, per the task's own instruction -- all 5 were
still genuinely open (no dead-code/duplicate-code tooling, no complexity
rule, no composite debt score, and auth-guard.ts -- the single highest-
churn file in src/lib -- had zero test coverage). All 5 findings share one
module/area (CI quality tooling) and are closed in one PR.

## Completed
- [x] **Dead Code Detection** (Medium): added `knip` as a devDependency +
      `knip.json` (entry points: app router files, middleware, seed script,
      CI scripts). `scripts/check-dead-code.mjs` wraps it, diff-scoped like
      `check-migration-collision.mjs` -- fails only if a NEW file this PR
      adds is unreachable from every real entry point, not on the ~18
      pre-existing dead files knip's first full-repo run found (left for a
      separate cleanup pass, listed in the script's own header). Script +
      `bun run check:dead-code` alias merged; CI wiring pending, see note
      below.
- [x] **Duplicate Code Detection** (High): added `jscpd` as a
      devDependency + `.jscpd.json` (excludes components/ui, *.test.ts,
      db/schema.ts). Measured real baseline: 1.97% duplicated lines across
      src/. Threshold set to 4% (headroom over baseline).
      `scripts/check-duplicate-code.mjs` wraps jscpd's own exit code into a
      clear CI failure message. Script + `bun run check:duplicate-code`
      alias merged; CI wiring pending, see note below.
- [x] **Technical Debt Score** (Medium): `scripts/technical-debt-score.mjs`
      derives a real composite 0-100 score from 3 existing trackers (no new
      tracking mechanism invented): open MASTER-TRACKER.yaml items
      (OPEN-*/GAP-* ids, excludes settled RATIFIED-* decisions) + empty-
      guardrail % from check-guardrail-presence.mjs's manifest + stale-doc
      count from stale-doc-manifest.yaml. Real measured score as of
      2026-08-15: **62/100** (18 open items, 0% empty guardrails, 44 stale
      docs). Informational, always exits 0, documented in the script's own
      header as a visibility tool, not a gate (a hard threshold would be an
      Owner-level product decision, not something to bake in silently).
      Script + `bun run debt:score` alias merged; CI wiring pending, see
      note below.

**Note on CI wiring:** all 3 `.github/workflows/ci.yml` job blocks
(`dead-code-detection`, `duplicate-code-detection`, `technical-debt-score`)
were written, and locally verified to actually pass, but could NOT be
pushed from this session -- this session's `gh` token lacks the `workflow`
OAuth scope GitHub requires for any push touching `.github/workflows/*.yml`
(same blocker as documented in a prior session's memory; not this repo's
own branch protection, a separate GitHub-side guardrail). The exact job
YAML + insertion point is preserved verbatim in
`docs/pending-ci-wiring/technical-debt-ci-jobs.md` for whoever has
`workflow` scope to apply as a tiny, already-reviewed follow-up. The
scripts/configs/package.json aliases they call are all merged and directly
runnable via `bun run check:dead-code` / `bun run check:duplicate-code` /
`bun run debt:score` in the meantime.
- [x] **Code Complexity Score** (Medium): added ESLint's `complexity` rule,
      scoped to the largest true orchestration/service files (measured, not
      guessed): report-engine-service.ts, capability-tree-service.ts,
      chat-service.ts, erp-fixed-assets-service.ts,
      capability-audit-service.ts, orchestra-model-resolver.ts,
      task-tightening.ts get `error` at threshold 20 (real measured max was
      18) -- a real ratchet, not decorative. task-execution-engine.ts (the
      single largest orchestration file, 2437 lines) measured functions up
      to complexity 372 (`dispatchEngine`'s engine-type switch) -- kept at
      `warn` only, since gating it at the same threshold would either
      instantly fail CI or force a threshold so high it's meaningless;
      flagged instead as the concrete next "Refactoring Readiness"
      candidate rather than blind-refactored in this same PR. `bun run
      lint` and `bunx tsc --noEmit` both still pass clean (0 errors).
- [x] **Refactoring Readiness** (Medium): per the finding's own
      recommendation ("prioritize adding tests to the largest/most-changed
      untested files before refactoring them"), cross-referenced
      `git log --name-only` churn against existing `*.test.ts` coverage.
      `src/lib/supabase/auth-guard.ts` was the highest-churn (23 commits)
      untested file in src/lib, and it's not peripheral -- every API route
      calls `requireAuth()`/`requireRole()` from it. Added
      `src/lib/supabase/auth-guard.test.ts`: 20 real tests (44 assertions)
      covering `ROLE_RANK`, `hasRole`, `requireRole`, `hasScope`,
      `requireRoleOrScope`, including a regression test for the real,
      already-fixed "6 Wave-1 hierarchy roles silently locked out" bug
      documented in the file's own comments. All 20 pass against the real
      implementation. `requireAuth()`/`autoProvisionUser()` (need a real
      Supabase/DB double) deliberately left uncovered -- out of scope for
      this slice, noted honestly rather than claimed as done.

## Verification run (2026-08-15)
- `bun run lint` -- 0 errors, 6 warnings (3 pre-existing + unrelated, 3 are
  the new task-execution-engine.ts complexity warnings, all informational).
- `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit` -- clean (the
  default heap OOMs on this repo's schema.ts regardless of this PR; not a
  regression this PR introduced).
- `bun test` -- 1441 pass, 0 fail, across 104 files (was 103 before this
  PR's new auth-guard.test.ts).
- `node scripts/check-dead-code.mjs` -- passes (1 new file this PR adds,
  not dead).
- `node scripts/check-duplicate-code.mjs` -- passes (1.97% < 4% threshold).
- `node scripts/technical-debt-score.mjs` -- runs, prints 62/100.

## Remaining
- [ ] Apply `docs/pending-ci-wiring/technical-debt-ci-jobs.md`'s 3 job
      blocks to `.github/workflows/ci.yml` -- blocked on `workflow` OAuth
      scope this session does not have, not on any remaining design/code
      work. Everything else for this gap-closure's 5 findings is complete.
      Follow-up ideas noted above but explicitly out of scope: (a) refactor
      task-execution-engine.ts's 3 highest-complexity functions under its
      own dedicated PR, (b) a deliberate cleanup pass for knip's ~18-file
      pre-existing dead-code backlog, (c) real Supabase/DB-doubled tests
      for requireAuth()/autoProvisionUser().
