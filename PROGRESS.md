# PROGRESS -- task-20260726-171957-crm-performance-under-load-indexes---loa

V2-16 -- CRM performance-under-load indexes + load-test harness.
Redispatch of a task originally blocked 2026-07-20 by a spend-governance
gate before any work started. Re-verified live against schema.ts/
drizzle/*.sql before starting: confirmed genuinely still open (no composite
index on crm_leads/crm_opportunities anywhere, no CRM-specific load-test
harness existed -- scripts/veridian-full-load-test.ts and
scripts/projexa-load-test.ts both exercise the orchestra/task-dispatch
layer, not CRM-table query performance).

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (no collision --
      existing CRM-area claims all touch application/UI logic, none claim
      schema.ts index changes or a CRM-specific load-test harness).
- [x] Grepped real service-layer query patterns (crm-service.ts,
      crm-accounts-service.ts, sales-engine-service.ts, veri-reward-service.ts)
      to determine which composite indexes actually matter, rather than
      guessing. Confirmed `getSalesPipelineOverview()`'s overdue-follow-up
      counts filter `(org_id, next_action_date)` with zero index support
      today -- this is the real "pipeline/dashboard" gap named in the spec.
- [x] Wrote `drizzle/0264_v2_16_crm_perf_indexes.sql`: 8 additive
      `CREATE INDEX IF NOT EXISTS` statements --
      `crm_leads(org_id,status,created_at)`,
      `crm_opportunities(org_id,stage)`,
      `crm_leads(org_id,next_action_date) WHERE next_action_date IS NOT NULL`,
      `crm_opportunities(org_id,next_action_date) WHERE next_action_date IS NOT NULL`,
      `crm_accounts(org_id,lifecycle_stage,created_at)`,
      `crm_contacts(org_id,account_id)`,
      `sales_referrals(org_id,status)`,
      `veri_reward_referrals(org_id,referrer_user_id)`.
      **Not applied against any live/shared database this session** -- Tier2
      (schema change) holds for Owner sign-off per this task's own
      constraints, same "left for the supervising session" convention as
      drizzle/0262 and others (see this session's ACTIVE-CLAIMS entry).
- [x] Wrote `scripts/crm-perf-load-test.ts`: a real, runnable synthetic
      load-test harness. Seeds 110,000 rows (50k leads + proportional
      opportunities/accounts/contacts/sales_referrals/veri_reward_referrals)
      into a throwaway `compliance` schema on a **disposable local Postgres
      container** (never the shared `supabase_db_verdian-ai`/
      `supabase_db_projexa` containers already running on this host, and
      never a real `DATABASE_URL` -- guarded by requiring a distinct
      `CRM_LOADTEST_DATABASE_URL` env var plus a hostname-pattern refusal
      check). Runs the 8 real query patterns via `EXPLAIN (ANALYZE,
      BUFFERS)` before/after applying `drizzle/0264_v2_16_crm_perf_indexes.sql`
      verbatim (read from disk, not re-typed).
- [x] **Actually ran the harness** (spun up a disposable `postgres:17`
      Docker container, installed the `postgres` npm package in an isolated
      temp dir since this sandbox had neither `bun` nor a project
      `node_modules` install, ran via `node --experimental-strip-types`,
      then discarded the container) -- this is real measured data, not
      hypothetical. Results: 6 of 8 query patterns measurably faster
      (up to 103.8x, with `rowsRemovedByFilter` dropping to 0 on every
      improved query -- the planner stops post-filtering entirely), 2 of 8
      neutral (~1x, honestly reported with root-cause explanation, not
      hidden -- see results doc §4).
- [x] Wrote `docs/testing/CRM_PERF_LOAD_TEST_RESULTS.md` -- full
      methodology, per-query before/after table, and the honest
      still-worth-it explanation for the two ~1x results.
- [x] Verification command from the task spec re-run against the current
      tree, passes:
      `grep -n "org_id.*status.*created_at\|org_id.*stage" drizzle/*.sql src/lib/db/schema.ts`
      now matches `drizzle/0264_v2_16_crm_perf_indexes.sql`;
      `find scripts -iname "*crm*load*test*"` now finds
      `scripts/crm-perf-load-test.ts`.

- [x] PR #576 opened, then found `main` had moved on (PR #572 merged) leaving
      PROGRESS.md in merge conflict. Resolved by keeping this task's entry --
      confirmed via `git show origin/main:PROGRESS.md` that this file is a
      per-task scratch log each merged PR overwrites wholesale (not an
      append-only history), so dropping the unrelated prior task's entry
      matches established convention, not data loss (merge commit `66adfb37`).
- [x] Post-merge CI run surfaced a real `Type Check` failure in this PR's
      own new file: `before`/`after` result arrays in
      `scripts/crm-perf-load-test.ts` had no type annotation, so `tsc`
      inferred `never[]` and rejected every `push()`/property access
      (TS2345/TS2339). Fixed with an explicit
      `({ label: string; query: string } & PlanResult)[]` annotation on
      both arrays (commit `6e4e51e9`). Re-ran `tsc --noEmit` locally after
      the fix -- zero `error TS` output anywhere in the tree.
- [x] Confirmed the two remaining non-green PR checks are both
      out-of-scope for this task, not caused by this diff:
      `Metadata Index Coverage Check` fails identically on `main`'s own
      last several CI runs (56 pre-existing ungoverned `ai-os/` files,
      none touched by this PR) and is not in branch protection's
      `required_status_checks` list -- doesn't block merge.
      `audit-check` requires a separate `AUDIT: PASS`/`FAIL` comment per
      AGENTS.md Rule 7c ("whichever agent did not implement a task is the
      mandatory auditor -- no self-certification"); since this session
      implemented the change, posting that comment itself would be
      self-certification, so it's correctly left for a separate
      supervising session to audit and comment before merge.

## Remaining
- [ ] None for this task's implementation scope. Live application of
      `drizzle/0264_v2_16_crm_perf_indexes.sql` against the real Supabase
      database is intentionally left for the supervising session /
      Owner sign-off (Tier2 hold, not an oversight).
- [ ] PR #576 is open, mergeable, and all required CI checks green except
      `audit-check`, which needs a non-implementer session's audit comment
      before merge (Rule 7c) -- this session does not merge.
