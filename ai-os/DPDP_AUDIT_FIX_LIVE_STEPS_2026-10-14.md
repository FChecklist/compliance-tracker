# DPDP audit fixes: live steps (2026-10-14)

Source: `DPDP_DATA_AUDIT_2026-10-14.md`, section 7 (fix numbers below are that list's). Branch `feat/dpdp-audit-fixes-2026-10-14`. Everything here is written and tested in the repository only: nothing was applied to the live database, nothing was deployed, no live data was changed. Project: Supabase `pcrjmlpuqsbocqfwoxod`; site: Cloudflare Pages `veridian-dpdp-app`.

Rules kept in every change: billing data (invoices, payments, payment attempts, the payment ledger, subscriptions, commissions, payment proofs) is never deleted by any job; a page says only "We keep billing data for audit and tax reasons."; the seller is only IT Services by Rajat Agarwal.

Order matters: database first (steps 1 to 4), then the Edge Functions (step 5), then the site (step 6). Each step has a check and a roll-back.

## 0. Before anything
- `select max(version) from supabase_migrations.schema_migrations;` and confirm 0760 to 0763 are not applied.
- Retention is already live (`select live from dpdp.retention_setting;` is true). Read what the new rules would delete before applying 0761 (step 2).

## 1. Audit trail: failures become visible (fix 4), migration 0760
Finding: `dpdp.audit_event` has 0 rows because nothing it records has happened since it went live on 2026-10-06 08:20 UTC. All 324 AI-link calls since then carried a token that matches no link (`link_id` is null, answered 410: a recurring probe), nobody signed in, nothing changed. A call with no matching link is not written by design. The write path is covered by tests, but it has never run against a live link.
1. Apply `drizzle/0760_dpdp_audit_note_failure.sql` (roll-back `drizzle/down/0760_...down.sql`).
2. Deploy `dpdp-ai-link` and `dpdp-audit` (new key-ring helper and failure notes): `supabase functions deploy dpdp-ai-link --project-ref pcrjmlpuqsbocqfwoxod` and the same for `dpdp-audit`.
3. Check: `select has_function_privilege('service_role','public.dpdp_audit_note_failure(text,text)','execute');` is true, and for `anon` is false.
4. Proof that it writes: create one AI link for a test organisation, open `/manual.md` once with it, then `select event_type, actor_type, outcome from dpdp.audit_event order by seq desc limit 3;` shows an `ai_read` row, and `select count(*) from dpdp.audit_failure;` stays 0. If the row does not appear, `select source, error from dpdp.audit_failure order by id desc limit 5;` now says why (`no_key` means `DPDP_AUDIT_SEAL_KEY` is missing or not 32 bytes in base64; the secret is set today).

## 2. Retention covers the rest (fix 3), migration 0761
What is new: the sent-mail log `dpdp.email_send` (13 months), the AI-link call log `dpdp.ai_link_call` (365 days; calls that matched no link 90 days; append-only table, the sweep alone may delete from it), ended AI links `dpdp.ai_link` (90 days after they end) and `dpdp.ai_link_read` (90 days). Billing tables are added to `dpdp.retention_kept_tables()`, so even an organisation offboarding leaves them. Payment-proof files: the job exists but ships with no period (`payment_proof_days` is null = keep), so it deletes nothing.
1. See what would go, before applying: `select count(*) filter (where created_at < now() - interval '395 days') from dpdp.email_send;` (0 today: the oldest row is from 22 September), `select count(*) from dpdp.ai_link_call where (link_id is not null and called_at < now() - interval '365 days') or (link_id is null and called_at < now() - interval '90 days');` and `select count(*) from dpdp.ai_link where least(coalesce(revoked_at, expires_at), expires_at) < now() - interval '90 days';` (on 2026-10-14 there were 164 expired and 42 withdrawn links out of 175, most of them ended long ago; these are the rows the first live run removes, together with their old read rows).
2. Apply `drizzle/0761_dpdp_retention_more_tables.sql` (roll-back `down/0761_...down.sql`). It replaces `public.dpdp_timer_retention_sweep` with a superset (same behaviour for the old rules), so the next 02:10 UTC run is the first with the new rules, live.
3. Dry run now: `select public.dpdp_timer_retention_sweep(true);` then `select report from dpdp.retention_run order by id desc limit 1;` shows `email_send`, `ai_link_call`, `ai_link_read`, `ai_link` counts and `live: false`.
4. Deploy the file job: `supabase functions deploy dpdp-retention-files --no-verify-jwt --project-ref pcrjmlpuqsbocqfwoxod`. The migration schedules `dpdp-retention-files` at 02:40 UTC (needs pg_cron, pg_net and the Vault secrets `dpdp_timer_url`, `dpdp_timer_secret` already used by `dpdp-audit-daily`). Check: `select jobname, schedule from cron.job where jobname = 'dpdp-retention-files';`
5. Billing check after the first live run: `select count(*) from dpdp.payment;` and the ledger tables are unchanged.

## 3. E-mail bodies are not stored (fix 5), migration 0762
Finding: bodies were kept only on dry-run rows (1,220 rows from 22 to 29 September, about 3.4 KB each); sent mail never stored one. Now `record_email_send` stores no body for any status, the old bodies are cleared, and a CHECK keeps it that way.
1. Apply `drizzle/0762_dpdp_email_send_metadata_only.sql` (roll-back restores the function and drops the check; cleared bodies cannot come back).
2. Deploy `dpdp-monday-email`, `dpdp-invoice-email`, `dpdp-pay` (they no longer send a body). Safe in either order: the database ignores a body that is sent.
3. Check: `select count(*) from dpdp.email_send where body_text is not null;` is 0.

## 4. Consent tokens and join codes are no longer plain text (fix 14), migration 0763
- `dpdp.consent_token.token` (18 rows) becomes a SHA-256 in `token_hash`; the plain column is emptied; a trigger hashes any plain token an older writer inserts. Links already sent keep working (their hash matches). The four lookup functions (`dpdp_parent_consent_preview`, `dpdp_parent_consent`, `dpdp_parent_consent_v2`, `dpdp_consent_withdraw`) match by hash.
- `dpdp.org_invite.code` (572 rows) is encrypted with the Vault key `dpdp_payout_key` (the same key as partner payouts) and matched through `code_hash`, a keyed HMAC. The owner's invite link and the Monday e-mail still show the code (they decrypt it). Needs that Vault secret (it exists); the migration refuses to run without it.
1. Before: open one live consent link of a test campaign in a browser (note it works). After the migration, open the same link again: it still works.
2. Apply `drizzle/0763_dpdp_hash_consent_token_and_invite_code.sql` (roll-back decrypts the join codes; consent links stay hashed).
3. Check: `select count(*) from dpdp.consent_token where token is not null;` is 0; `select count(*) from dpdp.org_invite where left(code,5) <> 'enc1:';` is 0; sign in as an organisation owner and open Settings: the invite link shows the same code as before; join with that code from a second account works.
4. The Next.js application code (`src/lib/services/dpdp-principal-service.ts`, schema) already writes and looks up by hash; it is not deployed (Vercel is paused), so nothing else is needed now.

## 5. Edge Functions (summary of deploys)
`dpdp-ai-link`, `dpdp-audit` (fix 4); `dpdp-retention-files` new (fix 3); `dpdp-monday-email`, `dpdp-invoice-email`, `dpdp-pay` (fix 5); `dpdp-inbound-mail` (a message that asks to name a nominee is filed as a data request, fix 13). `dpdp-ai-link` also refuses a write sent through the GET-only fallback when the request is marked as fetched ahead of time (fix 27).

## 6. Website and app: Cloudflare Pages deploy of `dpdp-app` (fixes 13, 15, 16, 17, 26, 28 and the uniform footer)
1. From `dpdp-app`: `bun run build` with `NODE_OPTIONS=--max-old-space-size=6144`, then deploy `dist` to Pages project `veridian-dpdp-app` (recipe in `dpdp-app/DEPLOY.md`).
2. Headers (fix 15): check with `curl -sI https://dpdp.veridian-aios.com/ | findstr /i "strict content-security referrer"`. Expect `Strict-Transport-Security: max-age=31536000`, one `Content-Security-Policy` (with `static.cloudflareinsights.com` on public pages only), one `Referrer-Policy` on `/app/`, `/p/`, `/act/`, `/copy/`, `/unsubscribe/`. If `/app/` still shows two Referrer-Policy values after this deploy, the second is added outside the repository (a Cloudflare Transform Rule or the zone setting): remove it there.
3. Look for blocked requests: open `/`, `/pricing/`, `/privacy/`, sign in at `/app/`, open an AI link page, a consent link `/p/...`, `/copy/...`, and press the Rs 1 test payment in the app. In the browser console there must be no "Refused to ..." line other than the Cloudflare analytics script on private pages (that one is intended). If something legitimate is refused, add its origin to the matching directive in `dpdp-app/public/_headers` and redeploy; to back out the whole policy, replace the long `Content-Security-Policy` values by `frame-ancestors 'none'`.
4. Cloudflare Web Analytics (fix 16): the header already makes browsers refuse the script on `/p/`, `/act/`, `/copy/`, `/app/`, `/unsubscribe/`. As well, in the Cloudflare dashboard open Workers and Pages, project `veridian-dpdp-app`, Settings, Web Analytics, and set it to Disabled if you do not want it on the public pages either (the Privacy Notice then needs the sentence in section 8 removed).
5. Footer: every public page now carries the uniform footer (`dpdp-app/data/uniform-footer.html`); its "Test a payment (Rs 1)" link points to the seller's page `https://itservices-rajat-agarwal.pages.dev/paytest/` which another agent is building: check that it opens once that page is live.
6. Supabase Auth, one setting (fix 15, advisor warning `auth_otp_long_expiry`): Authentication, Providers, Email, set the OTP expiry to 3600 seconds or less. Dashboard only.

## 7. What was changed in wording (fixes 13, 17, 26, 28)
- Home page, Disclaimer, Privacy Notice section 2, sign-in screen: the claims "never stores your documents" and "cannot be edited" are replaced by what is true (a fingerprint of each document is kept, not the document, with payment proofs the one exception; a change is added, earlier entries are not written over). The audit-log row now says "encrypted" and "linked to the one before it, so a change to the log can be detected".
- Privacy Notice v1.9 (14 October 2026): billing data line, the AI-link call log and ended-link periods, payment method details received from Razorpay, the central payment service and GitHub as recipients, nominating another person (section 14) with the route "write to dpdp@veridian-aios.com, subject Data request, say it is a nomination", Cloudflare analytics only on public pages, the referral code and service worker.
- `/subprocessors/` v1.1: the central payment service and GitHub added; changes announced by e-mail at least 14 days before a new service handles customer data.
- `/contact/`: the nominee route. The Grievance Officer is named by personal name (Rajat Agarwal) on `/privacy/` and `/contact/` (it already was).
- The Terms of Service were not changed (their text carries the acceptance version of the sign-in tick box, migration 0748); clause 6.6 still points at the Privacy Notice for the sub-processor list, which now links to `/subprocessors/`.

## 8. Not done, and why
- Fix 27 (AI link): kept the GET-only write fallback, because chat assistants that can only open a web address need it; added the refusal for prefetch and preview requests. The token stays in the address path for the same reason. Free text returned to the user's own AI and a prompt-injection test fixture are not done.
- Fix 10 (erase or correct one person), fix 19 (group incident plan), fixes 6, 7 and 29 (central ledger and GitHub copy, vendor agreements): outside this work.
- Payment-proof files: no deletion period is set (billing records are kept). To start deleting them later: `update dpdp.retention_setting set payment_proof_days = <days> where id = 1;`.
- The Privacy Notice text about the billing data retention is the single sentence given.

## 9. Roll-back summary
`drizzle/down/0763_...`, `0762_...`, `0761_...`, `0760_...` (in that order); redeploy the previous function versions (Supabase dashboard, Edge Functions, version history); redeploy the previous Pages deployment.
