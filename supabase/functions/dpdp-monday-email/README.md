# dpdp-monday-email — the Supabase timer (WO-DPDP-011 Step 4)

Everything that must run while every browser is closed. pg_cron (in Postgres)
posts to this Edge Function through pg_net; the function calls the
`public.dpdp_timer_*` SECURITY DEFINER wrappers (drizzle/0606) with the
service-role client, mints each person's Supabase Auth magic link server-side,
renders the email, and sends it through Resend. Vercel is not in the path.

| Job | pg_cron name | Schedule (UTC) | IST | Body |
| --- | --- | --- | --- | --- |
| Monday digest | `dpdp-monday-digest` | `30 0 * * 1` | Monday 06:00 | `{"job":"monday"}` |
| Legal clocks (72h leak / 90-day rights) | `dpdp-legal-clocks` | `30 3 * * *` | daily 09:00 | `{"job":"legal_clocks"}` |

## What the PM must do, in this order

Nothing below was applied or deployed by the session that wrote this. Every
step is an owner/PM act.

### 1. Vault secrets (run once, in the SQL editor, as `postgres`)

```sql
-- a random bearer the cron will present; 48+ characters
select vault.create_secret('<paste 48+ random chars, e.g. from `openssl rand -hex 32`>', 'dpdp_timer_secret');
-- the function's own URL (project ref in place of <ref>)
select vault.create_secret('https://<ref>.supabase.co/functions/v1/dpdp-monday-email', 'dpdp_timer_url');
-- check
select name, created_at from vault.secrets where name in ('dpdp_timer_secret', 'dpdp_timer_url');
```

The migration's `cron.schedule(...)` reads both from `vault.decrypted_secrets`
at run time; nothing is hard-coded in the repo.

### 2. Function secrets — ALL OPTIONAL

The function runs with only the platform-injected env (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, set by Supabase automatically — never set them
yourself) plus Vault:

* **Bearer check.** If `DPDP_TIMER_SECRET` is set as a function secret it is
  compared constant-time in the function. If it is NOT set, the function
  calls `public.dpdp_timer_check_bearer(p_bearer)` (drizzle/0608, service_role
  only) which compares sha256 digests against the same Vault secret
  `dpdp_timer_secret` the cron reads. So step 1 alone is enough; nothing
  needs `supabase secrets set`.
* `APP_ORIGIN` defaults to `https://app.veridian-aios.com`.
* `DPDP_EMAIL_FROM` defaults to `VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>`.
* `RESEND_API_KEY` absent = **dry run** (unchanged). Set it only once Resend's
  domain is verified, via the dashboard (Edge Functions → Secrets) or
  `supabase secrets set RESEND_API_KEY='re_...'` from a machine with a CLI token.

Other optional overrides: `DPDP_FUNCTION_URL` (defaults to
`$SUPABASE_URL/functions/v1/dpdp-monday-email`), `DPDP_ACTION_PATH` (default
`/act/`), `DPDP_UNSUBSCRIBE_PATH` (default `/unsubscribe/`).

### 3. Deploy the function — with JWT verification OFF

The cron authenticates with the Vault bearer, not a Supabase JWT, and the
one-click unsubscribe POST comes from a mail server with no JWT at all:

```sh
supabase functions deploy dpdp-monday-email --no-verify-jwt
```

(Via the Supabase MCP `deploy_edge_function`: pass `verify_jwt: false` and
both files, `index.ts` + `render.ts`.)

### 4. Apply the migrations

`drizzle/0606_dpdp_wo011_step4_timer.sql` (journal idx 437) and then
`drizzle/0608_dpdp_wo011_step4_bearer_check.sql` (idx 439 — the Vault bearer
check the function falls back to when `DPDP_TIMER_SECRET` is unset). Apply
through the Supabase MCP `apply_migration` (the project's established path),
or `bun run db:migrate`. Both are additive: 0606 = three new `dpdp.*` tables,
new functions, `public.dpdp_my_page` re-issued with the real `sent` count, and
the two cron jobs; 0608 = one function + grant. Applying before steps 1–3 is
harmless — the cron would just post to a null URL and log a failure in
`cron.job_run_details` until the secrets exist.

### 5. Supabase Auth allowlist (owner action)

The magic link redirects to `https://app.veridian-aios.com/app/`. Add that
exact URL to **Authentication → URL Configuration → Redirect URLs**. Without
it `generateLink` succeeds but the redirect is refused at sign-in time.

### 6. Smoke it, dry

```sh
curl -sS -X POST "https://<ref>.supabase.co/functions/v1/dpdp-monday-email" \
  -H "Authorization: Bearer $DPDP_TIMER_SECRET" -H "Content-Type: application/json" \
  -d '{"job":"monday","dryRun":true}'
```

Returns `{"job":"monday","dryRun":true,"digests":N,"sent":0,"dry_run":M,"failed":0,"skipped":K,"details":[...]}`.
Every dry-run email is in `dpdp.email_send` (status `dry_run`, with subject
and full text body, sign-in link and tokens left as `{{...}}` placeholders):

```sql
select to_email, kind, period_key, subject, left(body_text, 400) from dpdp.email_send where status = 'dry_run' order by created_at desc;
```

Add `"orgId":"<dpdp.organisation.id>"` to limit a run to one org, or
`"now":"2026-10-05T00:30:00Z"` to move the calendar. A dry run mints nothing
and creates no auth user.

### 7. Check the cron is armed

```sql
select jobname, schedule, active from cron.job where jobname like 'dpdp-%';
select jobname, status, return_message, start_time from cron.job_run_details
  join cron.job using (jobid) where jobname like 'dpdp-%' order by start_time desc limit 10;
select id, status_code, error_msg from net._http_response order by id desc limit 5;
```

## What the static app (`dpdp-app/`, other agents) needs to provide

* `/act/#<token>` — the one-click confirmation page (WO-011 §2.3). On load
  call `rpc('dpdp_preview_email_action', { p_token })` with the anon key and
  show "You're about to record **<action>** for **<what>**"; on the button
  press call `rpc('dpdp_apply_email_action', { p_token, p_answer: action })`.
  Opening the page changes nothing. Tokens are single-use and last 7 days.
* `/unsubscribe/#<token>` — call `rpc('dpdp_unsubscribe', { p_token })` on
  the button press. The `List-Unsubscribe` header's https URL is this
  function's `?action=unsubscribe&t=<token>` (a POST target, RFC 8058); a
  human GET on it is 302'd to this page.
* `/app/` — the signed-in page, and the "Send me a new link" button the
  email points at when its 24-hour link has expired.

## Behaviour summary

* One email **per membership**, never per identity: a person with two
  memberships gets two emails, each with only that organisation's jobs.
* Owner: sees every open job in the org (own jobs first, then everyone
  else's, late ones first in red) plus "Escalated to you".
* Staff: only jobs assigned to them or to a staff group they belong to, with
  one-click buttons; group jobs they have already answered are omitted.
* Escalation (§2.5), computed in SQL: late → red, top of list; late ≥14 days
  → coordinator's own email carries it; ≥30 days → owner named in the
  staff email and told in their own; "I can't" → coordinator at once (in the
  next Monday email, see PR notes); outside firm silent → owner; jobs
  required by today's law (any `s:`/`a:` law code) use 7/15 instead.
* Unsubscribe drops to **statutory only** (jobs required by today's law);
  the legal clocks are sent regardless.
* Idempotent per `(membership, kind, period_key)`; a re-run skips what is
  already recorded. One failed send is marked `failed` and never stops the
  run.
* `dpdp_my_page.rows[].sent` now counts `email_send` rows with status `sent`
  whose `obligation_ids` contain that job — the hard-coded 0 is gone.
