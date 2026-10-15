# Stage 2 apply list (2026-10-08): everything written but NOT yet applied or deployed

Nothing below has been applied, deployed or changed live. Each item says what, why, the exact command, how to check it, and how to undo it.
Project refs: VERIDIAN backend `pcrjmlpuqsbocqfwoxod` (verdian-ai); PROJEXA sign-in project `evpckeuxgvahguwsaeul` (projexa). Do not mix them up.
Tokens: put the Supabase access token in an environment variable inside the one command (`SUPABASE_ACCESS_TOKEN`), never print it.
Deploy rule from the handover: one function at a time, from a clean checkout of the branch that has merged to main, mkdir `C:/ct/deploy-<function>.lock` first.

## A. Migration drafts (apply in this order, through the Supabase MCP `apply_migration` or the SQL editor, each file as one migration)

The committed numbers are the next free ones after 0737. Both files carry the `PRE-APPROVED-LIVE-DDL` line that `scripts/check-ddl-authorization.mjs` requires.

| # | File | What it does | Why now | Check after | Undo |
|---|---|---|---|---|---|
| 1 | `drizzle/0738_projexa_org_storage_used.sql` | Adds `public.projexa_org_storage_used(text)`: bytes stored for an organisation in the `projexa-files` bucket. Read only, `service_role` only. | The 100 MB per-organisation upload cap (Supabase Free Storage is 1 GB). **Apply BEFORE deploying projexa-api (section B1)**: the new projexa-api answers 503 to every sign request until this function exists. | `select public.projexa_org_storage_used('9a1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff');` returns `0` (a number, no error). | `drizzle/down/0738_projexa_org_storage_used.down.sql` (deploy the old projexa-api first). |
| 2 | `drizzle/0739_projexa_sync_manifest_internal_ai.sql` | Replaces `public.projexa_sync_manifest(text,text)` with the live body plus a top-level boolean `internal_ai` (true only when the organisation has an enabled `internal_ai` row in `compliance.org_product_branch_enablements`). Grants re-stated as live. | The laptop chat reads `manifest.internal_ai`; the SQL never sent it. | `select public.projexa_sync_manifest('<a real auth sub>', null) -> 'internal_ai';` returns `false` or `true`. Existing fields identical (PGlite test proves it). | `drizzle/down/0739_projexa_sync_manifest_internal_ai.down.sql`. |

Journal: `drizzle/meta/_journal.json` already lists both (idx 545 and 546). `node scripts/check-migration-integrity.mjs` and `node scripts/check-ddl-authorization.mjs --base origin/main` pass locally.

NOT needed (checked, so nobody redoes it): a new `record_work_progress` seed migration. `platform.ai_work_link_functions` has no `declared_params` column live
(its columns are function_id, product, kind, link_level, money_sensitive, min_role_rank, excluded_reason, text_params); declared parameters live only in
`supabase/functions/ai-work-link/function-registry.generated.json`, which commit 294f7ea4 already regenerated. `bun scripts/gen-ai-link-registry.ts --check`
prints "ai-link registry up to date", and the live `public.ai_work_link__registry_version()` equals the committed 0687 value. Deploying `ai-work-link` (B3) is what makes the optional `activityId` real.

## B. Edge functions to deploy

Command pattern (from a clean checkout of main, one function, token in a variable inside the command):

```
npx --yes supabase@latest functions deploy <function> --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api
```

| # | Function | Why | Needs first | Check after | Undo |
|---|---|---|---|---|---|
| B1 | `projexa-api` | `POST /uploads/sign` enforces the 100 MB per-organisation cap (413 `ORG_QUOTA`, see `UPLOAD_CONTRACT_2026-10-06.md`). | Migration 0738 applied. | Sign a small file: 200. Then (staging org only) a request that would exceed 100 MB: 413 with `"code":"ORG_QUOTA"`. | Redeploy the previous commit. |
| B2 | `projexa-sync` | `GET /manifest` passes `internal_ai` (boolean) through to the laptop; without this the SQL field (0739) is dropped by the function's field whitelist. Per the handover, never deploy projexa-sync until ct #2098 is merged. | Migration 0739 applied; #2098 merged. | `GET /manifest` with a real token contains `"internal_ai":false` (or true). | Redeploy the previous commit (the old one simply ignores the field). |
| B3 | `ai-work-link` | Carries the optional `activityId` on `record_work_progress` (function-registry JSON from 294f7ea4), the BOQ in `/workspace`, `/workspace.txt`. Skip if it was already deployed from main after 294f7ea4. | none | `GET <link>/workspace.txt` returns 200 `text/plain` with `Content-Disposition: attachment; filename="projexa-workspace.txt"`, identical body to `/workspace`. | Redeploy the previous commit. |

`/workspace.txt` already existed in code (handler `workspace_txt`); this stage only added tests (same body as `/workspace` for every role, 410 for revoked, expired and unknown links).

## C. Live settings to change (PROJEXA sign-in project `evpckeuxgvahguwsaeul`)

Both are one Management API call; first read the current values, then change.

Read: `curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/evpckeuxgvahguwsaeul/config/auth` (look at `mailer_otp_exp`, `mailer_templates_magic_link_content`, `mailer_templates_confirmation_content`).

1. Email OTP expiry 3600 s -> 600 s:
   `curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"mailer_otp_exp":600}' https://api.supabase.com/v1/projects/evpckeuxgvahguwsaeul/config/auth`
   Undo: the same call with `3600`. (Dashboard path: Authentication > Providers > Email > Email OTP Expiration.)
2. Magic-link and signup (confirmation) email templates must show the 6-digit code `{{ .Token }}`. Change only the body fields, keep SMTP and Resend exactly as they are:
   `curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @templates.json https://api.supabase.com/v1/projects/evpckeuxgvahguwsaeul/config/auth`
   where `templates.json` has `mailer_templates_magic_link_content` and `mailer_templates_confirmation_content` set to a short HTML body that contains `{{ .Token }}` as the code, for example
   `<p>Your PROJEXA sign-in code is <strong>{{ .Token }}</strong>. It works for 10 minutes. If you did not ask for it, ignore this email.</p>`.
   Save the current template text first (from the Read call) so it can be restored. Check: request a sign-in code for a test address and confirm the email shows 6 digits.
   Do NOT touch `smtp_*` fields in the same call.

## D. Nothing to apply for these (done in code, tested locally)
- Upload cap logic, `/workspace.txt` tests, manifest pass-through: committed on branch `train/projexa-gaps-2026-10-08`, not pushed.
- Database saturation: no migration; see `ai-os/audit37/DB_SATURATION_NOTE_2026-10-08.md` (the role timeouts already exist live; compute size is the owner's decision).

## E. Order of the whole stage
0738 -> deploy projexa-api -> 0739 -> deploy projexa-sync (after #2098) -> deploy ai-work-link -> auth settings (C). Verify each step before the next.
