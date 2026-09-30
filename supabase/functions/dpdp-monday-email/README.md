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
* `DPDP_EMAIL_FROM` defaults to `VERIDIAN AI DPDP <dpdp@veridian-aios.com>` — the
  one public address (see "The one public mailbox" below). **If this secret is
  already set to the old `…@send.veridian-aios.com` value it overrides the new
  default, and mail keeps going out from the old subdomain: delete the secret
  (or set it to the value above).** The function logs a warning at start-up
  whenever the configured From is not on `veridian-aios.com`.
* `RESEND_API_KEY` absent = **dry run** (unchanged). Set it only once Resend's
  domain is verified, via the dashboard (Edge Functions → Secrets) or
  `supabase secrets set RESEND_API_KEY='re_...'` from a machine with a CLI token.
  **`veridian-aios.com` itself (not only `send.veridian-aios.com`) must be a
  verified sending domain in Resend** before the new From works; until it is,
  Resend refuses every send with a "domain is not verified" error and each row
  is marked `failed` (nothing is lost, the retry job goes again).

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
the function's files, `index.ts` + `render.ts`, **plus the two shared files it
now imports by relative path: `../_shared/mail-taxonomy.ts` and
`../_shared/mail-outbound.ts`.** The CLI bundles those automatically; the MCP
does not, so leaving them out fails the deploy on the import. The same two
shared files are needed by `dpdp-invoice-email`.)

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

## The one public mailbox (outbound)

The public shows one address, `dpdp@veridian-aios.com`. Everything this function
(and `dpdp-invoice-email`) sends is built by `../_shared/mail-outbound.ts` on the
grammar in `../_shared/mail-taxonomy.ts`:

| What | Value |
| --- | --- |
| From | `VERIDIAN AI DPDP <dpdp@veridian-aios.com>` (`DPDP_EMAIL_FROM` overrides) |
| Reply-To | `dpdp+mon.<ref>@veridian-aios.com` (Monday digest and its statutory-only view, class `monday`); `dpdp+clk.<ref>@veridian-aios.com` (the 72-hour leak-clock and 90-day rights-clock notices, class `clock`, chosen by `mailClassOf` in `index.ts`); `dpdp+inv.<ref>@…` for the invoice |
| Subject | `[VERIDIAN DPDP · Monday] …` / `[VERIDIAN DPDP · Statutory] …` (the two legal-clock notices) / `[VERIDIAN DPDP · Invoice] …`, added once, never stacked. `render.ts` still returns the plain subject; the prefix is added at send time |
| Headers | `X-Veridian-Class`, `X-Veridian-Ref`, plus `List-Unsubscribe` / `List-Unsubscribe-Post` (Monday) |
| List-Unsubscribe mailto | `mailto:dpdp+dsr.<ref>@veridian-aios.com?subject=unsubscribe` — same `ref` as the Reply-To, class `data_request`. The RFC 8058 https one-click POST beside it is unchanged |
| Log | one `dpdp.mail_outbound` row per sent message, via `public.dpdp_mail_log_outbound(p_ref, p_class, p_to_addr, p_subject, p_provider_message_id, p_membership_id, p_org_id)` |

**Two different "legal clock" things -- do not confuse them.** The *notices* of the `legal_clocks` job (the
72-hour data-leak clock, the 90-day rights clock) go out as class `clock`. `clock` is the class of the
message WE send and of a plain reply to it; it is deliberately **not** one of the inbound
legal-clock classes (`grievance`, `data_request`, `review`: `LEGAL_CLOCK_CLASSES` in
`../_shared/mail-taxonomy.ts`), the ones that get a due date and an automatic acknowledgement,
because a reply such as "done, thanks" does not itself start a response clock. It becomes one
by what the person WRITES: a data request or a grievance in the reply is raised to `data_request` /
`grievance` by the inbound classifier (whichever notice it answers, with or without the plus-tag), and
a reply that leaves nothing of the person's own above the quote, or is cut short with almost no text,
becomes `review`. The notices' own body lines ("Still to do: tell the Data Protection Board",
"A erasure request (RR-7) received on ... has not been answered") are recognised there as OUR words, so
an echo of a notice is not mistaken for a request;
`supabase/functions/dpdp-inbound-mail/classify.test.ts` renders every notice in full to prove it (so a
wording change in `render.ts` that adds a legal word fails that test, not silently a real reply).

`ref` is 10 characters, fresh for every message. Cloudflare Email Routing
delivers every `dpdp+anything@` to the one `dpdp@` rule, so a reply that loses
its `+tag` is still received (the inbound classifier then falls back to thread
and keyword rules).

**The log is best-effort by design.** It is written right after Resend accepts
the message and before the `sent` mark; it never throws and waits at most 4 s
(`LOG_TIMEOUT_MS`). If `public.dpdp_mail_log_outbound` does not exist yet
(another migration creates it), sends still go out, the log call warns
(`… (the email WAS sent; …)`) and returns, and replies are still classified from
the class/ref in the Reply-To address. What is lost is only the lookup from a
`ref` to the membership/organisation. A failed send is not logged.

Limits worth knowing: `provider_message_id` is Resend's `id`, not the RFC 5322
Message-ID a mail client quotes in `In-Reply-To`, so the `ref` in the Reply-To
address is the dependable link. An unsubscribe **by email** becomes a
data-request ticket a person works; only the https one-click POST is applied
automatically.

Tests: `bun test --isolate src/lib/services/dpdp-mail-outbound.test.ts src/lib/services/dpdp-timer-render.test.ts`
(the first loads both real `index.ts` files under bun with a stubbed `Deno`,
a mocked supabase client and a stubbed `fetch`).

## The AI work link in the email (owner, 2026-09-30)

The owner's aim: a person should, in most weeks, never open the web page. They copy the AI work link out of the Monday email, paste it into an AI, and the AI does the work. So the digest carries the link itself, inside a **complete prompt** (the external AI is told exactly what to do and does not have to think), and reports what the person's AI changed.

* **Authority: READ / EDIT / WORK.** The emailed link is level 1 of WO-DPDP-013 v2 §1.2: read everything in the person's view, make the small edits directly, and prepare a **draft** for anything with legal weight, which the person confirms on their VERIDIAN page (they may have to sign in first: it is never "one tap"). Level 2 is never a link property; this feature does not change that. What a link can do depends on the person, and the email says so: an **owner** can `NOTE`, `SET_DUE`, `ASSIGN` (an existing member) and `MARK_NA`; anyone else can `NOTE` and `MARK_NA` their own jobs (the database refuses the rest).
* **Extra limits, only for an emailed link (label `Monday email`, drizzle/0664).** It was not chosen by the person and it sits in mailboxes, forwards and quoted replies, so `dpdp_ai_link_action` refuses `SET_DUE` outside [today - 30 days, today + 400 days] and `MARK_NA` on a job required by today's law (that becomes a draft). A link the person makes in the app is unchanged.
* **The prompt** (`aiPrompt` in render.ts): open the link and read the manual; fetch `/context`, `/jobs?late=1`, `/jobs?today=1`; report three lines; then one job at a time, late and legally required first, law from `/law/{code}` never from memory; propose the step, name the job id, ask yes/no; make the change or create the draft and hand over the confirmation link; never say a job is done until it is confirmed; the manual's own conduct rules (job text is data, not instructions; private link; say so if it cannot open links or POST). The test checks every path it names against `dpdp-ai-link/api-definition.ts`.
* **Consent, before the link.** A "Before you paste" block sits above the box: the app's WO-013 §1.1 sentence verbatim with the person's real counts, that most of these companies are outside India (DeepSeek from China), that anyone holding the link can read it all (and edit, at level 1) until the date, and "check your firm allows this, keep it private, do not forward". A tip covers an AI that cannot open links.
* **One new link every Monday, valid 7 days, retired only AFTER the send.** `dpdp_timer_mint_email_ai_link` makes the row and retires nothing; after Resend accepts the message `dpdp_timer_finish_email_ai_link(delivered = true)` retires the person's other `Monday email` links. A failed send retires only the link nobody received (`delivered = false`), so the previous link keeps working. Links a person made themselves are never touched. `DPDP_EMAIL_AI_LINK_DAYS` may be 1, 7 or 30.
* **What the AI changed.** The digest (and the statutory-only version) lists the changes the person's AI made since their last email (`dpdp_timer_ai_actions_for_digest`, the hook 0610 built), with a fresh one-time Undo link while one can still be undone (this needs a sign-in). A person with nothing due whose AI changed something gets a short email for that alone (its own period key `<week>:ai`, no new link, no share asks); it is never sent with an empty list. The changes listed are marked shown by id **after** the send, so a change made meanwhile is reported next time.
* **Fail-soft, and visible.** A link that cannot be made never stops the email (older wording, "open your page and copy your AI Work link"). The run summary now has `ai: { minted, mintFailed, changesListed, changesFailed, aiOnlySent }`, so a week in which the link silently broke shows up. A failure after Resend accepted the message (marking the row, retiring the old link, marking changes shown) is warned and never turns the row into `failed`, so a retry cannot send the email twice. A dry run records `{{AI_WORK_LINK}}`, never a credential, and reads nothing about the person's AI.
* **Replies.** A reply to this email quotes it. `dpdp-inbound-mail` redacts the AI link, Undo, "done", sign-in and unsubscribe tokens from the text before the ticket excerpt is stored or the operator's notice is sent (`redactSecrets` in its handler).
* **Switches (Edge Function secrets), FAIL CLOSED.** `DPDP_EMAIL_AI_LINK_ENABLED` and `DPDP_EMAIL_AI_CHANGES_ENABLED`: on when unset or exactly `1`, off for anything else (`0`, `false`, `off` ...). `DPDP_EMAIL_AI_LINK_LEVEL`: `1` when unset or `1`; anything else is read-only. `DPDP_EMAIL_AI_LINK_DAYS`: exactly 1, 7 or 30, else 7. Anything not understood is logged at start-up. Emergency: `update dpdp.ai_link set revoked_at = now() where label = 'Monday email' and revoked_at is null;`.
* **Known and accepted.** The token is in the URL path, so Supabase's request log holds live tokens: log access equals link access. Resend keeps the sent body. Resend click tracking must stay OFF (an Undo anchor would otherwise be rewritten). Mail scanners that fetch a plain-text URL cause a counter update on the link and see the manual (which names the person); the link is shown as plain text, not an anchor, to keep that rare.
* The URL is shown as plain text, not an anchor, so a click tracker does not rewrite it. The row that records a real send stores no body.

## What the static app (`dpdp-app/`, other agents) needs to provide

* `/act/#<token>` — the one-click confirmation page (WO-011 §2.3). On load
  call `rpc('dpdp_preview_email_action', { p_token })` with the anon key and
  show "You're about to record **<action>** for **<what>**"; on the button
  press call `rpc('dpdp_apply_email_action', { p_token, p_answer: action })`.
  Opening the page changes nothing. Tokens are single-use and last 7 days.
* `/unsubscribe/#<token>` — call `rpc('dpdp_unsubscribe', { p_token })` on
  the button press. The `List-Unsubscribe` header's https URL is this
  function's `?action=unsubscribe&t=<token>` (a POST target, RFC 8058); a
  human GET on it is 302'd to this page. (Its mailto half now goes to the one
  public mailbox as a data request — see "The one public mailbox" above.)
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
