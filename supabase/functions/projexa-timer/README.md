# projexa-timer (PROJEXA-BUILD-001 U-21, PMD-12)

The PROJEXA timer's worker. pg_cron (in Postgres) posts to this Edge Function through pg_net, so no Vercel function runs.
It is the same shape as `supabase/functions/dpdp-monday-email` (bearer from Vault, service-role client inside the function), with its own secrets and its own job.

| Job | pg_cron name | Schedule (UTC) | Body |
| --- | --- | --- | --- |
| Live exchange-rate refresh | `projexa-exchange-rate-refresh` | `30 9 * * *` (the slot of the Vercel cron it replaces) | `{"job":"exchange_rate_refresh"}` (optional `"dryRun":true`) |

## What the job does

Once a day, for every org that has a base currency: fetch the provider's rates for that base from `open.er-api.com` (once per distinct base code), then replace that day's `source = 'live'` rows in `compliance.erp_exchange_rates` with both directions per other currency (`base -> F` at `r`, `F -> base` at `1 / r`, 10 decimals). Manual rates are never touched. Re-running the same day changes nothing. One org's or one base's failure never blocks the rest; the response body counts them (`orgsRefreshed`, `orgsSkipped`, `orgsFailed`, `totalRatesRefreshed`, `failures`).

The same logic runs on Vercel today in `src/lib/services/erp-accounting-service.ts` (`refreshLiveExchangeRatesForAllOrgs`) behind `/api/internal/exchange-rate-refresh/run`. That cron entry stays in `vercel.json` until U-41 removes it; `src/lib/services/projexa-timer.test.ts` proves the two produce the same rows.

## Files

- `rates.ts`: pure rate maths (a port of `buildLiveRatePairs`, no Deno globals).
- `handler.ts`: the request handler with its RPC and fetch passed in, run under bun in the test.
- `index.ts`: `Deno.serve` plus the service-role client. Nothing else.

## Database objects (drizzle/0615_build001_projexa_timer.sql, all `service_role` only)

- `public.projexa_timer_check_bearer(text)`: sha256 compare against the Vault secret `projexa_timer_secret`.
- `public.projexa_timer_exchange_plan()`: one entry per org with a base currency.
- `public.projexa_timer_apply_exchange_rates(text, date, jsonb)`: validates, deletes that day's live rows, inserts the pairs.

## Secrets

Two Vault secrets, created by the PM inside the database (the value never leaves it): `projexa_timer_url` (this function's URL) and `projexa_timer_secret` (a random bearer). The function needs no function secrets: it runs on the platform-injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` plus Vault.

## Deploy

`verify_jwt` must be **false** (the cron sends the Vault bearer, not a Supabase JWT). Deployed through the Supabase MCP by the PM after the claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` is on `main`.

## Check it worked

`select status_code from net._http_response order by created desc limit 1` shows 200 after a run, and `select count(*) from compliance.erp_exchange_rates where source = 'live' and rate_date = current_date` is at least 1 for an org that has another currency. A `succeeded` row in `cron.job_run_details` only proves the request was queued.
