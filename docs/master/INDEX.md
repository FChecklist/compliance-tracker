# VERIDIAN AI OS — Documentation Index

**This is the entry point.** If you're an AI agent (or a human) picking up this project cold, start here, not with a random root-level `.md` file. This index exists because none of the 32+ existing documentation artifacts in this repo previously linked to each other — they were a flat pile of dated, wave-numbered documents with no navigation layer. Built 2026-07-09.

## How to read this index

Each entry has a **maturity tag**:
- 🟢 **CURRENT** — accurate as of its own last-verified date, safe to trust
- 🟡 **PARTIALLY STALE** — mostly accurate, but contains at least one claim superseded by later work (noted)
- 🟠 **DECISION ARTIFACT** — a point-in-time record of a decision (build-vs-borrow, license check, scope call). Correct for what it decided; don't expect it to reflect current state
- 🔴 **STALE / ARCHIVED** — materially out of date or superseded; kept for history only, don't act on it
- 🆕 **NEW (this pass)** — written 2026-07-09 as part of this documentation merger

**If you only read five things**, read: this index → `MODULE_MAP.md` → `ARCHITECTURE.md` → `CRITICAL_GAPS.md` → whichever `AUDIT_2026-07-09.md` section covers what you're touching.

---

## Relationship to ai-os/ governance tracking

This file (`docs/master/INDEX.md`) is the **documentation navigation** layer — it catalogs and tags the 32+ narrative `.md` artifacts in this repo so they don't sit as an unlinked flat pile. It is not the same thing as, and does not replace, two files that live under `ai-os/`:

- [`ai-os/MASTER-TRACKER.yaml`](../../ai-os/MASTER-TRACKER.yaml) is the **live gap/task tracker** — the single place for what's open, in-progress, or blocked right now. If you're looking for current work status rather than "what document explains X," go there instead of here.
- [`ai-os/OS.yaml`](../../ai-os/OS.yaml) is the **governance-file index** — the entry point that lists every governance/tracking document (including this one) and what it's for.

See the new rows for both, plus `ai-os/BRAIN.md`, in the table below.

---

## Start here (new, this pass)

| Doc | Tag | What it is |
|---|---|---|
| [`MODULE_MAP.md`](MODULE_MAP.md) | 🆕 | The canonical "where does X live" reference — every domain → its tables/services/routes/pages. Read this before grepping. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 🆕 | Consolidated architecture reference — merges 4 previously-separate governance docs into one, de-duplicated. |
| [`AUDIT_2026-07-09.md`](AUDIT_2026-07-09.md) | 🆕 | The deep, severity-rated gap-analysis audit (executive summary through roadmap), module-by-module. |
| [`CRITICAL_GAPS.md`](CRITICAL_GAPS.md) | 🆕 | Running punch list of confirmed, severity-tagged problems — the thing to actually act on. Now annotated with every closure from the autonomous gap-closure pass. |
| [`ROADMAP.md`](ROADMAP.md) | 🆕 | Immediate / 30-day / 90-day / 1-year plan, synthesized from every finding above. |
| [`GAP_CLOSURE_LOG.md`](GAP_CLOSURE_LOG.md) | 🆕 | Append-only record of every fix made during the autonomous gap-closure pass — 8 batches, exact files/verification/commit per fix. |
| [`FINAL_STATUS_REPORT_2026-07-09.md`](FINAL_STATUS_REPORT_2026-07-09.md) | 🆕 | Closing report for the 2026-07-09 gap-closure pass: 22 findings fully closed, 4 partially closed. Superseded on the worker-agent-execution item by `CAPABILITY_COVERAGE.md` (2026-07-10). |
| [`CAPABILITY_COVERAGE.md`](CAPABILITY_COVERAGE.md) | 🆕 | Live-queried source of truth for CRITICAL_GAPS #1: exactly which worker agents/VCEL calculators are wired into deterministic Chain Selector dispatch vs. still AI-fallback, by domain/category, with the prioritized roadmap for the rest. Re-run its own SQL before trusting any number in it if time has passed. |

---

## Strategy & governance (root-level)

| Doc | Tag | What it is | Notes |
|---|---|---|---|
| [`PLATFORM_STRATEGY.md`](../../PLATFORM_STRATEGY.md) | 🟡 | The platform-pivot strategy (215KB, 1097 lines, §1-27). Brand architecture, business model, the 5-layer AI Orchestra Engine, platform architecture principles, and §10-27 are a wave-by-wave design log (VAIOS constitution → OSS build-vs-borrow research → PMS/HR/CRM/Ticketing/FDE/Capability Registry/MoM design records). | §9's Phase A-E TODO checklist is stale against later waves (many "not built" items were later built — e.g. Chat Page, instruction tracking). §5's "only task_oa is active, 4 layers dormant" claim is now partially outdated — `user_assistant_oa` (Wave 12) and `meta_oa` (Wave 18) both gained real call sites after this section was written. Still the best strategic reference; just cross-check any "current status" claim against `orchestra_changes.md`'s later entries. |
| [`orchestra_changes.md`](../../orchestra_changes.md) | 🔴 | The wave-by-wave build log, Waves 0-71 (2026-07-01 through 2026-07-05). **This is the single most valuable ground-truth document in the repo** — every entry cites real commits/migrations and states what was actually verified (live HTTP, DB-level SQL proof, or code-only) rather than just claimed. | **Confirmed stale**: stops at Wave 71 (2026-07-05). The codebase has since gone through dozens more waves — PROJEXA (Waves ~120-131), VERI Chat V2 composer, VCEL registry, GST Reconciliation Engine, this session's Wave 131 rollout — none of which are logged here. `PLATFORM_STRATEGY.md`'s own §27 references "Wave 99," meaning that doc kept receiving updates after this changelog stopped. **This is a real, confirmed documentation gap — see `CRITICAL_GAPS.md`.** |
| [`AGENTS.md`](../../AGENTS.md) | 🟢 | Authorized AI agents (Z.ai GLM, Claude Code), operating rules. Short, stable. | — |
| [`CLAUDE.md`](../../CLAUDE.md) | 🟢 | Technical stack reference for AI agents (Bun/Next.js 16/Drizzle/Supabase), directory structure, design tokens, commands. | — |
| [`SENTINEL.md`](../../SENTINEL.md) | 🟠 | Governance constitution — no secrets in code, no direct DB access from UI. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml` (2026-07-14). Corrected 2026-07-14: task tracking pointer was `BOARD.yaml` (self-declared stale since 2026-06-29) -- now points to `COMPLETED.yaml`. |
| [`ai-os/CONSTITUTION.yaml`](../../ai-os/CONSTITUTION.yaml) | 🟢 | **NEW ROW, 2026-07-14. THE SOLE CONSTITUTION for VERIDIAN AI OS**, v2.0 -- machine-readable, single source of truth, absorbing every rule from the 9 documents below (and SENTINEL.md/SENTINEL.yaml above) with a stable ID per rule. Read this FIRST for any AI-behavior/architecture/guardrail question. | Supersedes all 9 rows below as AUTHORITY -- they remain as detailed narrative evidence, not duplicated with drift risk. |
| [`VERIDIAN_AI_CONSTITUTION.md`](../../VERIDIAN_AI_CONSTITUTION.md) | 🟠 | The 23-section enterprise AI governance framework, each section tagged `[ENFORCED]`/`[PARTIALLY ENFORCED]`/`[POLICY ONLY]`/`[NOT APPLICABLE YET]` against real code. Consolidated (navigation) into `ARCHITECTURE.md`. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml` -- see its AUTHORITY NOTE banner. |
| [`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`](../../VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md) | 🟠 | Task lifecycle, 4-tier AI role hierarchy, TightTask guardrails, 30 Mandatory Guardrail Protocols status table. Dated 2026-07-11 -- postdates this index's original 2026-07-09 snapshot, was missing from this table until this correction. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s `task_lifecycle` section. |
| [`VERIDIAN_AUDIT_ORGANIZATION.md`](../../VERIDIAN_AUDIT_ORGANIZATION.md) | 🟠 | Chief Audit Officer, 4 Guardrail-team levels, L1-L7 audit cadence. Dated 2026-07-11 -- same missing-from-index issue as above. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s `audit_organization` section. |
| [`VERIDIAN_DMP_DCF_CONSTITUTION.md`](../../VERIDIAN_DMP_DCF_CONSTITUTION.md) | 🟠 | Dynamic Mode Pills / Dynamic Chain Framework -- the business-classification/navigation/orchestration language. Dated 2026-07-11 -- same missing-from-index issue as above. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s `navigation_and_intent` section. |
| [`VERI_CHAT_GOVERNANCE.md`](../../VERI_CHAT_GOVERNANCE.md) | 🟠 | VERI's identity, its relationship to VERI Chat, VERI-Assisted Communication Protocol. Dated 2026-07-11 -- same missing-from-index issue as above. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s `veri_identity`/`communication_engine` sections. |
| [`MASTER_AI_OS_ARCHITECTURE.md`](../../MASTER_AI_OS_ARCHITECTURE.md) | 🟠 | v1.0 governing rules for product branches — naming, module-reuse, RLS-mandatory, layer-key namespacing. Consolidated (navigation) into `ARCHITECTURE.md`. | Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s `architecture_rules` section (ARCH-01 through ARCH-09). |
| [`VAIOS_ARCHITECTURE_STRATEGY.md`](../../VAIOS_ARCHITECTURE_STRATEGY.md) | 🟠 | Build-vs-integrate-Frappe/ERPNext decision (rejected — license + infrastructure mismatch). | Superseded in spirit by Waves 49-71's own from-scratch ERP build. Superseded as AUTHORITY by `ai-os/CONSTITUTION.yaml`'s ARCH-07. |
| [`MCP_PROTOCOL.md`](../../MCP_PROTOCOL.md) | 🟡 | MCP server spec — two-server architecture (Compliance Data + Dev Dispatch), 9 tools, JSON-RPC 2.0. Consolidated into `ARCHITECTURE.md`. | **Correction 2026-07-14**: "MCP Server 2" (Groq-orchestrator-driven dev dispatch) has ZERO matches for "Groq orchestrator"/"mcp-dev"/"MCP_DEV_SECRET" anywhere in src/ -- confirmed not built, or built-then-removed with no record. Downgraded from 🟢 to 🟡. MCP Server 1 (`/api/mcp`) appears genuinely live -- not independently re-verified tool-by-tool. See `ai-os/CONSTITUTION.yaml`'s `meta.doc_debt_found_this_pass` DEBT-02. |
| [`VERIDIAN_HUMAN_INPUT_OUTPUT_TAXONOMY.md`](../../VERIDIAN_HUMAN_INPUT_OUTPUT_TAXONOMY.md) | 🟢 | 12 canonical input patterns with real-world examples across 6 personas. Living doc, feeds future intent-classifier design. | Reference vocabulary, not a rule set -- not superseded, complementary to `ai-os/CONSTITUTION.yaml`. |
| [`VERI_CHAT_COMPOSER_DESIGN.md`](../../VERI_CHAT_COMPOSER_DESIGN.md) | 🟢 | Design doc for the persistent VERI Chat composer, written this session — maps the throwaway HTML prototype to production code, documents deliberate divergences. | Updated this session to reflect the Wave 131 platform-wide rollout. |
| [`ai-os/OS.yaml`](../../ai-os/OS.yaml) | 🟢 | Governance-file index (added 2026-07-13) — lists every real governance/tracking document under `ai-os/` and what it's for; CI-enforced coverage via `scripts/check-metadata-index-coverage.mjs`. | Entry point for `ai-os/` specifically, distinct from this file's repo-wide doc catalog. |
| [`ai-os/BRAIN.md`](../../ai-os/BRAIN.md) | 🟢 | Plain-language "what is VERIDIAN AI OS / how does it work" explainer (added 2026-07-13), every claim cited to a file the author actually opened. | Closes the "no narrative explainer" gap `ai-os/OS.yaml`'s own header names. |
| [`ai-os/MASTER-TRACKER.yaml`](../../ai-os/MASTER-TRACKER.yaml) | 🟢 | THE live gap-analysis / open-work tracker (created 2026-07-12, consolidates 17 prior tracker files). The only place to check "what's open / what's next" going forward. | Supersedes `ai-os/boss/BOARD.yaml` (stale since 2026-06-29). |

## Gap analyses & certification passes

| Doc | Tag | What it is | Notes |
|---|---|---|---|
| [`AI_OS_CERTIFICATION.md`](../../AI_OS_CERTIFICATION.md) | 🟡 | 51-category AI-OS certification taxonomy, first pass 2026-07-04. Gate result: **FAIL**, stated as fact. Grounded in file:line evidence + live DB queries. | Several items it flagged as missing were subsequently built (Policy Enforcement Engine, Wave 46; some VCEL wiring, this session). Treat as a snapshot, not current state — cross-check against `CRITICAL_GAPS.md`. |
| [`AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md`](../../AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md) | 🟡 | Wave 110 evaluation (2026-07-08) — most "Most Critical 25" disciplines already exist under different names; 6 bounded real gaps identified. | Gap #1 (no pre-LLM routing cascade) is annotated as "partially closed, Wave 114" — see `WAVE_114_DETERMINISTIC_DISPATCH.md`. |
| [`COMPARISON_CSV_GAP_ANALYSIS.md`](../archive/COMPARISON_CSV_GAP_ANALYSIS.md) | 🔴 | VERIDIAN vs. Odoo/ERPNext/Zoho/SAP across 17 modules. Originally found 2 complete gaps (Budgeting, Contract Management). | **RESOLVED.** Both gaps closed: Budgeting (Wave 70), Contract Lifecycle Management (Wave 71) — `orchestra_changes.md` entries #117-118. This doc's "gap" framing is now stale; both features are live. Moved to `docs/archive/` 2026-07-13. |
| [`COMPARISON_CSV_2_GAP_ANALYSIS.md`](../archive/COMPARISON_CSV_2_GAP_ANALYSIS.md) | 🔴 | 13-module GRC/Legal/CorpSec/DMS/ESG/BCM/CLM/Workflow/Procurement/Inventory benchmark (506 features). | **RESOLVED per memory record** — all 6 waves (86-91) DONE as of 2026-07-05. Manufacturing/Low-Code/BPM explicitly out of scope (product-scale builds, not features). Moved to `docs/archive/` 2026-07-13. |
| [`COMPARISON_CSV_3_GAP_ANALYSIS.md`](../../COMPARISON_CSV_3_GAP_ANALYSIS.md) | 🟠 | AI-OS platform benchmark vs. Copilot Studio/Vertex/Agentforce/Kong/Datadog/Entra/etc. (135 features, 9 modules). | Mostly out of scope by design — the CSV describes standalone infrastructure platforms (Kubernetes, IoT, persistent servers), not application features VERIDIAN's Vercel-serverless architecture can or should replicate. Bounded real gaps: Orchestra Analytics Dashboard, MDM duplicate detection, API rate limiting, MFA enrollment — status unclear, worth checking in the audit. |
| [`ERP_BENCHMARK_COMPARISON.md`](../../ERP_BENCHMARK_COMPARISON.md) | 🟡 | 17-module ERP benchmark (136KB) — the most thorough comparison artifact, 8 parallel research passes. Section 10's ranked Tier 1-4 priority list. | **Confirmed heavily resolved**: `orchestra_changes.md` Waves 49-71 close nearly every ranked item (accounting periods, financial reports, approval engine, cost centers, cash management, credit notes, FIFO valuation, bank reconciliation, procurement workflow, statutory payroll, UOM/batch/serial, webhooks, SSO, invoicing, RMA, vendor scorecarding, HSN/SAC, multi-currency, multi-entity, TDS, e-invoicing, budgeting, contracts). Re-check Section 10 against Wave 71's own closing note before treating anything in it as still open. |
| [`WAVE_111_MULTI_COMPANY_AI_OS_TEST_REPORT.md`](../../WAVE_111_MULTI_COMPANY_AI_OS_TEST_REPORT.md) | 🟢 | Multi-company E2E test (10 companies, 1000 seeded people). L4 orchestra layer confirmed to have zero call sites (real, still-open gap). Found and fixed a silent dashboard-stats-failure bug. | — |
| [`WAVE_114_DETERMINISTIC_DISPATCH.md`](../../WAVE_114_DETERMINISTIC_DISPATCH.md) | 🟢 | Structured (non-LLM) dispatch for VeriComposer — 7/9 worker agents, 15/16 GST engines wired, `/api/home/todos` regression fixed. | This session's own Wave 131 rollout (see `VERI_CHAT_COMPOSER_DESIGN.md`) builds directly on this. |
| [`TEST_LOG.md`](../../TEST_LOG.md) | 🟢 | E2E test log, Wave 100+. **Found and fixed a critical bug**: `CRON_SECRET` was empty in production, silently disabling all 3 scheduled cron jobs (including the self-improvement loop runner) since creation. | Bug is fixed — don't re-flag as open. |
| [`evaluation_by_ca.md`](../../evaluation_by_ca.md) | 🟢 | Independent evaluation by a practicing India CA managing 119 clients. Rating **5.5/10** — real market-fit gap: the product assumes single-org-per-account, but a CA firm needs multi-client management. | **This is a real, unresolved gap** worth flagging prominently — see `CRITICAL_GAPS.md`. Note: the `clients`/`clientEntities` hierarchy (Wave 1, `orchestra_changes.md` #15) partially addresses this at the schema level; check whether the CA's specific UX complaint (signup/onboarding being single-org-only) has actually been fixed since 2026-06-29. |
| [`functional_testing.md`](../../functional_testing.md) | 🟡 | QA notes (2026-06-30) — auth/onboarding usability gaps (no forgot-password, no remember-me, org setup missing). | Predates many later waves; some items may be fixed. Re-verify before treating as current. |
| [`features_to_be_added_claude.md`](../../features_to_be_added_claude.md) | 🟠 | Early vision doc (2026-06-29) — "Compliance & Audit Operating System" framing, 4 architectural principles. | Much of this vision has since been operationalized across later waves; treat as historical framing, not a current backlog. |
| [`review_of_vedian.md`](../archive/review_of_vedian.md) | 🔴 | Early CEO-style review, largely superseded — the doc itself says a "Wave 6 reconciliation" already happened. | Don't trust its specific findings without cross-checking `orchestra_changes.md` #42's reconciliation note. Moved to `docs/archive/` 2026-07-13. |

## Operational docs

| Doc | Tag | What it is |
|---|---|---|
| [`docs/ESCALATION_MATRIX.md`](../ESCALATION_MATRIX.md) | 🆕 | Priority 12 (OPEN-07 point 10) reference doc — names all 5 real, independently-built escalation mechanisms (`escalation-ladder.ts`, `floor-tier-escalation.ts`, `model-tier-eligibility.ts`, the Auditor→Higher-AI loop, `dispatch-completion-monitor.ts`'s fail-closed pattern), what triggers each and what it does, and is explicit about where they do NOT connect. Cross-reference only, not a redesign. |
| [`docs/AI_WORKFORCE.md`](../AI_WORKFORCE.md) | 🟢 | How a task becomes a reviewed PR via the AI Router → 10-role roster → `repository_dispatch` → sandboxed execution (max 20 turns, no shell) → human-reviewed PR. |
| [`docs/research/VERI_MAIL_CALENDAR_PLAN.md`](../research/VERI_MAIL_CALENDAR_PLAN.md) | 🟠 | Composio Gmail/Calendar OAuth plan. **Recommended, not built** — verify current status before citing as done. |
| [`docs/research/VERI_REWARD_EVALUATION.md`](../research/VERI_REWARD_EVALUATION.md) | 🔴 | Gamification architecture recommendation. **Superseded** — VERI Reward is now actually built (`veri-reward-service.ts`, live). |
| [`docs/research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md`](../research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md) | 🟡 | CEO assessment: don't build a new Worker Agent Library, ~70% already exists via Capability Registry + Prompt OS; real gap was dispatch + confidence scoring. | Wave 114/131 (this session) directly closes part of the dispatch gap this doc identified. |

## Archived (moved or flagged, not deleted)

| Doc | Tag | What it is |
|---|---|---|
| [`history/TASK_LIST.md`](../../history/TASK_LIST.md) | 🔴 | 2026-06-28 fossil, TASK-001 through TASK-016, predates ERP/GRC/PMS/FM&CS/The Firm/Forge/VERI Chat/VCEL entirely. Already self-marked "ARCHIVED — do not execute." Moved to `history/` this session. |
| [`history/worklog.md`](../../history/worklog.md) | 🔴 | Very early artifact (2026-06-28) — Prisma-era schema (now Drizzle), pre-dates almost everything. Moved to `history/` this session. |
| [`main_dashboard_user.md`](../../main_dashboard_user.md) | 🟠 | Misnamed — it's an HTML mockup, not markdown. Captured as the Wave 3 worker-agent seed reference (33 global-tier agent taxonomy). Historical/reference only. |
| [`veridian-scope-selector-in-home.html`](../../veridian-scope-selector-in-home.html) | 🟠 | The VERI Chat composer's validated prototype. See `VERI_CHAT_COMPOSER_DESIGN.md`. |

---

## Known open documentation debt (tracked, not yet fixed)

1. **`orchestra_changes.md` is 4+ days / dozens of waves stale.** No single doc replaces it — either resume it from Wave 72 onward, or accept `PLATFORM_STRATEGY.md` §27+ and this index as the successor pattern going forward.
2. ~~**`analysis.md`** (not indexed above — very early Phase-1 discovery doc) claims RLS "not implemented at the database level," which was true when written but has been false since Wave 1 (`orchestra_changes.md` #18). Anyone reading `analysis.md` in isolation would reach a wrong, security-relevant conclusion. Needs a correction note or archival.~~ **Fixed 2026-07-13**: moved to [`docs/archive/analysis.md`](../archive/analysis.md) with an "ARCHIVED / STALE" banner as part of the GAP-UNIFIED-SOT-REMAINDER (b) root-level stale-doc quarantine pass — the banner is the correction note this item asked for.
3. The three CSV gap-analysis docs read as open gap lists but are substantially resolved — fixed in this index (marked 🔴/RESOLVED above) rather than in the source docs themselves, since editing them to "done" status would blur the historical record of what the gap actually was.
4. No `README.md` at repo root, no `CHANGELOG.md` (the natural role `orchestra_changes.md` should have filled), no `CONTRIBUTING.md`.
