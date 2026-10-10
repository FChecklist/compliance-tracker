# HANDOUT · 2026-09-22 · PROJEXA-COST-001 — Steps 2, 3, 5 (+ Step 6 baseline)

**Written by:** the PROJEXA PROJECT MANAGER session (Claude Code, laptop), for Rajat Agarwal.
**Work order:** WORK_ORDER_PROJEXA-COST-001_v2_2026-09-22.md (KT rank 0.27, Drive `1kAsuZ0Dn3_Oxa0eaV-G0zdhsC6f3HFBN`).
**Repos at:** compliance-tracker `main` = `995db84a` → `85f14423` (claim PR #1801 merged 06:20 UTC); projexa `main` = `e88b53e1`.
**Nothing was deployed, no build was triggered, no Vercel setting was changed, no cron was moved, no DNS was touched.**

## 0 · Three facts that change the plan (all live-verified by the PM, not taken from any agent)

1. **Every cross-tenant cron has been a silent no-op in production since 23 Aug 2026.** The raw `db` client (`DATABASE_URL`) connects as `app_runtime`, which has `rolbypassrls = false`; every `compliance.*` table carries an `org_id = compliance.current_org_id()` policy and a cron sets no org, so it reads zero rows. Evidence: `compliance.monitor_execution_log` — last run that saw orgs `2026-08-20T09:23Z` ("across 3 org(s), 270 skipped"), first "across 0 org(s)" `2026-08-23T09:15Z`, every run since (incl. 17–19 Sep while unpaused) = 0 of 278 orgs; `compliance.loop_executions` last row `2026-08-21`; Vercel error group `/api/internal/loops/run` → `new row violates row-level security policy for table "loop_executions"` (42501); `pg_stat_activity` 16 `app_runtime` app sessions, 0 `postgres`; `platform.claude_log` 203 (R74 Phase 0, 04 Sep) records the rebuilt `DATABASE_URL` "connected as `app_runtime`". The code's own comments (`tenant-scoped.ts:7-9`) still say `DATABASE_URL` is the `postgres` role — that comment is stale. **Consequence for Step 2: "MOVE to pg_cron (runs as `postgres`, BYPASSRLS)" re-enables behaviour that has been off for a month — writes that have never fired (report-schedule notifications, exchange rates, the orchestra purge, stuck-deal digests). Each such move needs your sign-off as a switch-on, not a relocation.** What changed on 21–23 Aug: could not determine.
2. **Vercel Pro includes a $20/month usage credit**, and the FOCUS export is gross (781 records for 19 Sep PT, all `ChargeCategory: Usage`, no credit rows). So the invoice is `Pro $20 + add-ons + max(0, usage − $20)`; last 7 days' usage was $2.42 (builds $2.31, serving $0.06, Web Analytics events $0.001) — inside the credit. **The bill today is $20 + Speed Insights Plus $20 = $40.03/month; the moment Speed Insights Plus is off it is $20.00**, and it stays there until real traffic exceeds $20 of usage in a month. My first report's "$46–56 projected" double-counted usage that the credit absorbs. Confirm the credit line on the next invoice (Vercel → Billing → Invoices); the FOCUS API cannot show it.
3. **A $1 Spend Management cap with "Pause all projects" is already ON** (R87, 13 Sep — `ai-os/boss/ACTIVE-CLAIMS.yaml` "left ON per G87-05"). My first report's "configured unknown" was wrong. It is very likely what re-paused both projects at `2026-09-19T19:41Z` (35 ms apart) after $2.3 of builds — but the API exposes no pause reason, so if you paused manually that evening, tell me and I'll correct this.

Also verified: **Speed Insights Plus is still ON on both projects** ($10/project/month → the $0.6452/day line), enabled by a Claude session via the Vercel CLI at 2026-09-17 05:06 UTC (both projects, same minute as Web Analytics). **Web Analytics is enabled AND billing** ("Web Analytics Events" $0.0013 over 7 days).

## 1 · Method

One cloud research agent classified the 30 crons; six independent cloud verifiers then tried to refute every verdict — two lenses per cron (code-truth: read the route and services; operational-risk: consumers, duplicates, RLS/role, secrets, live row counts) — plus one completeness critic and one deployment-history agent. Where the lenses disagreed I settled it with a read-only query against the live database or the Vercel API myself (§0 above, and each CONTESTED row below). Nothing below is marked CONFIRMED unless both lenses held.

## 2 · The 30 crons — verdict table

Verdicts: **MOVE-SQL** = Supabase `pg_cron` + SQL function (Bucket 3, $0). **MOVE-GHA** = a scheduled GitHub Actions job running the existing TypeScript against Supabase (needs the app's LLM/prompt/policy stack; $0 — repos are public). **KEEP** = stays a Vercel cron. **KILL** = remove the `vercel.json` line (route files stay; deleting a route file trips `authz-gap-inventory.test.ts`'s frozen counts, so file deletion is a separate hygiene PR).

| # | path (`/api/internal/…/run`) | schedule | what it does | inv/mo | outside Postgres | verdict | status | what you decide / must know |
|---|---|---|---|---|---|---|---|---|
| 1 | fm-ppm/generate-occurrences | daily 02:00 | next `fm_ppm_occurrences` for active PPM schedules, marks overdue | 30 | none | MOVE-SQL | CONFIRMED | 0 active schedules today; `UNIQUE(schedule_id,due_date)` exists → one atomic `INSERT … ON CONFLICT` |
| 2 | loops | daily 03:00 | 11 loop audits + cache purge + Sheets projection → `loop_executions` | 30 | 1 LLM call/run, embeddings, Google Sheets | MOVE-GHA | CONFIRMED | **500s every run today** (RLS on insert since 23 Aug; separately the cost-anomaly loop has no `loop_definitions` row so its FK insert can never succeed) — real bug, not cost |
| 3 | instruction-audit | daily 04:00 | LLM-judges overdue instruction commitments | 30 | LLM (org BYO or platform keys) | MOVE-GHA | CONFIRMED | 0 commitments exist; add a LIMIT; `AI_CONFIG_ENCRYPTION_KEY` is in no GitHub secret |
| 4 | metric-alerts | daily 05:00 | 6 checks → notifications, ticket escalations, task priority | 30 | none | MOVE-SQL (as 6 jobs) | CONFIRMED w/ decision | ticket-SLA check re-notifies daily with no dedup (live: 132 rows = 2 tickets × 33 days to 3 users) — keep or dedup? |
| 5 | the-firm/deadline-digest | daily 06:00 | counts deadlines, `console.log` only, delivery "deliberately not wired up" | 30 | none | KILL | CONFIRMED | nothing reads it |
| 6 | secrets-audit | daily 07:00 | checks 9 env vars exist in the running Vercel process | 30 | none | **KEEP** | CONFIRMED | the one job whose purpose is Vercel's own env; ~free. Latent bug: `PROVISIONING_DATABASE_URL`/`SUPABASE_DB_PASSWORD` are either/or but checked independently |
| 7 | the-firm/recur-engagements | daily 07:30 | clones due recurring engagements | 30 | none | MOVE-SQL | CONFIRMED w/ decision | JS date math overflows month-end (31 Jan+1mo → 3 Mar); Postgres clamps (28 Feb). Pick one; 0 recurring engagements today |
| 8 | audit-cadence | daily 08:15 | flags failed activity_log rows for re-audit | 30 | none | MOVE-SQL | CONFIRMED w/ decision | bug: scans a **3-hour** window on a **daily** cadence (misses 21 h/day) — fix the window when porting? |
| 9 | ai-performance-report | daily 01:00 | aggregates into JSON, "no persistence layer" | 30 | none | KILL | CONFIRMED | listed in the Reports catalog as a cron-only entry — remove that entry too |
| 10 | task-nudge-digest | daily 08:00 | one notification per user with overdue/due-soon tasks | 30 | none | MOVE-SQL **or KILL** | CONFIRMED w/ decision | duplicates #4's task-overdue alert (same type, same day, no dedup → N+1 rows/user/day). Keep one |
| 11 | escalations-report | daily 01:15 | regex-parses chat rows into counts, returned only | 30 | none | KILL | CONFIRMED | generator survives only if #15 stays in TypeScript |
| 12 | recommendations-report | daily 01:30 | groups loop_improvements, returned only | 30 | none | KILL | CONFIRMED | as #11 |
| 13 | risk-trends-report | daily 01:45 | buckets activity_log risk by day, returned only | 30 | none | KILL | CONFIRMED | as #11 |
| 14 | dispatch-completion-monitor | daily 08:30 | per org, stuck dispatches → LLM classify → escalate | 30 | LLM only when stuck rows exist | MOVE-GHA | CONFIRMED w/ prereq | needs a bypass-capable org list (SECURITY DEFINER fn); LLM calls per stuck row are **uncapped** — add a cap |
| 15 | report-schedules | daily 08:45 | evaluates user report schedules, attaches #11–13 bodies, inserts notifications | 30 | none | MOVE (pg_cron hourly for due-ness) | **CONTESTED** | real UI exists (ReportScheduleDialog) so not KILL. Lens A: the 3 report bodies are ~250 lines of TS → GHA. Lens B: deliver body-less notices from SQL (code already tolerates it). Your call. Latent bug: only fires for `timesOfDay` in the 08:xx hour; docs claim hourly. 0 schedules exist |
| 16 | capability-audit | daily 09:00 | LLM audits due task capabilities via SECURITY DEFINER RPCs | 30 | LLM ×(2+N) per capability | MOVE-GHA | CONFIRMED (spend bound contested) | works under RLS by design; cap per run; 0 due today |
| 17 | exchange-rate-refresh | daily 09:30 | fetch open.er-api.com per base currency, upsert `erp_exchange_rates` | 30 | HTTP | MOVE-GHA **or Edge Function** (not pg_cron: `pg_net` is not installed and is async) | CONTESTED → resolved | **0 rows ever written** (RLS since the 3 multi-currency orgs were created); consumers are timing-insensitive; must replicate both-direction `1/r` `toFixed(10)` exactly |
| 18 | orchestra-log-purge | daily 09:45 | nulls payloads on `orchestra_executions` > 90 d | 30 | none | MOVE-SQL | CONFIRMED | has **never purged a row** (RLS); first candidates ~2 Oct; keep `input='{}'` not NULL |
| 19 | routing-accuracy-report | weekly | `console.warn` only; same function on demand at `/api/orchestra/routing-accuracy` | 4.3 | none | KILL | CONFIRMED | flag: that on-demand route also reads 0 rows today → reports a fake 100 % routing accuracy |
| 20 | ai-reduction-snapshot | monthly | one `INSERT … SELECT` snapshot | 1 | none | MOVE-SQL | CONFIRMED | 1 snapshot exists (1 Aug); 1 Sep missed |
| 21 | cost-anomalies | daily 09:15 | ratio check, returned only | 30 | none | KILL | CONFIRMED | not a duplicate of #2 after all (different windows) — but still unread |
| 22 | idle-ai-capacity | quarterly | unused model configs, returned only | 0.33 | none | KILL | CONFIRMED | 0 BYO configs exist |
| 23 | pipeline-stuck-deal-digest | daily 09:50 | deals stuck 30+ d → one notification per owner | 30 | none | MOVE-SQL + dedup | CONFIRMED w/ decision | dead since 21 Aug; live: 4 owned deals at 77 days → moving = 2 notifications/day/owner forever unless dedup'd |
| 24 | l2-phrase-promotion | daily 10:30 | clusters gap_log, LLM proposes phrase maps | 30 | LLM (OpenRouter) | MOVE-GHA | CONFIRMED | the only cron already RLS-safe (SECURITY DEFINER discovery); needs `AI_PROVIDER_PIPELINE_L2=openrouter` or it throws; 8 gap_log rows/30 d |
| 25 | role-quality-regression | daily 10:45 | LLM eval cases per AI role | 30 | LLM | **KILL** (was MOVE-GHA) | CONTESTED → resolved | 0 eval cases exist → skips before any LLM; its table's RLS also rejects the insert. Revive later with cases |
| 26 | crm-lead-scoring | daily 11:00 | LLM scores ≤20 leads per Sales org | 30 | LLM — **platform key pays** (0 BYO configs) | MOVE-GHA **only with opt-in + daily cap** | CONFIRMED w/ decision | dead since 21 Aug; live: 27 sales orgs, 318 eligible leads → day-1 318 LLM calls, ~37/day after. Do you want this on? |
| 27 | crm-lead-followup-alerts | daily 11:15 | overdue `next_action_date` → notifications | 30 | none | MOVE-SQL + dedup | CONFIRMED | 0 overdue now; daily re-notify by design |
| 28 | crm-data-integrity | weekly | orphan check, `console.warn` only | 4.3 | none | KILL | CONFIRMED | one-off SQL if ever wanted |
| 29 | crr-catchup-worker | **every 15 min** | re-drives stuck document ingestion (Storage → extract → chunk → embed) | **2,880** | Storage, pdf-parse, officecli binary, OpenRouter/Groq | scheduler → pg_cron; Node executor stays; **30 min or hourly** | see §3 | today all 2,880/month are RLS no-ops; a **1-hour SLO exists** (`platform.crr_spec` CRR-090) |
| 30 | projexa · email-digest-cadence | daily 08:00 UTC | claims due digest slots, builds via compliance-tracker API, sends via Resend | 30 | Resend, ~5 CT API calls/project | KILL the line; feature is unconfigured | CONTESTED → resolved | **nothing works today on either trigger**: the GitHub poller has no `PROJEXA_APP_URL`/`EMAIL_DIGEST_CRON_SECRET` (17/17 runs failed), projexa's Vercel prod has no `RESEND_API_KEY`, 0 schedules and 0 runs exist in its DB, and the daily 08:00 UTC slot only ever matched digests scheduled 13:30 IST |

**Totals (after verification): 18 MOVE (10 SQL · 7 GHA · 1 pg_cron-gated) · 1 KEEP · 11 KILL.** Invocations/month **3,640 → 30** (KEEP only) **+ #29's residual** (≈0 gated, 720 hourly, 1,440 at 30 min) **+ the 31st trigger** below if it is ever configured. Changes from the classifier's 19/1/10: #25 → KILL, #17 → GHA/Edge (no `pg_net`), #15 and #30 re-scoped as above.

## 3 · crr-catchup-worker (#29) — the owner's question

- **What it does:** every 15 min, `SELECT` up to 20 `compliance.source_object` rows still `PENDING/EXTRACTED/CHUNKED`, oldest first; download bytes from Storage; extract text (pdf-parse; docx/pptx via a vendored 35 MB `officecli-linux-x64`); chunk; embed (OpenRouter → Groq fallback); mark `EMBEDDED`, or `FAILED` + `crr_ingest_error`. Idempotent per chunk via `unique(source_object_id, seq)`; no row lock (an `EXTRACTING` status exists in the schema but is never set).
- **Does it poll?** Yes. The primary path is the upload route's `after()` hook, but for **orgs with no AI model configured and for image uploads the worker IS the primary path** (those rows stay PENDING on purpose). An `AFTER INSERT` trigger is explicitly forbidden by the spec (CRR-090 `where_not_to_do`: "Not a webhook fired by the upload"); Realtime would need a long-lived listener; the executor is Node-bound. So polling is genuinely required — for the *scheduler*, not for Vercel.
- **Is `*/15` justified?** No. The only requirement on record is CRR-090's closure proof: "zero rows in PENDING/EXTRACTED/CHUNKED **older than 1 hour**". With limit 20 and a 300 s run, the longest interval that still meets it is **30 minutes** (or **hourly with `?limit=100`**, accepting a 59-min worst case). Nothing in the product surfaces `extract_status`, so a document stuck for an hour is invisible to users either way.
- **Proposal (prepare only):** a `postgres`-owned `pg_cron` job every 30 min that counts stuck rows via a SECURITY DEFINER function (pattern already in the repo: `gap_log_orgs_with_recent_activity()`), and only if `> 0` calls the Vercel route once via `pg_net` (`timeout_milliseconds = 300000`, secret from Vault). Vercel invocations ≈ hours-with-a-stuck-row ≈ 0. **Prerequisites:** enable `pg_net` (your DDL), put `CRON_SECRET` in Vault, fix the RLS read (today even Vercel's own poll sees nothing). If you refuse `pg_net`: hourly GitHub runner with the binary and keys — see §5 for why GitHub runners are not yet trustworthy here.
- **Live now:** 1 source_object (EMBEDDED), 0 stuck, 0 ingest errors, `cron.job` empty.

## 4 · The 31st trigger nobody counted

`FChecklist/projexa/.github/workflows/email-digest-poll.yml` runs `*/15` and POSTs the **same** `/api/internal/email-digest-cadence/run` on projexa's Vercel URL — 2,880 Vercel invocations/month after unpause, outside `vercel.json`. Today it fails on every run (no `PROJEXA_APP_URL` variable, no `EMAIL_DIGEST_CRON_SECRET` secret), and GitHub only fires it ~6×/day anyway. When the digest is actually wanted, replace both triggers with one daily job; the 15-minute slot-matching window (`bucketMinutes`) then also needs a catch-up rule.

## 5 · Prerequisites before ANY cron moves (in order)

1. **Decide the `DATABASE_URL` role** (§0.1): restore a BYPASSRLS role as the code was designed for, or keep `app_runtime` and add SECURITY DEFINER read functions for every cross-org query. Until then every raw-`db` path — crons *and* on-demand admin reports — reads nothing.
2. **Approve each MOVE-SQL row as a switch-on** (#15, #17, #18, #23, #27 have never written a row; #4/#23/#27 need a dedup rule first).
3. **GitHub runner path (7 rows) needs a first proof of connectivity**: `db-migrate.yml` has 0/5 successful runs (password failure), no workflow references `CRON_SECRET`, `AI_CONFIG_ENCRYPTION_KEY` or `GOOGLE_SHEETS_*`, and this org's scheduled workflows are delayed hours at a time (`*/15` fires ~6×/day). Daily jobs are fine; sub-hourly ones are not.
4. **`pg_net`**: not installed (0.20.3 available). Needed only for #29's gate.
5. **Hygiene in the same PR**: remove the `vercel.json` lines only; update `SENTINEL.yaml:85`, `MODULE_MAP.md:263`, `CONFIGURATION.md:83/89`, the Reports catalog entries for #9/#11–13, and the `authz-gap-inventory.test.ts` exemption rows if any route file is ever deleted.

## 6 · Step 3 — builds

- **3.1 Are previews skipped by `ignoreCommand`? Yes — from the deployments list, not the config.** In the unpaused window (`2026-09-17 ~05:00Z` → `2026-09-19 19:41Z`, R87 branch-gate `ignoreCommand` in force) **37 of 37 non-`main` preview deployments (28 compliance-tracker, 9 projexa) were CANCELED**, each stamped `errorLink: …/projects#ignored-build-step` after 4–18 s, while `main` commits in the same minutes went READY (18) or ERROR (3); 3 docs-only `main` commits were CANCELED by the path filter. Zero non-main preview ever reached BUILDING. Docs add only that "canceled builds count towards deployment quotas and concurrent build slots" — not dollars.
- **What the pause is doing:** 835 deployments were created 8–22 Sep (compliance-tracker 587: `main` 78 / other 509; projexa 248: 45 / 203). Every one since the pause is BLOCKED before the ignore step runs — including my own claim-PR push (`dpl_46MoCWb5…`). **Actually built in the window: 25** (compliance-tracker 21 = 18 READY + 3 ERROR; projexa 4), costing $2.31. **7 of compliance-tracker's 21 were duplicate production builds of the same SHA 20–60 s apart** — a third of the build spend; cause not exposed by the API (worth one look before unpause).
- **3.2 Preview policy (proposal, prove-able):** the R87 `ignoreCommand` — skip unless `$VERCEL_GIT_COMMIT_REF` is literally `main` — plus a `preview/*` branch convention for the rare PR that needs one. Vercel offers no label/comment opt-in; the ignore step cannot see GitHub labels. This exact command already ran in production 15–20 Sep with the evidence above.
- **3.3 After go-live:** same command's path filter (`main` builds only when the diff touches application code, not `*.md`/`kt/**`/`ai-os/**`/`.github/**`). Both live in `vercel.json` history (commit `3d7ca54f`) and in `vercel-lockdown.test.ts`'s history; restoring them is the go-live branch NEXT-001 Step 6.1 asks for — **needs a claim amendment** (my claim excludes `vercel.json`), so not done.
- **3.4 GitHub Actions:** all 16 FChecklist repos are **public** (`FChecklist` is a User account, not an org) → "usage is free for … public repositories that use standard GitHub-hosted runners" → **$0**. September so far: compliance-tracker 2,505 runs / 11,402 wall-clock min (≈20,000 job-min est.; CI alone 10,695 min over 983 runs, 676 failures); projexa 507 runs / 1,010 min (≈1,780 job-min). Exact billable minutes need the `user` billing scope this token lacks (404 recorded). Larger runners would be charged even on public repos — none are used.

## 7 · Step 5 — spend cap, corrected

- **What the dashboard offers (docs, no API):** Team → Settings → Billing → Spend Management: a spend **amount** covering on-demand usage only ("does not include seats, integrations, or separate add-ons"), notifications at **50 / 75 / 100 %** (fixed), a webhook, and **"Pause Production Deployments"** (only production pauses; projects do not auto-unpause; checks run "every few minutes", so overshoot past the amount is possible). No documented minimum.
- **Already set:** $1 with pause ON (R87). At go-live, $1 pauses production on the first handful of builds if the cap counts gross usage (the 19 Sep timing suggests it does).
- **Recommendation (I disagree with $18/$25 as worded):** the cap cannot touch the $20 Pro fee or the Speed Insights Plus subscription, so "$25 hard cap" would never stop the $40 bill — only switching the add-on off does. Set the amount to **$5, pause ON** → alerts at $2.50/$3.75/$5, worst-case invoice ≈ $20 + $5 + add-ons; the alert fires at ~50× normal serving cost, which is exactly when a pause is the right reflex. If Vercel confirms the amount is measured *after* the $20 credit, $5 means "$25 of usage" — still fine.
- **Trade-off, stated plainly:** a pause on a live product with a paying customer is an outage. The 50 % alert is what should act; the pause is the last line. I agree with that framing.
- **Ten-second monthly check (delivered):** `node scripts/vercel-monthly-cost-check.mjs --days 30` → one line, e.g. `2026-09-20 PT  total=$1.2914  pro=$0.6452  speedInsightsPlus=$0.6452  webAnalyticsPlus=$0.0000  builds=$0.0000  serving=$0.0011  → projected/mo=$38.74 (target $20.00)  ⚠ OVER`, exit 1 when over. Real runs today matched the work order's Section A table to the cent. 15 network-free tests.

## 8 · Step 6 baseline (Vercel PT charge days, from the script, one call per day)

| Day (PT) | Total | Pro | Speed Insights Plus | Web Analytics | Build CPU | Serving | Other |
|---|---|---|---|---|---|---|---|
| 14 Sep | 0.6459 | 0.6452 | 0.0000 | 0.0000 | 0.0000 | 0.0007 | 0 |
| 15 Sep | 0.6457 | 0.6452 | 0.0000 | 0.0000 | 0.0000 | 0.0006 | 0 |
| 16 Sep | 1.9448 | 0.6452 | 1.2952 (0.65 one-off "Plus Events" on switch-on) | 0.0002 | 0.0000 | 0.0043 | 0 |
| 17 Sep | 2.5913 | 0.6452 | 0.6452 | 0.0009 | **1.2740** | 0.0259 | 0.0002 |
| 18 Sep | 2.1074 | 0.6452 | 0.6452 | 0.0001 | **0.7980** | 0.0189 | 0 |
| 19 Sep | 1.5368 | 0.6452 | 0.6452 | 0.0000 | 0.2380 | 0.0085 | 0 |
| 20 Sep | 1.2914 | 0.6452 | 0.6452 | 0.0000 | 0.0000 | 0.0011 | 0 |

7-day total $10.76; **invoice-basis projection today $40.03/month** (Pro + SI+; usage inside credit). Two days after Speed Insights Plus is off I re-pull one day and expect the SI+ line to read $0.0000 and the projection $20.00.

## 9 · Found along the way, outside this work order's scope (reported, not fixed)

1. `/api/internal/loops/run` 500s daily since 23 Aug (RLS) and its cost-anomaly loop can never persist (missing `loop_definitions` row for an FK).
2. `/api/orchestra/routing-accuracy` returns a fake 100 % (reads 0 rows under RLS).
3. `scripts/check-guardrail-presence.mjs` — the manifest AGENTS.md Rule 9 and CI's "Guardrail Presence Check" are built on — **does not exist in the tree**, and no such CI job appears on PR #1801's check list.
4. `domain-drift-check.yml` (`*/15`) fails on every run and nobody has looked (cause not investigated here).
5. Step 4 as worded ("browser → Supabase with RLS") is an auth + RLS re-platform, not a screen-by-screen port: 523 `compliance` tables all RLS with **3** `authenticated` policies and 3 `anon`; PROJEXA users authenticate on `evpckeuxgvahguwsaeul`, whose JWTs do not validate on `pcrjmlpuqsbocqfwoxod`; `src/proxy.ts` and `next.config.ts headers()` are on Next's unsupported list for `output: 'export'`. WO-DPDP-011's same-day note already chose Vite + Cloudflare Pages + SECURITY DEFINER RPCs for the DPDP app. Decide one direction for both products before Step 4 starts.
6. Supabase org is on **Pro ($25/month)** live (a repo doc still says Free) — the real floor is Vercel $20 + Supabase $25.
7. Section D check: no cross-user browser compute exists or was proposed anywhere in the 30 crons or the poller.

## 10 · Owner decisions (numbered so you can answer by number)

1. `DATABASE_URL` role: restore BYPASSRLS (as designed) or keep `app_runtime` + SECURITY DEFINER reads?
2. Approve the cron plan (§2) as the go-live pack, with the switch-on rows acknowledged?
3. #4/#10 — one overdue-task notifier or both; ticket-SLA dedup or daily re-notify?
4. #7 — month-end: clamp (Postgres) or overflow (today's JS)?
5. #8 — fix the 3-hour window to 24 h while porting?
6. #15 — body-less SQL notices, or keep the TS generators on a GitHub runner?
7. #23/#27 — dedup rule (e.g. skip while an unread digest exists)?
8. #26 — turn lead scoring on at platform-key cost (~37 LLM calls/day, 318 on day 1) with a daily cap, or leave off?
9. #29 — enable `pg_net` (+ `CRON_SECRET` in Vault) for the gated design, or accept an hourly GitHub runner?
10. Spend Management: $5 / pause ON (my recommendation) or your $18/$25?
11. Speed Insights Plus off on **both** projects; Web Analytics off too (it is billing)?
12. Did you pause both projects manually at 01:11 IST on 20 Sep, or was that the $1 cap?
13. Step 4 direction: Next.js static export on Vercel (COST-001 §4) vs Vite + Cloudflare Pages (DPDP-011) — one answer for both products.
14. Claim amendment to prepare the go-live `vercel.json` branch (NEXT-001 6.1 / COST-001 3.3)?

## REPORT

```
STEP REACHED: 1 (owner action pending) · 2 DONE (plan, prepare-only) · 3 DONE · 5 DONE (recommendation) · 4 not started (owner decision 13) · 6 baseline captured, re-measure after Step 1
PROJECTED MONTHLY VERCEL: $40.03 on invoice basis (Pro 20.00 + Speed Insights Plus 20.00; usage $2.42/7d sits inside the $20 credit)   (TARGET: $20.00 — reached the day SI+ is off)
SPEED INSIGHTS PLUS: on, both projects — evidence: FOCUS "Speed Insights Plus / Subscription Licenses / 0.645161" every PT day 16–20 Sep; project API speedInsights.enabledAt 2026-09-17T05:06Z (both)
VERCEL WEB ANALYTICS: enabled veridian-compliance-ai (hasData true) · enabled projexa · billing: "Web Analytics Events" $0.0013 / 7 days
CRONS: 30 total · 18 MOVE (10 SQL, 7 GHA, 1 gated) · 1 KEEP · 11 KILL · crr-catchup-worker verdict: */15 unjustified; 30 min (or hourly, limit 100) meets the real 1-hour SLO; scheduler → pg_cron, Node executor stays; today every poll is an RLS no-op
BUILD MINUTES THIS MONTH: $2.31 (all 17–19 Sep, 25 builds incl. 7 duplicates); 0 since the pause · GITHUB ACTIONS MINUTES: $0 (public); ct 11,402 wall / ≈20,000 job-min est.; projexa 1,010 / ≈1,780
SPEND CAP: configured YES — $1, pause ON (R87) · recommended alert $2.50/$3.75 · hard cap $5 (pause ON)
SCREENS ON STATIC + BROWSER-DIRECT: 0 of 0 · zero-invocation verified: none (Step 4 not started)
FREE RAM (lowest seen): 0.17 GB (reported to owner at the time; owner kept the DPDP session; heavy work moved to cloud agents)
deployed to vercel: NO
builds triggered: 0 (deployments created by git pushes: 2, both BLOCKED by the pause before any build)
KT updated: yes — 00_KT_MASTER_INDEX.csv (1QUPfGP1vRlzeGRH3G8_ZYazsyfo8ifX6, ranks 0.24–0.27 added 05:57Z; rank 0.28 = this handout, added at session end), this file (Drive id in the index row)
OWNER-ONLY: Speed Insights Plus off (both) — STILL ON · Spend values — $5/pause ON recommended, $1 currently set · Cron plan — READY FOR APPROVAL (§2, decisions 1–9) · DNS send./reply.projexa-ai.com — unchanged · GOOGLE_SERVICE_ACCOUNT_JSON — unchanged · one email provider — unchanged (projexa digest also lacks RESEND_API_KEY) · go-live date + recharge — unchanged
```
