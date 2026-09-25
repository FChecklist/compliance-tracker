# PROJEXA-BUILD-001 - PLAN PACKAGE

Date: 2026-09-25. Prepared by Claude Code (project manager) for owner Rajat Agarwal. Read this file first.

**Status.** Complete plan, ready for Claude chat's audit. Development of Phase 1 started on the owner's instruction of 2026-09-25 ("make final document and start work, start development on local"); Phase 1 items already built and merged are listed in section 4. Vercel stays locked. No deploy, no DNS change, no spend increase, no recharge has been touched.

## 1. What this plan is

One deterministic, close-ended, boolean plan to build PROJEXA so that the project and all its data are created and maintained by software (Level 0) plus AI (Level 1: the internal assistant or the user's own external AI), with the human only asked when a real question arises. It merges four bodies of work: the PM's own analysis of 25 September, Claude chat's work order BUILD-001 (11 defects, 5 phases), its Addendum A (edge and browser-first), and the owner's later instructions (universal AI work link, run on local machine, minimise Vercel).

Every item is a row in `BOOLEAN_REGISTER.csv`: a runnable command that exits 0 for pass, the exact expected output, a status (pending / pass / fail / blocked_owner) and the evidence. `lint_plan.py` checks the whole package mechanically.

## 2. Read in this order

| # | File | What it is |
|---|---|---|
| 1 | `MASTER_PLAN.md` | The plan: governance, five phases with entry and exit tests, dependency graph, gap-closure matrix (every finding accounted for), owner block |
| 2 | `PM_DECISIONS.md` | Every decision the PM took under the owner's delegation, each with evidence, reversibility and how to override |
| 3 | `BOOLEAN_REGISTER.csv` | All work items: command, expected output, status, evidence |
| 4 | `DEV_TEST_DEPLOY_PLAN.md` | Development, testing and deployment plans: environments, branches and PRs, migrations, flags, rollback, RAM and cloud-agent policy, model routing |
| 5 | `UNIVERSAL_AI_WORK_LINK_SPEC.md` (+ `ai_link_capability_matrix.json`, `ai-link-harness/`) | One pasted link that any AI can use: format, layers, token model, security, per-vendor capability, conformance harness |
| 6 | `AMENDMENT_LOG_BUILD-001.md` | Every change to the work order and addendum, with evidence (ADD / DELETE / EDIT / REJECT) |
| 7 | `OWNER_QUESTIONS.md` | The questions that need the owner, each with the PM default already chosen |
| 8 | `SHARED_BOUNDARY.md` | Two products, one repository, one shared database: who owns what and the record-first rule |
| 9 | `MERGE_MAP.md` | Crosswalk of the PM spec, the work order and the addendum into 50 unified items (U-00..U-49) with prerequisites |
| 10 | `CONTRADICTIONS_RESOLVED.md`, `REQUIREMENTS_111_REGISTER.csv`, `surface_matrix.json`, `CRON_PLACEMENT.csv`, `EDGE_CANDIDATES.csv`, `PROJEXA_ROUTE_SITEMAP_projexa_main.md`, `REFERENCE_PG_CRON_PG_NET_EDGE.md` | The supporting deliverables the work order asks for |
| 11 | `gaps_master.json`, `REGISTER_CONVENTIONS.md`, `lint_plan.py` | Machine inputs and the linter |
| 12 | `evidence/` (private KT copy only) | Raw evidence from the verification agents: live database facts, gate analysis, identity and edge findings, AI vendor research, the audit of the link spec |

## 3. The numbers (recount with `python lint_plan.py .`)

| What | Count |
|---|---|
| Register rows (`BOOLEAN_REGISTER.csv`) | 197 (phase 1: 40, phase 2: 41, phase 3: 29, phase 4: 44, phase 5: 43) |
| Register status | pending 162, pass 4 (already true, with evidence), blocked_owner 31 (need the owner: a deployed instance, DNS, spend or a vendor acceptance run) |
| Unified work items | 50 (U-00..U-49), dependency graph acyclic |
| Amendment log rows | 102 (ADD / DELETE / EDIT / REJECT, each with evidence) |
| Findings indexed and accounted for | 100, from 23 verifier and audit agents; 68 agent amendments all placed in the amendment log |
| PM decisions | 26 (PMD-01..PMD-26) |

The linter recomputes all of these and fails on any gap: `python lint_plan.py .`

## 4. Already built and merged (development on local, 25 September)

| Item | What | Where |
|---|---|---|
| Claim | Phase 1 claim registered before any edit | compliance-tracker PR #1836 (merged) |
| T-3 | Tests that pin the AI provider gate as it is (30 + 6 tests, falsified by mutation) | PR #1837 (merged) |
| Runner | Read-only SQL assertion runner for the register (26 tests, live-checked) | PR #1838 (merged) |
| U-01c | PROJEXA assistant sends the signed-in person to the backend | projexa PR #319 (merged) |
| U-01 | Financial-figure redaction leak closed at every site (about 130 new tests) | PR #1839 (CI running) |
| Verify scripts | Nine deterministic verify scripts and a self-test harness (17 positive, 65 negative cases) | PR #1841 (CI running) |
| U-15 | MCP tools/list advertises only the 9 tools that run (drift-proof test) | PR #1840 (merged) |

## 5. What Claude chat is asked to attack

1. Decision PMD-01 (identity: Edge gateway, not PostgREST-direct, not user migration). Is the reasoning from the live grants, the tenant setting and the two auth pools sound?
2. Decision PMD-02 (keep the licence gate; the external AI is Level 1 with zero server model calls; no metered provider without the owner).
3. The register: is any row not boolean, not runnable, or able to pass vacuously?
4. The gap-closure matrix: is any finding closed on paper only?
5. The universal link spec: threats T1..T20, the per-vendor claims marked UNVERIFIED, the decision to refuse writes on Vercel (Option A).
6. Public repository hygiene (PMD-25): does the sanitised repository copy still leak an attack surface?
7. Anything the plan assumes without a live check.

## 6. Owner-only, untouched

Vercel recharge, unpausing or any Vercel setting; DNS records (the Resend inbound records are prepared, not applied); any spend increase (a paid Supabase branch, a metered AI provider); Team Billing cancellation of the Speed Insights Plus licence if it still bills after 2026-09-26 07:00 UTC.

## 7. Known limits

The register rows that need a deployed instance are `blocked_owner` until the owner releases a deploy. Vendor behaviour for ChatGPT, the Gemini app, consumer Copilot and DeepSeek chat is UNVERIFIED until the owner runs the acceptance tests listed in the link spec. Tenant-data SQL assertions need a database role that can see the rows (PMD-22).
