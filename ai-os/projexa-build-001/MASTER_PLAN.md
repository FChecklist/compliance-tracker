# PROJEXA-BUILD-001 MASTER PLAN

| Field | Value |
|---|---|
| Date | 2026-09-25 |
| Written by | chief architect agent for the project manager (Claude Code); owner Rajat Agarwal |
| Status | PLAN. Nothing in this file was executed by its writer. |
| Repo path when committed | `ai-os/projexa-build-001/MASTER_PLAN.md` (PMD-21; the repo copy wins over the Drive copy) |
| Code basis of the evidence | compliance-tracker origin/main `025eea08`; projexa main `e88b53e1` |
| Live state when written | compliance-tracker main `b2a4b20b` (PR #1838 merged 2026-09-25T07:40:06Z); PRs #1836 and #1837 merged; PRs #1839 (U-01) and #1840 (U-15) open; draft PR #1808 open (gh read 2026-09-25) |
| Register | 147 rows BR-101..BR-525 in register_part_1..5.csv, assembled into `BOOLEAN_REGISTER.csv` at commit |

How to read this plan (plain language, for the owner):

- The work is cut into 50 work items (U-00 to U-49). Each item has yes/no checks (BR rows). A check is a command that exits 0 for YES and non-zero for NO.
- The items run in 5 phases. A phase starts only when its ENTRY checks say YES, and it is finished only when every EXIT check says YES.
- A check that needs something only you can do (Vercel go-live, DNS, money, your own AI accounts) is marked blocked_owner. It is reported to you. It is never counted as YES.
- Vercel stays locked. Nothing in this plan deploys to Vercel, unpauses it, changes DNS or raises spend. What the plan does publish: merges to GitHub, database migrations after a rehearsal, and Supabase Edge Functions named `projexa-*` (DEV_TEST_DEPLOY_PLAN.md s4.1).

## 1. Purpose, scope and what is not in scope

**Purpose.** The 2026-09-25 build spec (HANDOUT_2026-09-25_PROJEXA_BUILD_SPEC_COMPLETE.md, 72,588 bytes) had 11 defects (D-01 to D-11) and no completion tests (WO s2). This plan turns it into a closed list of work items with yes/no checks, in 5 ordered phases, and accounts for all 100 findings and all 68 agent amendments of the verification workflow (gaps_master.json). The build goal: one record type (the BOQ line item, PMD-20) proven on all four surfaces (AI-prepared page, ERP screen, AI link, email), then replicated to 7 record types (28 cells), with Vercel spend held at or under 20 USD a month (PROJEXA-COST-001) and a universal AI work link that works for one user and one project (owner requirement, 2026-09-25).

**In scope.**

- compliance-tracker: the `/api/v1/projexa/*` service surface (287 routes, 106 modules), the pipeline (`src/lib/pipeline/*`), the AI link routes (`src/app/api/mcp/[token]`, `src/app/api/mcp`), the extraction service, CI workflows, `scripts/verify/*` (new), `ai-os/projexa-build-001/*` (new) and `ai-os/SHARED_BOUNDARY.md` (new).
- projexa: UI and proxy routes (310 routes, 109 modules at `e88b53e`), the BOQ screen, the AI-link projection.
- Supabase verdian-ai `pcrjmlpuqsbocqfwoxod`: PROJEXA-owned objects only (construction_* tables, `platform.user_ai_links`, register columns on `platform.sumeet_requirements`, `projexa-*` Edge Functions and `projexa-*` pg_cron jobs). Supabase PROJEXA `evpckeuxgvahguwsaeul`: read of the public key set; projexa-repo migrations.

**Not in scope.**

- Any Vercel action: deploy, unpause, setting, env or domain change, recharge (PMD-11). Checks that need a deployed instance are blocked_owner.
- DNS changes (PMD-06) and any spend increase: metered model provider (PMD-02), paid Supabase branch (PMD-10), any Vercel or Supabase add-on.
- DPDP-owned objects (dpdp schema, `public.dpdp_*` functions, dpdp-ai-link, dpdp-monday-email, the two dpdp cron jobs, the two Vault secrets): recorded only (PMD-18, SHARED_BOUNDARY.md R3).
> [removed from the public copy: see the private KT folder]
- PROJEXA-COST-001 files until the owner release: `vercel.json` in both repos, `supabase/prepared/cost001/`, PR #1808 (DEV_TEST_DEPLOY_PLAN.md s2.2).
- A hosting choice for browser-first screens beyond BOQ (OQ-29), and the 16 compliance-tracker-only modules with no projexa consumer (OQ-28).
- Rewriting working code: owner rule "do not duplicate, use existing" (OWNER_REQUIREMENT_AI_WORK_LINK, directive 6).

**Numbers at a glance (2026-09-25).**

| Measure | Value | Source |
|---|---|---|
| Unified work items | 50 (U-00..U-49) | MERGE_MAP.md s1 as patched |
| Register rows | 147 (phase 1: 40, phase 2: 29, phase 3: 29, phase 4: 24, phase 5: 25) | register_part_1..5.csv |
| Register status | pass 4, pending 126, blocked_owner 17, fail 0 | register_part_1..5.csv |
| Verification findings | 100 (critical 1, high 19, medium 42, low 37, info 1) | gaps_master.json |
| Agent amendments | 68, all present in AMENDMENT_LOG_BUILD-001.md | gaps_master.json; lint rule AMEND-COVERAGE |
| Amendment log | 102 rows: ADD 43, DELETE 1, EDIT 47, REJECT 11; rows missing evidence 0 | AMENDMENT_LOG_BUILD-001.md |
| PM decisions | 26 (PMD-01..PMD-21, plus PMD-22..PMD-26 added during development) | PM_DECISIONS.md |
| Owner questions | 32, of which 8 owner-only (OQ-01..OQ-08) | OWNER_QUESTIONS.md |

**Phases at a glance.**

| Phase | Name | Work items | Rows | ENTRY rows | EXIT rows | EXIT rows blocked_owner |
|---|---|---|---|---|---|---|
| 1 | Make the ground observable | U-00, U-01, U-02, U-03, U-04, U-05, U-06, U-07, U-08, U-09, U-10, U-11, U-12, U-14, U-15, U-43 (+ U-13 DPDP guard) | 40 | 1 | 16 | 0 |
| 2 | Identity, scope, attribution | U-16, U-17, U-18, U-19, U-20, U-21, U-44, U-45, U-49 | 29 | 2 | 6 | 0 |
| 3 | Evidence standard | U-22, U-23, U-24, U-25, U-26 | 29 | 6 | 7 | 0 |
| 4 | One record type on four surfaces | U-27, U-28, U-29, U-30, U-31, U-32, U-33, U-46, U-47 | 24 | 1 | 9 | 5 |
| 5 | Replicate, then perception | U-34, U-35, U-36, U-37, U-38, U-39, U-40, U-41, U-42, U-48 | 25 | 1 | 10 | 4 |

## 2. Sources and precedence

Code at a named commit and the live database win over any document, this plan included. A newer dated reading replaces an older one and is reported with its date, never edited into the old figure.

| Rank | Source | What it decides |
|---|---|---|
| 1 | The owner's own words in chat, quoted with the date | Any decision. The owner overrides a PM decision with the sentence given for it in PM_DECISIONS.md. |
| 2 | Code at a named commit (origin/main SHA, path:line) and dated live reads (SELECT on either Supabase project, gh api, read-only Vercel API) | Every fact. |
| 3 | PM_DECISIONS.md (PMD-01..PMD-26) | Decisions. They override the work order, Addendum A and the master handoff where they differ. Where two PMDs conflict, the PM settles it in a new PMD row (PC-21). |
| 4 | This plan and MERGE_MAP.md as patched (its section 6) | Sequencing: phases, the dependency graph, start rules. This plan adds one graph edge (U-38 needs U-36, PMD-03). |
| 5 | BOOLEAN_REGISTER.csv (register_part_1..5.csv) | The test and the status of every item. Where an AMENDMENT_LOG boolean_test names another file or output for the same item, the register row is the gate (PC-12 lists the pairs). |
| 6 | AMENDMENT_LOG_BUILD-001.md | Each change to the work order and Addendum A, with evidence. |
| 7 | ADDENDUM_A_BUILD-001_EDGE_AND_BROWSER_FIRST (normative) | Wins over the work order where they conflict (its header). |
| 8 | WORK_ORDER_PROJEXA-BUILD-001 | The base requirements: defects D-01..D-11, tests 1.1..5.5, Q1..Q6. |
| 9 | PROMPT_PROJEXA_MASTER_HANDOFF | Audit notes; the report format (PART 6). |
| 10 | PM build spec, architecture analysis, discussion log | Under audit; not a build source until its defects close. |
| 11 | KT files | They lag the code; cite them by folder and filename. |

Evidence files (LIVE_FACTS_D09_D10_D11_RLS.md, GATE_2_8_FINDINGS.md, IDENTITY_AND_EDGE_FINDINGS.md, INFRA_INVENTORY.md, DEV_TEST_DEPLOY_FACTS.md, BROWSER_READINESS.md, A08_billing_notes.md, CONTRADICTIONS_RESOLVED.md, the CSV and JSON registers) are rank 2 readings dated 2026-09-25 at `025eea08`. REGISTER_CONVENTIONS.md rule 5 applies: amended tests win over the original work-order wording.

## 3. Governance and limits

- **Amendment 001 (2026-09-24).** Full autonomy; merge on green. Three action types stay owner-only: Vercel recharges and payments, anything that increases spend, and DNS changes (PM_DECISIONS.md header).
- **Owner delegation (2026-09-25).** The owner wrote "except for recharge of vercel you can take any and all decision" and "make final document and start work, start development on local" (PM_DECISIONS.md header). Where a decision touches spend or DNS, the PM picks the option that spends nothing and changes no DNS.
- **Closed scoped exception (PMD-15).** The instruction "start only after Claude chat audits and you relay approval" was a scoped exception to Amendment 001. Its end condition was met on 2026-09-25 when the owner wrote "check this and your analysis. make final document and start work". It is closed; Amendment 001 autonomy applies again.
- **Vercel locked (PMD-11).** Both projects live=false, latest production deployment BLOCKED; both vercel.json files carry `ignoreCommand: sh -c 'exit 0'` (A08_billing_notes.md). No deploy, unpause, setting, env or DNS change. Draft PR #1808 stays unmerged. Releases are owner-approved manual deploys.
- **No spend increase.** No metered model provider (PMD-02), no paid Supabase branch (PMD-10, 0.01344 USD per hour), no Vercel or Supabase add-on or compute change (DEV_TEST_DEPLOY_PLAN.md s4.3). The 20 USD monthly Vercel ceiling is measured on gross charges; the 29.2436 USD billed from 2026-08-26 to 2026-09-25 is reported, not hidden (PMD-13).
- **No DNS change (PMD-06).** The PM prepares the Resend inbound record list; the owner applies it.
- **RAM policy (PMD-14).** Warn at 1.5 GB free; hard stop for new bun processes or agent bursts at 1.0 GB; one bun process at a time; typecheck, build, whole test suite and Playwright run only in CI; at most 12 concurrent agents; RAM checked before each bun command, before each agent burst and at the end of every phase (commands S-1 and S-2, DEV_TEST_DEPLOY_PLAN.md s2.1). Readings on 2026-09-25: 0.36 GB and 0.48 GB (DEV_TEST_DEPLOY_PLAN.md K-11), 305,996 KB (AMENDMENT_LOG AM-002), about 1.8 GB (PM statement for this assignment), 2.72 GB free of 7.82 GB at 07:36:29Z (read by this writer). The readings differ widely within one day, so the S-1 check runs before every bun command, not once a day.
- **Cloud agents.** Reading, verifying and auditing go to agents; git, merges, migration applies, Edge deploys, secret setting and register status changes stay with the PM (WO s9; DEV_TEST_DEPLOY_PLAN.md s5.3). At most 2 local interactive sessions (WO s1). An agent requested as remote may run as a local worktree on this laptop and then counts against the RAM rules (DEV_TEST_DEPLOY_PLAN.md s5.3). Every agent claim is re-verified by the PM against the live source before it enters the register or a report (WO s9).
- **Pull requests.** One U-item per PR; green means the 10 required contexts of compliance-tracker main (DEV_TEST_DEPLOY_PLAN.md K-03); a non-author `AUDIT: PASS` comment on every code PR (AGENTS.md Rule 7(c)); the BUILD-001 claim in ACTIVE-CLAIMS.yaml is updated before each phase (AGENTS.md Rule 11). No direct push to main.
- **Ownership (PMD-18).** PROJEXA work does not modify DPDP-owned objects or the VERIDIAN AI-OS tooling. Before creating an extension, a SECURITY DEFINER function, a cron.job entry or an Edge Function, a claim is written in ACTIVE-CLAIMS (SHARED_BOUNDARY.md R1).
- **SQL evidence (PMD-22).** The SQL runner connects as app_runtime, which row-level security filters. Catalog checks are exact under it; counts over tenant data are run by the PM through the Supabase MCP as role postgres and recorded with their date. No new database role is created.
- **Two copies of the package (PMD-25).** The private Drive copy holds everything, including the evidence folder. The public repo copy has no evidence folder, and assemble_pkg.py replaces every line or table cell that names a deny-listed secret or attack-surface term with a marker. This plan keeps such terms inside table cells only, so the public copy keeps every gate, graph line and finding id.

**Phase order rule (applies to every phase).**

1. No phase starts until every ENTRY test of that phase returns YES.
2. A phase is complete only when every EXIT test returns YES.
3. A blocked_owner row is reported, never marked pass. A phase with an EXIT row at blocked_owner is reported as "blocked on owner, not complete", with each such row named.
4. Item start rule: inside the phase order, a U-item starts only after every prerequisite U-item in the dependency graph has its PRs merged and every register row named on those PRs' `Register rows:` line (DEV_TEST_DEPLOY_PLAN.md s2.4) at pass. A row at blocked_owner stays on that line and in the report, but it does not hold the start. Rows that restate or re-run other rows ([ENTRY] rows, the phase-gate runner, the [MUTATION] row BR-525) are never put on an item PR's line. A U-item is done as defined in DEV_TEST_DEPLOY_PLAN.md s6.1. So work that does not need the owner keeps moving, and no owner-blocked row is ever counted as YES. DEV_TEST_DEPLOY_PLAN.md s6.3 states the owner-blocked condition per phase; this plan applies it per item, and this plan wins for sequencing (PC-15).
5. A status changes only after the PM runs the row's own verify_command and records the evidence (commit SHA, PR number or dated query result). A test changes only through a new AMENDMENT_LOG row with evidence (DEV_TEST_DEPLOY_PLAN.md s3.4).

## 4. Decisions taken by the PM

- **PMD-01** Identity bridge = Supabase Edge Function gateway on verdian-ai: verify the PROJEXA ES256 session token against the projexa key set, resolve the person through compliance.users.auth_user_id, query as app_runtime with the tenant setting, return keyset-paginated JSON; key-set spike first; fallback (c) keeps reads server-side.
- **PMD-02** Keep the provider gate; no metered provider; the external AI link makes zero server model calls and returns candidate functions and missing parameters on a Level 0 miss; internal chat for non-owners stays Level 0 with records in the refusal; the gate compares the acting person (Phase 2).
- **PMD-03** Build order: the AI-Link MCP path first (redaction, de-advertise 13 tools, zero server Level 1, project scoping), then extraction by extending document-extraction-service.ts, then the remaining registry entries.
- **PMD-04** Redaction leak first, all four role-dropping points in Phase 1: mcp/[token]/route.ts:58,68; executor.ts:372; assistant/route.ts:56,77 under API-key auth; construction-tools.ts:95 fail-open default.
- **PMD-05** Email-triggered actions create proposals only; reads and drafts run unattended; no write runs until a person confirms.
- **PMD-06** DNS stays owner-only; the PM prepares the Resend inbound MX and TXT record list; surface 4 cells stay blocked_owner until the owner applies DNS.
- **PMD-07** The credential given to an AI is the project-and-user scoped link token; org API keys are service-to-service and never handed to an AI.
- **PMD-08** platform.user_ai_links.project_id NOT NULL for links minted after the migration, the 2 legacy org-wide links revoked; compliance.api_keys.project_id nullable with a key_kind check (org_service, project_ai).
- **PMD-09** Amended tests: 2.8 as a provider matrix plus zero server Level 1; 1.6 as a required check; 1.7 split (CSV in Phase 1, cron count in Phase 5); 1.5 and 2.7 to the DPDP track with a narrow PROJEXA guard; 2.2 and 2.3 as nullable project_id plus per-request actor; stricter D-09; D-11 keyset on real-shaped fixtures; columns first for 3.1, 3.6, 4.2; E-06 and E-07 rewritten for PMD-01; E-08 on the built bundle; 4.5 tests AI-prepared content with an approve action.
- **PMD-10** No paid Supabase branch (0.01344 USD per hour); rollback proven by down files, an always-aborted transaction that compares schema hashes, and a PGlite replay.
- **PMD-11** Vercel stays locked; test 1.9 date-gated to the billing day that starts 2026-09-26 07:00 UTC; releases stay owner-approved manual deploys; draft PR #1808 stays unmerged.
- **PMD-12** One cron first: exchange-rate-refresh moves to pg_cron -> pg_net -> Edge Function on verdian-ai; the other prepared jobs follow one per PR.
- **PMD-13** The 20 USD measure uses gross charges; the cumulative 29.24 USD since 2026-08-26 is reported.
- **PMD-14** RAM policy: warn at 1.5 GB, hard stop at 1.0 GB, one bun process, typecheck and build in CI only, at most 12 concurrent agents, RAM check after every phase.
- **PMD-15** The owner-scoped exception "start only after Claude chat audits and you relay approval" ended on 2026-09-25; Amendment 001 autonomy applies again.
- **PMD-16** One canonical AI link (surface 3): compliance-tracker platform.user_ai_links with its MCP and REST route; the PROJEXA org_ai_link snapshot becomes a read-only projection that delegates to it; universal link implementation starts after U-18.
- **PMD-17** The 31 exceptions get ids EXC-ITEM-01..EXC-ITEM-31; the 3 META items count in the 111; platform.sumeet_gap is never the source.
> [removed from the public copy: see the private KT folder]
- **PMD-19** The exception record type converges on the underlying flagged record (for example the overdue RFI); no new table.
- **PMD-20** Phase 4 record type = BOQ line item (compliance.construction_boq_line_items); progress entries are the separate daily work progress type.
- **PMD-21** The plan lives in ai-os/projexa-build-001/ (CI reads it) and in the Drive KT folder PROJEXA_BUILD-001_PLAN_2026-09-25; the repo copy wins.

Added by the PM during development on 2026-09-25 (PM_DECISIONS.md, file written 07:39 UTC), after the first 21:

- **PMD-22** The SQL runner scripts/verify/sql-assert.mjs (PR #1838) opens a read-only transaction and accepts one SELECT; it connects as app_runtime, which row-level security filters, so catalog rows are exact but counts over tenant data can read 0 for the wrong reason. Tenant-data rows name the role they need; the PM runs them through the Supabase MCP (role postgres) and records a dated SQL result. No new database role is created.
- **PMD-23** U-01 closes in three PRs: #1839 (core), a follow-up on the same branch (tasks and submissions routes, task-execution-engine and fde-service callers, three construction tools without a financial gate), and a projexa PR that makes the assistant proxy send the acting person. Until that projexa PR merges, PROJEXA assistant users see redacted figures (fail closed); a caller that passes no role sees redacted figures even when the person is a manager.
- **PMD-24** The twelve options OD-1..OD-12 of the AI work link spec are decided as the spec recommends: supabase.co host only; spike S-1 before any write execution; the static inbox and confirm page on a free Cloudflare Pages *.pages.dev project created at Phase 4 entry with the existing owner-issued token (blocked_owner if that token cannot create it); default level 0; the section 9.1 write table as written; shared helper module only after an ACTIVE-CLAIMS claim with DPDP behaviour unchanged; the 2 legacy links revoked; 30-day maximum expiry; hide_personal on; no extra level-1 safety now; owner runs OT-01..OT-17 as blocked_owner rows; query-string tokens refused.
- **PMD-25** The package exists twice: the private Drive copy holds everything including the evidence folder; the public repo copy omits the evidence folder, and assemble_pkg.py replaces every line or table cell that names a deny-listed secret or attack-surface term with a neutral marker, then fails on any remaining hit. Both copies must pass lint_plan.py.
- **PMD-26** AI work link audit S02 (verdict PASS_WITH_FIXES, defects A-01..A-23, recorded as applied): user_ai_links gains a product column (existing rows = veridian, unchanged; a projexa row needs project_id and token_hash and no plaintext); database-side helpers copied from DPDP are exception EXC-DUP-1; writes through Vercel (option A) are not authorised, level-1 writes run only through the Edge bundle after spike S-1 and every link is level 0 until then; reads are POST-only with a read-only executor mode; effective level is computed per call from the live role; links only in single-owner connectors (OT-18); an emailed confirm link needs a typed 4-character code.

## Phase 1 - Make the ground observable

**Purpose.** Make every later claim checkable before any feature work: commit the plan package and its linter, put the evidence registers in the repo, close the live financial-redaction leak (the highest-severity item, MERGE_MAP s5), stop the external AI link from calling the internal AI, make the MCP tool list honest, write down who owns each shared database object, and cut the Speed Insights Plus charge. No schema change happens in this phase.

**Gate.** Phase 1 starts only when every ENTRY row returns YES and is complete only when all 16 EXIT rows return YES. Register rows in this phase: 40. EXIT rows pass today: 1 of 16 (BR-128). EXIT rows at blocked_owner: none.

**ENTRY tests:** BR-101 (amendment log exists and is non-empty).

**EXIT tests (16):**

| BR id | what it proves (register title) | status 2026-09-25 |
|---|---|---|
| BR-108 | Plan package linter passes (register format, 5 phase gates, coverage, banned words, D-05, D-07, D-08) | pending |
| BR-110 | Sitemap provenance header (repo, main_sha, generated_utc, route_count, module_count on lines 1-5) equals the projexa git tree at main_sha, plus a separate compliance-tracker table of 287 routes [creates scripts/verify/sitemap.sh] | pending |
| BR-112 | CONTRADICTIONS_RESOLVED.md has exactly the headings C-01 to C-10 | pending |
| BR-114 | REQUIREMENTS_111_REGISTER.csv holds 111 distinct requirement ids (80 R- ids plus EXC-ITEM-01 to EXC-ITEM-31) | pending |
| BR-116 | [DATE 2026-09-27] Speed Insights Plus team charge = 0.0000 for the Pacific day 2026-09-26T07:00Z to 2026-09-27T07:00Z (read-only billing script) [creates scripts/verify/vercel-billing-day.sh] | pending |
| BR-119 | Secret Scanning is a required status check on compliance-tracker main | pending |
| BR-121 | CRON_PLACEMENT.csv classifies all 30 Vercel crons (29 compliance-tracker + 1 projexa) with the 5-value enum and >=1 PG_CRON or EDGE_FN_VIA_PG_CRON row; the 6 suffixed values such as 'GITHUB_ACTIONS (existing)' are normalised [creates scripts/verify/cron-placement.sh] | pending |
| BR-125 | ai-os/SHARED_BOUNDARY.md lists both cron.job entries, the 7 Edge Functions of both projects, the installed extensions, the owning product of each, the claim-before-create rule and dated table counts [creates scripts/verify/shared-boundary.sh] | pending |
| BR-126 | surface_matrix.json has 28 cells, each with status, record_id, verify_command, all status unproven [creates scripts/verify/surface-matrix.sh] | pending |
| BR-128 | SECURITY DEFINER functions executable by anon or authenticated outside DPDP = 0 (platform and compliance schemas, plus public names not dpdp_ or pgaudit_) | pass |
| BR-131 | MCP tools/list advertises exactly the 9 implemented tools, 13 de-advertised (mutation: re-add one unimplemented worker_agents name, test fails) | pending |
| BR-132 | Redaction point 1: AI link mcp/[token] route, member-rank link owner gets budget null (mutation: call without role, test fails) | pending |
| BR-133 | Redaction point 2: executor.ts makeDispatchExecutor passes task.role; member gets budget null on the 6 dispatch reads and review_budget (mutation: drop role, test fails) | pending |
| BR-134 | Redaction point 3: assistant route with org API key, acting member gets budget null and no resolvable acting person gets budget null (mutation: role from ctx.dbUser only, test fails) | pending |
| BR-135 | Redaction point 4: construction-tools role null or undefined redacts financial fields (mutation: restore the true default, test fails) | pending |
| BR-137 | External AI link makes zero server-side model calls: runLevel1 spy calls = 0 under unset, claude-cli, claude-cli-remote, openrouter (mutation: restore runSubmission, test fails with -32000) | pending |

**Work items.** Register rows listed are the rows of this phase whose source names the item; rows of the same item in other phases are shown in brackets.

| U id | work | register rows | state on 2026-09-25 |
|---|---|---|---|
| U-00 | Amendment log for BUILD-001 and the BUILD-001 claim in ACTIVE-CLAIMS (WO s1; AGENTS.md Rule 11) | BR-101, BR-102, BR-103 [BR-201] | Done. Claim PR #1836 merged; amendment log (now 115 rows) in the repo copy (PR #1843). |
| U-01 | Financial-redaction leak closed at all 4 role-dropping points (PMD-04) | BR-132, BR-133, BR-134, BR-135, BR-136 [BR-202, BR-512, BR-514] | Done. PR #1839 (core fix incl. dashboard money fields), PR #1841 (verify scripts), projexa PR #319 (assistant proxy sends the acting person). Rows pass. |
| U-02 | Sitemap regenerated from projexa main with a provenance header; compliance-tracker proxy table kept separate | BR-110, BR-111 | Done. Sitemap in the repo copy (PR #1843); BR-110 pass. |
| U-03 | CONTRADICTIONS_RESOLVED.md: the 9 contradictions plus 8 extra, with the Gap number and letter table | BR-112, BR-113 | Done. CONTRADICTIONS_RESOLVED.md in the repo copy (PR #1843). |
| U-04 | All 111 requirement ids present by id (80 register ids plus EXC-ITEM-01..31, PMD-17) | BR-114, BR-115 [BR-307] | Done. REQUIREMENTS_111_REGISTER.csv in the repo copy (PR #1843); BR-114 and BR-115 pass. |
| U-05 | Plan package, BOOLEAN_REGISTER.csv and its linter; SQL assertion runner scripts/verify/sql-assert.mjs | BR-104, BR-105, BR-107, BR-108, BR-109, BR-140 [BR-201, BR-401] | Done. sql-assert runner PR #1838; register and linter PR #1843; evidence PR #1846 (39 of 40 phase 1 rows pass; BR-116 date-gated). |
| U-06 | Speed Insights Plus charge reads 0.0000 (spend decrease, date-gated, PMD-11) | BR-116, BR-117 | Speed Insights and Web Analytics disabled on both projects (disabledAt 2026-09-24 04:50 UTC). BR-116 (charge reads 0.0000) is date-gated and stays pending until 2026-09-27. |
| U-07 | Secret Scanning becomes a required check; committed planted-secret self-test | BR-118, BR-119, BR-120 [BR-316] | Job exists and the planted-secret self-test passes (BR-118, BR-120). Adding Secret Scanning as a required context is BR-316 (phase 3, pending). |
| U-08 | CRON_PLACEMENT.csv classifies the 30 declared Vercel crons (29 compliance-tracker plus 1 projexa) | BR-106, BR-121 [BR-328, BR-329] | Done for the classification (CRON_PLACEMENT.csv, 37 rows, 30 Vercel crons). The crons drift guard is BR-328/BR-329 (pending, with U-41). |
| U-09 | EDGE_CANDIDATES.csv classifies every LLM and email code path (MOVE_TO_EDGE, STAY, KILL) | BR-122 | Done. EDGE_CANDIDATES.csv in the repo copy (35 rows). |
| U-10 | Reference note: dpdp-legal-clocks is the proven pg_cron -> pg_net -> Edge Function path | BR-123, BR-124 | Done. REFERENCE_PG_CRON_PG_NET_EDGE.md written; BR-123 and BR-124 pass. |
| U-11 | ai-os/SHARED_BOUNDARY.md: owner of every cron.job, Edge Function and extension; claim before create | BR-125 [BR-222, BR-511] | Done. ai-os/SHARED_BOUNDARY.md merged (PR #1843) and kept current (U-21, U-18b done; U-25 and link objects planned). |
| U-12 | surface_matrix.json: 7 record types x 4 surfaces = 28 cells, all unproven; exception maps to its flagged record (PMD-19) | BR-126, BR-127 [BR-218] | Done. surface_matrix.json in the repo copy: 28 cells, all unproven until phase 4/5 (BR-126, BR-127 pass). |
| U-14 | Level 1 provider gate: decision PMD-02 recorded; test 2.8 rewritten as a provider matrix (T-3) | BR-130 [BR-202] | Done. PR #1837 merged; BR-130 pass. |
| U-15 | MCP tools/list advertises only the 9 implemented tools (13 de-advertised) | BR-131 [BR-514] | Done. PR #1840 merged; BR-131 pass. |
| U-43 | External AI link makes zero server model calls; a Level 0 miss returns candidate functions and missing parameters (PMD-02) | BR-137, BR-138, BR-139 [BR-202, BR-523] | Done. PR #1842 merged (external AI link makes zero server model calls). |
| U-13 (DPDP track) | DPDP-track questions Q-D1 and Q-D2 recorded; PROJEXA keeps only the narrow SECURITY DEFINER guard | BR-128, BR-129 | Guard BR-128 pass (SQL 2026-09-25 07:05Z: 0). |

Order inside the phase: (0) U-14 gate tests are already merged (PR #1837), so the PM re-runs BR-130 on main; (1) U-00 amendment log committed (BR-101); (2) U-01 redaction fix (PR #1839); (3) U-43 zero server model calls on the link; (4) U-15 de-advertise; (5) plan package docs U-02, U-03, U-04, U-05, U-08, U-09, U-10, U-11, U-12 as docs-only PRs; (6) U-07 required check; (7) U-06 read on or after 2026-09-27 07:00 UTC.

**Where each check runs.** Verify forms in this phase: SQL (F1) 2, bun test (F2) 10, script (F3) 10, git count (F4) 13, GitHub read (F5) 1, file test (F6) 2, lint (F7) 1, HTTP read (F9) 1.

- Local, by the PM on the laptop (SELECT-only SQL against live verdian-ai, git, gh reads, python lint, one `bun test --isolate` file at a time at the Normal RAM level): BR-101, BR-102, BR-103, BR-104, BR-105, BR-106, BR-107, BR-108, BR-109, BR-110, BR-111, BR-112, BR-113, BR-114, BR-115, BR-116, BR-117, BR-118, BR-119, BR-120, BR-121, BR-122, BR-123, BR-124, BR-125, BR-126, BR-127, BR-128, BR-129, BR-130, BR-131, BR-132, BR-133, BR-134, BR-135, BR-136, BR-137, BR-138, BR-139, BR-140. Every `bun test` row also runs inside CI Unit Tests on each PR. SQL rows cannot run in CI (no database access, DEV_TEST_DEPLOY_PLAN.md P-09); SQL rows over tenant data run through the Supabase MCP as role postgres with a dated result (PMD-22, PC-22).
- CI only (GitHub Actions; the laptop reads the result with gh): none.
- Needs the owner first (blocked_owner): none.

**Risks and rollback.**

- The redaction fix hides budget and margin figures from roles that used to see them through the API-key path. Intended (PMD-04). Rollback: `git revert <merge_sha>` in a new PR; a security fix carries no switch that re-opens the leak (DEV_TEST_DEPLOY_PLAN.md s2.7).
- De-advertising 13 tools can break an MCP client that lists them; each of the 13 already fails with 'Unknown tool' (MERGE_MAP V1). Rollback: flag BUILD001_MCP_IMPLEMENTED_TOOLS_ONLY off.
- The external link stops calling the internal AI; the 2 active links (last used 2026-08-29) then receive candidate functions instead of a server answer. Rollback: flag BUILD001_EXTERNAL_LINK_ZERO_SERVER_L1 off, which fails closed (Level 0 candidates only).
- A required Secret Scanning check can block merges on a false positive. Rollback: `gh api -X PUT` with the context list recorded in the PR body before the change.
- Until the projexa PR of U-01 merges, PROJEXA assistant users see redacted figures, managers included (PMD-23: intended, fail closed; Vercel is locked, so nothing is live). Rollback of that PR: `git revert` in the projexa repo.
- Low RAM: readings of 0.36 GB and 0.48 GB free while the plan was written (DEV_TEST_DEPLOY_PLAN.md K-11). Only one bun process at a time; no local build.

**Owner-blocked items and exactly what the owner does.**

- No Phase 1 row is blocked_owner.
- BR-116 is date-gated: the earliest run is 2026-09-27 07:00 UTC (end of the Pacific day that starts 2026-09-26 07:00 UTC). If it prints a non-zero charge, owner action A-3: open the Vercel dashboard, team team_Iqx3zyb7sDdsdzcNskCFFsHD, Settings, Billing; look for an add-on line named Speed Insights Plus; if it is active, cancel it there; tell the PM what the page showed.
- BR-119 changes a repository setting. It is not on the Amendment 001 owner-only list (OQ-26), but AM-050 says the PM applies it only after the owner says yes. Until that conflict is settled by a PMD row or the owner's yes, BR-119 waits (PC-14).
- Optional, default no: OQ-03 (metered provider for internal Level 1). Nothing in this phase waits on it.

## Phase 2 - Identity, scope, attribution

**Purpose.** Tie every AI or API write to one project and one real person, and prove every schema change can be undone. This is the one shared dispatch point that protects everything after it (WO s4). It also ports the first PROJEXA scheduled job to the free database scheduler and accepts the universal AI work link spec after its audit.

**Gate.** Phase 2 starts only when every ENTRY row returns YES and is complete only when all 6 EXIT rows return YES. Register rows in this phase: 29. EXIT rows pass today: 0 of 6. EXIT rows at blocked_owner: none.

**ENTRY tests:** BR-201 (plan lint still exits 0), BR-202 (redaction, gate matrix and zero-server-L1 tests still pass). Gap: these restate only BR-108, BR-137 and the redaction group of the 16 Phase 1 EXIT rows, and BR-202 names a test file no Phase 1 row creates. The PM adds `[ENTRY] bash scripts/verify/phase-gate.sh 1` before Phase 2 starts (PC-05, PC-06). That runner includes the date-gated BR-116, so Phase 2 starts no earlier than 2026-09-27 07:00 UTC.

**EXIT tests (6):**

| BR id | what it proves (register title) | status 2026-09-25 |
|---|---|---|
| BR-206 | Aborted-transaction rollback rehearsal logged PASS_ROLLED_BACK (h2 equals h0, down file present) for every migration in PHASE2_MIGRATIONS.txt (fails when a listed migration has no log line) | pending |
| BR-210 | Link minted for project A returns HTTP 403 on a write to project B, 0 rows staged (mutation: remove the project check, test must fail) | pending |
| BR-216 | Amended D-09: key-attributed audit rows with no person in the last 7 days | pending |
| BR-219 | Level 1 gate compares the acting person: RAJAT_USER_ID equal to the org key id and a non-owner actor gives level1_outcome refused on re-read (mutation: compare the key id, test must fail) | pending |
| BR-223 | Exactly one active projexa- pg_cron job on verdian-ai (exchange-rate-refresh via pg_net to Edge Function) | pending |
| BR-228 | Universal AI work link spec accepted: non-author audit file has one AUDIT: PASS line | pending |

**Work items.** Register rows listed are the rows of this phase whose source names the item; rows of the same item in other phases are shown in brackets.

| U id | work | register rows | state on 2026-09-25 |
|---|---|---|---|
| U-16 | Q5 and Q6 answered by PMD-07 and PMD-08 (owner may override) | BR-203 | Done. PMD-07 and PMD-08 recorded (BR-203 pass). |
| U-17 | Rollback proof per schema change: down file, always-aborted rehearsal, PGlite replay (PMD-10) | BR-204, BR-205, BR-206, BR-207 [BR-301] | Done. PR #1847 merged (rollback tooling); BR-204 to BR-207 pass. |
| U-18 | platform.user_ai_links.project_id (NOT NULL for new links), cross-project 403, 2 legacy links revoked | BR-208, BR-209, BR-210 [BR-302, BR-523] | Done. Migrations 0613 (PR #1848) and 0614 (PR #1851) applied live and merged; BR-208, BR-209, BR-290, BR-291 pass. The 2 legacy VERIDIAN chat links keep product veridian (PMD-26). |
| U-19 | compliance.api_keys.project_id nullable with a key_kind check (org_service, project_ai) | BR-211, BR-212, BR-213 | Done. PR #1851 merged; BR-211, BR-212, BR-213 pass. |
| U-20 | Per-request actor attribution: audit_logs.user_id set on every API-key write | BR-214, BR-215, BR-216, BR-217 [BR-303, BR-418, BR-514] | Partly done. U-20a (PR #1844), U-20b (PR #1854) and the PROJEXA side (projexa PR #322: every signed-in call names the person) merged; BR-214 and BR-215 pass. Pending: BR-216 (the 3 older rows leave the 7-day window after 2026-09-26 05:40Z) and BR-217 (needs a real key write through a running API; nothing can run until the owner releases Vercel). |
| U-21 | One PROJEXA job on pg_cron -> pg_net -> Edge Function (exchange-rate-refresh, PMD-12); email digest off projexa vercel.json | BR-205, BR-222, BR-223, BR-224, BR-225, BR-226, BR-227 [BR-305] | Done. Migration 0615 and Edge Function projexa-timer (PR #1850), projexa PR #320 (Vercel digest cron removed); cron projexa-exchange-rate-refresh live; BR-222 to BR-224, BR-226, BR-227 pass. BR-225 waits for a live Vercel project (owner). |
| U-44 | Universal AI Work Link spec accepted after a non-author audit (AUDIT: PASS) | BR-228, BR-229 [BR-306] | Done. Spec accepted after the non-author audit; BR-228 pass (PR #1852). |
| U-45 | Conformance harness: a plain-AI script proves uniform link behaviour without vendor accounts | BR-229 [BR-523] | Done. Harness, mock and self-test merged (PR #1852); BR-229 and BR-280 pass. |
| U-49 | Level 1 gate compares the acting person; level1 telemetry on every path; refusal carries records | BR-218, BR-219, BR-220, BR-221 [BR-304] | Done. PR #1859 merged; BR-219, BR-220, BR-221 pass and BR-304 passes as a phase 3 entry row. |

Order inside the phase: U-16 (already decided) -> U-17 rollback tooling -> U-20 attribution and U-19 key scope -> U-18 link scope (expand, then revoke, then constrain; DEV_TEST_DEPLOY_PLAN.md s2.6 M-12) -> U-49 gate identity; U-21 (cron) and U-44 -> U-45 (link spec, harness) run beside them.

**Where each check runs.** Verify forms in this phase: SQL (F1) 8, bun test (F2) 9, script (F3) 3, git count (F4) 6, GitHub read (F5) 2, lint (F7) 1.

- Local, by the PM on the laptop (SELECT-only SQL against live verdian-ai, git, gh reads, python lint, one `bun test --isolate` file at a time at the Normal RAM level): BR-201, BR-202, BR-203, BR-204, BR-205, BR-206, BR-207, BR-208, BR-209, BR-210, BR-211, BR-212, BR-213, BR-214, BR-215, BR-216, BR-217, BR-218, BR-219, BR-220, BR-221, BR-222, BR-223, BR-224, BR-226, BR-227, BR-228, BR-229. Every `bun test` row also runs inside CI Unit Tests on each PR. SQL rows cannot run in CI (no database access, DEV_TEST_DEPLOY_PLAN.md P-09); SQL rows over tenant data run through the Supabase MCP as role postgres with a dated result (PMD-22, PC-22).
- CI only (GitHub Actions; the laptop reads the result with gh): none.
- Needs the owner first (blocked_owner): BR-225.

**Risks and rollback.**

- Schema changes land on the one shared live database (no staging, P-08). Control: every migration has a down file, an always-aborted rehearsal that must print PASS_ROLLED_BACK with h2 equal to h0, and a PGlite replay (DEV_TEST_DEPLOY_PLAN.md s2.6 M-1..M-12). Rollback: apply the down file after the reverse rehearsal passes.
- Revoking the 2 legacy org-wide links (PMD-08, PMD-24 OD-7) would break the live VERIDIAN chat link that PMD-26 (audit A-05) keeps working. The PM settles PC-21 before U-18 starts. Any revocation keeps the before-image ids in the PR body; rollback is the inverse UPDATE from the down file.
- BR-215 refuses an API-key write that names no acting person (HTTP 400). projexa passes acting-user headers only optionally today (F-A01-6), so projexa writes without the header fail until projexa sends it. Which projexa routes send it is UNVERIFIED. Rollback: flag BUILD001_ACTOR_ATTRIBUTION off.
- The first pg_cron job re-enables exchange-rate writes that have been silent since about 2026-08-23 (PMD-12). Rollback: `cron.alter_job(... active := false)`, then `cron.unschedule`.
- The gate-identity change can refuse a caller that passed before through the org key match (F-A06-2). Rollback: flag BUILD001_GATE_ACTING_PERSON off, which fails closed.

**Owner-blocked items and exactly what the owner does.**

- BR-225 (zero Vercel invocations of the old exchange-rate route over 7 days) needs a live Vercel project. Owner action A-1: say `go live` in chat, recharge the Vercel team credit in Team Billing, unpause veridian-compliance-ai and projexa, tell the PM. It is not an EXIT row; BR-223 is.
- U-16 needs nothing from the owner: PMD-07 and PMD-08 are the defaults. To override, say `Q5: ...` or `Q6: ...` in chat (OQ-12, OQ-13).
- Optional, default no: OQ-04 (paid Supabase branch, 0.01344 USD per hour).

## Phase 3 - Evidence standard

**Purpose.** Stop certifying work from a status column: every requirement row gets a runnable check and evidence. Build the identity gateway that lets a PROJEXA browser session read verdian-ai data safely (PMD-01), prove no service-role key reaches a browser bundle, and make CI run the PROJEXA browser tests.

**Gate.** Phase 3 starts only when every ENTRY row returns YES and is complete only when all 7 EXIT rows return YES. Register rows in this phase: 29. EXIT rows pass today: 0 of 7. EXIT rows at blocked_owner: none.

**ENTRY tests:** BR-301 to BR-306: the 6 Phase 2 EXIT rows restated (BR-206, BR-210, BR-216, BR-219, BR-223, BR-228).

**EXIT tests (7):**

| BR id | what it proves (register title) | status 2026-09-25 |
|---|---|---|
| BR-308 | WO 3.1: zero built=YES register rows without a verify_command (column added by U-22; read through to_jsonb so the query never names a missing column) | pending |
| BR-309 | WO 3.2: all 31 EXC-ITEM rows carry a non-empty verify_command | pending |
| BR-311 | WO 3.6: zero DONE register rows whose evidence_ref is not a commit SHA, a PR number (PR#n) or a dated query result (SQL yyyy-mm-dd: value) | pending |
| BR-313 | WO 3.3: verify:all (bun script in package.json, not npm) runs at least 111 checks against live Supabase with 0 failed (new script scripts/verify/verify-all-local.sh) | pending |
| BR-316 | Required-check list on compliance-tracker main equals the 10 current contexts plus Secret Scanning plus E2E Tests (Env-1, cross-repo) | pending |
| BR-324 | U-25 spike decision recorded: continue with the gateway or fall back to option (c) server-side reads | pending |
| BR-326 | E-08 in CI: job Browser Bundle Service-Role Scan concludes success on compliance-tracker main (mutation: service_role string planted in a use client module fails the job) | pending |

**Work items.** Register rows listed are the rows of this phase whose source names the item; rows of the same item in other phases are shown in brackets.

| U id | work | register rows | state on 2026-09-25 |
|---|---|---|---|
| U-22 | Evidence columns on platform.sumeet_requirements; the 31 EXC-ITEM rows | BR-307, BR-308, BR-309, BR-310, BR-311, BR-312 [BR-401] | Done. Migrations 0616 and 0617 applied to verdian-ai and merged (PR #1860); BR-307, BR-308, BR-309, BR-310, BR-311 pass (decisions PMD-30, PMD-31; follow-up PR #1863). |
| U-23 | verify:all runs at least 111 checks; the deployed-URL half waits for go-live | BR-313, BR-314 | Done. verify:all (111 checks, 0 failed) and the phase-gate runner merged (PR #1870, #1874); BR-313 passes, BR-401 runs the gate for phase 3. |
| U-24 | CI runs the PROJEXA Playwright half and it becomes a required check | BR-315, BR-316 [BR-401] | Done as diagnosis: the Env-1 job fails for two reasons that need the owner (stored test-session secret, BR-315) and a cleanup of test data; BR-316 amended (PMD-29) and passes; Env-1 joins the required list after 3 green full runs. |
| U-25 | Identity gateway on Supabase Edge (PMD-01), key-set spike first, fallback (c) | BR-317, BR-318, BR-319, BR-320, BR-321, BR-322, BR-323, BR-324 [BR-401] | Done. Migration 0618 and Edge Function projexa-read live with the switch OFF (PR #1861); BR-317 to BR-321, BR-323, BR-324 pass; BR-322 waits for a real PROJEXA session from the owner (PMD-32). |
| U-26 | Zero service_role in built browser bundles, scanned in CI | BR-325, BR-326, BR-327 [BR-401] | Done. Scanner and CI job merged (compliance-tracker PR #1855, projexa PR #321), BR-316 lists the job as required, mutation proof recorded (job failed on a planted service_role, run 36131620580); BR-327 pass; BR-326 reads the check on main; BR-325 passes from the required CI job's own log (HITS=0 from a real next build, PR#1880; AM-124). |

Order inside the phase: U-22 columns and rows -> U-23 verify:all; U-25 spike (BR-323, BR-324) before any gateway code; U-24 fix the Env-1 job (BR-315) before it becomes required (BR-316); U-26 CI scan job.

**Where each check runs.** Verify forms in this phase: SQL (F1) 8, bun test (F2) 4, script (F3) 6, git count (F4) 7, GitHub read (F5) 4.

- Local, by the PM on the laptop (SELECT-only SQL against live verdian-ai, git, gh reads, python lint, one `bun test --isolate` file at a time at the Normal RAM level): BR-301, BR-302, BR-303, BR-304, BR-305, BR-306, BR-307, BR-308, BR-309, BR-310, BR-311, BR-312, BR-313, BR-316, BR-317, BR-318, BR-319, BR-320, BR-321, BR-323, BR-324, BR-328, BR-329. Every `bun test` row also runs inside CI Unit Tests on each PR. SQL rows cannot run in CI (no database access, DEV_TEST_DEPLOY_PLAN.md P-09); SQL rows over tenant data run through the Supabase MCP as role postgres with a dated result (PMD-22, PC-22).
- CI only (GitHub Actions; the laptop reads the result with gh): BR-315, BR-326, BR-327.
- Needs the owner first (blocked_owner): BR-314, BR-322.

**Risks and rollback.**

- Filling verify_command for the 61 built=YES rows will show that some DONE rows fail. That is the point (WO s5 RISK): each failure is reported as a finding, and no check is weakened to pass.
- The identity gateway is new security surface (token verification). Control: fail-closed switch PROJEXA_READ_ENABLED (503 when off); no signing secret in source (BR-318). If the key-set spike fails, fall back to option (c), server-side reads (PMD-01, BR-324).
- Making the Env-1 job required while it still fails would block every merge. Control: BR-315 (job succeeds on main) before BR-316 (required list). Rollback: restore the recorded context list.
- Linking the 22 unlinked PROJEXA users writes compliance.users rows (OQ-15). Default: the pilot uses the 92 linked users only; the 22 get a plain 403 USER_NOT_LINKED (BR-319).

**Owner-blocked items and exactly what the owner does.**

- BR-314 (verify:all against a deployed instance) waits for A-1 (go live).
- BR-322 (gateway isolation with a real PROJEXA session): the owner signs in to PROJEXA as a test user of org A and runs `bash scripts/verify/projexa-gateway-isolation.sh` in his own shell with that session; the script reads the token from an environment variable and the token is never written to a file, a PR or chat. The owner tells the PM the printed line (expected `200 404 401 401`).
- BR-325 was marked blocked_owner for a RAM reason (PMD-14), not an owner action (PC-07). It now passes from the log of the required CI job Browser Bundle Service-Role Scan (AM-124); BR-326 stays the gate.

## Phase 4 - One record type on four surfaces

**Purpose.** Prove the four-surface contract once, end to end, for one record type: the BOQ line item (PMD-20). One record id is written from the AI-prepared page, the ERP screen, the AI link and the email inbox, with 4 attributed audit rows. BOQ reads are paginated, and the BOQ screen works in the browser. The AI work link endpoints and the paste-back page land here.

**Gate.** Phase 4 starts only when every ENTRY row returns YES and is complete only when all 9 EXIT rows return YES. Register rows in this phase: 24. EXIT rows pass today: 0 of 9. EXIT rows at blocked_owner: BR-416, BR-417, BR-418, BR-422, BR-423.

**ENTRY tests:** BR-401: runner `bash scripts/verify/phase-gate.sh 3` runs every Phase 3 EXIT row that is not blocked_owner (none is).

**EXIT tests (9):**

| BR id | what it proves (register title) | status 2026-09-25 |
|---|---|---|
| BR-404 | D-11 as amended by PMD-09: default GET /api/v1/construction/boq?projectId= on a fixture of 5,924 BOQ headers and 10,907 line items (shape of project dd486dad, live 2026-09-25; that full read is 7,561,948 bytes of line-item JSON today) returns the current revision's first page only, body under 1,048,576 bytes, route time under 2,000 ms | pending |
| BR-409 | WO 4.5 as amended by M-A04-1: surface 1 route GET /api/v1/projexa/projects/[id]/approvals returns 200 with at least 1 AI-prepared BOQ line-item proposal from proposeSubmission() (run-submission.ts:1197; nothing written) and 1 approve action per proposal that posts to confirmSubmission() (run-submission.ts:1372) | pending |
| BR-416 | WO 4.1: all 4 boq_progress cells in surface_matrix.json are proven and carry 1 distinct record_id (runner scripts/verify/boq-surface-cells.sh, created by this row, runs the 4 cell verify_commands and the boq_progress convergence command; surface 4 needs owner DNS per PMD-06) | blocked_owner |
| BR-417 | WO 4.2: count(distinct surface) in compliance.audit_logs for the boq_progress record_id = 4 (runner scripts/verify/boq-audit-surfaces.sh, created by this row, reads record_id from surface_matrix.json and runs the SELECT through sql-assert.mjs) | blocked_owner |
| BR-418 | WO 4.3: the 4 audit rows for that record_id each have a user_id that exists in compliance.users and an actor_role other than api_key (runner scripts/verify/boq-audit-real-users.sh, created by this row) | blocked_owner |
| BR-420 | E-09: the BOQ screen renders its line items with the network offline after one online load (Playwright spec e2e/boq-offline.spec.ts in projexa, run by scripts/verify/projexa-playwright.sh, created by this row, against a local projexa server with the gateway stubbed by fixture JSON; no session minted, no Vercel) | pending |
| BR-421 | E-10: filtering a 10,907-line fixture runs in a Web Worker and the longest main-thread long task during the filter is under 50 ms (Playwright spec e2e/boq-worker-filter.spec.ts, same local runner as BR-420) | pending |
| BR-422 | E-11: 0 Vercel function invocations on the projexa BOQ read path over 24 h of synthetic traffic (scripts/verify/vercel-boq-invocations-24h.sh, created by this row, read-only Vercel API; exits 1 when the Edge gateway logged 0 synthetic BOQ reads in the same window, non-vacuity); needs an owner-released deploy | blocked_owner |
| BR-423 | E-12: the BOQ screen shell is a static CDN asset with response header x-vercel-cache HIT (scripts/verify/projexa-boq-cdn-hit.sh, created by this row; today scope/[id]/page.tsx reads params and searchParams, so it renders on demand); needs an owner-released deploy | blocked_owner |

**Work items.** Register rows listed are the rows of this phase whose source names the item; rows of the same item in other phases are shown in brackets.

| U id | work | register rows | state on 2026-09-25 |
|---|---|---|---|
| U-27 | BOQ line items read with keyset pagination: body under 1 MB, route under 2,000 ms | BR-403, BR-404, BR-405 [BR-501] | Done. Keyset pagination behind BUILD001_BOQ_KEYSET_PAGINATION merged (PR #1871); BR-403, BR-404, BR-405 pass. PROJEXA must follow nextCursor and ?revision= before the flag is turned on (PMD-36). |
| U-28 | BOQ registry entries create_boq and get_boq_line_items; revision forwards lineItems, override and change-order id | BR-406, BR-407, BR-408 [BR-501] | Done. create_boq, the revision fix (PR #1869) and get_boq_line_items (PR #1875) merged; BR-406, BR-407, BR-408 pass (PMD-34). |
| U-29 | Surface 1: AI-prepared approval page with an approve action | BR-409, BR-410, BR-424 [BR-501] | Not started. |
| U-30 | Q3 (proposals only, PMD-05) and Q4 (DNS owner-only, PMD-06) recorded; Resend inbound records prepared | BR-411, BR-412, BR-414 [BR-521] | Done. Q3 and Q4 recorded and the Resend inbound DNS record list prepared (PR #1865); BR-411 passes; BR-412 (records applied) waits for the owner. |
| U-31 | Email bridge: Resend attachments read; promote dispatches into EXECUTORS as a proposal | BR-413, BR-414, BR-416 [BR-521] | Done on the code side. Migration 0620 (attachments table) live and the webhook and promote-as-proposal merged (PR #1877); BR-413, BR-414 pass; the live email path waits for the owner's DNS step (PMD-38 for the confirm contract). |
| U-32 | One BOQ record id on 4 surfaces with 4 attributed audit rows | BR-402, BR-410, BR-415, BR-416, BR-417, BR-418 [BR-501] | Partly done. Part A: audit_logs.surface (migration 0619, live) and logActivity's optional surface merged (PR #1876), BR-415 passes. Not started: the surface values written by the four surfaces, BR-410, BR-416..418, BR-287. |
| U-33 | Browser-first BOQ: offline load, Web Worker filter, 0 function invocations, CDN HIT | BR-419, BR-420, BR-421, BR-422, BR-423 [BR-501] | Not started. |
| U-46 | Link endpoints on Supabase Edge: Markdown manual, OpenAPI, MCP, REST; one project and one user | BR-424 [BR-523, BR-524] | Not started. |
| U-47 | Paste-back fallback for AIs that cannot reach the URL (ties to surface 1) | BR-424 [BR-524] | Not started. |

Order inside the phase: U-27 pagination -> U-28 registry entries -> U-29 surface 1 -> U-30 records and U-31 email bridge (live half waits for DNS) -> U-32 convergence; U-33 after U-25 and U-26; U-46 -> U-47 after U-18 and U-45.

**Where each check runs.** Verify forms in this phase: SQL (F1) 1, bun test (F2) 10, script (F3) 11, git count (F4) 2.

- Local, by the PM on the laptop (SELECT-only SQL against live verdian-ai, git, gh reads, python lint, one `bun test --isolate` file at a time at the Normal RAM level): BR-401, BR-402, BR-403, BR-404, BR-405, BR-406, BR-407, BR-408, BR-409, BR-410, BR-411, BR-413, BR-414, BR-415, BR-419, BR-424. Every `bun test` row also runs inside CI Unit Tests on each PR. SQL rows cannot run in CI (no database access, DEV_TEST_DEPLOY_PLAN.md P-09); SQL rows over tenant data run through the Supabase MCP as role postgres with a dated result (PMD-22, PC-22).
- CI only (GitHub Actions; the laptop reads the result with gh): BR-420, BR-421.
- Needs the owner first (blocked_owner): BR-412, BR-416, BR-417, BR-418, BR-422, BR-423.

**Risks and rollback.**

- Keyset pagination changes the BOQ response shape; the three projexa proxy routes forward no cursor today (AM-088). Rollback: flag BUILD001_BOQ_KEYSET_PAGINATION off (old unpaginated read).
- The audit_logs surface column is a migration on a busy table: nullable and additive, with a down file (U-17 rules).
- The email surface is DNS-blocked and DNS is owner-only (PMD-06). The phase is reported blocked on owner, never complete with 3 of 4 surfaces (WO s6 RISK). Flag BUILD001_EMAIL_BRIDGE stays off until DNS is live.
- Browser-first flags (BUILD001_BOQ_READ_VIA_GATEWAY, BUILD001_BOQ_BROWSER_FIRST in projexa) stay off until BR-420 and BR-421 pass.

**Owner-blocked items and exactly what the owner does.**

- BR-412 then BR-416, BR-417, BR-418: owner action A-2. In the Resend dashboard open the Inbound setup for projexa-ai.com and for veridian-aios.com, copy the MX record Resend shows for each, and add it at each domain's DNS host. Leave the existing bare-domain MX of veridian-aios.com (Google Workspace) alone. Then say `DNS applied for <domain>` in chat. The exact MX host names and priorities are UNVERIFIED: Resend generates them per domain and no input file holds them.
- BR-422 and BR-423 (E-11 zero function invocations, E-12 CDN HIT): owner action A-1 (go live) plus one owner-released deploy of the BOQ screen.

## Phase 5 - Replicate, then perception

**Purpose.** Replicate the proven contract to all 7 record types (28 cells), create projects from documents by extending the existing extraction service, finish the registry, implement or drop the unrunnable MCP tools, move scheduled writes to pg_cron, cut Vercel crons to 1, and hold the 20 USD monthly ceiling. The owner acceptance run of the AI work link closes the phase.

**Gate.** Phase 5 starts only when every ENTRY row returns YES and is complete only when all 10 EXIT rows return YES. Register rows in this phase: 26. EXIT rows pass today: 0 of 10. EXIT rows at blocked_owner: BR-510, BR-521, BR-524.

**ENTRY tests:** BR-501: runner `bash scripts/verify/phase-gate.sh 4` runs every Phase 4 EXIT row that is not blocked_owner (BR-404, BR-409, BR-420, BR-421).

**EXIT tests (10):**

| BR id | what it proves (register title) | status 2026-09-25 |
|---|---|---|
| BR-503 | 5.4 COST_BUDGET.csv: per-call ceiling on every extraction path; projected monthly Vercel gross <= 20.00 (creates scripts/verify/cost-budget.sh) | pending |
| BR-507 | 5.3 planted prompt-injection document gives a schema-validation rejection with 0 createProject() and 0 createBoq() calls | pending |
| BR-508 | 5.2 POST projects/from-document route test: second submit of the same file returns the first project id (1 insert; reuses createProject()/createBoq()) | pending |
| BR-510 | E-13 over 7 days: Vercel invocations attributable to extraction = 0 while projexa-document-extract Edge invocations >= 1 (creates read-only scripts/verify/extraction-invocations-7d.sh) | blocked_owner |
| BR-514 | 5.5 /api/mcp tools/list names only tools with a handleTool branch; each construction tool refuses a call that carries no person or role | pending |
| BR-518 | E-14 on main: compliance-tracker vercel.json has 1 cron and 0 */N schedules; projexa vercel.json has 0 crons | pending |
| BR-520 | 5.1 part A: 17 cells proven (6 record types other than boq_progress on s1-s3; billing_claim s3 excluded; boq_progress cells are BR-416) (creates scripts/verify/surface-cells.sh) | pending |
| BR-521 | 5.1 part B: the 6 email-inbox cells (s4) of the record types other than boq_progress proven | blocked_owner |
| BR-522 | 5.1 part C: billing_claim cell on s3 proven under PMD-41 (the link proposes, a person with the billing role approves) | pending |
| BR-524 | Owner acceptance run: 9 AI families marked pass in AI_FAMILY_ACCEPTANCE.csv with one pasted link each | blocked_owner |

**Work items.** Register rows listed are the rows of this phase whose source names the item; rows of the same item in other phases are shown in brackets.

| U id | work | register rows | state on 2026-09-25 |
|---|---|---|---|
| U-34 | Q1 build order recorded (PMD-03) | BR-502 | Not started. |
| U-35 | COST_BUDGET.csv per-call ceilings; projected Vercel gross at most 20.00 USD a month | BR-503, BR-504 | Done. COST_BUDGET.csv and the check merged (PR #1866); BR-503 passes. |
| U-36 | Extraction: extend document-extraction-service.ts (every xlsx sheet, BOQ/project schema, Edge model call, idempotent, schema-validated) | BR-505, BR-506, BR-507, BR-508, BR-509, BR-510, BR-511, BR-525 | Not started. |
| U-37 | POST projects/from-document reusing createProject() and createBoq() | BR-508, BR-509, BR-525 | Not started. |
| U-38 | Remaining registry entries incl. create_drawing and create_mom traps; billing claims read-only | BR-512, BR-513, BR-522, BR-525 | Not started. |
| U-39 | /api/mcp: implement or drop the 13 construction and GST tools, with person and role | BR-514, BR-525 | Done. Tests for the two MCP surfaces (PR #1867) and the fix that a link whose person is no longer active cannot act (PR #1868, PMD-33); BR-514 passes. |
| U-40 | Scheduler bridge: pg_cron -> Edge -> runSubmission as the schedule owner | BR-511, BR-515, BR-516, BR-517, BR-525 | Not started. |
| U-41 | Vercel crons: 1 in compliance-tracker, 0 in projexa, none */N; crons drift guard | BR-516, BR-518, BR-519 [BR-328, BR-329] | Partly done. The crons drift guard is merged (PR #1862): BR-328 and BR-329 pass. Cutting vercel.json to one cron (BR-518, BR-519) waits for the owner release with the go-live pack (draft PR #1808). |
| U-42 | All 28 surface cells proven | BR-520, BR-521, BR-522 | Not started. |
| U-48 | Owner acceptance run across the 9 AI families | BR-524 | Not started. |

Order inside the phase: U-34 (already decided) and U-35 cost budget -> U-36 extraction -> U-37 from-document and U-38 registry (U-38 needs U-36, PMD-03) -> U-40 scheduler bridge -> U-41 crons; U-39 any time after U-01 and U-20; U-42 last; U-48 after U-46 and U-47.

**Where each check runs.** Verify forms in this phase: SQL (F1) 2, bun test (F2) 8, script (F3) 10, git count (F4) 4, GitHub read (F5) 1.

- Local, by the PM on the laptop (SELECT-only SQL against live verdian-ai, git, gh reads, python lint, one `bun test --isolate` file at a time at the Normal RAM level): BR-501, BR-502, BR-503, BR-505, BR-506, BR-507, BR-508, BR-511, BR-512, BR-513, BR-514, BR-515, BR-516, BR-518, BR-519, BR-520, BR-523, BR-525. Every `bun test` row also runs inside CI Unit Tests on each PR. SQL rows cannot run in CI (no database access, DEV_TEST_DEPLOY_PLAN.md P-09); SQL rows over tenant data run through the Supabase MCP as role postgres with a dated result (PMD-22, PC-22).
- CI only (GitHub Actions; the laptop reads the result with gh): none.
- Needs the owner first (blocked_owner): BR-504, BR-509, BR-510, BR-517, BR-521, BR-524.

**Risks and rollback.**

- Gross-basis tension: with Speed Insights Plus off, the Pro fee alone is 20.00 USD per 31-day month on gross charges (A08), so any billed build pushes the projection over 20.00. BR-503 passes only with 0 billed builds in the month, or if the owner moves the measure to net (OQ-07).
- LLM cost has no ceiling in the original design (WO s7 RISK). Control: per-call ceilings in COST_BUDGET.csv (BR-503); extraction model calls only in the projexa-document-extract Edge Function (E-13).
- Prompt injection through an uploaded document. Control: schema validation before createProject() and createBoq() (BR-507); a planted payload must produce a rejection and 0 writes.
- vercel.json is under the PROJEXA-COST-001 claim and draft PR #1808. U-41 edits are prepared on a branch and merged only with the owner release (DEV_TEST_DEPLOY_PLAN.md s2.5).
- The 10 prepared cost001 pg_cron jobs belong to veridian-compliance, not PROJEXA; their READMEs carry open decisions (register_part_5_notes.md item 6). None is enabled by this plan without a recorded decision.

**Owner-blocked items and exactly what the owner does.**

- BR-504: A-1 (go live), then 30 completed Pacific days.
- BR-509: the owner chose the provider on 2026-09-25 (PMD-43): the Groq floor tier with a hard cap of 1 USD, guarded by BR-526. What waits for the owner is one command that sets the provider key as an Edge Function secret; the PM writes no credential. Until then extraction runs only against the mocked model in tests (BR-506, BR-507).
- BR-510 and BR-517: A-1 (go live); BR-517's last hop runs in the deployed app.
- BR-521: A-2 (DNS), same records as Phase 4.
- BR-522: decided by the owner on 2026-09-25 (PMD-41): an AI link proposes a billing claim and a person with the billing role approves it. The row is back at pending and needs no owner action.
- BR-524: the owner pastes one link into each of the 9 AI families with his own accounts and records pass or fail per family in AI_FAMILY_ACCEPTANCE.csv (spec s15, OT-01..OT-17).
- U-41: BR-518 and BR-519 pass only after the vercel.json edits merge. DEV_TEST_DEPLOY_PLAN.md s2.5 merges them with the owner release (PR #1808, PROJEXA-COST-001 claim), so both rows wait for A-1 unless the PM decides to land U-41 on its own (register_part_5_notes.md item 2). Merging a vercel.json edit while ignoreCommand is `sh -c 'exit 0'` builds nothing.

## Dependency graph

One line per unified item: `item: prerequisites`. Copied from MERGE_MAP.md section 4, which already carries the PM patch (U-25 rewritten, U-43..U-49 added). One edge is added here: U-38 needs U-36, because PMD-03 puts extraction before the remaining registry entries (AMENDMENT_LOG AM-093).

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
U-38: U-28, U-36
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

Acyclic: checked by depth-first search over the 50 nodes on 2026-09-25 (no back edge). Every prerequisite sits in the same or an earlier phase.

**Critical path.** The longest prerequisite chain has 10 items. 45 chains share that length, and every one runs through the same spine: U-00 -> (U-02, U-03 or U-04) -> U-05 -> U-16 -> U-17 -> (U-18, U-19 or U-20) -> U-28. After U-28 the chains end in one of five tails: U-37 -> U-40 -> U-41; U-37 -> U-40 -> U-42; U-29 -> U-32 -> U-42; U-31 -> U-32 -> U-42; U-29 -> U-47 -> U-48. The chain MERGE_MAP.md names (U-00 -> U-02 -> U-05 -> U-16 -> U-17 -> U-18 -> U-28 -> U-37 -> U-40 -> U-41) is one of them. Plain meaning: nothing in Phases 4 and 5 moves until the plan package (U-05), the rollback tooling (U-17), the three scope and attribution items (U-18, U-19, U-20) and the BOQ registry entries (U-28) are done.

**Owner-blocked rows on the critical tails.** DNS (BR-412, BR-416..BR-418, BR-521) holds U-30, U-31, U-32 and U-42 short of done; U-48 needs the owner's AI accounts (BR-524); the U-41 vercel.json edits merge with the owner release unless the PM lands them on their own. Under the item start rule (section 3, rule 4), U-40 and U-41 still start once BR-411 passes; BR-412 (DNS) does not hold them.

## Gap closure matrix

One row per finding in gaps_master.json (100 findings). Generated from gaps_master.json and the register parts by `plan/_mk_master_plan.py`, so no id is missed. Columns: the unified id(s) that own the fix; the phase(s) of the register rows that close it (`none` for another track); the closing register rows or the disposition.

Legend: `BR-nnn` = register rows whose source cites the finding; `also BR-nnn` = rows that test the same defect without citing it; `AWL-xxx` = rows of the AI work link spec register (AWL_BOOLEAN_REGISTER.csv, 45 rows) that do not have a BR id yet (section 9); `AM-nnn` = amendment log rows whose test is not yet a register row (PC-13). `F-S02-n` = defects of the AI work link audit S02; the one-line text names the audit id A-nn, because the two numberings differ after 11. Dispositions: DPDP_TRACK, AI_OS_TRACK, OWNER_DECISION, DONE, REJECTED_WITH_EVIDENCE, DEFERRED_LOW_WITH_REASON.

| finding id | severity | one-line finding | unified id | phase | register ids or disposition |
|---|---|---|---|---|---|
| F-A06-1 | high | External AI link (mcp/[token]) makes its own server-side Level 1 call and refuses non-owners | U-43 | 1 | BR-137; also BR-138, BR-139 |
| F-A06-2 | high | Gate identity on the PROJEXA proxy is the org API key, so one match covers every user of that org | U-49 | 2 | BR-219 |
| F-A06-3 | medium | level1 telemetry is written only on the submitForVerdict path; 51 of 58 rows unmeasured | U-49 | 2 | BR-220 |
| F-A06-4 | medium | Refusal dead end (bare sentence, HTTP 400 or -32000) still live on 5 paths | U-49 | 2 | BR-221 |
| F-A06-5 | low | The L2 nightly batch cannot run on any subscription provider, owner included | U-14 | none | AI_OS_TRACK: L2 tooling belongs to the VERIDIAN AI-OS track (PMD-18); the only provider that runs it is metered openrouter, an owner-only spend decision (OQ-03) |
| F-A02-1 | high | The 31 exceptions items had no ids, so the D-02 test could not run as written | U-04, U-22 | 1, 3 | BR-114; BR-307; BR-309 |
| F-A02-2 | medium | Register evidence and closure data missing behind DONE and CLOSED claims | U-22, U-23 | 3 | BR-308; BR-311; BR-313 |
| F-A02-3 | low | platform.sumeet_gap has 31 rows but is not the exceptions directive | U-04, U-22 | 1, 3 | BR-307; also BR-115 (gap_refs=0) |
| F-A02-4 | low | KT doc says 24 detector functions; code exports 23 find* functions plus getProjectExceptions | U-04 | none | DEFERRED_LOW_WITH_REASON: code wins over KT files (section 2); 24 exports = 23 find* + getProjectExceptions; no register row depends on the detector count; the 31 ids come from the service header at 6d531f53 (PMD-17) |
| F-A02-5 | low | 7 of the 31 exceptions are PARTIAL per an AI-written report, not re-verified | U-23 | 3 | BR-313 (each of the 111 gets a runnable check; a PARTIAL item fails its check and is reported) |
| F-A05-1 | high | API-key audit rows can never carry a user (audit.ts:114-116; 267 of 267 rows user_id null) | U-20 | 2 | BR-214; BR-216; also BR-217 (non-vacuity) |
| F-A05-2 | high | Browser-direct BOQ reads need grants and a JWT tenant helper, not only policies | U-25 | 3 | BR-320; BR-321 (PMD-01 gateway replaces browser-direct reads) |
| F-A05-3 | medium | The 10,907-line BOQ is test residue; the largest real BOQ has 153 lines | U-27, U-36 | 4, 5 | BR-403; BR-404; BR-506 |
| F-A05-4 | medium | Four migration ledgers disagree (449 files, 442 journal, 438 and 655 ledger rows) | U-17 | 2 | BR-206; also BR-207 |
| F-A05-5 | medium | The BOQ list route returns every revision with every line item (7,561,948 bytes on the largest project) | U-27 | 4 | BR-404; also BR-405 (mutation partner) |
| F-A05-6 | low | Addendum table counts by schema do not reproduce live | U-11 | 1 | BR-125 (dated counts in SHARED_BOUNDARY.md) |
| F-A03-1 | medium | Spec's 14-function write ceiling vs EXECUTORS with 27 functions (7 writes, 20 reads) | U-03 | 1 | BR-113 |
| F-A03-2 | medium | WO asks NOT NULL project_id where the spec proposes nullable, settling Q6 in advance | U-18, U-19 | 2 | BR-208; BR-211 (PMD-08 split) |
| F-A03-3 | medium | Trap: platform.sumeet_gap (31 rows) is not the 31-item exceptions directive | U-22 | 1, 3 | BR-307; also BR-115 |
| F-A03-4 | low | Register row R-98 is stale: sourceChangeOrderId linkage exists in code | U-28 | 4 | BR-408 |
| F-A03-5 | medium | The spec's 'trust this boundary' covers only the server path; 0 construction_* policies name authenticated or public | U-25 | 3 | BR-320; BR-321 |
| F-A03-6 | medium | Spec Gap 9 puts autonomous work on Vercel crons, against the Addendum's pg_cron design | U-40 | 5 | BR-515; BR-516 |
| F-A04-1 | high | Surface 3 is split across two unrelated AI-link token systems | U-44, U-46 | 2, 5 | BR-228; BR-523 (neither row cites it). PMD-16 names the canonical link. Closing tests AWL-S08 and AM-038 are not yet register rows (section 9, PC-13) |
| F-A04-2 | medium | compliance.audit_logs has no surface column, so the convergence tests have no data source | U-32 | 4 | BR-415 |
| F-A04-3 | medium | Exceptions have no persisted record, so one record_id is undefined for 1 of 7 types | U-12, U-42 | 1, 5 | BR-520; also BR-127 (PMD-19) |
| F-A04-4 | low | The spec's record-type list disagrees with the owner's 7 | U-12 | 1 | BR-127 |
| F-A04-5 | low | Punch list is missing from the one-page project view | U-42 | 5 | BR-520 |
| F-A04-6 | low | The Phase 4 record type is named two ways (BOQ line items, BOQ progress) | U-32 | 4 | BR-402 (PMD-20) |
| F-A08-1 | high | Speed Insights Plus is a team-level license that kept billing at 0 projects | U-06 | 1 | BR-116 (date-gated 2026-09-27) |
| F-A08-2 | medium | Cumulative Vercel spend 29.24 USD since 2026-08-26, above the 20 USD cap | U-35 | 5 | BR-503 (reported, PMD-13) |
| F-A08-3 | low | Billing API needs one call per day and has no per-project split | U-06, U-35 | 1, 5 | BR-117; BR-504 |
| F-A08-4 | low | Billing day boundary is 07:00Z (Pacific midnight), not 00:00Z | U-06, U-35 | 1, 5 | BR-117; BR-504 |
| F-A01-1 | medium | Three projexa routes call compliance-tracker endpoints that do not exist | U-02 | 1 | BR-111 (flags them; the fix test AM-009 is not yet a register row; route choice OQ-28) |
| F-A01-2 | low | Module names 'ai' and 'organization'/'org' are not counterparts across the repos | U-02 | 1 | BR-110 |
| F-A01-3 | low | Chain-options logic exists in both repos | U-02 | 1 | BR-110 |
| F-A01-4 | medium | Two AI-link implementations exist (projexa ai/[token] and compliance-tracker mcp/[token]) | U-44, U-46 | 2, 5 | BR-228; BR-523 (neither row cites it). PMD-16 names the canonical link. Closing test AWL-S08 is not yet a register row (section 9) |
| F-A01-5 | low | 16 compliance-tracker-only modules have no projexa consumer | U-02 | 1 | BR-110 (listed in the sitemap; decision OQ-28) |
| F-A01-6 | medium | projexa mixes the shared org API key with its own role gates | U-20 | 2 | BR-215 |
| F-A07-1 | medium | AGENTS.md Rule 9 names a guardrail check job and script that do not exist | U-05 | 1 | BR-107 (records it; the fix is AI_OS_TRACK, SHARED_BOUNDARY.md F-8) |
| F-A07-2 | medium | The 10 prepared PG_CRON replacements are not applied and would re-enable writes off since about 23 Aug | U-21, U-41 | 2, 5 | BR-223; BR-519 |
| F-A07-3 | low | exchange-rate-refresh is a clean E-04 candidate (fetch plus upsert, no LLM) | U-21 | 2 | BR-224 |
| F-A07-4 | medium | E-04's cron.job check cannot run on PROJEXA's own Supabase project | U-21, U-11 | 2, 5 | BR-222; BR-223; BR-511; BR-516 (PMD-12: jobs live on verdian-ai) |
| F-A07-5 | low | The COST-001 runner cannot cover crr-catchup-worker or run yet | U-41 | 5 | BR-519 |
| F-A07-6 | low | vercel-lockdown.test.ts does not guard the crons array | U-41 | 3 | BR-328; BR-329 |
| F-A09-1 | critical | Identity split: PROJEXA users have no identity that verdian-ai accepts; no bridge exists | U-25 | 3 | BR-317; BR-319; also BR-318, BR-320, BR-322, BR-324 |
| F-A09-2 | high | 22 of 114 PROJEXA auth users are not linked to compliance.users | U-25 | 3 | BR-319 (unlinked user gets 403 USER_NOT_LINKED; linking the 22 is OQ-15, proposed default: pilot on the 92 linked) |
| F-A09-3 | medium | [removed from the public copy: see the private KT folder] | U-11 | 1 | BR-125 (recorded as F-1 in SHARED_BOUNDARY.md; the fix is AI_OS_TRACK, PMD-18, OQ-30) |
| F-A09-4 | medium | dpdp-monday-digest has never run; only dpdp-legal-clocks is proven | U-10 | 1 | BR-123; BR-124 (BR-124 pass: SQL 2026-09-25 07:05Z: 3) |
| F-A09-5 | low | check-register-consistency.mjs fails every run with PGRST106 | U-22 | 3 | BR-312; BR-323 |
| F-A09-6 | low | PROJEXA PostgREST served 36,952 memberships reads in one day | U-25 | none | DEFERRED_LOW_WITH_REASON: Supabase load on the PROJEXA project, not a Vercel cost and not a correctness defect; no BUILD-001 row depends on it; re-measure after U-25 and U-33 change the read path |
| F-A12-1 | medium | Three scheduled workflows fail on every run | U-08, U-21 | 1, 2 | BR-106; also BR-226 (projexa Email Digest Poll removed); Domain Ownership Drift Check is AI_OS_TRACK |
| F-A12-2 | medium | Deploy documents are stale and contradict R87 | U-05 | 1 | BR-105 |
| F-A12-3 | low | git show truncates output on this laptop | U-05 | 1 | BR-105 |
| F-A12-4 | high | No batch-release mechanism: each green merge would build once Vercel is live | U-35 | 5 | BR-503 (PMD-11: releases stay owner-approved manual deploys; AM-076 check not yet a register row) |
| F-A12-5 | medium | Only 2 of 5 deployed verdian-ai Edge Functions have source in the repo | U-11 | 1 | BR-125 (recorded; the 3 functions without source are AI_OS_TRACK, PMD-18) |
| F-A12-6 | low | Older worktrees hold full node_modules copies | U-05 | 1 | BR-105 |
| F-A11-1 | high | Redaction leak also reaches PROJEXA internal chat (API-key path, executor.ts:372) | U-01 | 1 | BR-132; BR-133; BR-134; BR-135; also BR-136 |
| F-A11-2 | medium | The extraction service already exists at the path Gap 2 proposes to create | U-36 | 5 | BR-505 |
| F-A11-3 | medium | WO tests 3.1, 3.6 and 4.2 query columns that do not exist | U-22, U-32 | 3, 4 | BR-308; BR-311; BR-415 |
| F-A11-4 | medium | The compliance MCP door runs on the service-role client with no person or role | U-39 | 5 | BR-514 |
| F-A11-5 | low | OCID-056 removal and the secret-scan job were already done in part | U-00, U-07 | 1, 3 | BR-103; BR-118; BR-316 (BR-103 and BR-118 pass) |
| F-A11-6 | low | D-09 attribution gap is live but small (3 rows in 7 days, 267 all-time) | U-20 | 2 | BR-216 |
| F-A10-1 | medium | E-08 as worded fails on a correct codebase (comments match) | U-26 | 3 | BR-325; BR-326; BR-327 (BR-325 is blocked_owner, see PC-07) |
| F-A10-2 | high | Cross-project identity gap blocks browser-first BOQ | U-25 | 3 | BR-317; BR-319; BR-322 |
| F-A10-3 | low | Email digest has two triggers (daily Vercel cron plus 15-minute workflow) | U-21 | 2 | BR-226; BR-227 |
| F-A10-4 | medium | llm-client.ts has a Node-only supervision path, so no straight Edge copy | U-36 | 5 | BR-505; BR-510 |
| F-A10-5 | low | Import-graph reachability behind EDGE_CANDIDATES.csv is coarse | U-09 | 1 | BR-122 |
| F-R10-1 | high | PROJEXA has a third AI-link mechanism (M4, org_ai_link, plaintext token, no expiry) | U-44, U-46 | 2 | BR-228 (the spec audit settles M4: PMD-16 projection or spec retirement). Closing test AWL-S08 is not yet a register row (section 9) |
| F-R10-2 | high | M4 public snapshot returns the construction dashboard with no role redaction | U-01 | 1 | BR-134 (point 3 fix at the assistant route M4 calls; the projexa-side test AM-022 is not yet a register row) |
| F-R10-3 | high | M1 link tokens are plaintext with no expiry, scope, project, rate limit or call log | U-18, U-46 | 2 | BR-208; BR-209 (project scope; neither row cites it). Hashing, expiry and rate limit: AWL-D01, AWL-D12, AWL-S07, AWL-H09 and AM-097, not yet register rows |
| F-R10-4 | medium | M1 MCP tools call runSubmission (internal AI path) and do not check projectId | U-43, U-18 | 1, 2 | BR-210; also BR-139 |
| F-R10-5 | medium | DPDP M3 rate limit lets calls through when call logging errors | U-46 | none | DPDP_TRACK (PMD-18; dpdp-ai-link is DPDP-owned). The PROJEXA link refuses a call when its call log fails (spec D-10) |
| F-R10-6 | low | Every GET on a DPDP M3 link writes to the database | U-46 | none | DPDP_TRACK (PMD-18) |
| F-R10-7 | low | M5 route /api/dpdp/ai/[token] is dead code | U-46 | none | DPDP_TRACK (PMD-18). Spec row AWL-S09 proposes removing it, which conflicts with PMD-18 (section 9, A3) |
| F-R10-8 | low | dpdp.ai_link preauth policy allows SELECT of all link rows with no org context | U-46 | none | DPDP_TRACK (PMD-18). The PROJEXA link does not copy this policy (spec audit point, section 9) |
| F-R10-9 | low | /api/mcp advertises worker_agents tools it does not implement | U-15 | 1 | BR-131 |
| F-R10-10 | info | Deployed dpdp-ai-link Edge Function equals origin/main | U-46 | none | DONE: verified 2026-09-25, no defect; the method is reused as DEV_TEST_DEPLOY_PLAN.md ED-5 |
| F-S02-1 | high | Link reads over GET write submission, task, pill and chain rows, against the spec's own rule that a GET changes nothing (audit A-01) | U-46, U-44 | 2 | BR-228 (spec text fix per PMD-26 A-01: POST-only reads in a read-only executor mode); the audit A-01 test is not yet a register row (PC-23) |
| F-S02-2 | high | Dashboard redaction below manager rank misses ledgerBudget and progressByBoqValuePct (audit A-02) | U-01 | 1 | BR-132; BR-133 (neither row cites it). PMD-26: fixed in PR #1839 (open); a row that asserts both fields are null below manager rank is not yet in the register (PC-23) |
| F-S02-3 | high | A demoted user keeps link write power: level and functions are checked only when the link is made (audit A-03) | U-46, U-49 | 2 | BR-228 (spec text fix per PMD-26 A-03: effective level computed on every call); the audit A-03 test is not yet a register row (PC-23) |
| F-S02-4 | high | A link installed in a shared workspace connector becomes a shared credential and misattributes writes (audit A-04) | U-44, U-48 | 2, 5 | BR-228 (spec text: single-owner connectors only, PMD-26 A-04); BR-524 (owner acceptance, incl. OT-18) |
| F-S02-5 | high | NOT NULL project_id on every link row breaks the live VERIDIAN chat link (audit A-05) | U-18 | 2 | BR-208; BR-209 (neither row cites it; both change under PMD-26, PC-21) |
| F-S02-6 | medium | The spec re-creates DPDP's database-side link helpers instead of reusing them (audit A-06) | U-46 | none | OWNER_DECISION: OD-13b recorded by the PM under the owner's 2026-09-25 delegation (PMD-26): the copy is exception EXC-DUP-1 for this increment; unification waits for the DPDP track's agreement in ACTIVE-CLAIMS |
| F-S02-7 | medium | Writes through Vercel (option A) were the automatic fallback, against Addendum A1 (audit A-07) | U-46 | 2 | BR-228 (spec text per PMD-26 A-07: no writes through Vercel; every link level 0 until spike S-1 passes) |
| F-S02-8 | medium | 15 AWL register tests need psql, which this laptop lacks (audit A-08) | U-05, U-45 | 1 | BR-109 (SQL runner self-test; runner merged in PR #1838, PMD-22); the AWL rows move to the SQL runner form when they get BR ids (section 9, A7) |
| F-S02-9 | medium | Record filters and sort order can recover hidden money columns (audit A-09) | U-46 | 2 | BR-228 (spec text: per-kind filter and sort allow-list); the audit A-09 test is not yet a register row (PC-23) |
| F-S02-10 | medium | The default idempotency key drops genuine repeats and a failed intent locks its key (audit A-10) | U-46 | 2 | BR-228 (spec text); the audit A-10 test is not yet a register row (PC-23) |
| F-S02-11 | medium | The same-project check for rosterId and issueId runs only at the Edge step (audit A-11) | U-18, U-46 | 2 | BR-228 (spec text); related BR-210 (a project A link is refused on project B); the audit A-11 executor test is not yet a register row (PC-23) |
| F-S02-12 | medium | A browser-driving AI can press Confirm on the level-1 inbox page (audit A-14) | U-47 | 2 | BR-228 (spec text: threats T7 and T17; W-C and W-D writes rated as direct writes) |
| F-S02-13 | medium | Email link scanners can run the confirm page and click (audit A-15) | U-47 | 2 | BR-228 (spec text per PMD-26 A-15: a typed 4-character code, no POST on page load); the audit A-15 test is not yet a register row (PC-23) |
| F-S02-14 | medium | Text written through the link reaches the internal AI and other users without data fencing (audit A-16) | U-46 | 2 | BR-228 (spec text); the audit A-16 test is not yet a register row (PC-23) |
| F-S02-15 | medium | Claude web fetch may reject JSON while the manifest read URLs default to JSON (audit A-22) | U-46 | 2, 5 | BR-228 (spec text: Markdown by default); BR-523 (conformance against the Edge URL) |
| F-S02-16 | low | The call log has no retention and the throttle's IP header is not named (audit A-12) | U-46 | 2 | BR-228 (spec text; the audit fixes LOW items before the vendor acceptance step) |
| F-S02-17 | low | The 24-hour age check on an unsigned proposal cannot be enforced (audit A-13) | U-46 | 2 | BR-228 (spec text) |
| F-S02-18 | low | Exfiltration through AI-built URLs is missing from threat T7 and the warning sentence (audit A-17) | U-44 | 2 | BR-228 (spec text) |
| F-S02-19 | low | Spec fact F-12 lists 2 executor values; the live enum has 3 (audit A-18) | U-44 | 2 | BR-228 (spec text) |
| F-S02-20 | low | Two token-leak residuals are missing: vendor fetch caches and browser history (audit A-19) | U-44 | 2 | BR-228 (spec text) |
| F-S02-21 | low | Several AWL register tests are flawed (placeholder, always-true check, wrong status codes) (audit A-20) | U-45 | 2 | BR-228 (spec text); the AWL rows are corrected when they get BR ids (section 9, A7) |
| F-S02-22 | low | MCP search and fetch output has no stated redaction and no token-free url rule (audit A-21) | U-46 | 2, 5 | BR-228 (spec text); BR-523 (conformance against the Edge URL) |
| F-S02-23 | low | FETCHED-S01 vendor facts have no archived copy and some source labels are overstated (audit A-23) | U-44 | 2 | BR-228 (spec text) |

Totals: 100 findings. 65 are closed by register rows that cite them. 26 have register rows that do not cite them yet and need the fixes named in their row: F-A04-1, F-A01-4, F-R10-1, F-R10-3, F-S02-1, F-S02-2, F-S02-3, F-S02-4, F-S02-5, F-S02-7, F-S02-8, F-S02-9, F-S02-10, F-S02-11, F-S02-12, F-S02-13, F-S02-14, F-S02-15, F-S02-16, F-S02-17, F-S02-18, F-S02-19, F-S02-20, F-S02-21, F-S02-22, F-S02-23. 9 carry a disposition only: AI_OS_TRACK 1, DEFERRED_LOW_WITH_REASON 2, DONE 1, DPDP_TRACK 4, OWNER_DECISION 1.

## 9. The universal AI work link workstream

**Owner requirement (2026-09-25, OWNER_REQUIREMENT_AI_WORK_LINK_2026-09-25.md).** One link that a person copies into any AI chat, AI API, AI inside email or AI on the laptop. Many chat AIs have no login, so the link itself carries an access token for one user and one project, and the external AI does the work directly. Families named by the owner: ChatGPT, Gemini, Claude, DeepSeek, Z.ai, Copilot, Microsoft AI, AI in email, AI on the laptop. Binding directives: the external AI is Level 1 and the software is Level 0; when the link is used the internal AI does not run; the APIs serve only that project and user; one link per project and user; do not duplicate, use what exists; Vercel use stays minimal.

**Placement.** After Phase 1, not beside it (master handoff PART 3.7). Phase 1 carries only U-43, which makes the existing link stop calling the internal AI. Link implementation (U-46) starts only after project scoping U-18 (PMD-16), because a token cannot be project-scoped before the column exists.

| U id | phase | work | prerequisites | register rows |
|---|---|---|---|---|
| U-43 | 1 | External AI link makes zero server model calls; a Level 0 miss returns candidate functions and missing parameters (PMD-02) | U-14 | BR-137, BR-138, BR-139, BR-202, BR-523 |
| U-44 | 2 | Universal AI Work Link spec accepted after a non-author audit (AUDIT: PASS) | U-05 | BR-228, BR-229, BR-306 |
| U-45 | 2 | Conformance harness: a plain-AI script proves uniform link behaviour without vendor accounts | U-44 | BR-229, BR-523 |
| U-46 | 4 | Link endpoints on Supabase Edge: Markdown manual, OpenAPI, MCP, REST; one project and one user | U-01, U-18, U-20, U-43, U-45 | BR-424, BR-523, BR-524 |
| U-47 | 4 | Paste-back fallback for AIs that cannot reach the URL (ties to surface 1) | U-29, U-46 | BR-424, BR-524 |
| U-48 | 5 | Owner acceptance run across the 9 AI families | U-46, U-47 | BR-524 |
| U-49 | 2 | Level 1 gate compares the acting person; level1 telemetry on every path; refusal carries records | U-14, U-20 | BR-218, BR-219, BR-220, BR-221, BR-304 |

Register rows for U-43..U-49: 15 (BR-137, BR-138, BR-139, BR-202, BR-218, BR-219, BR-220, BR-221, BR-228, BR-229, BR-304, BR-306, BR-424, BR-523, BR-524).

**Spec and audit status (staging folder, read 2026-09-25).**

- The spec `UNIVERSAL_AI_WORK_LINK_SPEC.md` exists: 94,857 bytes, 1,076 lines, last written 07:23:17 UTC; its status line still reads "DRAFT FOR AUDIT".
- The audit exists: `UNIVERSAL_AI_WORK_LINK_AUDIT.md` (assignment S02, a non-author of the spec; 274 lines, written 07:37:27 UTC). Verdict line: "Verdict: PASS_WITH_FIXES". It lists 23 defects A-01..A-23; the 5 HIGH ones (A-01..A-05) block approval and must be fixed in the spec text before the first link build step (audit section 6). gaps_master.json carries the 23 as findings F-S02-1..F-S02-23 (added 07:50 UTC; Gap closure matrix).
- PMD-26 records the audit outcome and says all 23 fixes are applied. The spec file was last written before the audit, so whether the spec text itself carries the fixes is UNVERIFIED in the staging copy.
- BR-228 is not YES today: it needs `ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC_AUDIT.md` (the audit file has another name) with a line starting `AUDIT: PASS`. The PM gets a non-author re-check of A-01..A-05 in the spec text and records it in that file (PC-20).
- Until BR-228 passes, U-44 is not done, so U-45, U-46, U-47 and U-48 wait (graph); the staging harness is reused when U-45 starts.

**What the spec proposes (summary; the audit may change it).** One capability URL on the Supabase Edge host (135 characters) that serves a Markdown manual on GET, an MCP endpoint on POST, a REST root and OpenAPI documents; a 256-bit `pxa_` token stored as sha256 only, expiry 1, 7 or 30 days, 120 calls per minute and 30 writes per hour; writes as a proposal the person confirms on a page; a token-free paste card for AIs that cannot open URLs; every write through runDirectTask -> validate -> executeTask -> EXECUTORS; model_calls = 0 on link traffic; reads with 0 Vercel invocations. The harness self-test already ran: clean 20/20 pass, 10/10 deliberate breaks detected (AWL-H03 pass, 2026-09-25).

**Points settled by PMD-24 and PMD-26, and points still open (found while writing this plan).**

- A1 Function name, OPEN: the spec names the Edge Function `ai-work-link` (and a cron job `ai-work-link-call-retention`, audit A-12); DEV_TEST_DEPLOY_PLAN.md ED-2 lets the PM deploy only `projexa-*` names, and its U-46 row says `projexa-ai-link`.
- A2 PROJEXA M4 (org_ai_link), OPEN: PMD-16 makes it a read-only projection that delegates to the canonical link; the spec (D-14, AWL-S08) retires it.
- A3 DPDP code, SETTLED IN PART: the database-side helpers are copied as recorded exception EXC-DUP-1 and the TypeScript helpers are shared only after the DPDP track agrees through ACTIVE-CLAIMS (PMD-24 OD-6, PMD-26). Still OPEN: spec row AWL-S09 removes the dead DPDP route M5, which changes DPDP-owned code (PMD-18).
- A4 Where writes run, SETTLED: writes through Vercel are not authorised; level-1 writes run only through the Edge bundle after spike S-1 passes, and every link is level 0 until then (PMD-26, A-07). Spike S-1 itself (runDirectTask inside an Edge Function within 2 s CPU) is UNVERIFIED.
- A5 Inbox and confirm page host, SETTLED: a free Cloudflare Pages *.pages.dev project with no DNS, created at Phase 4 entry with the existing owner-issued token; if that token cannot create it, the page is blocked_owner (PMD-24 OD-3). This supersedes OQ-29 for this one page only; any paid tier would be an owner-only spend increase.
- A6 Link host, SETTLED: the supabase.co Edge Function URL only; a projexa-ai.com host later is an owner DNS action (PMD-24 OD-1). Owner directive 3 names PROJEXA-AI.COM; serving the APIs under that domain needs that DNS action, so until then they live on the supabase.co host.
- A7 Register ids, OPEN: the 45 AWL rows of today (26 phase 2, 18 phase 4, 1 phase 1; 3 pass; the audit adds more, such as AWL-S11) are not in BOOLEAN_REGISTER.csv. BR-523 reserves BR-580..BR-599: 20 ids, and the linter ties BR-5nn ids to phase 5, so that range can hold neither 45 rows nor phase 2 and phase 4 rows. After the audit the PM gives them ids by phase: free today are BR-141..BR-199 (phase 1), BR-230..BR-299 (phase 2) and BR-425..BR-499 (phase 4); BR-580..BR-599 stay for phase 5 link rows.
- A8 Supabase plan tier, OPEN (spec U-8, UNVERIFIED): the spec's example month of 900,000 Edge invocations is over the Free plan's 500,000; if the organisation is on Free, that volume needs a paid plan, an owner-only spend increase.
- A9 Legacy link rows, OPEN: PMD-26 (audit A-05) keeps the existing rows working as product = veridian with no project; PMD-08 and PMD-24 OD-7 revoke the 2 legacy links; register rows BR-208 and BR-209 follow PMD-08 (PC-21).

**Status line for reports:** see the added line in section 11.

## 10. Owner decisions and owner-only actions

Full list with defaults and override sentences: OWNER_QUESTIONS.md.

- Owner-only questions (Amendment 001): OQ-01 go-live and recharge; OQ-02 DNS for Resend inbound; OQ-03 metered Level 1 provider; OQ-04 paid Supabase branch; OQ-05 Team Billing check of the Speed Insights Plus add-on; OQ-06 read the two Sensitive env values RAJAT_USER_ID and AI_PROVIDER_PIPELINE_L1; OQ-07 the Pro included-credit figure; OQ-08 one measured test deploy. Every one has a PM default that spends nothing.
- Owner-only actions: A-1 go live (say `go live`, recharge, unpause; the PM then follows the go-live order in OWNER_QUESTIONS.md A-1, see PC-18 on PR #1808); A-2 Resend inbound DNS records; A-3 Team Billing check; A-4 metered provider yes or no; A-5 paid branch yes or no; A-6 read two env values; A-7 Pro credit figure; A-8 one test deploy (optional).
- Register rows waiting on the owner (15 of the 17 first listed; BR-325 passes from CI and BR-522 was decided, PMD-41): BR-225, BR-314, BR-322, BR-412, BR-416, BR-417, BR-418, BR-422, BR-423, BR-504, BR-509, BR-510, BR-517, BR-521, BR-524. Every row that needs a running Vercel app waits for go-live, which comes last (PMD-39).
- PM defaults that still need a PMD row before the item they block starts (not owner-only): OQ-15, OQ-20, OQ-22, OQ-24, OQ-26, OQ-27, OQ-28, OQ-29.
- AI work link decisions: OD-1..OD-12 are decided by PMD-24 and OD-13, OD-13b by PMD-26 (section 9). What stays with the owner: a projexa-ai.com link host (DNS), the Cloudflare Pages project if the owner-issued token cannot create it, and the acceptance runs OT-01..OT-18 with the owner's own AI accounts.

## 11. Report format

The block from the master handoff PART 6, unchanged:

```
T-1 SPEED INSIGHTS PLUS: on/off — charge line evidence
T-2 CREDENTIAL FILES: removed yes/no — anonymous fetch status codes
T-3 GATE TEST: written yes/no · passes yes/no · gate live yes/no/unreadable
PLAN PACKAGE: uploaded yes/no · folder file count · index row yes/no
AMENDMENT LOG: <n> rows · ADD/DELETE/EDIT/REJECT · rows missing evidence: <n>
BOOLEAN_REGISTER: <n> rows · linter exit <n> · pass/fail/pending/blocked_owner
PHASE REACHED: 1/2/3/4/5 · gate: <n> of <n> YES (list every NO with command + actual output)
DEFECTS D-01..D-11: <n> closed / <n> open (name each open)
111 COVERAGE: <n> of 111 ids with a verify_command
Q-ID1: answered? · Q-GATE: answered? · Q1-Q6, Q-D1, Q-D2: <status>
VERCEL: $<n>/mo projected · builds <n> · deployed YES/NO · spend increased YES/NO
FREE RAM (lowest): <GB> · cloud agents: <n> · local sessions: <n>
OWNER-ONLY (Amendment 001 §3): recharges / spend increases / DNS — touched?
```

Added line for the AI work link:

```
AI WORK LINK: spec audit PASS yes/no · U-43..U-49 register rows pass <n> of <n> · AWL rows with a BR id <n> of 45 · AI families accepted <n> of 9
```

A phase reported complete with any exit test not YES is a false report. An honest blocked beats a false pass (master handoff PART 6). Every NO is reported in the fail block of DEV_TEST_DEPLOY_PLAN.md s3.5.

## 12. Known limits of this plan

**12.1 UNVERIFIED items.**

- The exact Resend inbound MX host names and priorities (OWNER_QUESTIONS.md A-2).
- Whether the live Level 1 gate matches a person or an org key today: RAJAT_USER_ID is a Sensitive value (OQ-06). The report line T-3 says "gate live: unreadable" until the owner reads it.
- Which projexa routes send the acting-user header on writes (F-A01-6: "not verified end to end"); this decides how many projexa writes BR-215 refuses.
- DEV_TEST_DEPLOY_PLAN.md s8 UV-1..UV-9: GitHub Actions cost for these public repos, whether an MCP apply_migration writes a drizzle ledger row, whether a changed Edge secret needs a redeploy, prebuilt-deploy build minutes, peak memory of local tools, the Supabase plan tier, the cause of the Domain Ownership Drift Check failures, the Vercel Node version, the exit code of `gh pr checks --required`.
- Spec s18 U-1..U-15: whether each AI family opens a pasted URL, runDirectTask inside an Edge Function within 2 s CPU, the Supabase log retention, and others.
- Whether the gitleaks binary exists on the laptop for BR-120; if not, the self-test runs in CI.
- End-to-end BOQ latency on a deployed instance (AM-088): the D-11 row measures the route in process only.
- Whether role app_runtime can read the cron.* tables, platform.user_ai_links and platform.sumeet_requirements rows that SQL register rows count (PC-22).
- Whether the staging spec text carries the 23 audit fixes that PMD-26 records as applied (the spec file predates the audit file).

**12.2 What cannot be tested before a Vercel go-live.** BR-225 (old exchange-rate route invocations), BR-314 (verify:all on a deployed instance), BR-422 (E-11), BR-423 (E-12), BR-504 (30-day measured gross), BR-510 (E-13 over 7 days), BR-517 (live scheduler-bridge run). BR-518 and BR-519 also wait for the owner release if U-41 lands through PR #1808 (Phase 5 owner list). Also the prebuilt-deploy build-minute question (OQ-08) and the Node runtime version check. Everything else runs on local dev plus live Supabase.

**12.3 What depends on owner answers.** DNS: BR-412, BR-416, BR-417, BR-418, BR-521. The owner's own AI accounts: BR-524. The Edge extraction provider key, one command (provider chosen in PMD-43): BR-509. The owner-run session check: BR-322. The Team Billing add-on, if the 2026-09-26 Pacific day is not 0.0000: BR-116. The cap measure (gross or net): BR-503 reporting. Required Secret Scanning (AM-050 versus OQ-26): BR-119.

**12.4 Register and document conflicts found while writing this plan.** Each was checked on the staging files on 2026-09-25 (script `plan/_sim_docrows.py`). The PM fixes them in the commit PR, before the linter row BR-108 is run.

| # | Conflict | Fix proposed |
|---|---|---|
| PC-01 | BR-107 counts `check-guardrail-presence.mjs` in OWNER_QUESTIONS.md: 0 today (the text is in SHARED_BOUNDARY.md F-8). | Add the finding line to OWNER_QUESTIONS.md, or point BR-107 at ai-os/SHARED_BOUNDARY.md. |
| PC-02 | BR-112 expects 10 headings C-01..C-10; CONTRADICTIONS_RESOLVED.md has 9 (C-01..C-09) plus X-01..X-08. WO D-05 and AM-020 require exactly 9. | Change BR-112 to 9 headings `C-0[1-9]`. |
| PC-03 | BR-113 expects PMD-08, PMD-12 and "27 (7 writes, 20 reads)" in CONTRADICTIONS_RESOLVED.md: 0 of 3 today. | Add the three strings to X-02, X-03 and X-01 when the file is committed. |
| PC-04 | BR-411 expects table rows starting `\| Q3 \|` and `\| Q4 \|` and the file name DNS_RESEND_INBOUND_RECORDS.md; OWNER_QUESTIONS.md uses OQ-11 and OQ-02 and names no record file. AM-095 names a different file, RESEND_INBOUND_DNS_RECORDS.md. | Pick one file name (BR-412 also uses DNS_RESEND_INBOUND_RECORDS.md) and point BR-411 at the OQ-11 and OQ-02 rows. |
| PC-05 | BR-202 runs src/lib/pipeline/financial-redaction.test.ts; no Phase 1 row creates it (BR-132..BR-135 create four other files). DEV_TEST_DEPLOY_PLAN.md s2.5 and AM-021 name financial-redaction.test.ts. | Point BR-202 at the four Phase 1 test files, or add the combined file to U-01. |
| PC-06 | Phase 2 ENTRY (BR-201, BR-202) restates only BR-108, BR-137 and the redaction group; BR-110, BR-112, BR-114, BR-116, BR-119, BR-121, BR-125, BR-126, BR-128, BR-131 are not restated (REGISTER_CONVENTIONS phase gate shape). | Create scripts/verify/phase-gate.sh in Phase 1 (today BR-401 creates it) and add `[ENTRY] bash scripts/verify/phase-gate.sh 1` to Phase 2. |
| PC-07 | BR-325 is blocked_owner for a RAM reason (PMD-14), which is not one of the owner reasons in REGISTER_CONVENTIONS. | Drop BR-325 or set it pending with a CI runner; BR-326 is the gate. |
| PC-08 | BR-420 and BR-421 run Playwright against a local projexa server; DEV_TEST_DEPLOY_PLAN.md s3.2 runs Playwright only in CI (PMD-14). | Run scripts/verify/projexa-playwright.sh inside a CI job and read the result. |
| PC-09 | BR-127 expects exception=non-null; the staging surface_matrix.json has record_type_tables.exception = null. | Pending work under U-12 (PMD-19); not a register error. |
| PC-10 | BR-524 reads AI_FAMILY_ACCEPTANCE.csv; AM-102 names AI_FAMILY_ACCEPTANCE_RESULTS.csv. | Use one name. |
| PC-11 | U-46 is a Phase 4 item (MERGE_MAP.md, DEV_TEST_DEPLOY_PLAN.md s2.5) but its only register row BR-523 is a phase 5 row. | Give U-46 a phase 4 row when the AWL rows get BR ids (section 9, A7). |
| PC-12 | AMENDMENT_LOG boolean_test and register row name different files, scripts or outputs for the same item: AM-021 and BR-132..BR-135; AM-027 and BR-220; AM-036 and BR-215; AM-039 and BR-207; AM-051 and BR-120; AM-060, AM-065 and BR-322; AM-073 and BR-313; AM-074 (a projexa job named E2E required) and BR-315, BR-316 (the compliance-tracker Env-1 job required); AM-078 and BR-116; AM-082 and BR-503; AM-084 and BR-409, BR-410; AM-088 and BR-403, BR-404; AM-091 and BR-513; AM-094 and BR-414; AM-099 and BR-229; AM-100 and BR-523; AM-101 and BR-424; AM-059 (supabase/functions/exchange-rate-refresh) and DEV_TEST_DEPLOY_PLAN.md U-21 (projexa-exchange-rate-refresh). | The register row is the gate (section 2, rank 5); the PM aligns each amendment row to it in the commit PR. |
| PC-13 | Amendment rows whose test has no register row: AM-009, AM-022, AM-037, AM-038, AM-040, AM-042 (its schema-hash-twice.sh half), AM-076, AM-096, AM-097. | Add a register row for each, or record in the amendment row why none is needed. |
| PC-14 | AM-050 says the Secret Scanning branch-protection change waits for the owner; OQ-26 marks it not owner-only with a PROPOSED default and no PMD row. | Record a PMD row (or the owner's yes) before BR-119 is run. |
| PC-15 | DEV_TEST_DEPLOY_PLAN.md s6.3 lets the next phase start only when no blocked_owner row belongs to a prerequisite of a next-phase item; with DNS pending that stops all of Phase 5. | This plan applies the condition per item (section 3, rule 4); the PM aligns s6.3. |
| PC-16 | MERGE_MAP.md s4 says "43 nodes"; the patched graph has 50. | Note only; the graph above is the one of record. |
| PC-17 | BR-121 speaks of 6 suffixed classification values; the staging CRON_PLACEMENT.csv has none (37 rows: KILL 12, GITHUB_ACTIONS 11, PG_CRON 10, EDGE_FN_VIA_PG_CRON 3, VERCEL 1). | Title only; the row still tests the right thing. |
| PC-18 | OWNER_QUESTIONS.md A-1 has the PM merge PR #1808 after go-live; that PR builds every non-docs main merge (F-A12-4). PMD-11 and DEV_TEST_DEPLOY_PLAN.md V-03 keep ignoreCommand at exit 0 with one owner-approved manual deploy per release. | Default PMD-11. The owner's go-live message says which one applies. |
| PC-19 | AM-057 expects the text "5 deployed; 2 in use" in ai-os/SHARED_BOUNDARY.md: 0 today (the file states the same facts in other words, section 6 totals). | Add the exact phrase to SHARED_BOUNDARY.md section 6. |
| PC-20 | BR-228 reads ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC_AUDIT.md for a line starting "AUDIT: PASS". The audit file is UNIVERSAL_AI_WORK_LINK_AUDIT.md and its verdict line reads "Verdict: PASS_WITH_FIXES". The pattern `^AUDIT: PASS` would also count a line "AUDIT: PASS_WITH_FIXES". | After a non-author re-check of A-01..A-05 in the spec text, write "AUDIT: PASS" in the file BR-228 names, and anchor the BR-228 and BR-306 pattern as `^AUDIT: PASS$`. |
| PC-21 | PMD-26 (audit A-05) keeps the existing platform.user_ai_links rows working as product = veridian with no project; PMD-08 and PMD-24 OD-7 revoke the 2 legacy links. BR-208 (CHECK project_id IS NOT NULL) and BR-209 (0 unrevoked rows without a project) follow PMD-08 and would fail under PMD-26. | The PM records one PMD row that settles it before U-18 starts; under PMD-26, BR-208 becomes a CHECK of (product = veridian or project_id is not null) and BR-209 counts projexa rows only. |
| PC-22 | PMD-22: SQL rows over tenant data can read 0 for the wrong reason under app_runtime: BR-216, BR-217, BR-224, BR-303, BR-517, and the script rows BR-509 (compliance.projects) and BR-313 where they count tenant rows. Whether app_runtime can read cron.* (BR-124, BR-223, BR-305, BR-516), platform.user_ai_links (BR-209) and platform.sumeet_requirements (BR-307..BR-311) is UNVERIFIED. | Name the role in each such row (PMD-22) and run it through the Supabase MCP as role postgres; record the dated result. |
| PC-23 | The 23 audit findings F-S02-1..F-S02-23 (added to gaps_master.json at 07:50 UTC) are cited by no register row. BR-228 is the gate for their spec-text fixes; the code-level tests of audit section 6 for A-01, A-02, A-03, A-09, A-10, A-11, A-15 and A-16 have no BR id. | Add F-S02-1..F-S02-23 to the source of BR-228, and give each audit test a BR id together with the AWL rows (section 9, A7). |

**12.5 State moved since the evidence was read.** The evidence files cite compliance-tracker `025eea08`. Main is `11d03fd1` at the time of writing (PR #1836 merged 2026-09-25T07:04:08Z; PR #1837 merged 2026-09-25T07:21:30Z). Line numbers quoted from `025eea08` may shift; each PR re-reads them at its own base SHA with `MSYS_NO_PATHCONV=1 git cat-file blob` and a byte-size check (F-A12-3).

**12.6 Resource limit.** Local checks run one bun file at a time and stop below 1.0 GB free RAM, so local verification is serial and slow. Typecheck, build and Playwright results exist only in CI.

