# PROJEXA-COST-001 — prepared `pg_cron` replacements, batch B

**Status: PREPARED, NOT APPLIED.** Nothing in this batch has been executed against
any database in a way that persisted. This branch (`prep/cost001-sql-b`) is the
deliverable; applying is a separate, deliberate owner action. Work-order rule,
verbatim: *"Prepare, do not execute. Branch only."*

Owner: Rajat Agarwal. Prepared 2026-09-22, re-validated 2026-09-24, against live
project `pcrjmlpuqsbocqfwoxod`.

## 1. What this is

Five more Vercel crons, re-expressed as `pg_cron`-ready `compliance.cron_*()`
functions. Same framing as batch A (`README.md`) — production `DATABASE_URL`
authenticates as `app_runtime` (no `BYPASSRLS`), so every one of these routes has
read zero cross-org rows since ~2026-08-23; scheduling under `pg_cron` (runs as
`postgres`, which has `BYPASSRLS`) re-enables that behaviour. Not a neutral move —
owner-signed.

| File | Function(s) | Schedule (UTC) | Replaces |
|---|---|---|---|
| `04_metric_alerts.sql` | 6 functions (`cron_metric_alert_rules`, `cron_ticket_sla_breaches`, `cron_ticket_escalations`, `cron_task_overdue`, `cron_task_reprioritise`, `cron_cost_cap`) + wrapper `cron_metric_alerts` | `0 5 * * *` | `/api/internal/metric-alerts/run` (route's own `Promise.all` over 6 checks) |
| `10_task_nudge_digest.sql` | `compliance.cron_task_nudge_digest(p_dedup, p_dry_run, p_due_soon_window_days, p_now)` | `0 8 * * *` | `/api/internal/task-nudge-digest/run` |
| `15_report_schedules.sql` | `compliance.cron_report_schedules(p_dedup, p_dry_run, p_now, p_default_hour, p_once_per_slot)` | **`5 * * * *`** (hourly — see Owner Decision #6, NOT the Vercel `45 8 * * *`) | `/api/internal/report-schedules/run` |
| `23_pipeline_stuck_deal_digest.sql` | `compliance.cron_pipeline_stuck_deal_digest(p_dedup, p_dry_run, p_stuck_threshold_days, p_now)` | `50 9 * * *` | `/api/internal/pipeline-stuck-deal-digest/run` |
| `27_crm_lead_followup_alerts.sql` | `compliance.cron_crm_lead_followup_alerts(p_dedup, p_dry_run, p_now, p_branch_key)` | `15 11 * * *` | `/api/internal/crm-lead-followup-alerts/run` |

Every function: `SECURITY INVOKER`, `set search_path = compliance, platform,
public`, a transaction-scoped advisory lock (a second overlapping run returns
`{"skipped":"overlap"}` instead of double-running), and a `p_dry_run boolean
default false` that evaluates everything and returns real counts with zero
writes — the recommended first call after applying.

## 2. Dedup convention (Owner Decisions #3 / #7 — applies to every function here)

Every notification-writing function takes `p_dedup boolean default true`. When
true, a notification is skipped for a recipient who already has an **unread**
notification with the same `type` + `metadata->>'kind'` (+ the same entity id in
metadata, where one exists). The TypeScript re-notifies on every run with no
dedup at all — live proof: 132 "SLA breached" rows = 2 tickets × 2 recipients ×
33 daily runs (2026-07-10 → 2026-08-21); 12 "stuck deal" rows = 6 days × 2 owners.
`p_dedup => false` reproduces today's TS behaviour exactly for every function
except `cron_metric_alert_rules`'s five checks, whose TS metadata has no `kind`
key at all — this port adds one so there is something stable to dedup on, so the
very first `p_dedup => true` run after apply still writes once per (recipient,
kind) before dedup starts biting on the second run.

**Owner Decision #3 (both batches):** `cron_task_overdue` (batch A, in
`04_metric_alerts.sql`) and `cron_task_nudge_digest` (this file) both notify a
task's assignee about the same overdue task on the same morning — 05:00 one row
per task, 08:00 one row per user (batched). Keep one. Recommendation only, not a
decision: keep the digest (lower noise), leave `cron_task_overdue` unscheduled —
but `cron_task_overdue` also notifies `assignedById`, which the digest does not.

## 3. Live dry-run counts (2026-09-24, `p_dry_run => true`, rolled back)

| Function | Result |
|---|---|
| `cron_metric_alert_rules` | 0 active rules (`checked: 0`) |
| `cron_ticket_sla_breaches` | 0 breached tickets today (the 132 legacy rows are unread but the tickets they cite may since be resolved — re-check live before scheduling) |
| `cron_ticket_escalations` | 0 candidates (no ticket has both `sla_policy_id` and `sla_deadline` set today) |
| `cron_task_overdue` | 0 (see §4b — `tasks.status` today is only `completed`/`failed`) |
| `cron_task_reprioritise` | 0 evaluated (same reason) |
| `cron_cost_cap` | 0 orgs with enforcement enabled |
| `cron_task_nudge_digest` | 0 users (Owner Decision #10a: live `tasks.status` contains only `completed`/`failed` today — 1,917 rows, 9 with a `due_date` — so `ACTIVE_STATUSES` (`pending`/`in_progress`) matches zero rows; a no-op until real pending tasks with due dates exist) |
| `cron_report_schedules` | 0 schedules exist |
| `cron_pipeline_stuck_deal_digest` | With `p_dedup => true`: 0 (the 12 existing unread rows already carry `metadata.kind`). With `p_dedup => false`: would write 2 rows (4 stuck deals, 2 owners, all 77 days in stage) — see §2. |
| `cron_crm_lead_followup_alerts` | 27 orgs have `sales` enabled (Owner Decision #27a: `distinct` vs the TS's non-deduplicated map — equal count on today's data); 0 overdue leads today |

## 4. Other owner decisions, indexed

- **#4a–#4e** (`04_metric_alerts.sql` header): the `sourceEntity` → column
  whitelist (must stay in sync with `custom-report-service.ts`'s
  `GROUP_BY_FIELDS`), the `countMetric()` → `count(*)` port, escalation-rule
  ordering (`step_order`), cost-cap dedup keying on breach level, and metadata
  key casing (kept camelCase for the existing topbar click-through).
- **#6** (`15_report_schedules.sql`): the report generators
  (escalations/recommendations/risk-trends) are **not** ported — every schedule
  gets the body-less notice the TS already writes for an unknown generator.
  Scheduled **hourly** (`5 * * * *`), not the Vercel `45 8 * * *`, because
  `matchesTimeOfDay()` only ever matched the hour the cron itself ran in — a
  schedule configured for any other hour could never fire under the old daily
  cron. `p_once_per_slot` (default true) prevents a manual re-run or overlap
  from double-delivering inside the same hour.
- **#10a/#10b, #23a/#23b, #27a/#27b/#27c**: see each file's own header — none
  change behaviour on today's data (all no-ops), each documents why.

## 5. Fidelity / safety notes (all functions)

- `auto_register_asset_trg` (SECURITY DEFINER, owner `postgres`) fires
  identically on the `tasks`/`tickets`/`metric_alert_rules` UPDATEs here as it
  does on the Drizzle updates today — nothing in this batch needs anything from
  it.
- Every write is wrapped in the function's own advisory-lock guard; none of
  these functions call another one in this batch except `cron_metric_alerts`
  (the wrapper), whose six inner calls each run in their own `BEGIN ...
  EXCEPTION` sub-block — a failing check rolls back only its own partial writes
  and returns its error under its own key, while the other five still commit.
- `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` reproduces
  `Date.toISOString()` exactly for the message text a few functions build.
- Rows written are identifiable by `metadata->>'kind'` for cleanup, listed in
  each file's own ROLLBACK section; `tasks.priority`/`tickets.team_id`/
  `tickets.assignee_id` changes are not reversible from SQL alone (the TS never
  was either).

## 6. Validation (2026-09-24, PM session, owner-authorized)

All 10 functions across the 5 files were re-verified via a real transactional
test against `pcrjmlpuqsbocqfwoxod`: `BEGIN`, `CREATE OR REPLACE FUNCTION` for
each, one real call per function (the `cron_metric_alerts` wrapper call
exercises all 6 batch-A-style sub-functions from this file in one shot, each
with `p_dry_run => true`; `cron_task_nudge_digest`/`cron_report_schedules`/
`cron_pipeline_stuck_deal_digest`/`cron_crm_lead_followup_alerts` likewise called
with `p_dry_run => true`), then `ROLLBACK` — confirmed via a follow-up `SELECT`
that zero matching functions exist in `pg_proc` afterward. All 10 compiled and
executed without error; nothing persisted, no notification row was written
(every call used `p_dry_run => true` on top of the rollback, belt and braces).
Still not applied to any database — see "Status" above.
