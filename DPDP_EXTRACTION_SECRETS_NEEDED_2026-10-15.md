# DPDP extraction: what the owner must re-enter (prepared 2026-10-15, NOT executed)

Nothing below has been done. The plan is in `DPDP_EXTRACTION_PLAN_2026-10-13.md`. This file lists every secret and setting the new private repository (`FChecklist/veridian-dpdp`) needs, so the owner can enter them once, in one sitting. Claude never reads or writes a secret value into any file. Names only.

## 1. GitHub Actions secrets and variables (new repository, Settings > Secrets and variables)
| Name | Kind | Used by | Where the value comes from |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | `dpdp-app-deploy.yml`, `dpdp-site-health.yml` | Cloudflare dashboard > My Profile > API Tokens (Pages edit on the account). The existing token is in the old repo; GitHub never shows it again, so create or copy it. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | same | Cloudflare dashboard, account home page (not secret in itself, kept as a secret by habit). |
| `VITE_SUPABASE_URL` | variable | build in `dpdp-app-ci.yml`, `dpdp-app-deploy.yml` | `https://pcrjmlpuqsbocqfwoxod.supabase.co` (public). |
| `VITE_SUPABASE_ANON_KEY` | variable | same | Supabase > Project Settings > API > anon (public) key. |
| `SUPABASE_ACCESS_TOKEN` | secret | deploying the 10 Edge Functions from the new repo (only if you want CI to deploy them) | Supabase > Account > Access Tokens. Optional: functions can also be deployed by hand. |

`deploy-prebuilt.yml` stays in the old repository (it also serves other products); only its DPDP mentions are edited.

## 2. Cloudflare Pages project `veridian-dpdp-app` (Settings > Variables and secrets)
| Name | Used by | Note |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Pages Functions (`/ai/*`, `/api/*`) | same values as above |
| `REPORT_KEY` | `/api/telemetry` report reading | random string; owner chose it earlier |
| `VISIT_PROXY_KEY` | visit relay to `dpdp-track` | must equal `DPDP_VISIT_PROXY_KEY` below |
| D1 binding `DB` = `dpdp-telemetry` | telemetry | binding, not a secret; stays attached to the project |
These already exist on the Pages project. The extraction does not touch them as long as the SAME project is redeployed. They only need re-entering if a NEW Pages project is made (not planned).

## 3. Supabase Edge Function secrets (project `pcrjmlpuqsbocqfwoxod`, Edge Functions > Secrets)
These live in Supabase, not in GitHub, so moving the code does not lose them. Listed so the owner can confirm nothing is missing after the first deploy from the new repo.
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `DPDP_EMAIL_FROM`, `APP_ORIGIN`, `DPDP_TIMER_SECRET`, `DPDP_INBOUND_SECRET`, `DPDP_RESEND_WEBHOOK_SECRET`, `DPDP_OPERATOR_EMAIL`, `DPDP_SALES_FORWARD_TO`, `DPDP_LEGAL_RESPONSE_DAYS`, `DPDP_AUDIT_SEAL_KEY`, `DPDP_AUDIT_SEAL_KEY_ID`, `DPDP_AUDIT_SEAL_KEY_OLD`, `DPDP_AUDIT_SEAL_KEY_OLD_ID`, `DPDP_AUDIT_ALLOWED_ORIGINS`, `DPDP_AUDIT_CODE_MAX_AGE_SECONDS`, `DPDP_AUDIT_EXPORTS_PER_HOUR`, `DPDP_AUDIT_VENDOR_IP_RANGES`, `DPDP_VISIT_KEY`, `DPDP_VISIT_PROXY_KEY`, `DPDP_VISIT_RATE_PER_MIN`, `PARTNER_SIGN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, the central-ledger service key and URL used by `dpdp-pay` (`PAY_SERVICE_KEY`, `PAY_SERVICE_URL`), `DPDP_FUNCTION_URL`, `DPDP_ACTION_PATH`, `DPDP_COPY_PAGE_URL`, `DPDP_UNSUBSCRIBE_PATH`, `DPDP_EMAIL_AI_LINK_ENABLED`, `DPDP_EMAIL_AI_LINK_DAYS`, `DPDP_EMAIL_AI_LINK_LEVEL`, `DPDP_EMAIL_AI_CHANGES_ENABLED`.
The `DPDP_AUDIT_SEAL_KEY*` values are the keys that open every sealed audit entry. They must NEVER be rotated by this extraction; losing them makes the audit log unreadable.

## 4. Database-side secrets (Supabase Vault)
Partner payout encryption key (migration 0723) and the audit/visit keys read by SQL functions live in Supabase Vault. They stay with the database; nothing to move.

## 5. Secrets to REPLACE after the move (treat as exposed)
Everything that ever appeared in the public repository's history. The history scan (`DPDP_HISTORY_SECRET_SCAN_2026-10-13.txt`) is the authority; until its result is read, the safe list to rotate is: the Razorpay secret reported exposed earlier, `DPDP_TIMER_SECRET`, `DPDP_INBOUND_SECRET`, `DPDP_RESEND_WEBHOOK_SECRET`, `DPDP_VISIT_PROXY_KEY`/`DPDP_VISIT_KEY`, `REPORT_KEY`. Rotating a Supabase function secret also needs the matching value changed where it is called from (the pg_cron jobs and the Resend and Razorpay dashboards).

## 6. Owner-only actions that cannot be scripted
1. Create the private repository `FChecklist/veridian-dpdp` (or authorise Claude to).
2. Enter section 1 values in it.
3. Razorpay dashboard: webhook secret equals `RAZORPAY_WEBHOOK_SECRET`; webhook URL stays `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-pay/webhook`.
4. Resend dashboard: inbound webhook secret equals `DPDP_RESEND_WEBHOOK_SECRET`.
5. After the new repository has deployed once and been compared with the live site: approve switching the old repository's four DPDP workflows off.
