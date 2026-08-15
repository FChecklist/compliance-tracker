# PROGRESS -- task-20260718-071002-ai-maintainability--change-risk-manageme

VERIDIAN Review Framework gap-closure: "AI Maintainability / Change Risk
Management," 5 findings. All addressed in this one PR (they share the same
area, per this task's own instruction not to split into 5 PRs).

Before writing any code, checked the current codebase against each gap
description (per this task's own instruction that the framework evaluation
may be stale): `git grep` for dependency-index/dependency-graph/impact-
analysis/rollback-runbook/down-migration across `src/`, `scripts/`,
`docs/`, `*.md` turned up nothing but unrelated Business-Continuity-
Management "impact analysis" (`bcm-service.ts` -- disaster-recovery BIA, a
different domain). None of the 5 findings were already resolved except
#5 (Knowledge Sync), which turned out to be a genuine, confirmed duplicate
-- see below.

## Completed

- [x] **[High] Impact Analysis Before Modification** + **[High] Dependency
      Graph Accuracy** (same underlying work, per the second finding's own
      recommendation: "Build the dependency index from row 74's
      recommendation"). Built `scripts/build-dependency-index.ts`: a
      static import-graph builder over `src/app/api`, `src/lib`,
      `src/components` (which route/service/file imports which other
      internal file, resolved through the `@/` alias and relative paths).
      `bun scripts/build-dependency-index.ts` writes the graph;
      `bun scripts/build-dependency-index.ts --impact <path>` (also
      `bun run deps:impact <path>`) prints direct + transitive dependents
      via BFS -- the real pre-modification blast radius, queryable, not
      generic git/grep. Verified against the real repo (1349 files
      scanned): e.g. `--impact src/lib/services/permission-service.ts`
      correctly finds 59 real direct dependents. Pure graph-building core
      (`extractImportSpecifiers`/`resolveImportPath`/`buildDependencyGraph`/
      `computeImpact`) unit-tested in `scripts/build-dependency-index.test.ts`
      (18 tests) against fake source/filesystem, matching this repo's
      established pure-core/shell split (`model-scorecard-service.ts`).
      Doc: `docs/DEPENDENCY_INDEX.md` (usage, scope, and the honest limits
      -- static import graph only, not a runtime call graph; also notes the
      row-37 FK-constraint follow-up as explicitly out of scope for this
      pass, not attempted as a drive-by). Output JSON is gitignored
      (regenerate on demand, never committed stale).

- [x] **[High] Rollback Readiness**. `docs/ROLLBACK_RUNBOOK.md`: a real
      ordered procedure (classify the deploy -> app-code rollback ->
      database rollback -> post-rollback retrospective), distinct from and
      cross-referencing the existing `docs/SEV1_INCIDENT_RUNBOOK.md`
      (which already covers Vercel Instant Rollback for live incidents --
      not duplicated here). `drizzle/down/` convention established for
      down-migration scripts going forward, with one real worked example
      (`0224_erp_exchange_rates_source_down.sql`, paired with the existing
      forward migration) rather than only described in prose. Explicitly
      did NOT attempt to retroactively backfill down migrations for all
      230 existing forward migrations -- see `drizzle/down/README.md`'s
      "Scope, stated honestly" section for why a blind mechanical pass
      over 230 files (many additive, some genuinely irreversible without
      re-verification) would risk shipping wrong down migrations, which is
      worse than having none.

- [x] **[Low] AI Confidence Before Code Changes**. Gap: "Confidence input
      itself is not independently verified." Found the existing
      `confidence-banding.ts` (Guardrail 9) bands a reported 0-100
      confidence into a closure path, and `activity_log` already persists
      `confidencePercentage`/`confidenceBand` plus real outcome signals
      (`reviewDecision`, `reAuditRequestedAt`) -- but nothing previously
      cross-checked the two. Built
      `src/lib/services/confidence-correlation-service.ts`
      (`getConfidenceOutcomeCorrelation`): aggregates activity_log by
      confidence band and computes rejection rate + re-audit rate per
      band, then flags "miscalibration" when a band whose reported
      confidence implied a SAFER path (e.g. `auto_proceed`) shows a worse
      re-audit rate than a band that implied a less-safe path (e.g.
      `escalation_required`) -- i.e., the actual periodic check this
      finding's recommendation asked for ("audit whether reported
      confidence percentages correlate with actual outcome quality").
      Exposed at `GET /api/ai/team/confidence-audit`
      (`?sinceDays=<n>`, `veridian_admin`-gated), matching the sibling
      `/api/ai/team/scorecard` governance-report pattern exactly. Pure
      merge/scoring core unit-tested in
      `confidence-correlation-service.test.ts` (10 tests), including the
      miscalibration-detection logic itself.

- [x] **[Medium] Knowledge Synchronization Between Code and
      Documentation**. Confirmed as a genuine duplicate of the prior "AI
      Documentation" row 67 finding (closed via PR #685 / #1039 / #1047 /
      #1048) -- same gap description, same recommended approach verbatim
      ("periodic manual audit passes as the practical complement to
      structural CI checks"). Did not build a second semantic-drift
      detector, per this task's own instruction to say so rather than make
      an unnecessary change when a finding matches prior work. Instead:
      `docs/KNOWLEDGE_SYNC_AUDIT.md` documents what the existing structural
      check (`check-doc-cross-references.mjs`) does and doesn't cover
      (link validity, not semantic accuracy), and turns the "periodic
      manual audit" recommendation into a concrete checklist item attached
      to the already-existing L6 (Weekly Strategic Review) cadence in
      `audit-cadence.ts`, rather than inventing a new mechanism or
      schedule.

## Remaining

None of the 5 findings are outstanding. Two follow-ups were identified and
explicitly deferred (named honestly rather than attempted as unscoped
drive-bys):

- Row 37's FK-constraint recommendation (data-layer dependency graph via
  real foreign keys) -- a separate, larger, schema-migration-risk piece of
  work spanning `schema.ts`'s hundreds of tables. See
  `docs/DEPENDENCY_INDEX.md`'s "Related" section.
- Retroactive down migrations for the 229 pre-existing forward migrations
  that predate the `drizzle/down/` convention. See
  `drizzle/down/README.md`'s "Scope, stated honestly" section.
- CI enforcement of the `drizzle/down/` convention (currently PR-review-
  enforced only) -- see `drizzle/down/README.md`'s "Not a CI gate" section
  for why adding this now was out of scope (new-guardrail territory,
  AGENTS.md Rule 9).

## Verification

- `bun install` (node_modules was empty in this workspace at task start).
- `bun test scripts/build-dependency-index.test.ts
  src/lib/services/confidence-correlation-service.test.ts` -- 30 pass, 0
  fail.
- `bun scripts/build-dependency-index.ts` -- ran against the real repo
  (1349 files), wrote a real graph.
- `bun scripts/build-dependency-index.ts --impact
  src/lib/services/permission-service.ts` -- 59 real direct dependents,
  spot-checked against `git grep` for the same import, matches.
- Did not touch `src/lib/services/permission-service.ts`'s `ERP_ACTION_ROLES`
  table or any in-flight worker's declared scope, per this task's own
  constraint.
- Full-project `tsc --noEmit` OOMs in this environment regardless of this
  change (pre-existing environment limitation, not something introduced
  here) -- no errors were reported against any of this PR's new files
  before the OOM.
- Merged `origin/main` into this branch before opening the PR (this
  workspace's checkout was ~1326 commits behind -- resolved real conflicts
  in `PROGRESS.md`, taking this task's own content per the repo's own
  established per-task-overwrite convention for that file, and in
  `ai-os/boss/ACTIVE-CLAIMS.yaml`, keeping both sides' entries, append-only).
  Re-ran `bun install` + the full `bun test` suite post-merge: 2559 pass, 0
  fail, across 225 files -- nothing broken by the merge.
- Note: `bunfig.toml`'s `[test] root = "src"` (added by main, commit
  `6318fc773`, before this PR) means CI's bare `bun test` only auto-
  discovers `*.test.ts` under `src/` -- `scripts/build-dependency-index.test.ts`
  is therefore not picked up by that bare invocation, the same
  pre-existing, already-accepted limitation every other `scripts/*.test.ts`
  file in this repo (`audit-asset-registry.test.ts`,
  `backfill-platform-assets.test.ts`, `report-cognitive-brain-coverage.test.ts`)
  already lives with. Verified manually instead (`bun test
  ./scripts/build-dependency-index.test.ts`, 20/20 pass) -- flagged
  honestly rather than silently relying on a CI run that won't actually
  execute it.
