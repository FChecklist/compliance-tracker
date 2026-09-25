# SHARED BOUNDARY - who owns what in the shared infrastructure

Repo path when committed: `ai-os/SHARED_BOUNDARY.md`. Written 2026-09-25 for PROJEXA-BUILD-001 (tests E-16 and E-17 of Addendum A). Status of every fact is dated 2026-09-25 unless a row says otherwise. A row that no input file or dated query supports says UNVERIFIED.

Source keys used in this file: A09 = IDENTITY_AND_EDGE_FINDINGS.md; A07 = INFRA_INVENTORY.md; DTD = DEV_TEST_DEPLOY_FACTS.md; ADD-A6 = ADDENDUM_A_BUILD-001_EDGE_AND_BROWSER_FIRST_2026-09-25.md section A6; PMD = PM_DECISIONS.md; LIVE = a SELECT run on 2026-09-25 by the writer of this file (extension lists, see section 4).

## 1. Purpose

There are two products and two roadmaps: PROJEXA (construction and interior-design project management, its own Next.js repo FChecklist/projexa) and DPDP (the data-protection product). Both run on one repository (FChecklist/compliance-tracker) and one shared database (Supabase project verdian-ai, `pcrjmlpuqsbocqfwoxod`). The VERIDIAN AI-OS track (governance, AI router, dev tooling) uses the same repository and database as a third user.

What went wrong (ADD-A6): between 22 and 25 September 2026 the DPDP track installed `pg_net`, added about 30 RPC functions and created 2 cron jobs. That changed the database PROJEXA runs on. PROJEXA was not told. A reading of that database taken on 22 September was stale by 25 September for that reason, including the auditor's own reading.

This file exists so that no such change is silent again. It names, for each shared resource, the owner product, who may change it, and the rule that a change is written down in `ai-os/boss/ACTIVE-CLAIMS.yaml` BEFORE it is made.

Not covered here: DPDP-owned objects are not modified by PROJEXA work (PMD-18). This file records them only so PROJEXA knows they exist.

## 2. The rule (applies to every product and every agent session)

R1. Before you do any of the four actions below, add a claim to `ai-os/boss/ACTIVE-CLAIMS.yaml`, following the protocol at the top of that file. The claim names the action, the exact object name, the project, and the product that asked. Do the action only after the claim is on `main`.
- install or drop a Postgres extension (either Supabase project);
- add, replace or drop a SECURITY DEFINER function (any schema);
- create, change or drop a `cron.job` entry;
- deploy, replace or delete a Supabase Edge Function (either Supabase project).

R2. After the action, edit the matching table in this file (section 4, 5 or 6) in the same pull request or the next one, so that the tables stay equal to the live database. A table that differs from the live database is a defect of the last person who made a change.

> [removed from the public copy: see the private KT folder]

R4. Schemas each product may create objects in (proposed by the PM under PMD-18; the owner can override by saying so in chat):

| Schema in verdian-ai | PROJEXA may create objects | DPDP may create objects | VERIDIAN AI-OS may create objects |
|---|---|---|---|
| `compliance` | YES (construction_* tables and PROJEXA proxy support) | NO | YES |
| `platform` | ONLY objects listed in section 3 as PROJEXA-owned (user_ai_links per PMD-16, sumeet_requirements register columns per OQ-21, and `platform.rpc_resolve_ai_link_scoped`, the resolver of user_ai_links rows, added 2026-09-25 by migration 0614 with EXECUTE for `app_runtime` only; `platform.projexa_gateway_settings` (U-25, the gateway switch, added 2026-09-25 by migration 0618: row-level security forced, no policy, no grant to `app_runtime`, `anon` or `authenticated`, SELECT for `service_role` only) and, planned under U-46, the five `platform.ai_work_link_*` tables named in ACTIVE-CLAIMS) | NO | YES |
| `dpdp` | NO | YES | NO |
| `public` | ONLY `projexa_timer_*` and `projexa_read_*` functions, granted to `service_role` alone (PMD-12 and PMD-01; the Edge Functions reach the database through PostgREST, which exposes only `public`) | YES (dpdp_* RPCs) | NO |

R5. A PROJEXA SECURITY DEFINER function is never granted to `anon` or `authenticated`. PROJEXA has 4 such functions since 2026-09-25: `public.projexa_timer_check_bearer`, `public.projexa_timer_exchange_plan`, `public.projexa_timer_apply_exchange_rates` (migration 0615, U-21), all `service_role` only (guard query G-5 returns 0), and `platform.rpc_resolve_ai_link_scoped` (migration 0614, U-18b), executable by `app_runtime` alone exactly like the VERIDIAN resolver `platform.rpc_resolve_ai_link_token` it sits beside (guard query G-3 returns 0).

R6. Vercel is locked (PMD-11). No deploy, unpause, setting change, env change, DNS change, recharge or spend increase is made by any agent. Only the owner does these.

## 3. Shared resources: owner product and who may change

| # | Resource | What it is (evidence) | Owner product | Who may change it | Rule that applies |
|---|---|---|---|---|---|
| 1 | Repo `FChecklist/compliance-tracker` | Public repo (A07 s5). Branch `main` protected: pull request required, 10 required checks (Lint, Type Check, Build, Unit Tests, Migration Number Collision Check, Migration Integrity Check (AR-12), Governance YAML Parse Check, Migration Schema Drift Check, Screen Definition Label Check, Graph Drift Check), strict, 0 approvals, enforce_admins true, no force push (A07 s3). | Shared: PROJEXA, DPDP, VERIDIAN AI-OS | Any agent through a pull request that is green on a head containing current main | R1 to R3; claim in ACTIVE-CLAIMS before work (AGENTS.md rule 11) |
| 2 | Repo `FChecklist/projexa` | Separate repo, PROJEXA UI. Required checks: Lint, Type Check, Test, Build, Secret Scanning (A07 s3). | PROJEXA | PROJEXA sessions | Own repo; still R1 for Supabase objects |
| 3 | Supabase project verdian-ai `pcrjmlpuqsbocqfwoxod`, region ap-south-1, Postgres 17, created 2026-06-24 (DTD s4) | Shared database. Schemas: `compliance` (523 tables by relkind r/p on 2026-09-25 per A09 s5; ADD-A6 says 526, basis differs), `platform` (93 per A09; ADD-A6 says 111), `dpdp` (62 per A09; ADD-A6 says 56), `public` (only `dpdp_*` functions are exposed to anon or authenticated per ADD-A5 and A09 s4). 1,290 policies, 30 `construction_*` tables with RLS on and 60 policies for roles `app_runtime` and `service_role` only (A09 s3c). | Per schema: `compliance` shared (construction_* = PROJEXA); `platform` VERIDIAN AI-OS with the PROJEXA objects listed in R4; `dpdp` and `public` DPDP | See R4 | R1, R2, R4 |
| 4 | Supabase project PROJEXA `evpckeuxgvahguwsaeul`, region ap-south-1, Postgres 17, created 2026-07-08 (DTD s4) | PROJEXA's own auth and app data. 22 tables in `public` (memberships, organizations, veridian_credentials, profiles and 18 more; projexa `src/lib/db/schema.ts` declares 22 pgTable, PROJEXA_ROUTE_SITEMAP line 214). Its own `auth.users` = 114 (0 of them exist in verdian-ai `auth.users`), `public.memberships` = 110, `public.veridian_credentials` = 14, `compliance` schema tables = 0 (A09 s3a). Its Auth issues ES256 JWTs with a published key set (A09 s3a). | PROJEXA | PROJEXA sessions | R1 (extensions and Edge Functions on this project too) |
| 5 | Postgres extensions | See section 4. | Shared (see section 4 per extension) | Whoever files a claim first | R1 |
| 6 | Supabase Edge Functions | See section 6. | Per function, section 6 | Owner product of that function | R1, R3 |
| 7 | Supabase Vault (`vault.secrets` on verdian-ai) | 2 secrets by name: `dpdp_timer_secret`, `dpdp_timer_url`, both created 2026-09-22 09:43:14 UTC. PROJEXA added `projexa_timer_url` and `projexa_timer_secret` on 2026-09-25 10:55:39 UTC (U-21; the secret value was generated inside the database and has never been read out). 4 secrets in total. Values are never printed or copied into any document. | DPDP (`dpdp_timer_*`); PROJEXA (`projexa_timer_*`) | DPDP; PROJEXA for its own two | R1; PROJEXA adds a secret only through a claim |
| 8 | Vercel team `team_Iqx3zyb7sDdsdzcNskCFFsHD`, projects `veridian-compliance-ai` and `projexa` | Both projects live=false, latest production deployment BLOCKED (A08_billing_notes.md). Cost ceiling: USD 20 per month (PROJEXA-COST-001; PMD-13 measures it on gross charges). Billing 2026-08-26 to 2026-09-25 = USD 29.2436; run rate USD 1.2903 per day (A08_billing_notes.md). Speed Insights and Web Analytics disabled on both projects since 2026-09-24 04:50 UTC. | Shared by all three tracks; ceiling set by the owner | Owner only (recharge, unpause, settings). PMD-11 and R6 | R6 |
| 9 | The 8 GB laptop | Development machine, about 1.8 GB free RAM on 2026-09-25 (task statement). Policy PMD-14: warn at 1.5 GB free, hard stop for new bun or agent bursts at 1.0 GB, one bun process at a time, typecheck and build only in CI, at most 12 concurrent agents. | Shared | Any local session, inside PMD-14 | PMD-14 |
| 10 | GitHub Actions in compliance-tracker | 14 workflow files (A07 s3). Includes the scheduled `domain-drift-check` (every 15 minutes). | Shared; drift check is VERIDIAN AI-OS | Any agent through a pull request | R1 for anything that touches Supabase objects |

## 4. Postgres extensions (LIVE: `select extname, extversion from pg_extension` on each project, 2026-09-25)

### 4a. verdian-ai `pcrjmlpuqsbocqfwoxod` - 13 installed

| extension | version | schema | owner product (proposed) | evidence for the owner |
|---|---|---|---|---|
| pg_cron | 1.6.4 | pg_catalog | Shared; used today only by DPDP jobs; PROJEXA's first job is planned here (PMD-12) | A07 s6: 2 active cron.job rows, both DPDP |
| pg_net | 0.20.3 | extensions | Shared; used today only by DPDP jobs; installed by the DPDP track between 22 and 25 September (ADD-A6) | A09 s2: cron jobs call `net.http_post` |
| supabase_vault | 0.3.1 | vault | DPDP (both existing secrets) | A09 s2 |
| vector | 0.8.0 | extensions | VERIDIAN AI-OS (embeddings). Installer UNVERIFIED | DTD s4: repo file supabase/migrations/create_pgvector.sql |
| pgaudit | 17.1 | public | UNVERIFIED (platform default or a track's choice). Flagged by the Supabase advisor as an extension in `public` (A09 s4) | LIVE list |
| hstore | 1.8 | public | UNVERIFIED. Flagged by the same advisor (A09 s4) | LIVE list |
| pg_stat_statements | 1.11 | extensions | Supabase platform default, no product | LIVE list |
| pgcrypto | 1.3 | extensions | Supabase platform default, no product | LIVE list |
| uuid-ossp | 1.1 | extensions | Supabase platform default, no product | LIVE list |
| pg_trgm | 1.6 | extensions | UNVERIFIED | LIVE list |
| hypopg | 1.4.1 | extensions | UNVERIFIED (Supabase advisor tooling) | LIVE list |
| index_advisor | 0.2.0 | extensions | UNVERIFIED (Supabase advisor tooling) | LIVE list |
| plpgsql | 1.0 | pg_catalog | PostgreSQL built-in | LIVE list |

Available but not installed on verdian-ai (DTD s4): http, pgmq, pgsodium.

### 4b. PROJEXA `evpckeuxgvahguwsaeul` - 6 installed

| extension | version | schema | owner product (proposed) |
|---|---|---|---|
| supabase_vault | 0.3.1 | vault | PROJEXA |
| pgaudit | 17.1 | public | UNVERIFIED |
| pg_stat_statements | 1.11 | extensions | Supabase platform default |
| pgcrypto | 1.3 | extensions | Supabase platform default |
| uuid-ossp | 1.1 | extensions | Supabase platform default |
| plpgsql | 1.0 | pg_catalog | PostgreSQL built-in |

`pg_cron` 1.6.4, `pg_net` 0.20.3 and `vector` 0.8.0 are available but NOT installed on the PROJEXA project; the schema `cron` does not exist there (A07 s6, DTD s4). Correction: DTD s4 says "only supabase_vault installed" for this project; the live list today shows 6 installed extensions, so that sentence of DTD is stale. Installing `pg_cron` or `pg_net` on the PROJEXA project needs a claim first (R1; test E-16). PMD-12 puts PROJEXA's cron on verdian-ai instead.

## 5. cron.job entries (verdian-ai; `select jobid, jobname, schedule, active from cron.job`; source A09 s2 and A07 s6, 2026-09-25)

Exact count today: 3 (2 DPDP, 1 PROJEXA; the PROJEXA job was created 2026-09-25 by migration 0615). The PROJEXA project has no `cron` schema, so 0 jobs there.

| jobid | jobname | schedule (UTC) | active | owner product | what it does | runs recorded in cron.job_run_details | status |
|---|---|---|---|---|---|---|---|
| 1 | dpdp-monday-digest | `30 0 * * 1` (Mondays) | true | DPDP | `net.http_post` with body `{"job":"monday"}`, timeout 300000 ms, url and bearer read from Vault (`dpdp_timer_url`, `dpdp_timer_secret`) | 0. Created 2026-09-22 09:43 UTC, after that Monday's 00:30 slot; first scheduled run is 2026-09-28 00:30 UTC | UNPROVEN (never ran) |
| 2 | dpdp-legal-clocks | `30 3 * * *` (daily) | true | DPDP | `net.http_post` with body `{"job":"legal_clocks"}`, timeout 300000 ms, same Vault url and bearer | 3 rows (runid 1, 2, 3 at 2026-09-23, 09-24, 09-25 03:30:00 UTC), all `succeeded`, return_message `1 row`. The newest HTTP result kept by pg_net: id 7, 2026-09-25 03:30:00 UTC, status_code 200, timed_out false | PROVEN (3 of 3 runs, HTTP 200) |
| 4 | projexa-exchange-rate-refresh | `30 9 * * *` (daily, the slot of the Vercel cron it replaces) | true | PROJEXA | `net.http_post` to Edge Function `projexa-timer` with body `{"job":"exchange_rate_refresh"}`, timeout 300000 ms, url and bearer read from Vault (`projexa_timer_url`, `projexa_timer_secret`); the function fetches open.er-api.com once per base currency and writes both directions per org through `projexa_timer_apply_exchange_rates` (same rows as `refreshLiveExchangeRatesForAllOrgs`) | 0 scheduled runs (first is 2026-09-26 09:30 UTC). One manual run of the same command on 2026-09-25 11:03 UTC: `net._http_response` id 9, status_code 200, 3 orgs refreshed, 8 skipped, 0 failed, 6 live rows written (a dry run, id 8, wrote none) | UNPROVEN on the schedule; PROVEN by hand (HTTP 200, rows written) |
| (planned) | ai-work-link-call-retention | `10 4 * * *` (daily 04:10, outside DPDP's 00:30 and 03:30 minutes) | not created yet | PROJEXA | `select public.ai_work_link_call_retention()` as postgres: creates next month's partition of platform.ai_work_link_call and drops partitions older than 90 days (spec section 10.10) | 0 (claimed 2026-09-25, U-46) | PLANNED (claim on main; row updated when created) |

Notes (A09 s2):
- `succeeded` with `1 row` proves only that `net.http_post` queued a request. The HTTP outcome is proven by `net._http_response` (pg_net keeps about 6 hours) and by the Edge log line at 2026-09-25T03:30:03Z (POST `/functions/v1/dpdp-monday-email`, user agent `pg_net/0.20.3`, status 200, 2672 ms).
- Both jobs call the same Edge Function `dpdp-monday-email` (inferred from the logs; the Vault value was not read).
- The reference pattern for a PROJEXA job (E-03, E-04) is `dpdp-legal-clocks`, not `dpdp-monday-digest`.
- The 10 prepared PG_CRON replacement files under `supabase/prepared/cost001/` are NOT applied: `compliance.cron_*` functions = 0 (A07 s6).
- Addendum A0 said "2 jobs running". That overstates it: 1 of 2 has run (A09 verdict PARTIAL).

## 6. Edge Functions (both projects; `list_edge_functions` and Edge logs, 7-day window 2026-09-18 12:00 UTC to 2026-09-25 about 12:00 UTC; source A09 s1 and DTD s4)

| slug | project | status | version | [removed from the public copy: see the private KT folder] | last updated (UTC) | invocations in 7 days | source in compliance-tracker origin/main | owner product | note |
|---|---|---|---|---|---|---|---|---|---|
| dpdp-ai-link | verdian-ai | ACTIVE | 3 | false | 2026-09-22 12:24 | about 45 (curl smoke tests 200/201/400/403/404; scanners and browsers 401/404) | YES (supabase/functions/dpdp-ai-link, 8 files) | DPDP | Reference implementation of an AI link (see section 8, item 7) |
| dpdp-monday-email | verdian-ai | ACTIVE | 4 | false | 2026-09-22 12:31 | 8 by the A09 summary: 7 from `pg_net/0.20.3` with status 200, 1 curl with status 401. The per-window rows in A09 add up to 6 pg_net calls (4 + 1 + 1), so the 7 versus 6 difference is UNVERIFIED | YES (supabase/functions/dpdp-monday-email, 3 files) | DPDP | Target of both cron jobs; also POSTs api.resend.com from Deno (EDGE_CANDIDATES.csv row for dpdp-monday-email index.ts:124-131) |
| [removed from the public copy: see the private KT folder] | verdian-ai | ACTIVE | 9 | false | 2026-06-29 17:21 | 0 | NO | VERIDIAN AI-OS (PMD-18) | See finding F-1 |
| orchestrator | verdian-ai | ACTIVE | 9 | false | 2026-06-29 17:22 | 0 | NO | VERIDIAN AI-OS (PMD-18) | Code not read by A09 (out of its scope); content UNVERIFIED |
| mint-session-r39ct | verdian-ai | ACTIVE | 3 | true | 2026-09-08 17:49 | 0 | NO | VERIDIAN AI-OS (PMD-18) | Test-only session mint; returns 503 unless MINT_SECRET_CT and MINTABLE_EMAILS env are set; uses the service role to mint a magic link; not usable as a PROJEXA identity bridge (A09 s1a) |
| mint-session-r33 | PROJEXA | ACTIVE | 3 | true | 2026-09-08 17:48 | UNVERIFIED (not measured on this project). Indirect sign: 208 `auth/v1/admin/generate_link` calls on 2026-09-21 attributed to end-to-end test sessions (A09 s6) | NO (not in compliance-tracker; projexa repo UNVERIFIED) | PROJEXA test tooling (PM proposal, no PMD row) | Test and demo tooling |
| rotate-demo-password-r38 | PROJEXA | ACTIVE | 3 | true | 2026-08-24 19:44 | UNVERIFIED (not measured) | NO (same) | PROJEXA test tooling (PM proposal, no PMD row) | Test and demo tooling |

| projexa-timer | verdian-ai | ACTIVE | 1 | false | 2026-09-25 11:02 | 2 (both from pg_net by hand, 200) | YES (supabase/functions/projexa-timer, 4 files) | PROJEXA | Target of the PROJEXA cron job; bearer checked through public.projexa_timer_check_bearer (Vault) like dpdp-monday-email; fetches open.er-api.com from Deno |
| projexa-read | verdian-ai | ACTIVE | 1 | false | 2026-09-25 12:30 | 0 real callers (smoke calls only: no token 401, malformed token 401, forged HS256 401, forged ES256 signed by a foreign key 401, preflight from projexa-ai.com 204) | YES (supabase/functions/projexa-read, 3 files) | PROJEXA | The identity gateway (PMD-01): verifies a PROJEXA ES256 access token against the PROJEXA key set (no signing secret stored), maps it to a linked compliance.users row, and returns that organisation's rows through service_role-only `public.projexa_read_*` functions (migration 0618). The switch platform.projexa_gateway_settings.enabled is OFF, so a verified caller gets 503 until a reviewed migration turns it on; claimed 2026-09-25 (U-25) |
| (planned) ai-work-link | verdian-ai | not deployed yet | - | false | - | - | will be `supabase/functions/ai-work-link` | PROJEXA | The per-user, per-project AI work link endpoint (Markdown manual, OpenAPI, MCP, REST); the link token is the credential; no internal-AI path; claimed 2026-09-25 (U-46) |
| (planned) ai-work-link-exec | verdian-ai | not deployed yet | - | false | - | - | will be `supabase/functions/ai-work-link-exec` | PROJEXA | Executes link reads and writes (spec option B, the same TypeScript source as the pipeline); no call to any Vercel route; claimed 2026-09-25 (U-46) |

Totals: 7 Edge Functions on verdian-ai (2 DPDP with traffic, 3 VERIDIAN AI-OS with 0 traffic in 7 days, 2 PROJEXA: projexa-timer and projexa-read, both deployed 2026-09-25) and 2 on PROJEXA's own project (test tooling). PROJEXA has 2 runtime Edge Functions today (the gateway is deployed with its switch off). Each PROJEXA function needed a claim first (R1). Addendum A1 said "5 running"; A09 shows ACTIVE means deployed, and 3 of 5 had 0 invocations in 7 days.

## 7. SECURITY DEFINER exposure (PROJEXA guard)

| id | query (read-only) | expected result today | meaning |
|---|---|---|---|
| G-1 | Supabase MCP `get_advisors` type security on verdian-ai | 7 anon-callable and 32 authenticated-callable SECURITY DEFINER functions, all in schema `public` (A09 s4) | Advisor count, all `dpdp_*` or extension internals |
| G-2 | Addendum A5 count of publicly callable SECURITY DEFINER functions | 30 (5 anon, 25 authenticated), all `dpdp_*`; 2 more hits are `pgaudit_ddl_command_end` and `pgaudit_sql_drop` (extension internals). The advisor count in G-1 (7 and 32) differs from this count; the reason is UNVERIFIED | Both counts show 0 PROJEXA functions |
| G-3 | Live check of 2026-09-25 (task statement): SECURITY DEFINER functions in schemas `platform` and `compliance` executable by `anon` or `authenticated` | 0 | The PROJEXA guard (PMD-09 replaces tests 1.5 and 2.7 with this) |
| G-4 | Same query re-run after any change | 0 | Any non-zero result is a defect of the last change |
| G-5 | Functions in schema `public` whose name starts `projexa_` that `anon` or `authenticated` may execute: `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\_%' and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))` | 0 (live 2026-09-25 after 0615) | The 3 `projexa_timer_*` functions are `service_role` only |

## 8. Findings for other tracks (PROJEXA reports them and does not fix them; PMD-18)

| id | finding | evidence | goes to |
|---|---|---|---|
| F-1 | [removed from the public copy: see the private KT folder] | A09 s1a | VERIDIAN AI-OS track |
| F-2 | [removed from the public copy: see the private KT folder] | A09 s1a, DTD s4 | VERIDIAN AI-OS track |
| F-3 | [removed from the public copy: see the private KT folder] | DTD s4 | VERIDIAN AI-OS track |
| F-4 | DPDP question Q-D1: are the 5 anon-callable functions (`dpdp_apply_email_action`, `dpdp_parent_consent`, `dpdp_parent_consent_preview`, `dpdp_preview_email_action`, `dpdp_unsubscribe`) intentionally public, and is each safe against a guessed or replayed argument? Several are what a public consent link needs, so they are plausibly correct by design. | ADD-A5, handoff Q-D1 | DPDP track |
| F-5 | DPDP question Q-D2: should `dpdp_create_client_org` and `dpdp_my_clients` be callable by any signed-in user of either product, given both share this database? DPDP RPCs identify the caller by the JWT email, which works because DPDP users sign in to verdian-ai's own Auth. | ADD-A5, A09 s3c, handoff Q-D2 | DPDP track |
| F-6 | Supabase advisor items on verdian-ai: `dpdp.partner_sale` has RLS on and no policy; leaked-password protection is off; OTP expiry is over 1 hour; `pgaudit` and `hstore` sit in schema `public`. None is PROJEXA-specific. | A09 s4 | DPDP track (partner_sale); VERIDIAN AI-OS track (Auth settings, extensions) |
| F-7 | `scripts/check-register-consistency.mjs` (CI job Register Consistency Check, not required) fails with PGRST106 on every run, 60 to 120 runs per day, because it reads schema `platform` through PostgREST and `platform` is not exposed. A check that cannot pass. | A09 s4 and s6 | VERIDIAN AI-OS track (owner of the check); PROJEXA item U-22 depends on the register it reads |
| F-8 | `AGENTS.md` rule 9 and `CLAUDE.md` name `scripts/check-guardrail-presence.mjs` and a CI job "Guardrail Presence Check". The file does not exist on origin/main and no such required check exists. | A07 s1 | VERIDIAN AI-OS track |
| F-9 | A comment in compliance-tracker `src/lib/supabase/auth-guard.ts` (near line 540) says nothing populates `users.auth_user_id` with a PROJEXA Supabase id. It is stale: 92 of 114 PROJEXA auth ids are linked, across 8 compliance orgs. | A09 s3b | VERIDIAN AI-OS track (code owner); PROJEXA will update it inside item U-25 |
| F-10 | Scheduled workflows failing: `domain-drift-check` (last three runs failed 2026-09-24 20:54Z, 23:38Z, 2026-09-25 01:53Z), projexa `email-digest-poll` (35 of 35 recorded runs failed, latest 2026-09-25T01:56Z), projexa `claude-nightly-maintenance` (last three runs failed, 22 to 24 September). The E2E Env-1 cross-repo job failed on the last three runs; it is not a required check. | A07 s5 and s3 | domain-drift-check: VERIDIAN AI-OS track; the other two: PROJEXA (question OQ-27) |
| F-11 | `R72_DEPLOY_RITUAL.md` and `VERCEL_DEPLOY_OWNER_GUIDE.md` are stale: they still describe `git.deploymentEnabled.main=false`, "This repo has no CI" and the OWNER_DEPLOY_APPROVAL variable, which vercel.json no longer reads. | DTD s3 | VERIDIAN AI-OS track |
| F-12 | [removed from the public copy: see the private KT folder] | OWNER_REQUIREMENT_AI_WORK_LINK_2026-09-25.md; A09 s1a | Reference for PROJEXA (items U-44 to U-46); DPDP track owns the objects |
| F-13 | PROJEXA reaches compliance-tracker only with an org API key plus an unverified `X-Acting-User` header; the user's own JWT never reaches compliance-tracker. The 22 unlinked PROJEXA users are question OQ-15. | A09 s3b | PROJEXA (Phase 2 per-request actor) |

## 9. Checks for tests E-16 and E-17 (all read-only; exit 0 means pass)

E-16 (file exists and names each shared resource with owner product, schema rule and the claim rule):
1. `test -f ai-os/SHARED_BOUNDARY.md` exits 0.
2. `grep -c "ACTIVE-CLAIMS" ai-os/SHARED_BOUNDARY.md` prints 1 or more.
3. For each of these ten resource words, `grep -c` prints 1 or more: `compliance-tracker`, `verdian-ai`, `evpckeuxgvahguwsaeul`, `pg_cron`, `pg_net`, `pgaudit`, `supabase_vault`, `Edge Function`, `Vercel`, `laptop`.

E-17 (every live cron.job entry and Edge Function is listed with an owner):
1. Live cron list: `select jobname from cron.job order by 1` on verdian-ai returns exactly `dpdp-legal-clocks` and `dpdp-monday-digest` today. Each name must appear in this file (`grep -c "<jobname>" ai-os/SHARED_BOUNDARY.md` prints 1 or more).
> [removed from the public copy: see the private KT folder]
3. Live extension list: `select extname from pg_extension` returns 13 names on verdian-ai and 6 on PROJEXA today. Each name must appear in section 4.
4. Any difference between the live lists and this file is a failure of E-17 and a defect of the last change (R2).

## 10. Change log

- 2026-09-25: file created for PROJEXA-BUILD-001 (E-16, E-17). Extension lists queried live on both projects (read-only SELECT). Everything else from the evidence files named at the top; no secret value read or printed.
