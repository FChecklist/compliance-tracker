# PROJEXA automatic error and action log (client log)

**In plain words.** When someone uses PROJEXA, their own phone or laptop quietly notices every error and every step they take,
packs the last few steps around each error into a small report, and posts batches of reports to us. Our server only checks,
cleans and stores them, so it does almost no work. The owner can see every error grouped into one "issue" (how often, which
projects and screens), and see a project's whole history from start to end. Later the owner asks Claude Code (run by the owner,
not part of the app) to fix the open issues; the fix is written back on the issue with the files changed and the commit. If a
"fixed" issue happens again after the fix, it is reopened by itself, so a regression cannot hide.

Code: `src/lib/services/client-log-service.ts` and `src/app/api/v1/projexa/client-logs/**`. Migration: `drizzle/0754_client_log_events.sql`
(rollback `drizzle/down/0754_client_log_events.down.sql`). Raw SQL, no `schema.ts` entry (append/upsert-only tables).

## Tables (schema `compliance`, RLS on `org_id`, like every tenant table)

`client_log_events` (append-only): `id` (client uuid, idempotency key), `org_id`, `user_id`, `project_id`, `session_id`,
`kind` (error | unhandled_rejection | render_error | api_failure | action), `severity` (error | warning | info), `fingerprint`
(computed on the device), `message` (2000), `stack` (8000), `route`, `api_path`, `http_method`, `http_status`, `request_id`,
`duration_ms`, `action_name`, `outcome` (ok | failed), `breadcrumbs` (jsonb, last 40 steps), `context` (jsonb, max 4 KB),
`occurred_at`, `received_at`.

`client_error_issues` (one row per org + fingerprint): `id`, `org_id`, `fingerprint`, `title`, `first_seen_at`, `last_seen_at`,
`occurrences`, `status` (open | fixed | reopened | ignored), `severity`, `sample_event_id`, `project_ids[]`, `routes[]`,
`fix_summary`, `fix_files` (jsonb `[{path, change}]`), `fix_commit`, `fixed_at`, `fixed_by`, `reopened_count`.

## Routes (`/api/v1/projexa/client-logs`)

| Route | Who | What |
|---|---|---|
| `POST /` body `{events:[...]}` (max 50) | any signed-in member, or API key with `write` | Validates, truncates, strips secrets again, stores. Answers `{accepted, rejected:[{index, reason}]}`; never 500 for a bad event. More than 120 events/min/person: `429` with `accepted` and `Retry-After: 60`. Duplicate event ids are ignored (safe to resend). A non-action event also upserts its issue. |
| `GET /issues?status=open\|fixed\|reopened\|ignored\|all&projectId=&limit=` | admin (API key: `read`) | Issues (newest first, default `open`, limit 50, max 200), each with `sample_event` (the full report), `people` (count of distinct non-null `user_id` among the issue's events) and `last_event_at` (newest event time; `people` 0 and `last_event_at` null if none). Both come from ONE grouped query for the whole page, not one per issue. |
| `GET /issues/[id]` | admin (API key: `read`) | `{issue, events}`: the issue plus its latest 20 events with breadcrumbs. |
| `PATCH /issues/[id]` | admin (API key: `write`) | Body `{status?, fix_summary?, fix_files?:[{path, change}], fix_commit?, fixed_by?}`. `status:"fixed"` needs `fix_summary` and at least one `fix_files` entry in the same call (400 with `field`), and sets `fixed_at`. |
| `GET /timeline?projectId=&limit=&order=asc\|desc&after=` | admin (API key: `read`) | One project's actions and errors in time order (default asc, limit 200, max 1000; `after` is a time cursor for paging). Leaves out stack/breadcrumbs/context; those are on the issue. |

## Rules worth knowing

- **Regression rule.** On ingest, if an issue is `fixed` and a new event's `occurred_at` is later than `fixed_at`, the issue becomes
  `reopened` and `reopened_count` goes up by one. An event that happened before the fix but arrived late from an offline device does
  not reopen it. `ignored` stays `ignored`.
- **Secrets.** The device strips first; the server strips again: Authorization/Cookie header text, bearer tokens, JWTs, `vk_`/`sk_` keys,
  `password|secret|token|api_key|...=value` pairs in any text, and any object key with such a name (messages, stacks, breadcrumbs, context).
- **Load.** Two SQL statements per batch (one insert of all events, one upsert of the issues). The per-minute limit is held in memory
  per server instance, so it costs no database work.
- **Who sent it.** `user_id` comes from the session, or from `X-Acting-User` for PROJEXA's API key; it is never read from the body.
- **Offline-safe.** Event ids are the idempotency key and issue counts only grow for newly stored events, so a retried batch is harmless.
- **Field spelling.** Events may use camelCase (what the browser sends: `occurredAt`, `projectId`, `sessionId`, `apiPath`, `httpMethod`, `httpStatus`, `requestId`, `durationMs`, `actionName`) or snake_case (`occurred_at` ...). camelCase wins if both are present; unknown keys are ignored. Reads always return snake_case.
