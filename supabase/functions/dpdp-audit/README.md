# dpdp-audit / dpdp-audit-lifecycle -- the DPDP audit trail

Owner-approved specification 2026-10-06. Database: `drizzle/0730_dpdp_audit_trail.sql`. Shared code: `supabase/functions/_shared/audit/*`.
Tests: `src/lib/services/dpdp-audit-*.test.ts` (pure, handler, lifecycle, and the whole migration on real Postgres via PGlite).

## What is recorded, and how it extends what was already there

| Source | How it reaches the audit chain |
|---|---|
| Every call to the AI work link (`dpdp-ai-link`) | One row per call from `index.ts` (`auditAiLinkCall`), joined to `dpdp.ai_link_call` by `ai_call_id`. Fetcher + vendor the SERVER saw, the AI's optional self-declaration (`X-AI-Model` / `X-AI-Version` / `X-AI-Session` / `X-AI-Machine` headers or `ai_model` / `ai_version` / `ai_session` / `ai_machine` query parameters) as CLAIMS, a mismatch flag, link id + token fingerprint (hash prefix, never the token), the guide hash. |
| AI draft and the person's confirm | Database triggers on `dpdp.ai_draft`: `ai_prepare` when the AI drafts, `human_confirm` when the person confirms; both carry the draft id as `request_id`. `dpdp.ai_action` insert is `edit` by the AI link. |
| Every existing business event (`dpdp.event`, ~40 writers) | AFTER INSERT trigger: metadata only (kind, organisation, actor id, the event's id); never the summary or detail text. |
| Sign-in, failed sign-in, read of personal data | Browser reports to `POST /event` (`dpdp-app/src/lib/audit-api.ts`); the server adds address / country / browser itself. |
| Downloads | `download_export` row (with the file's verification hash) written BEFORE the file is handed out; if it cannot be written the download is refused. |
| Internal reads of full values | `dpdp.audit_access_log` (who, why, when, how many) written first, plus a `staff_read` row on the organisation's own chain. |

Only these types are accepted from a browser: `login`, `failed_login`, `read_personal_data`. A browser cannot claim a delete or an AI event.

## Routes (`/functions/v1/dpdp-audit/...`, deployed `verify_jwt: false`; every route but a failed-login report authenticates with `auth.getUser`)

`POST /event` · `GET /orgs` · `GET /my` · `GET /org` · `POST /verify` · `POST /verify-file` · `POST /policy/hod` · `POST /staff/read` · `POST /staff/legal-hold`

Downloads (`/my`, `/org`) need: a signed-in person, a code-based sign-in within the last 10 minutes (`amr` claim of the access token -- the app's existing e-mail code flow, asked for again by `AuditLogPanel`), and at most 5 a hour (every attempt, including refused ones, is on the record). `/org` needs owner or a head of department. The file is the HTTP response of the signed-in browser; nothing here sends a log by e-mail.

## Secrets (Edge Function secrets, NOT in the database, NOT in the repository)

| Name | Meaning |
|---|---|
| `DPDP_AUDIT_SEAL_KEY` | base64 of 32 random bytes (`openssl rand -base64 32`). REQUIRED. Without it nothing is written or read (fail closed; the AI link keeps working and logs `audit row not written (no_key)`). |
| `DPDP_AUDIT_SEAL_KEY_ID` | short id stored with each sealed value (default `k1`). |
| `DPDP_AUDIT_SEAL_KEY_OLD`, `DPDP_AUDIT_SEAL_KEY_OLD_ID` | the previous key while rotating, so old rows still open. |
| `DPDP_AUDIT_VENDOR_IP_RANGES` | optional JSON `{"OpenAI":["a.b.c.d/nn"],...}` refreshed from each vendor's published list. Not hard-coded here on purpose (they change). Unset = network proof reads `not_checked`. |
| `DPDP_AUDIT_CODE_MAX_AGE_SECONDS` | default 600. `DPDP_AUDIT_EXPORTS_PER_HOUR` default 5. `DPDP_AUDIT_ALLOWED_ORIGINS` default the app origin. |
| `APP_ORIGIN`, `RESEND_API_KEY`, `DPDP_EMAIL_FROM`, `DPDP_TIMER_SECRET` | already set for the sibling functions; `dpdp-audit-lifecycle` reuses them. |

Keep a copy of the seal key somewhere that is not Supabase. Losing it makes every sealed value unreadable for good (the chain, counts and masked structure survive; the personal values do not).

## Deploy order (the lead; nothing here has been applied)

1. Set `DPDP_AUDIT_SEAL_KEY` (+ `_ID`) as an Edge Function secret on project `pcrjmlpuqsbocqfwoxod`.
2. Apply `drizzle/0730_dpdp_audit_trail.sql` (Supabase MCP `apply_migration`). It creates tables, triggers, functions and the `dpdp-audit-daily` cron job (skipped by its own guard if pg_cron/pg_net are missing).
3. Deploy `dpdp-audit` with `verify_jwt: false`, `dpdp-audit-lifecycle` with `verify_jwt: false`, and redeploy `dpdp-ai-link` and `dpdp-monday-email` (read-only default level).
4. Deploy the Pages app (`dpdp-app`: proxy forwards the `x-ai-*` headers and country; panel; privacy v1.7).
5. Smoke: `POST /event` failed login for a known address answers 202; sign in and download with a fresh code; `POST /verify`; check `select * from dpdp.audit_event order by seq desc limit 5`.

## What the database guarantees on its own

`dpdp.audit_event`: INSERT only (the chain trigger stamps id, server clock, previous hash, content hash and row hash; a writer supplies only the sealed content); UPDATE / DELETE / TRUNCATE refused for every role. The single exception is the purge function, only for rows 365 days old of an organisation with no legal hold (checked again inside the guard trigger). The `app_runtime` role can insert and read nothing; no browser role has any grant. A superuser can still bypass triggers -- the daily chain-head e-mail to the owner, and "Verify chain" (which checks every recorded head is still in the chain), are what make that detectable.
