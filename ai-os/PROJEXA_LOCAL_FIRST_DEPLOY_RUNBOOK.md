# PROJEXA local-first: deploy runbook (for the PM)

Owner order (2026-10-02): everything is built and tested on local + Supabase + git FIRST; the deploy comes after; **the Vercel deploy is the VERY LAST step**, and only the owner may spend credits or touch Vercel settings (`CLAUDE.md` R76: no Vercel deploys, no `OWNER_DEPLOY_APPROVAL` set by an agent; R87 later loosened the gate to "`main` + a real code change", still an owner decision).
Everything below up to step 7 touches Supabase and git only. Nothing here needs Vercel.

## EXECUTION LOG (2026-10-02, PM session; owner order "complete everything on local + Supabase + git, then test it, deploy last")
Sections 2, 3 and 5 below were EXECUTED, in this order, and the "nothing was run live" sentence further down describes how the runbook was first written, not today's state.
- **Section 2, migrations 0678..0687 APPLIED** on `pcrjmlpuqsbocqfwoxod` with `scripts/verify/apply-projexa-local-first-chain.mjs`: `--check` (read-only), `--rehearse` (the whole chain in ONE request that ends in a deliberate exception, so it proves the chain applies on the real database and leaves nothing), then `--apply` (each file its own request, the files carry their own BEGIN/COMMIT). It talks to the Supabase Management API with the project access token because the app's runtime role (`app_runtime`) cannot run DDL. Post-checks: tracking health ok (37 kinds, 3 statement triggers each), `anon`/`authenticated` can execute none of the chain's functions. The ten files are also recorded in Supabase's own migration history (`scripts/verify/record-projexa-local-first-migrations.mjs`, names like `projexa_sync_keys_ids_0678`), so `list_migrations` shows them. The repo's own drizzle ledger (`drizzle.__drizzle_migrations`) was NOT touched: it already lags the live database for every file since ~0640 (all applied through the MCP), and adding rows for only these ten would only make it look more complete than it is.
- **Section 3, Edge functions DEPLOYED** (`ai-work-link-exec`, `ai-work-link`, `projexa-sync`, in that order) with the Supabase CLI; on this laptop it needs `SUPABASE_GO_BINARY=C:\Users\Dell\.local\share\supabase\supabase-go.exe` and that folder on `PATH`. `AWL_SYNC_EXEC_SECRET` is set (the same value is what `/sync-run` and `/sync-run-batch` check; `AWL_EXEC_INTERNAL_SECRET` stays the fallback). Without a token: `/manifest`, `/heads`, `/release/current` answer 401, the CORS preflight allows `authorization, content-type, x-px-client` and exposes `Retry-After`, `ai-work-link-exec /health` answers 401.
- **Section 5, smoke, done WITHOUT any password or token** (the Edge session check needs a real PROJEXA person token, which is the owner's to produce by signing in): `scripts/verify/projexa-sync-live-read-check.ts` runs the REAL Edge handler in-process over the LIVE SQL functions for 9 real people of 3 organisations (an `tok:<sub>` stand-in for the verified session): manifest, `/heads`, 404-isolation between organisations, role visibility (a lower role never sees a row or a filled column the admin does not), paging, organisation kinds as per role. `scripts/verify/projexa-sync-live-write-check.ts` runs the write side: push ledger exactly-once and role gates, job lease, tracking health, and ONE committed change on the test tenant `R74-TEST-Tenant-A` (a project description changed twice and restored) to prove the change feed live. SQL probes it uses live in `scripts/verify/sql/` and always end in a deliberate exception so they leave nothing behind. Results: read check 117 PASS / 0 FAIL (620 live database calls), write check 30 PASS / 0 FAIL.
- **A pushed edit, end to end on the live database** (`scripts/verify/projexa-sync-live-push-check.ts`, 12 PASS): the real `projexa-sync` handler AND the real exec pipeline (`ai-work-link-exec` handler + the generated `app.bundle.mjs`, the same code the deployed function runs) in one process over the live database, ledger functions through the Management API and the business write through `APP_RUNTIME_DATABASE_URL`. One task title of the E2E fixture organisation is changed and restored: applied (version 0 -> 1, the server snapshot comes back), the same op again is `duplicate` (nothing runs twice), a stale edit is `conflict`, a viewer and a person of another organisation are `rejected`, the change feed and `/pull` show the new version, and the title is restored. The only stand-ins are the session check (`tok:<sub>`) and the HTTP hop between the two functions. Two facts it taught: `update_task` takes `{projectId, issueId, title, ...}` (not `taskId`; the laptop's `local-writes.ts` already uses `issueId`), and the pipeline's database connection has a hard `connect_timeout` of 10 s which this laptop's network path to the pooler sometimes exceeds (all three pooler addresses timed out on TCP for several minutes while HTTPS worked): the check is a retry-later case there, and `APP_RUNTIME_POOL_MAX=3` keeps it light. It needs the generated bundle (`bun scripts/build-ai-work-link-exec.ts`).
- **Still to do, in this order**: (1) the authenticated end-to-end smoke by the owner (sign in once, or paste a person token for `scripts/verify/projexa-sync-smoke.mjs`); (2) merge the backend PR, then the laptop PR last; (3) publish `release.json` with the deploy and `POST /release/register`; (4) the first signed pull creates the signing key (`select count(*) from public.projexa_sync_public_keys()` is 0 today, which is correct before that).
- **Known blocker for step 3 of the last-step chain**: both PRs show a Vercel status "Deployment rate limited, retry in 24 hours" (team `veridian-ai-os`). Every pushed branch creates a Vercel deployment that `ignoreCommand` cancels at once, and those cancelled attempts still count against the per-day build rate limit. Do not upgrade the plan to get past it (owner-only spend); push fewer branches and let the window roll off, or serve the static release files from Cloudflare Pages as section 6 allows.
- Facts learned that change nothing above but save a search: a bare `updated_at` touch creates NO record version (the tracking trigger drops an update whose project and content did not change, by design, so no laptop pulls a no-change); the change feed shows a row only once its transaction is behind the commit horizon (a long-open transaction anywhere delays it, nothing is lost).

What this runbook was written from (nothing was run live; every command is to be run by the PM, with the owner's go-ahead for the live steps):
`supabase/functions/projexa-sync/{handler,index}.ts`, `drizzle/0677..0683` and their `down/` files, `.github/workflows/ci.yml`, `projexa/docs/local-first/CONTRACT.md`, the briefs in `ai-os/cloud-agents/`.

## 0. Preconditions (stop if any is false)
- The owner has said "go" for the live steps of this run (AGENTS.md Rule 7(e): deploying is the one step that is not cleanly reversible).
- `main` of both repos is green. Read `ai-os/boss/ACTIVE-CLAIMS.yaml` and register the claim (AGENTS.md Rule 11).
- You hold: the Supabase project ref `pcrjmlpuqsbocqfwoxod` (verdian-ai), a way to run SQL against it (the Supabase MCP `apply_migration` / `execute_sql`, or `psql` with the owner-provided connection string), and the Supabase CLI (`supabase` 2.107+, `--use-api` deploys need no Docker). Secrets are **names only** in this file; values are never written to git, chat or logs.
- Cost check first: `node scripts/verify/projexa-local-first-cost-model.mjs` (this repo). Default 50 users: Edge invocations bind first at ~95 users on the defaults; see section 7 for the two levers that move it to ~190.

## 1. Pull-request order and CI
Open the PRs in this order; merge each only after its required checks are green. No PR is opened by the cloud agents; the PM opens them.

| # | Repo | Branch | Carries | Migration |
|---|---|---|---|---|
| 1 | compliance-tracker | `feat/lf-sync-backend` | `projexa-sync` handler, 0678-0683, 8 PGlite suites, this runbook and scripts (via `claude/lf-b4-runbook`) | 0678..0683 |
| 2 | compliance-tracker | `claude/lf-b1-org-masters` | organisation master kinds | 0684 |
| 3 | compliance-tracker | `claude/lf-b2-ai-crud` | AI create/update/delete registry seed | 0685 |
| 4 | compliance-tracker | `claude/lf-b3-ai-off` | in-app model lanes OFF behind `PROJEXA_INTERNAL_AI_ENABLED` | none |
| 5 | compliance-tracker | `claude/lf-b4-runbook` | this file, cost model, smoke script | none |
| 6 | projexa | `feat/local-first-complete`, `feat/lf-client-core`, `feat/lf-pwa-offline`, then `claude/lf-c1-peers`, `claude/lf-c2-jobs`, `claude/lf-c3-browser-ai` | the laptop app | none |

Rules for the order: backend before laptop (a laptop must never speak to routes that do not exist; the 426 gate protects the other direction); migrations in number order with no gap and no reuse (`scripts/check-migration-collision.mjs`); a PR that adds a migration keeps its journal `when` strictly greater than the previous entry (`scripts/check-migration-integrity.mjs`). Row 1 is the base of rows 2-5: merge it first, then update each other branch with a merge of `main` (no rebase of a branch someone else pushed).

CI (`.github/workflows/ci.yml`, runs on PRs to `main`, push to `main`, and manual dispatch). Jobs a backend PR must pass: Lint, Type Check, Build, Unit Tests (`bun test --isolate`), Browser Bundle Service-Role Scan, Migration Number Collision Check, **DDL Authorization Check** (`scripts/check-ddl-authorization.mjs`: every new migration needs the `-- PRE-APPROVED-LIVE-DDL:` first line the 0678-0683 files carry), Route Error Handling Check, Migration Integrity Check (AR-12), Governance YAML Parse Check, Migration Schema Drift Check, New Test Coverage Check, Graph Drift Check. Report-only: Migration Replay From Empty (E-103), Test Coverage Gap Report. `E2E Tests` and `E2E Tests (Env-1, cross-repo)` need their own secrets and have a history of skipping behind Lint (CLAUDE.md, R75): read the actual job list of the run, do not stop at "a green check".
Branch protection: AGENTS.md Rule 6 says PR + CI for every change; CLAUDE.md R72 records that real protection is only "no force-push, no deletion". Use a PR anyway. Do not force-push `main`.

## 2. Migrations 0678 .. 0685 (additive; live DDL pre-approved by the owner's 2026-10-02 directive quoted in each file's first line)
Order is strict: 0677 (merged to `main` in #2035; whether it is applied LIVE is not known from git: run the 0677 check below first and apply it if the functions are absent) -> 0678 -> 0679 -> 0680 -> 0681 -> 0682 -> 0683 -> 0684 -> 0685. **0684 and 0685 are being built on their own branches and are not on `feat/lf-sync-backend`; their verification below is by name only: re-read their headers when they land and replace the placeholders.**

How to apply (no Vercel, no `db:migrate`):
- Apply ONE file at a time with the Supabase MCP `apply_migration` (name = the file's tag, query = the file body) or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/<file>.sql`. Each file is a single `BEGIN ... COMMIT` with `SET LOCAL lock_timeout = '5s'`: all or nothing. If the MCP wraps your SQL in its own transaction the inner BEGIN/COMMIT only raises a warning; check the result, do not assume.
- Do **not** use `bun run db:migrate` or `.github/workflows/db-migrate.yml` for these: they apply every unregistered journal entry, not one, and the repo's own notes (E-74, `scripts/migration-ledger.mjs`) show the ledger is out of step with the live database. After a manual apply, the journal row is in git (`drizzle/meta/_journal.json`); the live ledger is not touched by this method, which is the repo's established practice. Every statement is `IF NOT EXISTS` / `OR REPLACE` / `DROP ... IF EXISTS`, so applying twice changes nothing.
- Apply 0679 and 0683 off-peak: each `CREATE TRIGGER` takes a SHARE ROW EXCLUSIVE lock on a live business table for an instant (13 tables, then 15); a 5 s lock timeout aborts the whole migration cleanly if a table is busy; just retry.
- After each migration run its check below. A check failing means: stop, run the down file, report.

Common check (run after every migration):
```sql
select count(*) as projexa_functions from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','platform') and p.proname like 'projexa\_%' escape '\';
select count(*) as projexa_tables from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'platform' and c.relkind = 'r' and c.relname like 'projexa\_%' escape '\';
select count(*) as track_triggers from pg_trigger where tgname = 'projexa_track_change' and not tgisinternal;
```
Expected cumulative values after each step (functions are distinct names; the table count counts `platform.projexa_*` tables):

| After | New objects (from the file) | functions | tables | triggers | Smoke select |
|---|---|---|---|---|---|
| 0677 | `projexa_sync__ctx`, `__cursor_field`, `__src`, `projexa_sync_manifest`, `projexa_sync_pull` | 5 | 0 | 0 | `select proname from pg_proc where proname = 'projexa_sync_manifest'` returns 1 row |
| 0678 | `projexa_sync__kinds`, `__view_class`, `projexa_sync_ids`, `_key_active`, `_key_put`, `_key_rotate`, `_public_keys` (+ manifest replaced); table `projexa_sync_key` | 12 | 1 | 0 | `select count(*) from public.projexa_sync_public_keys()` runs (0 rows is fine before the first signing); `select relrowsecurity, relforcerowsecurity from pg_class where relname='projexa_sync_key'` = `t,t` |
| 0679 | `platform.projexa_track_change`, `projexa_sync__items`, `projexa_sync_changes`, `projexa_sync_pull_ids` (+ pull replaced); tables `projexa_record_head`, `projexa_change_log`; 13 triggers | 16 | 3 | up to 13 (a table absent in this environment is skipped) | `select count(*) from platform.projexa_change_log` runs; update one scratch row's `updated_at` in a test org and see `projexa_change_log` grow by 1 (skip on live: read the count only) |
| 0680 | `projexa_install_record`, `projexa_release_current`, `projexa_release_register`, `projexa_release_set_min_compatible`; tables `projexa_release`, `_file`, `_release_file`, `_release_policy`, `_client_install` | 20 | 8 | same | `select public.projexa_release_current()` returns `{"registered": false, ...}` |
| 0681 | `projexa_sync_push_begin`, `projexa_sync_push_finish`; table `projexa_sync_op` | 22 | 9 | same | `select count(*) from platform.projexa_sync_op` = 0 |
| 0682 | `projexa_job_enqueue/claim/heartbeat/result/get`; table `projexa_work_job` | 27 | 10 | same | `select count(*) from platform.projexa_work_job` = 0 |
| 0683 | 15 more triggers; `projexa_sync__kinds` and `__src` replaced, `projexa_track_change` replaced | 27 | 10 | up to 28 | `select count(*) from public.projexa_sync__kinds()` = 28 |
| 0684 | placeholder: organisation-master kinds; read the file header when it lands | per header | per header | per header | per header |
| 0685 | placeholder: AI function registry seed (`INSERT ... ON CONFLICT DO UPDATE`); down file deletes exactly the new ids | unchanged | unchanged | unchanged | `select count(*)` of the new function ids in the registry equals the brief's number |

The function counts above come from `CREATE OR REPLACE FUNCTION` names in each file (a name replaced in a later file is not counted twice); recount from the files if a file changed since this was written: `grep -io 'create or replace function [a-z_.]*' drizzle/06[78]*.sql | sort -u`.
Also confirm grants once after 0678-0682: the `projexa_*` functions must not be executable by `anon`, `authenticated` or `app_runtime`:
```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'projexa\_%' escape '\' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
```
Expected: 0 rows.

Rollback (per migration, newest first; the down files are in `drizzle/down/`, run by the PM deliberately, never by a script). Always roll back in REVERSE order:
`0685 -> 0684 -> 0683 -> 0682 -> 0681 -> 0680 -> 0679 -> 0678 -> 0677`, each `drizzle/down/<tag>.down.sql`. DATA LOSS per file is stated in its header: 0679 loses the version history (`projexa_record_head`, `projexa_change_log`); 0680 the whole release registry and install history; 0681 the push ledger (applied ops are NOT undone); 0682 queued jobs; 0678 the signing keys (laptops holding signed rows must re-pull). No business table is touched by any down file. Prefer the layer rollbacks in section 8 (undeploy the function, raise nothing) over a down migration unless the migration itself is the fault.

## 3. Edge Function deploys (Supabase only, from a clean checkout at the merge SHA)
```
git switch --detach <merge sha on main>          # a clean worktree, not a dirty working copy
supabase functions deploy projexa-sync      --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api
bun run scripts/build-ai-work-link-exec.ts            # generates supabase/functions/ai-work-link-exec/app.bundle.mjs (git-ignored, never committed)
supabase functions deploy ai-work-link-exec --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api
supabase functions deploy ai-work-link      --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api
```
- `--no-verify-jwt` is required for all three: `projexa-sync` and `ai-work-link` verify the PROJEXA person's token themselves (`ai-work-link/session.ts`; the token is signed by the PROJEXA Auth project, not by verdian-ai); `ai-work-link-exec` is called only by the other two with the shared secret.
- Deploy order: `ai-work-link-exec` first (a pushed op needs it), then `ai-work-link`, then `projexa-sync` last (the one laptops talk to). Run `scripts/build-ai-work-link-exec.ts --check` beforehand: it must stay under its 5,000,000-byte limit.
- Secrets (names only; set with `supabase secrets set NAME=...` or the dashboard, by the owner or PM; never echo a value):

| Function | Secret names it reads | Notes |
|---|---|---|
| `projexa-sync` | `AWL_EXEC_INTERNAL_SECRET` | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Without the exec secret a push answers `needs_server`/unavailable, reads still work. |
| `ai-work-link` | `AWL_EXEC_INTERNAL_SECRET` | same two injected values |
| `ai-work-link-exec` | `AWL_EXEC_INTERNAL_SECRET`, `APP_RUNTIME_DATABASE_URL` | the exec secret must be the SAME value in all three; without either, every request is 503 NOT_CONFIGURED |

- Confirm the deployed source equals git: `supabase functions list --project-ref pcrjmlpuqsbocqfwoxod` shows a new version for each; a smoke (section 5) is the real proof.
- The signing key (ES256) is created by the first isolate that needs it (`projexa_sync_key_put`); it needs no secret. Rotating it is `select public.projexa_sync_key_rotate();` (service role / SQL only); old public halves keep verifying old rows.
- `release/register` fetches `https://projexa-ai.com/_release/release.json` itself, so it can only succeed after a PROJEXA release is published there (section 6).

## 4. Kill switches and flags (what each does, who flips it, how to see it worked)

| Switch | Where | Effect | Flip |
|---|---|---|---|
| `px-local-first` | the laptop's localStorage (`projexa/src/lib/local-first/local-reader.ts`, `LOCAL_FIRST_FLAG`); `"1"` = read the laptop's own copy | per-browser only; it is NOT a remote switch | the app's own settings; a user or support can clear it. A remote stop is the next row. |
| Stop sync for everyone | redeploy `projexa-sync` as a stub that answers 503 (or `supabase functions delete` is NOT used: it removes the function) | laptops treat 5xx/unreachable as offline (requirement R2) and keep working locally; nothing is lost; the outbox keeps its ops | `supabase functions deploy projexa-sync --use-api` from the previous good SHA restores it |
| `platform.ai_work_link_settings.writes_enabled` | SQL: `update platform.ai_work_link_settings set writes_enabled = false where id;` | every AI-link write AND every pushed op is refused (the pushed op runs the AI-link write path); reads still work. Drilled by `scripts/verify/awl-killswitch-drill.sh` (offline, no live DB). | owner/PM via SQL only; set back to `true` to resume |
| `PROJEXA_INTERNAL_AI_ENABLED` | server env (package lf-b3): strictly `1` turns PROJEXA's own model lanes on; unset/other = OFF (default OFF, zero model cost) | OFF is the shipped state; do not set it | owner only, and only if the owner decides to pay for in-app AI |
| release `min_compatible` | `select public.projexa_release_set_min_compatible('<release_version>');` (service role / SQL only) | a laptop whose `X-Px-Client` release is below it, or on another protocol, gets `426 UPDATE_REQUIRED` on every route except `release/current`, `release/register`, `install` | owner/PM; see section 6 policy |
| Rate caps | `REQUESTS_PER_MINUTE = 120` per person per isolate; push 600 ops/hour, 5 `create_project`/day (SQL, `projexa_sync_push_begin`); jobs 30 open and 200/day per person | code constants; a change is a code deploy | PM via PR |

## 5. Post-deploy smoke (reads only, no Vercel)
```
export SYNC_BASE='https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync'
export PX_TOKEN='<a PROJEXA access token of a test person, pasted by the PM; never put it in a file or a command history you keep>'
node scripts/verify/projexa-sync-smoke.mjs
```
It calls manifest, pull (one kind, limit 1), changes, ids, attest and release/current and prints a PASS/FAIL table with latencies; exit 0 only if nothing FAILed. It refuses any host that is not `<project>.supabase.co` with the exact path `/functions/v1/projexa-sync`. A person with no project gets SKIP rows for the project calls: that is data, not a fault; use a person who has one.
The same checks by hand (placeholders; `-s` keeps curl quiet, do not add `-v` which would print the header):
```
curl -s -H "Authorization: Bearer $PX_TOKEN" -H 'X-Px-Client: smoke; protocol=2; schema=3' "$SYNC_BASE/manifest" | head -c 600
curl -s -H "Authorization: Bearer $PX_TOKEN" -H 'Content-Type: application/json' -d '{"project_id":"<project id>","kind":"project","after":null,"limit":1}' "$SYNC_BASE/pull" | head -c 600
curl -s -H "Authorization: Bearer $PX_TOKEN" -H 'Content-Type: application/json' -d '{"project_id":"<project id>","after_seq":null,"limit":1}' "$SYNC_BASE/changes"
curl -s -H "Authorization: Bearer $PX_TOKEN" "$SYNC_BASE/release/current"
```
Expected failures that are CORRECT: no token -> 401; an unreadable or other-organisation project -> 404 (one answer for all three); a laptop below `min_compatible` -> 426; more than 120 calls a minute -> 429.

Monitoring after the deploy (cost is the top priority):
- Supabase: dashboard -> Edge Functions -> Invocations for `projexa-sync` and `ai-work-link-exec`, and Logs. Compare with the model: `node scripts/verify/projexa-local-first-cost-model.mjs --users <real users>`; edge invocations per user per month is the number to watch (default model: ~5,200). Alert at 60% of 500,000.
- Vercel (read-only, owner's token, never in git): `bash scripts/verify/vercel-invocations.sh '<route pattern>' <days>` counts function invocations for a route over complete billing days (exit 0 = none, 1 = some, 2 = no data; a locked/paused project reads as "no data", which proves nothing); `VERCEL_API_TOKEN=... node scripts/vercel-monthly-cost-check.mjs` prints one line and exits 1 when the projected month is above $20.
- Target after launch: zero Vercel function invocations from laptop traffic (the app is static; the laptop serves itself).

## 6. Release registration and `min_compatible` policy (after the PROJEXA deploy)
1. Order of the last steps: (a) backend migrations + Edge deploys done and smoked (sections 2, 3, 5); (b) laptop app PRs merged and green; (c) **the Vercel deploy of PROJEXA, last, by the owner's own act** (no agent deploys; no `OWNER_DEPLOY_APPROVAL` set by an agent). The release files `public/_release/release.json` and `px-<release_version>.tar.gz` are static files in that deploy (Cloudflare Pages is the zero-cost fallback host if Vercel credits run out; the registry only requires the allow-listed origin `https://projexa-ai.com`).
2. Register: `curl -s -X POST -H "Authorization: Bearer $PX_TOKEN" -H 'Content-Type: application/json' -d '{}' "$SYNC_BASE/release/register"`. It takes no input; the server fetches `release.json` itself, checks that `manifest_sha256` is the sha256 of the manifest it sits in, and registers it. Idempotent for the same digest. Answers: 200 registered; 409 `VERSION_TAKEN` (same version, different content: the build must bump the version, never overwrite); 502 `MANIFEST_UNREACHABLE` / `MANIFEST_BAD` (the file is not published yet, or was altered). Then `GET /release/current` must show `registered: true` and the new `release_version` (the function caches the registry for one minute).
3. `min_compatible` policy: leave it empty at first launch (nobody is blocked). Raise it only when a release is **incompatible** with the older ones (sync protocol or laptop database schema change, a security fix, or a data-corrupting bug): `select public.projexa_release_set_min_compatible('<version>');`. A protocol change is separate and automatic: a client on another `protocol=` than the server's 2 gets 426. Raise it a few days AFTER most laptops have updated (see `platform.projexa_client_install`: how many installs report the new release) so few people are interrupted. Never raise it above the current release. Lowering it is the same call with an older version (an emergency exit).
4. Each laptop then posts `POST /install` once per update; `select release_version, count(*) from platform.projexa_client_install group by 1` is the rollout view.

## 7. Cost levers if the invocation count approaches the limit (from the cost model's derivation)
The two biggest fixed costs per active user, on the default assumptions, are the daily `/ids` repair (`P x 28 kinds` calls a day) and `jobs/claim` polling. `--idsRepairsPerDay 0.15 --jobsPollSec 900` moves the break-even from ~95 to ~190 users with no change to data safety (deletes then reach a laptop within about a week by the repair, and at once through `/changes` tombstones). Longer `/changes` intervals and polling only the open project are the next levers. These are laptop-side settings (package lf-c1/c2): ask for them in a PR; do not edit the laptop code from here.

## 8. Rollback plan per layer (cheapest first)
| Layer | What to do | Data effect |
|---|---|---|
| Laptop app (a bad release) | publish the previous release again (a new, higher `release_version` with the old content; versions are never reused: 409) and, only if it corrupts data, raise `min_compatible` to the fixed version | none |
| Vercel static deploy | owner promotes the previous deployment in the dashboard (`vercel rollback` by the owner's own act); laptops keep running their installed copy regardless | none |
| Edge Functions | redeploy the previous SHA of the function (section 3, `--use-api`, clean worktree); to stop sync entirely, deploy the 503 stub. Laptops go offline-quiet and keep their data and outbox | none; queued ops sync after restore |
| AI writes | `ai_work_link_settings.writes_enabled = false` | none; ops stay in the outbox |
| Database | the down files of section 2, newest first | see each file's DATA LOSS note (version history, release registry, push ledger, jobs, keys). The business tables and their rows are never touched. |

Do not delete data anywhere in a rollback. If something cannot be undone with the rows above, stop and hand it to the owner.

## 9. Not in this runbook (honest limits)
- Nothing here was executed against the live project: counts in the section 2 table are derived from the migration files and must be re-read from a real run.
- 0684 and 0685 are not on the branch this was written from.
- The free-tier numbers in the cost model are from memory of the vendor pages and are marked "to verify" where unsure (Vercel Hobby function-invocation cap; whether Realtime counts delivered copies).
- `px-local-first` is a per-browser flag; there is no remote switch for it in the code as read, only the Edge Function stub (section 4).
