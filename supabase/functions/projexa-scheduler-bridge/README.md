# projexa-scheduler-bridge (PROJEXA-BUILD-001 U-40, PMD-05, PMD-39)

The middle hop of the scheduler bridge. pg_cron (in Postgres) posts to this Edge Function through pg_net every five minutes; the function checks whether any schedule is due and, if so, calls the deployed app, which runs each due schedule **as the schedule's owner** and stores a **proposal** for every write (nothing is written until a person approves it). No API key is involved anywhere in the chain.

```
pg_cron job projexa-scheduler-bridge (*/5 * * * *, created INACTIVE)
  -> net.http_post (url and bearer from Vault)
  -> Edge Function projexa-scheduler-bridge   (this directory)
       1. bearer checked through public.projexa_scheduler_bridge_check_bearer (service_role only)
       2. public.projexa_scheduler_bridge_due_count(): none due -> answer, no app call
       3. POST <SCHEDULER_BRIDGE_APP_URL>/api/internal/scheduler-bridge/run with Bearer <SCHEDULER_BRIDGE_INTERNAL_SECRET>
  -> src/app/api/internal/scheduler-bridge/run/route.ts -> src/lib/pipeline/scheduler-bridge.ts
```

The cron command names only this function, never the app route (register row BR-516). Vercel runs only step 3, so it is the last thing switched on at go-live (PMD-39).

| Job | pg_cron name | Schedule (UTC) | Body |
| --- | --- | --- | --- |
| Run the due schedules | `projexa-scheduler-bridge` | `*/5 * * * *` | `{"job":"scheduler_bridge"}` |

## Secret names (values are set by the owner or the PM, never written in a file)

| Where | Name | Used for |
| --- | --- | --- |
| Vault (the cron job reads both) | `projexa_scheduler_bridge_url` | this function's URL |
| Vault | `projexa_scheduler_bridge_secret` | the bearer the cron sends; `projexa_scheduler_bridge_check_bearer` compares it |
| Edge Function secret | `SCHEDULER_BRIDGE_APP_URL` | the deployed app's origin, an `https://` URL with no credentials |
| Edge Function secret | `SCHEDULER_BRIDGE_INTERNAL_SECRET` | the bearer this function sends to the app route; 24 characters or more |
| App environment (Vercel, at go-live) | `SCHEDULER_BRIDGE_INTERNAL_SECRET` | the same value; the route refuses every call without it |

The function also uses the platform-injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. With any of the Edge Function secrets unset it answers `503 not_configured` and calls nothing.

## What the app does with a due schedule

`compliance.pipeline_schedules` (drizzle/0642) holds a registry function id, its params, a cron cadence and the owner (a `compliance.users` id). For each due, active schedule, in a bounded batch:

1. Claims it with one UPDATE that also moves `next_run_at` to the next slot, so two overlapping runs run it once and a failing run does not repeat every tick.
2. Reads the owner's row now. An owner who is missing, deactivated or in another organisation means the schedule is skipped and deactivated (PMD-33).
3. A write function is never run: one proposal row is stored (`compliance.submissions`, `selected_chain` with `source: "scheduler_bridge"`) for the approval list. A schedule keeps at most one waiting proposal: while its earlier proposal is still `in_progress`, a due tick stores nothing and the run is recorded as `already_pending` (the schedule stays active and moves to its next slot). A read function runs through the executor registry with the owner as `userId` and `actorUserId` and the owner's role.
4. Writes one `compliance.audit_logs` row per claimed run, a run that fails included: `user_id` the owner, `api_key_id` null, `surface` `s1_one_page_ai_prepared`, `details` JSON with `trigger: "scheduler_bridge"`. The one row with no `user_id` is a run whose owner row is gone or could not be read: it names the bridge itself (`actor_role` `system`).

A schedule may also name a **job** that is not a registry function (`src/lib/pipeline/scheduled-jobs.ts`; BUILD-002 WP-13, `scan_connected_folder`, the way-5 pull of a connected mailbox or Drive folder). The bridge runs it itself as the owner, it is reachable from nothing else, it records proposals and creates no business record, and only its counts are kept in `last_result` and the audit row. Owner steps: `ai-os/projexa-build-002/OWNER_WAY5_STEPS.md`.

No model is asked at any point: the schedule already names its function.

## Files

- `handler.ts`: the request handler with its RPC and fetch passed in, run under bun in `src/lib/services/projexa-scheduler-bridge.test.ts`.
- `index.ts`: `Deno.serve` plus the service-role client and the two secrets by name. Nothing else.

## Database objects (drizzle/0642_build001_pipeline_schedules.sql)

- `compliance.pipeline_schedules` (RLS by organisation, in the pattern of `report_schedules`).
- `public.projexa_scheduler_bridge_check_bearer(text)` and `public.projexa_scheduler_bridge_due_count()`, both `service_role` only.
- The cron job `projexa-scheduler-bridge`, created **inactive**. The PM switches it on at go-live with `select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'projexa-scheduler-bridge'), active := true)`.

## Deploy

`verify_jwt` must be **false** (the cron sends the Vault bearer, not a Supabase JWT). Deployed through the Supabase MCP by the PM after the claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` is on `main`. Nothing here deploys to Vercel.

## Check it worked (after go-live)

`select status_code from net._http_response order by created desc limit 1` shows 200, and `select count(*) from compliance.audit_logs where action like 'pipeline_schedule.%' and user_id is not null and api_key_id is null` grows with each due run. A `succeeded` row in `cron.job_run_details` only proves the request was queued.
