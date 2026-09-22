# DB role posture: `DATABASE_URL` authenticates as `app_runtime`, not a BYPASSRLS role

**Status: OPEN -- owner decision required.** Prepared 2026-09-22 under PROJEXA-COST-001 on
branch `prep/cost001-role-posture`. Nothing on that branch changes production; it adds a guard
that makes this condition impossible to miss, and this page, which frames the decision.

## The defect

`src/lib/db/index.ts` builds the raw Drizzle client `db` from `DATABASE_URL` (resolved by
`getConnectionString()` in `src/lib/db/connection-string.ts`). The code documents that client
as the RLS-bypassing `postgres` role in two places:

- `src/lib/db/tenant-scoped.ts:7-9` -- "using the `app_runtime` Postgres role (no RLS bypass --
  unlike `postgres`, which DATABASE_URL still uses for routes not yet migrated to this wrapper)"
- `src/lib/orchestra-execution-logger.ts:136-138` -- "uses the direct `db` import (DATABASE_URL,
  bypasses RLS) rather than withTenantContext, matching every existing cross-org loop's own
  convention"

In production `DATABASE_URL` has connected as **`app_runtime`** (`rolbypassrls = false`) since
roughly 2026-08-21..23. A raw-`db` query runs with no tenant context, so
`compliance.current_org_id()` is null and every `app_runtime_tenant_isolation` policy
(`org_id = compliance.current_org_id()`) matches nothing. Consequence: **every cross-org read
through `db` returns 0 rows with no error**, and every cross-org insert into an RLS-forced table
fails its WITH CHECK. The reads are the dangerous half -- "0 org(s)" is indistinguishable from
"nothing to do" unless someone looks.

## Evidence

Verified live by the PM on 2026-09-22, and re-confirmed by this branch's author the same day
where marked "(re-confirmed)". All DB checks were read-only `select`s via the Supabase MCP on
project `pcrjmlpuqsbocqfwoxod`.

| # | Evidence | Source |
|---|----------|--------|
| 1 | `pg_roles` (re-confirmed): `postgres` bypassrls=**true** super=false; `service_role` bypassrls=**true**; `app_runtime` bypassrls=**false**; `veridian_provisioning` bypassrls=**false** | live select, 2026-09-22 |
| 2 | `compliance.monitor_execution_log`, monitor `dispatch_completion_monitor` (re-confirmed): 2026-08-18 08:44, 08-19 08:38, 08-20 09:23 UTC all say "across **3 org(s)** (270 org(s) skipped: no active veridian_admin user)"; 2026-08-23 09:15, 08-25, 08-26 and every run since say "across **0 org(s)**". No rows exist for 08-21 or 08-22. | live select |
| 3 | Vercel error log: `/api/internal/loops/run` fails with `new row violates row-level security policy for table "loop_executions"` | PM, 2026-09-22 |
| 4 | `pg_stat_activity`: 16 `app_runtime` application sessions, 0 `postgres` | PM, 2026-09-22 |
| 5 | `platform.claude_log` id 203 (2026-09-04, R74 Phase 0) (re-confirmed): the rebuilt `DATABASE_URL` was "live-tested ... `select current_user` ... succeeded, connected as `app_runtime` to database `postgres`" -- then written to Production/Preview/Development. The test proved the string *works*; nobody compared the role against the code's assumption. | live select |
| 6 | Commit `aebb8763` (2026-08-24, PR #1348): "a live diagnostic query (select current_user) proved DATABASE_URL in this environment actually authenticates as app_runtime ... Every cross-org query through it silently matched zero rows under RLS". Fixed for exactly one query via `compliance.gap_log_orgs_with_recent_activity()` (`drizzle/0296`). **This is the earliest in-repo acknowledgement of the condition.** | git history |
| 7 | `.github/workflows/db-migrate.yml:72` (2026-08-29): "secrets.DATABASE_URL is the app_runtime role (correct for the app's own queries at runtime)" -- so the GitHub secret agrees with Vercel, and that comment calls the posture *correct* while the two comments above call the opposite correct. The repo disagrees with itself. | file |
| 8 | `.github/workflows/ci.yml:1174-1183` (2026-09-12): CI's `DATABASE_URL` "connects as the `app_runtime` role, which lacks BYPASSRLS ... returned ZERO rows from both tables with no error -- exactly the false-negative this check exists to prevent". Same defect, found independently, worked around locally, not generalised. | file |
| 9 | `src/lib/db/preauth-lookups.ts:27-33` (2026-08-28) already describes `db` as "authenticates as app_runtime with no org context set ... the blanket policy is the ONLY thing currently allowing them to read anything". | file |

## Blast radius

- **478 files under `src/` import the raw client** (`git grep -l -P 'from [\x22\x27]@/lib/db[\x22\x27]' -- src`, 2026-09-22): 140 under `src/app/api`, 336 under `src/lib` (269 of them in `src/lib/services`). Not every one of those is a cross-org read -- many run in a request whose tenant context is set elsewhere, or read `users`/`api_keys`, which have blanket preauth policies -- but every read that spans orgs with no context set gets 0 rows.
- **Vercel crons.** `vercel.json` schedules 29 `/api/internal/*` routes. The ones silenced by this (PM-verified): `loops`, `instruction-audit`, `metric-alerts`, `dispatch-completion-monitor`, `report-schedules`, `exchange-rate-refresh`, `orchestra-log-purge`, `routing-accuracy-report`, plus `crr-catchup-worker`, `pipeline-stuck-deal-digest`, `crm-lead-scoring`, `crm-lead-followup-alerts`, `cost-anomalies`, `idle-ai-capacity`, `task-nudge-digest`. Six route files import `db` directly (`loops`, `dispatch-completion-monitor`, `orchestra-log-purge`, `crr-catchup-worker`, `secrets-audit`, `ops-task-sync`); the rest reach it through services. Every one of these still bills a function invocation per run while doing nothing useful -- the COST-001 angle -- and the monitoring ones (`metric-alerts`, `dispatch-completion-monitor`, `cost-anomalies`) report a clean "0 org(s)" instead of alerting.
- **Admin / cross-org reports**, e.g. `/api/orchestra/routing-accuracy`, and the orchestra payload purge (`purgeExpiredOrchestraPayloads`, the very function whose comment claims bypass) -- so the 90-day prompt/response TTL is not actually being enforced.
- **Cross-org writes** (`loop_executions`) fail loudly -- the only part of this that shows up in a log.
- **Not affected:** everything inside `withTenantContext` (`APP_RUNTIME_DATABASE_URL`, org-scoped by design); the preauth lookups (`preauth-lookups.ts`, blanket policies + SECURITY DEFINER); organisation provisioning (`src/lib/db/provisioning.ts`, its own connection).

## Remediation options (the owner's decision)

**A. Restore a BYPASSRLS role behind `DATABASE_URL`** -- `postgres`, or a new dedicated role
created with `BYPASSRLS` and only the grants the crons need.
- For: one env-var change (plus one migration if a new role); matches the contract the code
  already documents; every cron and report works on the next run; the two comments become true
  again.
- Against: **re-widens every one of the 478 importers at once** -- any bug or injection in any
  raw-`db` path can read or write across all tenants again, which is the risk `app_runtime`
  exists to remove. Using `postgres` itself also hands the app a schema-owning role (DDL from a
  request path). And whoever switched the value in August may have done it *for* least
  privilege (see evidence 7); A silently reverses that without knowing why.
- Narrower variant worth naming: a dedicated BYPASSRLS role behind a **new** variable (e.g.
  `CRON_DATABASE_URL`) used only by `/api/internal/*`, leaving `DATABASE_URL` as `app_runtime`.
  Cheaper than B, tighter than A; still a policy call.

**B. Keep `app_runtime` and make each cross-org read explicit** with a `SECURITY DEFINER`
function owned by `postgres`, `EXECUTE` granted to `app_runtime`, one per query.
- Precedents already in this repo: `compliance.gap_log_orgs_with_recent_activity()`
  (`drizzle/0296`, commit `aebb8763`, called from `src/lib/ai/batch/analyse.ts:171`) and
  `compliance.lookup_user_by_email` / `compliance.lookup_api_key_by_hash` (migration
  `crr027_028`, 2026-08-27, called from `src/lib/db/preauth-lookups.ts`).
- For: least privilege stays intact; every cross-org access is named, reviewed, and narrowly
  scoped; the blast-radius list above becomes a finite work list.
- Against: **per-callsite work** -- each of the 15 crons and each admin report needs its own
  function and migration, and until a given one is done that cron stays silent; cross-org
  *writes* (`loop_executions`) need a function or a targeted policy too; the two comments and
  `EXPECTED_POSTURE.DATABASE_URL` in the guard must flip to `bypassrls: false` in the same PR.

Either way the decision must be written down where the guard can read it (the
`EXPECTED_POSTURE` table in `scripts/check-db-role-posture.mjs`) so the repo stops disagreeing
with itself.

## What changed on 21-23 Aug 2026

- **Git: nothing that explains it.** `git log -S"DATABASE_URL" --since=2026-08-15
  --until=2026-08-25 -- .github/ scripts/ src/lib/db/` returns two commits, neither of which
  changes how `DATABASE_URL` is consumed: `c37f91c9` (08-18, deleted dispatch workflows and
  scripts that merely referenced it) and `d40f77fa` (08-24, comment lines in a backfill
  script). `-S"app_runtime"` repo-wide in the window finds only ordinary per-table
  `app_runtime_tenant_isolation` policies in new migrations (`cd327948`, 08-21:
  `drizzle/0317`, `0319`) and the `aebb8763` workaround -- nothing alters the role or the
  connection string. `src/lib/db/connection-string.ts` is unchanged since 2026-07-09.
- **So the change was to the *value* of the Vercel env var** -- an infra action outside git --
  between the 2026-08-20 09:23 UTC and 2026-08-23 09:15 UTC monitor runs (evidence 2). Who,
  and why: **could not determine.** Vercel's own env-var metadata cannot answer it either: the
  variable was re-set on 2026-08-29 (`scripts/db-migrate-preflight.mjs` header) and removed and
  re-added on 2026-09-04 (evidence 5), so its `updatedAt` no longer points at the August change.
  Not checked: Vercel's team audit log (owner-only; outside this brief and R76's lockdown).

## The guard added on this branch

- `scripts/check-db-role-posture.mjs` -- for each of `DATABASE_URL`, `APP_RUNTIME_DATABASE_URL`,
  `PROVISIONING_DATABASE_URL` that is set, opens one short-lived connection (`max: 1`, 10 s
  connect timeout), runs `select current_user, current_database(), rolbypassrls, rolsuper`, and
  prints one row per variable -- never a URL or password. Compares against `EXPECTED_POSTURE`
  (`DATABASE_URL` -> bypassrls **true**, the code's documented assumption;
  `APP_RUNTIME_DATABASE_URL` -> `app_runtime`, bypassrls false; `PROVISIONING_DATABASE_URL` ->
  `veridian_provisioning`). Exit 1 on any mismatch (or on a set-but-unreachable string --
  "unverified" is not green) with a one-line explanation naming the two stale comments;
  `--report-only` always exits 0; `--json` emits the rows. Unset variables are "not set", not a
  failure. Pure functions are exported; `scripts/check-db-role-posture.test.ts` proves the
  logic (including that the live 2026-09-22 posture is flagged) with no network.
- `.github/workflows/db-role-posture.yml` -- `workflow_dispatch` only (weekly `schedule`
  commented out), runs the script `--report-only` with the two existing repo secrets by name,
  `continue-on-error: true`, uploads the JSON as an artifact. Its header says why it is
  report-only and lists the steps to flip it to enforcing once the decision lands.
- Not verified live from the preparing laptop: the script was exercised locally for the
  not-set, bad-flag, `--json`, and unreachable paths only (there is no sanctioned way to obtain
  the production connection string here without reading `.env*`). The first
  `workflow_dispatch` run is the live proof.

## To fix with the decision (deliberately NOT touched on this branch -- `src/` is out of scope)

1. `src/lib/db/tenant-scoped.ts:7-9` -- rewrite the "unlike `postgres`, which DATABASE_URL still
   uses" clause to state the decided posture.
2. `src/lib/orchestra-execution-logger.ts:136-138` -- rewrite "direct `db` import (DATABASE_URL,
   bypasses RLS)"; under option B this purge needs its own SECURITY DEFINER function.
3. `.github/workflows/db-migrate.yml:72` -- the "correct for the app's own queries" remark must
   agree with 1 and 2.
4. `scripts/check-db-role-posture.mjs` `EXPECTED_POSTURE.DATABASE_URL` -- flip to `bypassrls:
   false` only under option B, in the same PR as 1-3.
5. `.github/workflows/db-role-posture.yml` -- follow its header's flip-to-enforcing steps.
6. `ai-os/OS.yaml` -- register this page in the governance index (not done here).
