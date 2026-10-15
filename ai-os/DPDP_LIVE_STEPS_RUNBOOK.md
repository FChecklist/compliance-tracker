# DPDP fix programme: live steps runbook

For the owner's local session, after the PRs merge. Project: Supabase `pcrjmlpuqsbocqfwoxod` (verdian-ai). Do the steps in this order. Each step has the exact action, a check, and a rollback. Nothing here deploys to Vercel and nothing spends money.

Tools: Supabase MCP (`apply_migration`, `execute_sql`, `deploy_edge_function`, `get_advisors`), `supabase` CLI, `wrangler` for Cloudflare Pages.

## 0. Before anything
- Take a note of the time. Everything below is reversible with the `drizzle/down/` file named in each step.
- Check the migration ledger: `select max(version) from supabase_migrations.schema_migrations;` and confirm 0720-0726 are not applied yet.

## 1. AI link hides other people's e-mails (migration 0720)
1. Apply `drizzle/0720_dpdp_ai_link_hide_emails_default.sql`.
2. Deploy the edge function: `supabase functions deploy dpdp-ai-link --project-ref pcrjmlpuqsbocqfwoxod`.
3. Check:
   ```sql
   select count(*) filter (where hide_emails is not true) as still_visible from dpdp.ai_link;  -- 0
   select column_default from information_schema.columns where table_schema='dpdp' and table_name='ai_link' and column_name='hide_emails';  -- true
   ```
   Then open one AI link manual in a browser: other people appear as roles, no `@`, no 10-digit number.
4. Rollback: `drizzle/down/0720_dpdp_ai_link_hide_emails_default.down.sql` (default only). Redeploy the previous function version if needed.

## 2. Payout encryption key, then RLS, payment-proof storage, payout encryption (0721-0723)
1. **You** create the Vault secret. Generate 48+ random characters yourself and never paste them in chat or a file:
   `select vault.create_secret('<48+ random characters>', 'dpdp_payout_key', 'DPDP partner payout encryption');`
   Check: `select name, length(decrypted_secret) from vault.decrypted_secrets where name='dpdp_payout_key';` (length at least 32). Keep a copy of the key in your password manager: without it the payout details cannot be read.
2. Apply `0721_dpdp_rls_on_for_every_dpdp_table.sql`.
   Check:
   ```sql
   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dpdp' and c.relkind='r' and not c.relrowsecurity;  -- no rows
   select table_name from dpdp.rls_hardening_log order by 1;  -- the tables that were switched on
   ```
   Then run `get_advisors` (security): no `dpdp` table reports RLS disabled. Smoke test the app: sign in, open the dashboard, make an AI link, open a consent link. All must work.
   Rollback: `down/0721_...down.sql` (switches back off exactly the logged tables).
3. Apply `0722_dpdp_payment_proof_storage_policy.sql`.
   Check: `select file_size_limit, allowed_mime_types from storage.buckets where id='dpdp-payment-proofs';` (5242880 and four types), and `select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'dpdp payment proof%';` (two rows).
   Rollback: `down/0722_...down.sql`.
4. Apply `0723_dpdp_partner_payout_encrypted.sql` (it refuses to run if step 2.1 was skipped).
   Check:
   ```sql
   select left(upi_id,5), left(pan,5) from dpdp.partner_payout_store limit 5;  -- 'enc1:' for filled columns, never plain text
   select count(*) from dpdp.partner_payout_detail;  -- the view still returns the same rows, decrypted
   ```
   Then, as a test partner, save payout details in the app and read them back masked.
   Rollback: `down/0723_...down.sql` (decrypts back; needs the same Vault key). Then re-apply `0674` function `dpdp_partner_save_payout_details` from the repo.

## 3. Retention and consent (0724, 0725)
1. Apply `0724_dpdp_retention_sweep_and_offboarding.sql`. It ships in dry-run (`live = false`).
   Check: `select live from dpdp.retention_setting;` (false) and `select jobname, schedule from cron.job where jobname='dpdp-retention-sweep';` (`10 2 * * *`).
2. Run once by hand and read the report: `select public.dpdp_timer_retention_sweep(true);` then `select ran_at, report from dpdp.retention_run order by id desc limit 3;`. Repeat on two more days.
3. Only when the counts look right: `update dpdp.retention_setting set live = true, updated_at = now() where id = 1;` To stop: set `live = false`.
4. Apply `0725_dpdp_consent_page_purposes_guardian_withdraw.sql`.
   Check: send yourself a consent link as an organisation does today (unchanged). Open it: notice text, Yes/No, saved. Open the same link again: it shows your answer and, if Yes, a withdraw button that works.
5. Rollbacks: `down/0724_...down.sql` (removes the job, functions, tables), `down/0725_...down.sql` (then re-apply `0609` consent preview function).

## 4. Breach fields (0726)
1. Apply `0726_dpdp_breach_rule7_fields.sql`.
2. Check: `select column_name from information_schema.columns where table_schema='dpdp' and table_name='breach' and column_name in ('nature','cert_in_due_at','customer_notice_due_at');` (3 rows).
3. Rollback: `down/0726_...down.sql`.

## 5. Website and app (Cloudflare Pages, project `veridian-dpdp-app`)
1. `cd dpdp-app && bun install && bun run build`.
2. `wrangler pages deploy dist --project-name veridian-dpdp-app` (use wrangler 3, see `dpdp-app/DEPLOY.md`).
3. Check: `https://veridian-aios.com/privacy/` shows Version 1.6; `/subprocessors/` loads; the footer shows Sub-processors; a payment-proof upload from the app works with a PNG under 5 MB and is refused for a 6 MB file.
4. Rollback: redeploy the previous Pages deployment from the Cloudflare dashboard.

## 6. Dashboards and people (cannot be done in code)
- Resend dashboard: confirm the domain region is Tokyo (ap-northeast-1); the privacy page says so.
- Razorpay: nothing to change; the privacy page now names it.
- Lawyer: send `ai-os/dpdp-governance/` (breach runbook, records of processing, DPIA outline, calendar, customer DPA, questions, GST check, retention schedule).
- Pending owner decisions: the final retention periods (the schedule is a draft) and the GST invoice gap. The grievance wording (14 days to reply, 90 days to resolve through mutual discussion) is decided and published.

## Order summary
0720 + function deploy, Vault key, 0721, 0722, 0723, 0724 (dry-run), 0725, 0726, Pages deploy. Any step can be stopped after its own check; the steps do not depend on each other except that 0723 needs the key, and the Pages deploy should follow 0722 (the new upload path matches the new storage policy; deploy Pages within minutes after 0722).
