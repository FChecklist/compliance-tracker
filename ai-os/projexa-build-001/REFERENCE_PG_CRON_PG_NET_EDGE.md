# REFERENCE: scheduled work with pg_cron -> pg_net -> Edge Function (zero Vercel)

Register row: BR-123 (test E-03). Written 2026-09-25 from the live `cron.job` table and `cron.job_run_details` on the verdian-ai project (`pcrjmlpuqsbocqfwoxod`), read-only.

Reference implementation: dpdp-legal-clocks
dpdp-monday-digest runs as of 2026-09-25: 0

## Why this note exists

Two scheduled jobs already run entirely inside the database and call a Supabase Edge Function. No Vercel function is involved, so the jobs cost nothing on Vercel. The DPDP track built them in the week of 22 September. PROJEXA copies the pattern instead of adding a Vercel cron (Addendum A section A1).

## Which job proves the pattern

| Job | Schedule (UTC) | Runs recorded | Succeeded | Last run |
|---|---|---|---|---|
| dpdp-legal-clocks | 30 3 * * * (daily) | 3 | 3 | 2026-09-25 03:30 |
| dpdp-monday-digest | 30 0 * * 1 (Mondays) | 0 | 0 | none yet; the first run is due 2026-09-28 00:30 |

`dpdp-legal-clocks` is the proven end-to-end path. `dpdp-monday-digest` uses the same command with a different body, but it has never fired, so it proves nothing yet. A run row with status `succeeded` in `cron.job_run_details` proves only that the HTTP request was queued. The result of the call itself is in `net._http_response` (status code and body): check it before calling a job healthy.

## The exact pattern (from cron.job.command, secret NAMES only, never values)

```sql
select net.http_post(
  url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'),
  headers := jsonb_build_object(
               'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
               'Content-Type',  'application/json'),
  body    := '{"job":"legal_clocks"}'::jsonb,
  timeout_milliseconds := 300000
)
```

Scheduled with `cron.schedule('<name>', '<cron expression>', $$ ... $$)`. Both jobs use the same URL secret and the same bearer secret; the body field `job` selects what the Edge Function does.

## What PROJEXA copies

1. Two new Vault secrets with their own names: `projexa_timer_url` and `projexa_timer_secret`. They are created by the owner or by a claimed migration, never typed into a repository file.
2. One new Edge Function, `projexa-timer`, on the verdian-ai project. It refuses any request without the bearer secret (fail closed) and dispatches on `body.job`.
3. Each job is one `cron.schedule` row whose name starts `projexa-` (for example `projexa-exchange-rate-refresh`). Every job is safe to run twice.
4. Register rows check three things: a row in `cron.job` with the name, a `net._http_response` row with status 200 after the first run, and zero Vercel function invocations attributable to the job.

## Rules from the shared boundary

- Creating a `cron.job` entry, deploying an Edge Function or adding a Vault secret is recorded in `ai-os/boss/ACTIVE-CLAIMS.yaml` BEFORE it is done (`ai-os/SHARED_BOUNDARY.md`).
- PROJEXA never edits the `dpdp-` jobs, the `dpdp_timer_*` secrets, or the DPDP Edge Functions.
- Jobs that were prepared earlier on `prep/*` branches (`supabase/prepared/cost001/`) re-enable writes that have been silent since about 2026-08-23. They are switched on one job per pull request, each with a note saying so (PMD-12).
