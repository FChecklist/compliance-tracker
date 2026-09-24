# PROJEXA-COST-001 — prepared `pg_cron` replacements, batch A

**Status: PREPARED, NOT APPLIED.** Nothing in this directory has been executed
against any database. No function exists, no `cron.job` row exists, no row has been
written. This branch (`prep/cost001-sql-a`) is the deliverable; applying is a
separate, deliberate owner action described below. Work-order rule, verbatim:
*"Prepare, do not execute. Branch only."*

Owner: Rajat Agarwal. Prepared 2026-09-22 against live project
`pcrjmlpuqsbocqfwoxod` (read-only `select` statements only).

## 1. What this is

Five Vercel crons (`vercel.json` `crons`, all hitting
`src/app/api/internal/<path>/run/route.ts` behind a `CRON_SECRET` bearer check)
were verified as **pure-Postgres work** — each handler's whole effect is one or
two SQL statements on tables in this database. They are re-expressed here as
`compliance.cron_*()` plpgsql functions so `pg_cron` can run them **inside
Supabase**, removing five daily/monthly Vercel function invocations from the bill
(the owner's ceiling is $20/month, PROJEXA-COST-001).

Not in scope here: any cron that needs HTTP (`pg_net` is **not** installed on this
project), any change to `vercel.json`, `drizzle/`, `supabase/migrations/` or
`src/` (all untouched, by instruction), and the remaining Vercel crons.

| File | Function | Schedule (UTC) | Replaces (Vercel route) | Parameters |
|---|---|---|---|---|
| `01_fm_ppm_generate_occurrences.sql` | `compliance.cron_fm_ppm_generate_occurrences(p_lookahead_days int = 14, p_today date = null)` | `0 2 * * *` | `/api/internal/fm-ppm/generate-occurrences/run` | lookahead window; `p_today` is a test override |
| `07_the_firm_recur_engagements.sql` | `compliance.cron_the_firm_recur_engagements(p_month_end text = 'clamp', p_today date = null)` | `30 7 * * *` | `/api/internal/the-firm/recur-engagements/run` | **OWNER DECISION #4** (`'clamp'` / `'overflow'`) |
| `08_audit_cadence.sql` | `compliance.cron_audit_cadence(p_window_hours int = 24)` | `15 8 * * *` | `/api/internal/audit-cadence/run` | **OWNER DECISION #5** (`24` / `3`) |
| `18_orchestra_log_purge.sql` | `compliance.cron_orchestra_log_purge(p_retention_days int = 90)` | `45 9 * * *` | `/api/internal/orchestra-log-purge/run` | was env `ORCHESTRA_PAYLOAD_RETENTION_DAYS` |
| `20_ai_reduction_snapshot.sql` | `compliance.cron_ai_reduction_snapshot(p_platform_only bool = false, p_snapshot_date date = null)` | `0 2 1 * *` | `/api/internal/ai-reduction-snapshot/run` | all rows vs `org_id IS NULL` rows |

Every function: `language plpgsql`, `set search_path = compliance, platform,
public`, `SECURITY INVOKER` (default — no privilege of its own), returns a `jsonb`
summary of counts, is idempotent (`on conflict do nothing` / `where ... is null`
guards, same as the TypeScript), and takes a transaction-scoped advisory lock so
two overlapping runs cannot interleave (the second returns `{"skipped": true}`).
Each file also `revoke`s `EXECUTE` from `PUBLIC` — only the owner role (`postgres`,
which is what a `pg_cron` job runs as) can call them. Each file ends with the
`cron.schedule(...)` line **commented out** and a commented rollback.

Schedules are byte-identical to the Vercel ones. Both Vercel crons and this
project's `pg_cron` run on UTC (`cron.timezone = GMT`, `TimeZone = UTC`, verified
live), so wall-clock timing does not change.

## 2. The role / RLS framing — read this before applying

This is the single most important thing about batch A: **these functions do not
merely move the crons, they switch behaviour back on that has been silently off.**

* The TypeScript handlers run on the raw `db` export
  (`src/lib/db/index.ts` → `getConnectionString()` → `DATABASE_URL`). In
  production that connection string authenticates as the **`app_runtime`** role.
  Verified live: `pg_roles.rolbypassrls` is `false` for `app_runtime` and `true`
  for `postgres`.
* Every table these crons touch has **RLS enabled** (and *forced* on all but
  `activity_log` / `ai_reduction_snapshots`). The `app_runtime` policies are all
  of the form `org_id = compliance.current_org_id()` (plus `org_id IS NULL OR …`
  for `fm_checklist_templates`, and a separate `org_id IS NULL` read policy on
  `platform.task_capabilities`).
* `compliance.current_org_id()` is `NULLIF(current_setting('app.current_org_id',
  true), '')` — it reads a session GUC that is **only ever set inside
  `withTenantContext()`** (`src/lib/db/tenant-scoped.ts:472`). A cross-org cron
  has no tenant, so the GUC is unset, the predicate evaluates to NULL, and the
  cron's cross-org SELECT/UPDATE has matched **zero rows** since the production
  `DATABASE_URL` moved to `app_runtime` (~2026-08-23).
* A `pg_cron` job runs as **`postgres`** (BYPASSRLS). Scheduling any of these
  functions therefore **re-enables** the behaviour platform-wide. That is the
  intent of the work order — but it is a real change, and the owner signs it off
  per function in the decision table below. It is *not* a silent side effect.
* Partial exception, stated plainly: cron 20 (`ai-reduction-snapshot`) did keep
  working under `app_runtime`, reading only `org_id IS NULL` rows through the
  `app_runtime_read_platform_defaults` policy and inserting through the
  `WITH CHECK (true)` insert policy — there is one live snapshot row dated
  2026-08-01 (and none for 2026-09-01). Under `postgres` it sums **all** rows,
  which is what `drizzle/0233`'s header documents as the design. Identical today
  (the table has exactly 1 row, `org_id IS NULL`). `p_platform_only => true` pins
  the narrower reading if preferred.

## 3. Decision table (owner)

| # | Cron | Decision | Options | Default in file | Recommendation |
|---|---|---|---|---|---|
| S1 | 01 fm-ppm | Switch-on: resume occurrence generation + overdue marking for every org | schedule / don't | — | schedule (0 rows affected today) |
| S1a | 01 fm-ppm | Unknown `frequency` value | skip + count (SQL) / abort run (TS) | skip + count | keep; unreachable today (enum has exactly the 7 values) |
| S2 | 07 the-firm | Switch-on: resume recurring-engagement cloning for the_firm orgs | schedule / don't | — | schedule (0 rows affected today; 1 org enabled) |
| **#4** | 07 the-firm | Month-end arithmetic (`p_month_end`) | `'clamp'` (Postgres interval; 31 Jan+1 → 28/29 Feb) / `'overflow'` (JS `setUTCMonth`; 31 Jan+1 → 3 Mar) | `'clamp'` | `'clamp'` — **but** `createEngagement()` (`firm-engagement-service.ts:66`) still seeds the *first* `next_occurrence_date` with the overflowing JS helper, so the owner must pick one and, if `'clamp'`, align the TS in a follow-up PR |
| S2a | 07 the-firm | Catch-up semantics | one interval per daily run (TS) | as TS | keep (faithful) |
| S3 | 08 audit-cadence | Switch-on: resume automated re-audit flagging | schedule / don't | — | schedule (0 rows; `activity_log` is empty) |
| **#5** | 08 audit-cadence | Scan window (`p_window_hours`) | `24` (covers the daily cadence) / `3` (faithful TS value — a confirmed bug: misses 21 h of every day since the 2026-07-14 move to daily) | `24` | `24`; optionally a larger one-off value on the first run to back-fill |
| S3a | 08 audit-cadence | L4 read-only count | dropped / reinstate | dropped | dropped — it was returned only in the HTTP body, nothing consumed it; query kept in the file as a comment |
| S4 | 18 orchestra-log-purge | Switch-on: **irreversible** purge of `input`/`output` payloads older than the window | schedule / don't | — | schedule; **this cron has never purged a row in production** — 0 eligible today, first row becomes eligible 2026-10-02 UTC |
| S4a | 18 orchestra-log-purge | Retention (`p_retention_days`) | any positive int | `90` | `90` (the TS default); invalid values raise instead of silently falling back |
| S5 | 20 ai-reduction-snapshot | Sum semantics (`p_platform_only`) | `false` = all rows (drizzle/0233 design) / `true` = `org_id IS NULL` only (what `app_runtime` effectively did) | `false` | `false`; identical result today |

To choose a non-default, edit the argument in the `cron.schedule` command, e.g.
`$$select compliance.cron_the_firm_recur_engagements('overflow');$$`.

## 4. Dry-run 2026-09-22 (read-only, live, `postgres` semantics)

Each function's read half was run against the live database with the exact
predicates the write uses (UTC date 2026-09-22; `now()` = 07:05 UTC).

| Cron | What the write would act on today | Live count | Context |
|---|---|---|---|
| 01 fm-ppm | schedules due in window → occurrences generated | **0** | `fm_ppm_schedules` 0 rows, `fm_ppm_occurrences` 0 rows, `fm_checklist_templates` 0 rows (orphans 0, already-generated 0) |
| 01 fm-ppm | `due` occurrences past due, not notified → overdue | **0** | — |
| 07 the-firm | due recurring engagements → cloned + advanced | **0** | 1 org has `the_firm` enabled (branch row exists); `firm_engagements` 0 rows; unknown-recurrence skips 0 |
| 08 audit-cadence | failed + unflagged in window → flagged | **0** (3 h) / **0** (24 h) | `activity_log` 0 rows total; never previously flagged by `system:audit-cadence-scan` |
| 18 orchestra-log-purge | `payload_purged_at IS NULL AND created_at < now()-90d` → purged | **0** | 2,624 rows, **0** ever purged, oldest `created_at` 2026-07-04 14:04 UTC → first eligible 2026-10-02; 2,313 rows carry `input->'escalation'` (why `input` becomes `{}`, not NULL) |
| 20 ai-reduction-snapshot | 1 row inserted | **1** | `platform.task_capabilities` 1 row (`org_id IS NULL`): 3 / 0 / 0 → total 3 — identical for all-rows and platform-only; existing snapshots 1 (2026-08-01) |

Every column referenced by every function was confirmed present in
`information_schema.columns` (see each file's "COLUMNS VERIFIED LIVE" block).
`UNIQUE (schedule_id, due_date)` on `fm_ppm_occurrences` confirmed via
`pg_constraint`. No `compliance.cron_*` function existed before this work (name
collision check). `cron.schedule(job_name text, schedule text, command text)`
and `cron.unschedule(job_name text)` exist (`pg_cron` 1.6.4).

## 5. Column-name / type drift observed

* **No column-name drift** on any of the ten tables — every name used in the
  TypeScript maps to the live column the file uses.
* **Type drift, informational:** `schema.ts` declares `created_at` / `updated_at`
  / `overdue_notified_at` / `payload_purged_at` / `re_audit_requested_at` on these
  tables as timezone-naive `timestamp()`, and `drizzle/0233` declares
  `ai_reduction_snapshots.created_at` as `timestamp`; the **live** columns are all
  `timestamptz`. The SQL here writes `now()` (timestamptz), which is correct for
  the live type. Same drift class CLAUDE.md already documents for `memory_records`.
* `ai_reduction_snapshots.snapshot_date` is a live `date`; the TS passes a
  `'YYYY-MM-DD'` string. The SQL inserts a `date` value directly (a `to_char()`
  text would not assignment-cast to `date`).
* `fm_checklist_templates.frequency`, `fm_ppm_occurrences.status`,
  `firm_engagements.service_line` / `fee_type` are Postgres enums live (TS treats
  them as string unions); labels verified and listed in the files.

## 6. Local execution check (not committed)

Because nothing may be created on the live database, the five files were also
executed **verbatim** against a throwaway in-memory PGlite (real Postgres as WASM,
`@electric-sql/pglite` 0.5.8 from this repo's own `node_modules`, the same engine
`bun run check:migration-replay` uses) with live-shaped tables (same names, types,
enums, NOT NULLs and unique constraints). The harness seeded edge cases for every
branch — orphaned template, pre-existing occurrence (conflict-skip without
advance), month-end clamp vs overflow (31 Jan → 28 Feb vs 3 Mar; 30 Nov + 3 mo →
28 Feb vs 2 Mar), terminated / wrong-branch / missing-client / unknown-recurrence
engagements, 3 h vs 24 h windows, already-flagged rows, already-purged rows, empty
and mixed `task_capabilities` — and asserted the written values and idempotent
re-runs. All checks passed. The harness lives outside the repo (it is a test rig,
not a deliverable) and can be re-created from the assertions described here on
request.

The month-end expression itself was additionally validated **live** with a pure
`SELECT` over nine sample dates; both columns matched hand-computed JS results.

## 7. How to apply (later — owner only)

1. Open the Supabase SQL editor for `pcrjmlpuqsbocqfwoxod` as `postgres`.
2. Take the decisions in section 3.
3. **One file at a time**, paste the whole file and run it. Only the
   `create or replace function` and the `revoke` execute; the `cron.schedule`
   and rollback lines are comments.
4. Run the function **once by hand** and read the summary before scheduling:
   `select compliance.cron_orchestra_log_purge();` etc. Compare the counts with
   section 4 (re-run the dry-run queries if days have passed).
5. Uncomment and run that file's `select cron.schedule(...)` line — with the
   chosen argument if it differs from the default.
6. After the first scheduled run, verify (section 8).
7. Separately (its own PR, not here): remove the five entries from
   `vercel.json`'s `crons` so Vercel stops invoking routes that would now do the
   work twice — harmless because every function is idempotent, but it is the
   whole point of the cost work order.

Do **not** use `apply_migration` / `drizzle/` for these: they are operational
objects, not schema, and the repo's migration folder is documented as not being
a from-empty rebuild source anyway.

## 8. How to verify

```sql
-- what is scheduled
select jobid, jobname, schedule, command, nodename, active
  from cron.job order by jobname;

-- recent runs (status 'succeeded' / 'failed', return_message holds the jsonb summary or the error)
select jobid, runid, status, return_message, start_time, end_time
  from cron.job_run_details
 order by start_time desc limit 25;

-- domain checks
select count(*) from compliance.fm_ppm_occurrences where status = 'overdue' and overdue_notified_at is not null;
select count(*) from compliance.firm_engagements where recurrence_type = 'none' and start_date = current_date;
select count(*) from compliance.activity_log where re_audit_requested_by = 'system:audit-cadence-scan';
select count(*) from compliance.orchestra_executions where payload_purged_at is not null;
select * from compliance.ai_reduction_snapshots order by created_at desc limit 3;
```

Baseline before apply (live 2026-09-22): `cron.job` has 0 rows,
`cron.job_run_details` has 0 rows.

## 9. Rollback

Per file, bottom block: `select cron.unschedule('<jobname>');` then
`drop function if exists compliance.cron_<name>(<arg types>);`. Job names:
`cost001-fm-ppm-generate-occurrences`, `cost001-the-firm-recur-engagements`,
`cost001-audit-cadence`, `cost001-orchestra-log-purge`,
`cost001-ai-reduction-snapshot`. Data written by a run is **not** reverted by
rollback; for cron 18 in particular, purged payloads are gone.

## 10. Things this batch deliberately does not do

* Does not touch `vercel.json` (the five Vercel cron entries are still there).
* Does not carry over `CRON_SECRET` (no HTTP surface exists any more).
* Does not replicate cron 18's on-error insert into `application_errors`; a
  failing `pg_cron` run is recorded in `cron.job_run_details` instead.
* Does not fix the TS `addMonthsToDateStr()` overflow on the creation path
  (OWNER DECISION #4 must land first).
* Does not persist the dropped L4 count anywhere.
