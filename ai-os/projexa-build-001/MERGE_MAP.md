# MERGE_MAP -- PROJEXA-BUILD-001 (A11-merge-map)

Verifier: independent subagent, 2026-09-25. READ-ONLY. Code basis: FChecklist/compliance-tracker origin/main `025eea08156baa6a5a0985edb766ff7948de5008` (2026-09-24 12:30 +0530) via `git show`/`git grep`; FChecklist/projexa main `e88b53e12bf0e2166d194b29d125680ed507b861` via `gh api`. DB basis: SELECT-only on `pcrjmlpuqsbocqfwoxod`. Inputs merged: (i) PM build spec + architecture analysis + discussion log, (ii) WORK_ORDER BUILD-001 (D-01..D-11, 1.1-5.5, Q1-Q6), (iii) Addendum A (E-01..E-17, normative) + chat reply #2 excerpt.

Rule applied: Addendum A wins over the work order where they conflict (Addendum header). Code/DB on origin/main wins over any document.

## 0. Load-bearing PM-spec claims re-verified

| # | PM claim | Verdict | Evidence |
|---|---|---|---|
| V1 | MCP advertises 22 tools, runs 9 (Gap 3/D) | CONFIRMED | `src/app/api/mcp/route.ts:252-284` getToolDefinitions serves `platform.worker_agents` tier=global (SQL: 22 rows with code_reference); handleTool branches at :367,:380,:392,:413,:443,:464,:497,:510,:521 = 9; :525 `throw new Error(`Unknown tool: ${name}`)`. The 13 = 7 construction + 6 GST (confirm_gst_batch, generate_gst_ai_review, generate_gst_return, list_gst_import_batches, list_gst_returns, run_gst_reconciliation). Stale in-file comment :263-264 says TOOL_DEFINITIONS holds 7; the array (:138-229) holds 9. |
| V2 | EXECUTORS = 27 functions, 7 writes | CONFIRMED (26 implementations + 1 alias) | `src/lib/pipeline/executor.ts:672-685`: 7 writes (record_work_progress, record_timesheet, record_attendance, add_roster_entry, create_meeting, create_boq_revision, create_document) + get_construction_project_dashboard + 6 READ_ONLY_DISPATCH (:350-357) + alias review_budget (:668-670) + 12 org-scoped reads (:393-402) = 27 keys. |
| V3 | platform.user_ai_links has no project_id | CONFIRMED | information_schema: `id,org_id,user_id,token,status,created_at,last_used_at,revoked_at`; 2 rows. |
| V4 | compliance.api_keys has no project/user scope | CONFIRMED | information_schema: `id,name,key_hash,key_prefix,org_id,scopes,is_active,last_used_at,created_at,updated_at,domain_scope,rate_limit_per_minute,issued_for_application_id`; 36 rows. |
| V5 | Redaction default at construction-tools.ts:95; fix = pass role at [token]/route.ts:58/:68 | CONFIRMED location, REFUTED fix scope | Path is `src/lib/task-execution/construction-tools.ts:95` (`role ? ... : true`), not src/lib/pipeline. `src/app/api/mcp/[token]/route.ts:58,:68` call runSubmission with no role (confirmed; run-submission.ts:161 comment says so). BUT a third drop exists: `executor.ts:372` makeDispatchExecutor calls `dispatchTool(db, task.orgId, task.userId, codeReference, {inputs})` with NO role, so the 6 dispatch reads + review_budget ignore `task.role` for EVERY pipeline caller, including the internal assistant rawInput path. And a fourth: `src/app/api/v1/projexa/assistant/route.ts:56,:77` pass `ctx.dbUser?.role ?? null`, while `auth-guard.ts:424,:445` return `dbUser: null` on API-key auth, so role=null -> financialsAllowed=true. PROJEXA's own assistant proxies through that route with the org API key (projexa `src/app/api/assistant/route.ts:43,:83`, header :12-16). |
| V6 | No document-understanding layer exists; build new `src/lib/services/document-extraction-service.ts` (Gap 2) | REFUTED | That exact file exists on origin/main (552 lines; last touch de9245ab 2026-09-20): PDF/Word/PPT/email text extraction + vision for images + LLM `extractComplianceFields` (:237) via `resolveModelConfig`; 20 files reference it incl. `construction-ai-service.ts`, `fm-register-digitization-service.ts`, `src/app/api/documents/extract/route.ts`. Missing: xlsx branch, BOQ/project target schema. |
| V7 | Drawings trap / MoM trap | CONFIRMED | `executor.ts:18` imports createDocumentRecord (document-service); createDrawingRecord is a separate fn at `document-service.ts:224` with supersede tests at `document-service.test.ts:230`. `executor.ts:17` imports createMeeting from `pms-meeting-service`; `createVeriMeeting` at `veri-meeting-service.ts:279`. |
| V8 | executeCreateBoqRevision forwards only boqId/title | CONFIRMED | `executor.ts:485-492`. |
| V9 | Every DB call runs inside withTenantContext (PM s10) | REFUTED for the compliance MCP door | [removed from the public copy: see the private KT folder] |
| V10 | Topology 287/106 CT proxy vs projexa 310/109 | CONFIRMED | `git ls-tree` origin/main: 287 route.ts, 106 modules under src/app/api/v1/projexa; 1,246 total API routes. projexa tree listing: 310 route.ts, 109 modules, 0 under src/app/api/v1. |
| V11 | 29 + 1 Vercel crons, one */15 | CONFIRMED | CT vercel.json 29 crons, `/api/internal/crr-catchup-worker/run */15 * * * *`; projexa vercel.json 1 cron `/api/internal/email-digest-cadence/run 0 8 * * *`. cron.job = dpdp-monday-digest, dpdp-legal-clocks. |

## 1. Crosswalk -> unified work items

Gap letter aliases come from the architecture analysis (A..I). They are NOT 1:1 with Gap numbers: Gap 4 and Gap 9 have no letter (they arose after that report); 'Gap D' means Gap 3 at spec L423 but Gap 6 at spec L39 (WO D-05 item 2).

| Source id | Letter alias | Source item | Unified id | Note |
|---|---|---|---|---|
| PM Gap 1 | A, C | No API creates a project from a file | U-37 | C also feeds U-28/U-38 (no AI tool creates project) |
| PM Gap 2 | B, I | No document-understanding (L1) layer | U-36 | REFUTED as worded: src/lib/services/document-extraction-service.ts exists (552 lines); B = parser.ts reads sheet 1 only |
| PM Gap 3 | D (L423) | MCP advertises 13 tools it cannot run | U-15 + U-39 | split: de-advertise now, implement later |
| PM Gap 4 | (none; post-A..I) | AI link org-wide, not project-scoped | U-18 | twin on api_keys = U-19 |
| PM Gap 5 | E | External link shows unredacted financials | U-01 | scope wider than 2 call sites (see s5) |
| PM Gap 6 | F; 'Gap D' at L39 | Email attachments discarded | U-31 |  |
| PM Gap 7 | G | Email creates one task after human promote (policy) | U-30 | Q3 |
| PM Gap 8 | H | Inbound email DNS-blocked (R-C17) | U-30 | Q4, owner-only DNS |
| PM Gap 9 | (none) | No autonomous/no-trigger pattern | U-40 | rescoped to pg_cron by Addendum A1 |
| PM Gap I | I | L0-L3 framework mostly unwired; L3 dead code; AID-07 gate | U-36 + U-14 |  |
| D-01 |  | Sitemap inventories wrong repo | U-02 |  |
| D-02 |  | 43 of 111 requirements never analysed | U-04 |  |
| D-03 |  | Zero acceptance criteria | U-05 |  |
| D-04 |  | No phases / dependencies | U-05 + this graph | graph in s4 |
| D-05 |  | Nine internal contradictions | U-03 |  |
| D-06 |  | SECURITY DEFINER exposure | U-13 | withdrawn from PROJEXA by Addendum A5 |
| D-07 |  | Metered scheduler chosen over pg_cron | U-08 + U-21 + U-41 | rescoped by Addendum A5 |
| D-08 |  | Four-surface contract absent | U-12 + U-32 + U-42 |  |
| D-09 |  | Actor misattribution | U-20 | live: 3 rows/7d, 267 all-time |
| D-10 |  | No rollback/migration/flags | U-17 | PGlite before any paid branch |
| D-11 |  | Performance at 10,907 lines | U-27 |  |
| E-01 |  | CRON_PLACEMENT.csv, PG_CRON>0 | U-08 |  |
| E-02 |  | EDGE_CANDIDATES.csv | U-09 |  |
| E-03 |  | Reference-pattern note | U-10 |  |
| E-04 |  | One PROJEXA job on pg_cron | U-21 |  |
| E-05 |  | Email digest off projexa/vercel.json | U-21 |  |
| E-06 |  | authenticated policies for BOQ tables | U-25 |  |
| E-07 |  | Cross-org PostgREST zero rows | U-25 |  |
| E-08 |  | No service_role in browser | U-26 |  |
| E-09 |  | BOQ offline | U-33 |  |
| E-10 |  | <50 ms main-thread filter | U-33 |  |
| E-11 |  | 0 function invocations 24 h | U-33 |  |
| E-12 |  | Static CDN HIT | U-33 |  |
| E-13 |  | LLM extraction on Edge only | U-36 |  |
| E-14 |  | <=2 crons, none */N | U-41 |  |
| E-15 |  | Projected Vercel <= $20 | U-35 |  |
| E-16 |  | SHARED_BOUNDARY.md | U-11 |  |
| E-17 |  | Every cron/Edge fn owner listed | U-11 |  |
| 1.1 |  | D-01 | U-02 |  |
| 1.2 |  | D-05 | U-03 |  |
| 1.3 |  | D-02 | U-04 |  |
| 1.4 |  | BOOLEAN_REGISTER | U-05 |  |
| 1.5 |  | anon SECDEF = 0 | U-13 | moved to DPDP track (Addendum A5) |
| 1.6 |  | secret-scan CI | U-07 | job exists: .github/workflows/sentinel.yml:6-13 |
| 1.7 |  | D-07 | U-08 (CSV) + U-41 (<=2 crons) | Addendum E-14 puts cron count in Phase 5 |
| 1.8 |  | surface_matrix unproven | U-12 |  |
| 1.9 |  | Speed Insights off | U-06 |  |
| 2.1 |  | user_ai_links.project_id NOT NULL | U-18 |  |
| 2.2 |  | api_keys.project_id NOT NULL | U-19 | EDIT to nullable |
| 2.3 |  | api_keys.user_id + D-09 | U-20 | EDIT to per-request actor |
| 2.4 |  | cross-project 403 | U-18 |  |
| 2.5 |  | Gap 5 redaction | U-01 | moved to Phase 1 |
| 2.6 |  | D-10 rollback | U-17 |  |
| 2.7 |  | authenticated SECDEF allowlist | U-13 | DPDP track |
| 2.8 |  | RAJAT_USER_ID gate | U-14 | owner-blocked (openrouter = metered) |
| 3.1 |  | built=YES has verify_command | U-22 | column absent |
| 3.2 |  | 31 exceptions in register | U-22 |  |
| 3.3 |  | verify:all >=111 | U-23 |  |
| 3.4 |  | checks vs deployed instance | U-23 | blocked_owner while Vercel locked |
| 3.5 |  | Playwright PROJEXA half | U-24 |  |
| 3.6 |  | DONE has evidence_ref | U-22 | column absent |
| 4.1 |  | 4 BOQ cells proven, same record | U-32 |  |
| 4.2 |  | distinct surface in audit_logs = 4 | U-32 | column 'surface' absent |
| 4.3 |  | 4 audit rows have real user_id | U-32 |  |
| 4.4 |  | D-11 | U-27 |  |
| 4.5 |  | Surface 1 route 200 | U-29 |  |
| 5.1 |  | 28 cells proven | U-42 |  |
| 5.2 |  | Extraction idempotent | U-36 |  |
| 5.3 |  | Extraction schema-validated / injection rejected | U-36 |  |
| 5.4 |  | Cost ceiling <= $20 | U-35 |  |
| 5.5 |  | tools/list = implemented | U-15 + U-39 | de-advertise half moved to Phase 1 |
| PM s5 registry table (22 rows) |  | Register existing fns into EXECUTORS | U-28 + U-38 | absent from WO/Addendum |
| PM trap 1 |  | create_document on drawings skips supersede | U-38 | absent from WO/Addendum |
| PM trap 2 |  | create_meeting wraps pms-meeting, not veri-meeting | U-38 | absent from WO/Addendum |
| PM s8 item 2 |  | Email bridge | U-31 | absent from WO/Addendum |
| PM s8 item 3 |  | Scheduler bridge | U-40 | absent as a write bridge |
| WO Q1 |  | build option | U-34 |  |
| WO Q2 |  | fix Gap 5 now | U-01 |  |
| WO Q3 |  | email authority | U-30 |  |
| WO Q4 |  | DNS/MX | U-30 |  |
| WO Q5 |  | REST key sanctioned? | U-16 |  |
| WO Q6 |  | break/grandfather tokens | U-16 |  |
| WO s11 OCID-056 removal |  | remove credential-exposure report | CLOSED | already removed: cfd14a40 (#1833) |

### Unified item list

| Unified id | Phase | Title | Prerequisites | Owner-blocked |
|---|---|---|---|---|
| U-00 | 0 | Amendment log for BUILD-001 (WO s1) | - | no |
| U-01 | 1 | Financial-redaction leak fix at all 3 role-dropping call sites | U-00 | no |
| U-02 | 1 | Regenerate sitemap from projexa@main with provenance header; keep CT proxy table separate | U-00 | no |
| U-03 | 1 | CONTRADICTIONS_RESOLVED.md (9) incl. Gap number<->letter table | U-00 | no |
| U-04 | 1 | All 111 ids (80 register + 31 exceptions) present by id | U-00 | no |
| U-05 | 1 | BOOLEAN_REGISTER.csv, every row has verify_command | U-02, U-03, U-04 | no |
| U-06 | 1 | Speed Insights Plus off on both Vercel projects (spend decrease) | U-00 | no |
| U-07 | 1 | secret-scan proof: planted secret on a PR branch fails the job (job already exists) | U-00 | no |
| U-08 | 1 | CRON_PLACEMENT.csv: 29 CT + 1 projexa crons classified | U-00 | no |
| U-09 | 1 | EDGE_CANDIDATES.csv: every LLM/email code path MOVE_TO_EDGE|STAY | U-00 | no |
| U-10 | 1 | Reference note: dpdp-monday-digest net.http_post+Vault pattern | U-00 | no |
| U-11 | 1 | ai-os/SHARED_BOUNDARY.md + every cron.job/Edge Function owner | U-00 | no |
| U-12 | 1 | surface_matrix.json 28 cells, all unproven | U-00 | no |
| U-13 | DPDP | DPDP-track questions Q-D1/Q-D2 on SECURITY DEFINER exposure (non-gating for PROJEXA) | U-11 | no |
| U-14 | 1 | L1 provider gate (RAJAT_USER_ID) decision recorded; test 2.8 re-worded | U-00 | yes |
| U-15 | 1 | MCP tools/list advertises only the 9 implemented tools (de-advertise 13) | U-00 | no |
| U-16 | 2 | Owner answers Q5 (REST key path) + Q6 (break vs grandfather) recorded | U-05 | yes |
| U-17 | 2 | Rollback script per schema change, replayed on PGlite (branch only with owner cost OK) | U-16 | no |
| U-18 | 2 | platform.user_ai_links.project_id + cross-project 403 | U-01, U-16, U-17 | no |
| U-19 | 2 | compliance.api_keys.project_id NULLABLE + check at shared dispatch points | U-16, U-17 | no |
| U-20 | 2 | Per-request actor attribution (audit_logs.user_id non-null on API-key writes) | U-17 | no |
| U-21 | 2 | Port projexa email-digest cron to pg_cron->pg_net->Edge Function | U-08, U-10, U-11 | no |
| U-22 | 3 | Evidence columns on sumeet_requirements (use closure_* or add verify_command) | U-04, U-05 | no |
| U-23 | 3 | verify:all >=111 checks; deployed-URL half blocked_owner until go-live | U-22 | yes |
| U-24 | 3 | CI runs PROJEXA Playwright half (count >= R-B1) | U-05 | no |
| U-25 | 3 | Identity bridge spike + Edge gateway for BOQ reads (PMD-01: verify PROJEXA ES256 JWT via JWKS, resolve compliance.users, query as app_runtime, cross-org zero-rows test); replaces RLS-direct | U-11, U-17, U-20 | no |
| U-26 | 3 | Zero service_role in browser bundles | U-05 | no |
| U-27 | 4 | BOQ line items paginated: <2000 ms, <1 MB on 10,907-line project | U-05 | no |
| U-28 | 4 | BOQ registry entries: create_boq, executeCreateBoqRevision forwards lineItems/allowScopeReductionOverride/sourceChangeOrderId, get_boq_line_items | U-01, U-18, U-19, U-20, U-27 | no |
| U-29 | 4 | Surface 1: AI-prepared approval page route returns 200 | U-12, U-28 | no |
| U-30 | 4 | Owner Q3 (email/unattended authority) + Q4 (DNS/MX, owner-only) | U-05 | yes |
| U-31 | 4 | Email: read Resend attachments + promote dispatches into EXECUTORS (email bridge) | U-28, U-30 | no |
| U-32 | 4 | BOQ proven on all 4 surfaces with one record_id + 4 attributed audit rows | U-20, U-28, U-29, U-31 | no |
| U-33 | 4 | Browser-first BOQ: offline, <50 ms worker filter, 0 function invocations, CDN HIT | U-25, U-26, U-27 | no |
| U-34 | 5 | Owner Q1: build option order (doc-only / AI-Link MCP / own L1) | U-05 | yes |
| U-35 | 5 | COST_BUDGET.csv per-call ceilings; projected Vercel <= $20.00 | U-06, U-08, U-09 | no |
| U-36 | 5 | Extraction: EXTEND existing document-extraction-service.ts (xlsx multi-sheet, BOQ/project schema, Edge-hosted, idempotent, schema-validated) | U-09, U-14, U-34, U-35 | no |
| U-37 | 5 | POST projects/from-document reusing createProject()/createBoq() | U-28, U-36 | no |
| U-38 | 5 | Remaining ~19 registry entries incl. create_drawing (trap 1), create_mom (trap 2), billing read-only | U-28 | no |
| U-39 | 5 | MCP: implement or permanently drop the 13 construction/GST tools, with role threading | U-15, U-01, U-20 | no |
| U-40 | 5 | Autonomous scheduler bridge on pg_cron calling runSubmission/EXECUTORS | U-21, U-30, U-37 | no |
| U-41 | 5 | vercel.json across both repos: <=2 crons, none */N | U-08, U-21, U-40 | no |
| U-42 | 5 | All 28 surface_matrix cells proven | U-32, U-33, U-38, U-31, U-40 | no |
| U-43 | 1 | External AI link makes zero server-side model calls and is outside the provider gate; on a Level 0 miss returns candidate functions + missing params (PMD-02) | U-14 | no |
| U-44 | 2 | Universal AI Work Link spec accepted (audit PASS): one pasted URL, token = user + project + scope, layers for the nine AI families | U-05 | no |
| U-45 | 2 | Conformance harness: a dumb-AI script (GET root, parse instructions, call API, dry-run write) proves uniform behaviour without vendor accounts | U-44 | no |
| U-46 | 4 | Link endpoints on Supabase Edge: Markdown instruction page, OpenAPI JSON, MCP endpoint, REST verbs, project + user scoped | U-01, U-18, U-20, U-43, U-45 | no |
| U-47 | 4 | Paste-back fallback page for AIs that cannot reach the URL (ties to surface 1) | U-29, U-46 | no |
| U-48 | 5 | Per-AI-family owner acceptance run (real ChatGPT, Gemini, Claude, DeepSeek, Z.ai, Copilot, Microsoft AI, email AI, laptop AI) | U-46, U-47 | yes |
| U-49 | 2 | Level 1 gate compares the acting person (not the org API key); level1 telemetry written on every submission path; refusal text carries the records | U-14, U-20 | no |

## 2. Coverage gaps between the three bodies

### 2a. PM findings missing from WO/Addendum

| PM finding | In WO/Addendum? | Unified id | Evidence |
|---|---|---|---|
| Drawings-register revision trap (create_document skips createDrawingRecord supersede) | NO | U-38 | V7 |
| MoM tool calls older pms-meeting-service | NO | U-38 | V7 |
| MCP 13 advertised-but-unimplemented | YES (5.5, Phase 5 only) | U-15, U-39 | V1; de-advertising needs no prerequisite, so Phase 1 |
| Project-scope twin on compliance.api_keys | YES (2.2) but as NOT NULL, which conflicts with the PROJEXA proxy key | U-19 | V4; projexa assistant route :12-16 |
| External-link financial redaction bug | YES (2.5, Q2) but Phase 2 and under-scoped | U-01 | V5 |
| Email bridge (promote -> EXECUTORS) | NO | U-31 | spec s8 item 2; `email-intelligence-service.ts:16` 'No object created without approval' |
| Scheduler bridge (cron -> runSubmission) | PARTIAL: E-04 ports a digest, no write bridge | U-40 | spec s8 item 3 |
| Extraction service | PARTIAL: 5.2/5.3/E-13 test properties; none notices the existing service | U-36 | V6 |
| 22-row registry registration table | NO | U-28, U-38 | spec s5 table |
| executeCreateBoqRevision drops lineItems/allowScopeReductionOverride/sourceChangeOrderId | NO | U-28 | V8 |
| BOQ importer reads sheet 1 only (Gap B) | NO | U-36 | spec/arch: `src/lib/ingest/parser.ts:44-46` (not re-read this pass) |
| Billing-claim writes held for owner decision (R-95) | NO | U-38 (read-only half) | spec s5 |
| R-81 unwired-pill filter only client-side; R-82 no GET discovery; R-C16 cache per-user; R-A6 two pinned refs; R-A5 placeholder text | NO | not in graph (low) | spec s6.5-s6.8 |

### 2b. WO/Addendum items missing from the PM spec

D-01 (wrong-repo sitemap), D-02 (31 exceptions), D-03 (acceptance criteria), D-04 (phases), D-06 (SECURITY DEFINER; now DPDP), D-07 (pg_cron/pg_net), D-08 (four-surface contract), D-09 (actor attribution), D-10 (rollback), D-11 (performance), 1.6 (secret scan), 1.9 (Speed Insights), 2.8 (L1 provider gate: present in the architecture analysis s3 via AID-07, dropped from the build spec), E-06..E-12 (RLS + browser-first), E-16/E-17 (shared boundary), Addendum A4 (build CPU minutes as the real $20 threat).

## 3. Conflicts and proposed winners

| # | Conflict | Proposed winner | Evidence |
|---|---|---|---|
| C1 | WO D-06/1.5/2.7 call SECDEF exposure a PROJEXA defect; Addendum A5 says all DPDP | Addendum (normative) | chat excerpt PM pre-verification: public anon 7 = 5 dpdp_* + 2 pgaudit_*; platform/compliance secdef exec by anon/auth = 0 |
| C2 | WO 1.7 requires <=2 Vercel crons in Phase 1; Addendum E-14 puts it in Phase 5 | Addendum: CSV in Phase 1 (U-08), count in Phase 5 (U-41) | 29+1 crons today (V11) |
| C3 | PM Gap 9 extends Vercel `/api/internal/*/run`; Addendum A1 routes scheduled work to pg_cron | Addendum | cron.job has 2 live net.http_post jobs; CT has a */15 Vercel cron |
| C4 | PM s4 Gap 5 + s10: fix now, alone; WO 2.5 places it in Phase 2 behind all of Phase 1; WO Q2 itself recommends 'yes, now' | PM + Q2: Phase 1 (U-01), with 4 call sites not 2 | V5 |
| C5 | WO 2.1/2.2 NOT NULL project_id on both tables; PM s5/s6.5 nullable column | Split: user_ai_links NOT NULL for new mints (2 rows exist); api_keys NULLABLE (PROJEXA proxy key is org-wide by design) -> owner Q6 | V3, V4; projexa `src/app/api/assistant/route.ts:12-16` |
| C6 | WO 2.3 adds user_id to api_keys; one PROJEXA org key serves many people | Per-request actor (actorEmail/resolveActingUser) writing audit_logs.user_id | `auth-guard.ts:424,:445` dbUser null on API-key auth; D-09 live = 3 rows/7d, 267 all-time |
| C7 | PM Gap 2 says nothing extracts documents; build new service at document-extraction-service.ts | Code: extend the existing file | V6 |
| C8 | PM s10 'every DB call inside withTenantContext'; WO D-06 disputes it via PostgREST | Both partly wrong: PostgREST exposure is DPDP (C1); the compliance MCP door uses the service-role client | V9 |
| C9 | WO 3.4 checks must hit a deployed instance; WO s3 and R76/local-first forbid unpausing | 3.4 = blocked_owner until owner go-live; checks run local + live Supabase meanwhile | WO s3 'DO NOT ... unpause'; Vercel ignoreCommand exit 0 |
| C10 | WO D-10/2.6 runs rollback on a Supabase branch; branches are billed compute (the Supabase MCP gates create_branch behind get_cost/confirm_cost) and spend increases are owner-only | PGlite replay first (`bun run check:migration-replay` infra); branch only with owner cost approval | Amendment 001 s3; CLAUDE.md Commands (PGlite) |
| C11 | PM uses 5 access patterns; WO D-08 uses 4 surfaces | WO/owner contract is the acceptance model. Map: pattern 1 -> surface 2 (partial: manual entry is not 'pre-filled'); patterns 2+3 -> surface 3; pattern 4 -> surface 4; pattern 5 -> producer, no surface; surface 1 has no PM pattern | WO D-08; spec s1 |
| C12 | WO s11: OCID-056 exposure report must be removed | Already done | `git log origin/main -- ai-os/OCID-056-CREDENTIAL-EXPOSURE-REPORT.md` -> cfd14a40 (#1833) |
| C13 | WO 1.6 implies no secret-scan job | Job exists; only triggers on PR/push to main | `.github/workflows/sentinel.yml:2-13` (gitleaks-action@v3) |
| C14 | WO 2.8 'gate does not throw for non-owner' | Cannot pass without switching L1 to a metered provider (owner-only) | GATE_2_8_FINDINGS.md s0 (adapter.ts:120-141; adapter.test.ts:28) |
| C15 | WO 5.5 in Phase 5; PM Gap 3 says fix now | De-advertise in Phase 1 (U-15); implement in Phase 5 (U-39) only after U-01/U-20, because the compliance MCP authenticates by API key with no user, so wiring construction tools there without role reproduces the leak | V1, V5, V9 |

## 4. Dependency graph (node: prerequisites)

```
U-00: (none)
U-01: U-00
U-02: U-00
U-03: U-00
U-04: U-00
U-05: U-02, U-03, U-04
U-06: U-00
U-07: U-00
U-08: U-00
U-09: U-00
U-10: U-00
U-11: U-00
U-12: U-00
U-13: U-11
U-14: U-00
U-15: U-00
U-16: U-05
U-17: U-16
U-18: U-01, U-16, U-17
U-19: U-16, U-17
U-20: U-17
U-21: U-08, U-10, U-11
U-22: U-04, U-05
U-23: U-22
U-24: U-05
U-25: U-11, U-17, U-20
U-26: U-05
U-27: U-05
U-28: U-01, U-18, U-19, U-20, U-27
U-29: U-12, U-28
U-30: U-05
U-31: U-28, U-30
U-32: U-20, U-28, U-29, U-31
U-33: U-25, U-26, U-27
U-34: U-05
U-35: U-06, U-08, U-09
U-36: U-09, U-14, U-34, U-35
U-37: U-28, U-36
U-38: U-28
U-39: U-15, U-01, U-20
U-40: U-21, U-30, U-37
U-41: U-08, U-21, U-40
U-42: U-32, U-33, U-38, U-31, U-40
U-43: U-14
U-44: U-05
U-45: U-44
U-46: U-01, U-18, U-20, U-43, U-45
U-47: U-29, U-46
U-48: U-46, U-47
U-49: U-14, U-20
```

Acyclicity: checked by DFS in `a11src/mk_merge_map.py` (raises on a back-edge). Result: ACYCLIC, 43 nodes, topological order computed.

Critical path (longest prerequisite chain, 10 nodes): U-00 -> U-02 -> U-05 -> U-16 -> U-17 -> U-18 -> U-28 -> U-37 -> U-40 -> U-41

Topological order: U-00, U-01, U-02, U-03, U-04, U-05, U-06, U-07, U-08, U-09, U-10, U-11, U-12, U-13, U-14, U-15, U-16, U-17, U-18, U-19, U-20, U-21, U-22, U-23, U-24, U-25, U-26, U-27, U-28, U-29, U-30, U-31, U-32, U-33, U-34, U-35, U-36, U-37, U-38, U-39, U-40, U-41, U-42

## 5. Highest-severity finding, first in the queue

U-01, the financial-redaction leak, is the single highest-severity item and is placed first after the amendment log. It is a live confidentiality defect in code on origin/main, and it is wider than the PM spec, WO 2.5 or Q2 state:

1. `src/app/api/mcp/[token]/route.ts:58,:68` -- runSubmission with no role (external AI link).
2. `src/lib/pipeline/executor.ts:372` -- makeDispatchExecutor drops `task.role` for get_construction_budget_status, get_construction_kpi_status, list_delayed_activities, list_over_budget_projects, generate_construction_progress_summary, detect_construction_budget_schedule_risk and alias review_budget, for every pipeline caller.
3. `src/app/api/v1/projexa/assistant/route.ts:56,:77` -- role = `ctx.dbUser?.role ?? null`; `auth-guard.ts:424,:445` set dbUser null for API-key auth; PROJEXA's assistant calls this route with the org API key, so every PROJEXA user, of any role, gets unredacted budget/margin figures.
4. `src/lib/task-execution/construction-tools.ts:95` -- `role ? rank>=manager : true` (unknown role = show). Fail-open default.

Proposed boolean test (new committed test file; exit 0 = pass): `bun test --isolate src/lib/pipeline/financial-redaction.test.ts` asserting that a member-rank actor reaching get_construction_budget_status via (a) the [token] link, (b) assistant rawInput, (c) assistant codeReference with an API key, each receives HTTP 4xx or `budget: null`; plus `git grep -n "role ? (ROLE_RANK" origin/main -- src/lib/task-execution/construction-tools.ts` returning exit 1 (fail-open default removed). Mitigating context, not a reason to defer: Vercel is locked and the 2 user_ai_links rows were last used 2026-08-29 (architecture analysis s4).

Runner-up: U-14 (L1 provider gate), which makes 'AI does the work' false for every non-owner identity; it is an owner decision (metered provider), not a code fix.

## 6. PM patch (2026-09-25, after verification workflow)

U-25 rewritten per PMD-01 (identity bridge, not RLS-direct). U-43..U-49 added: external-link zero-server-L1 (PMD-02), universal AI work link workstream (owner requirement 2026-09-25, sequenced after Phase 1 and after U-18 per Claude chat audit), gate identity and telemetry (GATE_2_8_FINDINGS D3). Dependency graph above already includes these nodes.
