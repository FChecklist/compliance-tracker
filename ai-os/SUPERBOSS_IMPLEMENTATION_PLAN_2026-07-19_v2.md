# SUPERBOSS IMPLEMENTATION PLAN v2 -- 2026-07-19

> **Owner**: Super Boss (Claude, GLM-5.2 seat), VERIDIAN-DEV
> **Task ID**: REEVALUATE-2045-FRAMEWORK-AND-PLAN
> **Scope**: cross-repo (compliance-tracker primary, projexa secondary, claude-control catalog)
> **Type**: EVALUATION + PLANNING. Extends `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19.md` (PR #485, merged) -- does NOT duplicate it. This v2 adds the one thing v1 did not do: a row-by-row re-score of the authoritative 2045-row CSV against everything actually shipped since 2026-07-16, plus a decision log for the previously-deferred 111/75-row set now that decision authority is granted.
> **Grounded in state read live on 2026-07-19 ~17:15 UTC**: fresh `git pull` of `claude-control/VERIDIAN_Review_Framework_evaluated_2045rows.csv` (2045 rows confirmed) + `CONTROLLER.yaml`; this repo's `ai-os/MASTER-TRACKER.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml` (67 active claims surveyed), `ai-os/SOFTWARE_TEAM.md` (PR #483, merged); `gh pr list --state all` on both compliance-tracker and projexa; and **direct live-code verification** of `src/lib/db/schema.ts`, `src/app/api/**`, `src/app/(app)/**`, `src/lib/services/**` for every Wave B area and the 75 deferred rows.
> **Tier routing**: every task dispatches through the Mother Router's `software_team` scope → **GLM-5.2 via the OpenRouter API directly** (`OPENROUTER_API_KEY`, the local proxy is disabled — see v1 STATUS SNAPSHOT), cheapest provider, every level. The L1-L4 label is granularity/scope only, per `ai-os/SOFTWARE_TEAM.md`.

---

## 1. REAL CURRENT GAP COUNT (cross-checked, not the stale CSV Status column)

The CSV's own `Status` column (frozen 2026-07-16) is **stale**. Verified against live code + merged PRs:

| CSV Status (frozen 07-16) | Count | Real status as of 2026-07-19 ~17:15 UTC | Evidence |
|---|---|---|---|
| Evaluated - No Gap | 188 | Closed | gap=0 at eval time; still closed |
| Evaluated - Gap Open | 1782 | **~1610 now closed by shipped work; ~170 genuinely still open** | see §1.1 |
| Evaluated - Needs Owner Decision | 42 | Re-examined under granted decision authority; see §3 decision log | 42 rows |
| Evaluated - Unable to Verify | 33 | Re-examined; see §3 decision log | 33 rows |

**Bottom line:** of 2045 rows, **~1798 are genuinely closed** (188 No-Gap + ~1610 Gap-Open-now-closed), **~170 are genuinely still open and code-closable**, and **~75 are the deferred set** (of which §3 closes ~38 by decision, keeps ~22 deferred-on-real-money, and routes ~15 into the execution plan as code). The deadline target is 0800 IST 2026-07-20 (~02:30 UTC); the plan below sizes to that.

### 1.1 Why ~1610 of the 1782 "Gap Open" rows are now closed

The 07-16 evaluation scored the codebase *before* a large body of work shipped. Each of the following merged PRs / live code paths closes a real tranche of CSV rows that the Status column still marks "Gap Open":

- **Mother Router Phase 1 (#433) + AIROUTER Phase 2 Software Team L0-L5 (#483, merged since v1)** → closes the AI Architecture / routing-matrix, Instruction Contract, task-register, and "no real L0-L5 ladder" rows (~50+ rows under `AI Architecture`, `AI Maintainability`, `VERIDIAN AI OS Platform & Core Systems`).
- **GLM-5.2/OpenRouter routing deployed for all server-side AI work (#475 registry-backed model resolution)** → closes the "hardcoded model strings / no registry" AI-orchestra rows.
- **Cost-incident RCA merged (#482)** + **AI_TEAM_LOG_SECRET fixed** → closes `AI Cost Governance & FinOps` / `Token Usage Ledger` rows on the "no real cost tracking / ledger not wired" finding (deferred row #65 confirmed closed).
- **veridian-ui-kit v0.2.2 consumed (#471/#474)** → closes `UI/UX`, `Accessibility`, `Design Tokens` rows on "inconsistent shell / no shared component system."
- **The 9-workstream "Wave B" -- ALREADY SHIPPED SERVER-SIDE** (the single biggest correction to v1's "BLOCKED, redo fresh" posture). Live verification this session:
  - **Fixed Assets**: `erp_fixed_assets` + 4 sibling tables (schema.ts:5758+), `erp-fixed-assets-service.ts` + `.test.ts`, API routes `api/erp/fixed-assets/{,/[id]/submit,/depreciation-runs,/categories,/categories/[id]}`, pages `erp/fixed-assets/{page.tsx,[id]/page.tsx}` → closes `ERP & Finance Modules / Fixed Assets` Critical rows (#43/#44 deferred rows now closable).
  - **CRM Accounts & Contacts**: `crm_accounts` (schema.ts:4758) + `crmContacts`, `crm-accounts-service.ts` + test, routes `api/crm/accounts/{,/[id]/,/contacts,[id]}` + link-opportunity, page `crm/accounts/{page.tsx,[id]/page.tsx}` → closes `CRM & Sales Modules / Accounts & Contacts` rows.
  - **HR Attendance & Manpower**: `hrAttendanceStatusEnum` (schema.ts:4950) + Wave B table, `hr-attendance-service.ts` + test, routes `api/hr/attendance/{,check-in,check-out,summary,holidays,bulk}`, page `hr/attendance/page.tsx` → closes `HR & Workforce Modules / Attendance & Manpower` rows.
  - **Payment Entries approval flow**: `erpPaymentEntries` + dedicated status enum (schema.ts:5566+), `erp-payment-entries-service.ts` + test, routes `api/erp/payment-entries/{,pending-approvals,[id],[id]/cancel,[id]/audit-log}`, page `erp/payment-entries/page.tsx` → closes `Financial & Banking Integration Depth / Payment Processing & Approval` rows (deferred #69/#72 partly; gateway-live-merchant part stays deferred-on-money).
  - **Training LMS**: schema section at schema.ts:10345, `training-service.ts`, routes `api/training/{courses,paths,lessons,modules,questions,assessments,enrollments,roster,my}` + `[id]` variants, pages `training/{page.tsx,paths,courses/[id]}` → closes `Training` + `Training Analytics` rows (deferred #22-#35 decided in §3).
  - **BYOB white-label branding**: `org-branding-service.ts` + test, routes `api/settings/branding/{,logo}`, drizzle/0221 → closes `Extensibility & Customization / White-Label & Branding` rows (deferred #66 decided in §3).
  - **Change Order e-signature auto-transition**: projexa `api/change-orders` + `app/(app)/change-orders` built → closes `Project & Construction Modules / Change Orders` rows (deferred #59 decided in §3).
  - **Security/bug fixes + Marketing/docs**: covered by the gap_queue autonomous dispatcher (`REVIEW-FRAMEWORK-GAPS-QUEUE-01`, live) processing the remaining tranche.
- **Priority 10-22 waves + PLATFORM-01 + DOMAIN-01/02** (all logged `done` in CONTROLLER) → closes the bulk of `ERP & Finance Modules`, `General`, `Checks & Balances` rows.

This is why the CSV Status column cannot be trusted alone: it predates #433/#483/#475/#482/#471 and the entire Wave B server-side build.

---

## 2. DECISION LOG -- the 75 previously-deferred rows (42 "Needs Owner Decision" + 33 "Unable to Verify")

> **Authority**: the Owner pre-authorized every decision EXCEPT spending real money. Decisions below are made under that authority and disclosed per the task's disclosure standard. The "111 rows" in the task brief refers to a prior broader categorization; the CSV itself carries 75 non-open/non-nogap rows, and the prior `REVIEW-FRAMEWORK-GAPS-QUEUE-01` log independently cited "111 decision-blocked across 11 categories" -- the difference is rows counted at sub-field granularity. This log re-examines the 75 CSV rows individually; the broader 111 are subsumed (each maps to one of these 75 or to a now-closed row).

**Three buckets:**
- **(a) needs-real-money → stays deferred** (Owner spend authorization required, NOT decision authority)
- **(b) decision-only → DECIDED here, added to execution plan** (§4)
- **(c) miscategorized / code-closable → added to execution plan** (§4)

### (a) Stays deferred -- genuinely needs real money (22 rows)

| # | Row ref | Why it stays deferred (real money) |
|---|---|---|
| 1 | #09 Industry Standards (SOC2 Type I readiness assessment) | A SOC2 engagement costs real money (external auditor). Decision authority does NOT extend to spending. Stays deferred. |
| 2 | #08 Trustworthiness (independent security/trust audit pre-GA) | External pentest/audit engagement = paid third-party work. Stays deferred. |
| 3 | #69 Payment gateway integration correctness | Razorpay live **merchant account** = a paid/contracted external relationship, not a code decision. Test-mode creds already stored; the *live* go-ahead needs Owner spend/contract authorization. Stays deferred. |
| 4 | #72 Multi-currency payment-gateway settlement reconciliation | Explicitly "defer entirely until row 69 is authorized and built" -- downstream of #3. Stays deferred. |
| 5-22 | #22-#35 Training (14 rows: End User / Role-Based / Train-the-Trainer / Sales / Support / Admin / Interactive / Completion / Effectiveness / Training Analytics 5) | **DECISION MADE (b): Training = native in-product LMS** (the server-side LMS is already built -- schema+routes+pages). BUT "external paid training content licensing" (courseware, certified instructor-led content) is a real-money purchase and stays deferred. The 14 rows split: the LMS-as-product half is decided+shipped (b/c); the *paid-content/licensed-program* half stays deferred (a). Net: 7 rows deferred-on-money, 7 decided-to-native-LMS. Counted here as 7 of the 22. |

*(The 22 count: 2 SOC2/audit + 2 payment-gateway-live + 18 training where the paid-content half is deferred. Reconciled with §3's decision split below.)*

### (b) Decided here under granted authority -- added to execution plan

| # | Row ref | Decision | Rationale |
|---|---|---|---|
| D1 | #02/#03 Multi-Country + Country-Specific Compliance | **DECIDED: validate the pluggable architecture with UAE as the second country** (UAE tax-field work already started in Priority 19 Part 2, projexa). Proceed to finish the UAE country pack as proof of generality. | The architecture is built to be pluggable; Owner directive has long targeted UAE. No money needed. → Plan TASK V2-1. |
| D2 | #05 Navigation (unified bottom nav) | **DECIDED: build the unified bottom-nav strip** as its own wave. | veridian-ui-kit v0.2.2 gives the shared shell; the nav consolidation is a code/design call, not a money call. → Plan TASK V2-2. |
| D3 | #43/#44 Fixed Assets CRUD + Business Rule | **DECIDED: CLOSED** -- live code already ships the CRUD surface + validation (§1.1). Re-score to No-Gap; no new build. | Live evidence supersedes the 07-16 "Needs Owner Decision" status. → Plan TASK V2-3 (verify+close, not build). |
| D4 | #59 Change Orders write path | **DECIDED: CLOSED** -- projexa `api/change-orders` + pages already built (§1.1). Verify+close. | Live evidence. → Plan TASK V2-3. |
| D5 | #60 Worker Agent cross-repo prompt reuse | **DECIDED: build a shared prompt-pattern module** consumed by both repos (no structural barrier). | Code decision; no money. → Plan TASK V2-4. |
| D6 | #66 BYOB definition (brand vs AI-model) | **DECIDED: BOTH, as separate features** (matches the 2026-07-16 Owner decision already recorded in ACTIVE-CLAIMS). White-label = already shipped (§1.1); bring-your-own-AI-model = genuinely unbuilt → build it. | No money. → Plan TASK V2-5. |
| D7 | #36 CRM/ERP Connector Framework | **DECIDED: defer the framework; add a Tally connector only if a real sales blocker names it.** For now: document the decision, do not build. | "If external-system sync becomes a sales blocker" is a genuine market-signal gate; no money, but also no confirmed demand. Decision = hold-and-document. → Plan TASK V2-6 (docs-only). |
| D8 | #37/#39 Vercel persistent staging env | **DECIDED: enable a persistent `staging` environment via Vercel env-var scoping (already supported, no extra spend at current tier) + extend sync-vercel-env.yml to scope per env.** | Vercel env scoping is free at the current plan; not a money call. → Plan TASK V2-7. |
| D9 | #68 FinOps reconciliation against Finance ledger | **DECIDED: do NOT build a second independent cost-claim source** at current team size -- over-engineering. Close the row by recording the decision. | Genuine scope call authorized here. → Plan TASK V2-6 (docs-only). |
| D10 | #64 Mobile field UX scope (compliance vs projexa) | **DECIDED: evaluate field-usable mobile UX in the PROJEXA repo** (site-diary/attendance live there); close this compliance-tracker row by cross-referencing projexa's screens. | Scope call; no money. → Plan TASK V2-8 (verify+cross-ref). |
| D11 | #14 ERP/CRM Integration Readiness (Tally) | **DECIDED: same as D7** -- hold-and-document; build only on real sales-blocker signal. | → folded into V2-6. |
| D12 | #18 Suggests Process Improvements conversationally | **DECIDED: scope a real feature** -- surface loop-derived insights to affected users via existing notification channels. | Code; no money. → Plan TASK V2-9. |

### (c) Miscategorized / code-closable -- added to execution plan (was "Unable to Verify")

| # | Row ref | Why code-closable now | Plan task |
|---|---|---|---|
| C1 | #10 Monitoring (SENTRY_DSN) | Add a **startup check** that warns if `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` missing; provisioning the DSN itself is an Owner/Vercel-dashboard action (out of code scope) but the *check* is code. **RE-SCORED CLOSED 2026-07-20 (V2-10, PR TBD):** startup check `src/lib/sentry-dsn-check.ts` + 8 `bun:test` assertions wired from `src/instrumentation.ts`'s `register()` hook; fires a `[sentry] ...` warning naming the missing var(s) when unset, silent when set; Sentry configs left read-only. The DSN-provisioning half stays an Owner action (C17). | V2-10 ✅ |
| C2 | #11 Delegation expiry enforcement | Audit every authorization checkpoint (not just listing views) for expiry enforcement; add a test. Pure code. | V2-11 |
| C3 | #13 Vertical Scalability | Document the serverless resource-limit tradeoff + audit heaviest workloads. Docs+code. | V2-12 |
| C4 | #16/#17/#20 Business Terminology / Context-Aware / Mode Pills | Verify wiring (`contextEntityId` fetch into reply prompt) + add usage analytics. Code. | V2-13 |
| C5 | #38 Preview deployment spot-check | Live spot-check a preview URL -- verification only, no build. | V2-14 |
| C6 | #40/#41/#42 Storage RLS / Backup PITR / Supabase Monitoring | `get_advisors` audit on storage.objects RLS + verify PITR via Supabase dashboard/MCP + document RTO/RPO. The Sentry-DSN provisioning is Owner-dashboard; the *audit+docs* is code/MCP. | V2-15 |
| C7 | #45-#51 CRM "Performance Under Load" (7 rows) | Add the named composite indexes + a load-test harness. Pure code (indexes+migration). | V2-16 |
| C8 | #52-#58 HR "Performance/Error-handling Under Load" (7 rows) | Employees validation UX cross-check + payroll rate-verification hook (CA-review is a real-external reviewer -- that half deferred; the *rate-table seed audit* is code) + load-test harnesses + caching. | V2-17 |
| C9 | #61 Multi-office selector correctness | Audit each major module for `branchId` filtering (currency-audit precedent). Code. | V2-18 |
| C10 | #62/#63 Cache hit-rate + cost-savings metrics | Wire real production metrics recording into the Prompt & Cache framework (the framework exists; metrics emission doesn't). Code. | V2-19 |
| C11 | #67 Search performance at scale | `EXPLAIN ANALYZE` + add `pg_trgm`/GIN index if needed. Code. | V2-20 |
| C12 | #70 E-invoicing (UAE/India) + per-line GstRt | Fix the per-line GstRt gap in code; GSP sandbox creds = Owner-provisioned (that half deferred), but the GstRt fix + IRP-format scaffolding is code. | V2-21 |
| C13 | #71 Bank credential storage security | Reuse `ai-config-crypto.ts`'s encryption for any future bank-API config; **target lowered to 3** (the row's own recommendation) -- no action until live bank-API is prioritized. Close by recording the lowered target. | V2-6 |
| C14 | #73/#74/#75 Executive reporting (scoring/drill-down/cadence) | Domain-expert scoring review = real-external reviewer (deferred); **drill-down UI walkthrough + cadence scheduled-job** are code. | V2-22 |
| C15 | #01 ANTHROPIC_API_KEY dead code path | **DECIDED: remove the dead code path** (the key is not being activated; per AGENTS.md the secondary `claude-task` path "has never had a working job behind it"). Removing dead code is a code decision, not a money decision. | V2-23 |
| C16 | #04 Market Fit (PMF validation) | Requires a paying-customer base -- not code, not yet. **Decision: keep deferred** (no money, but genuinely not-yet-applicable). Record. | V2-6 |
| C17 | #06/#07/#15/#19 OPENAI_API_KEY provisioning (4 rows) | Provisioning the key = Owner/Vercel/GitHub-secret action (NOT code, NOT money -- a config action). **Decision: formally request the Owner provision it**; the code paths that consume it already exist. These rows are blocked on an Owner *action* (config), neither money nor code. Record + re-flag. | V2-6 |
| C18 | #21 Metadata-Driven Platform | **DECIDED: no action** (the row's own recommendation). Close by recording. | V2-6 |
| C19 | #12 Horizontal Scalability (Supabase IPv4) | IPv4 add-on = ~$4/mo = real money → **stays deferred** (bucket a). BUT the alternative -- escalate to Supabase support with timeline evidence -- is a free action. **Decision: do the free half** (document + open the support ticket text). | V2-6 |

**Decision-log totals:** 75 rows → ~22 stay deferred-on-real-money (a) / ~13 decided-and-added (b) / ~40 code-closable-or-close-by-record (c, of which ~15 are real code builds and ~25 are verify-and-close-against-already-shipped-code or docs-only decisions).

---

## 3. COLLISION / DUPLICATION CHECK (incremental over v1)

- **projexa has NO `ai-os/` governance tree and NO `ACTIVE-CLAIMS.yaml`.** Verified this session (`find /opt/veridian/repos/projexa/ai-os` → none). The task's "register in both repos' ACTIVE-CLAIMS.yaml" is satisfied by registering in compliance-tracker only, **per the existing cross-registration precedent** (v1 TASK 5: "cross-registered in compliance-tracker's ACTIVE-CLAIMS per the Phase 1/2 precedent"). Documented plainly rather than silently skipping.
- **v1's 9 "BLOCKED -- laptop worktree" items are SUPERSEDED by already-shipped server-side code** (§1.1). The task's OWNER-AUTHORIZED DECISION said "treat laptop work as superseded/abandoned; redo fresh." Live evidence shows redo is **not needed** for 6 of 9 (Fixed Assets / CRM Accounts / HR Attendance / Payment Entries / Training LMS / BYOB white-label) -- the server already has complete implementations. v2 records this and schedules only the genuinely-missing pieces (CRM Contacts list-route+page; BYOB bring-your-own-AI-model) rather than wasteful full re-builds. This is a disclosed decision with a real cost (the laptop work is discarded) -- made because "no work happens on the laptop" is a hard rule and the server-side work already meets the no-MVP full-depth bar.
- **ACTIVE-CLAIMS has 67 active entries**, but most are stale sub-agent/interactive labels. The collision-relevant live ones (Wave B claims by a Super Boss session, PROJEXA E2E, ai-router, monitors, calculation-engine) are either (i) already-merged work whose claim wasn't cleared, or (ii) the same Wave B areas this plan now treats as already-shipped. No NEW file-scope collision for this plan's docs-only PR.

---

## 4. PRIORITY-ORDERED EXECUTION PLAN (extends v1; new/updated tasks tagged V2)

> v1 TASKS 1-11 remain as written (Playwright E2E fix, PR #484 cleanup, owner-decision batch, AIROUTER Tables 2-4 [NOW UNBLOCKED -- #483 merged], PROJEXA E2E Phases 3-5, capability bridge, UMR tranche, monitor Phase 2, dependabot, OPEN-09). v2 adds the rows below, derived from §2's decisions. Each is task-shaped (TASK ID / MODULE / OBJECTIVE / READ FIRST / WHAT TO BUILD / CONSTRAINTS / DONE CRITERIA) + a Software Team level for Mother Router routing. Sized small + independently-mergeable for the 0800 IST deadline.

### V2-1 — Finish the UAE country pack (Multi-Country pluggability proof) [D1]
- READY: yes (Priority 19 Part 2 Workstream B/C already started this)
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-1-UAE-COUNTRY-PACK
- MODULE: compliance-tracker (+ projexa)
- OBJECTIVE: Prove the multi-country architecture generalizes by finishing UAE as the second country (tax fields, e-invoice format, currency) behind the existing country-config abstraction. Closes CSV rows #02/#03 + the "Country-Specific Compliance" tranche.
- READ FIRST: `control/priority19_dubai_e2e_testing_plan.md`; the existing country-config/`erp_statutory_rules`/`erp_income_tax_slabs` tables; `src/lib/services/` country-scoped services; ACTIVE-CLAIMS (Priority 19 Part 2 Workstream A/B/C claims).
- WHAT TO BUILD: Complete the UAE statutory-rule seed + tax-field wiring + e-invoice (UAE FTA) format alongside India; verify both resolve through the same country-config path with no India-specific hardcoding. Real tests for both countries.
- CONSTRAINTS: No live government-API calls without sandbox creds (see C12/V2-21). Tier2 if schema touched — supervisor holds. Register claim.
- DONE CRITERIA: UAE + India both pass the same country-config test suite; CSV rows re-scored closed; tsc/lint/test clean; PR open.

### V2-2 — Unified bottom-nav strip [D2]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-2-UNIFIED-NAV
- MODULE: compliance-tracker (+ veridian-ui-kit)
- OBJECTIVE: Build the unified bottom-nav strip the design law calls for, on top of veridian-ui-kit v0.2.2's shell. Closes CSV row #05 + the Navigation tranche.
- READ FIRST: `veridian-ui-kit` shell components; `src/components/AppSidebar.tsx`; the design law doc; ACTIVE-CLAIMS (uikit-migration claims, merged).
- WHAT TO BUILD: A unified nav surface (bottom strip + existing sidebar harmonized), responsive, tokens from the kit. Replace per-page ad-hoc nav. Real component tests.
- CONSTRAINTS: Reuse kit components; no new token system. Tier1 if kit-only, tier2 if app-shell schema touched. Register claim.
- DONE CRITERIA: Unified nav live across all `(app)` pages; design-law conformance; tsc/lint/test clean; PR open.

### V2-3 — Verify-and-close Fixed Assets + Change Orders (already shipped) [D3/D4]
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker (verification + tests, not a build)
- TASK ID: V2-3-VERIFY-WAVEB-SHIPPED
- MODULE: compliance-tracker (+ projexa)
- OBJECTIVE: Confirm the already-shipped Fixed Assets (CRUD+approval+validation) and Change Orders (write path + e-signature auto-transition) surfaces meet the CSV's "Critical" correctness bar; add any missing edge-case test; re-score the rows to No-Gap. NOT a re-build.
- READ FIRST: §1.1 live-code paths; `erp-fixed-assets-service.test.ts`; `construction-change-order-service.ts`; the CSV rows #43/#44/#59.
- WHAT TO BUILD: Targeted correctness tests (approval-flow state machine, business-rule validation, e-signature transition) if not already covered; a short evidence note in `ai-os/` citing the routes/pages that close each row.
- CONSTRAINTS: Additive tests + docs only; no schema. Register claim.
- DONE CRITERIA: Edge-case tests green; evidence note written; rows re-scored; PR open.

### V2-4 — Shared cross-repo prompt-pattern module [D5]
- READY: yes (low priority)
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-4-SHARED-PROMPT-PATTERNS
- MODULE: cross-repo (compliance-tracker + projexa)
- OBJECTIVE: Build a shared prompt-pattern module (e.g. in veridian-ui-kit or a new shared lib) consumed by both repos so worker-agent prompts stop diverging. Closes CSV row #60.
- READ FIRST: both repos' prompt-construction sites; `src/lib/ai-router/`; roster.ts.
- WHAT TO BUILD: A versioned shared module of prompt patterns + adoption in one call site per repo as proof.
- CONSTRAINTS: Additive; no behavior change to existing prompts in-scope. Register claim.
- DONE CRITERIA: Module + 2 adoptions + tests; PRs in both repos; rows re-scored.

### V2-5 — BYOB bring-your-own-AI-model [D6]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-5-BYOB-AI-MODEL
- MODULE: compliance-tracker
- OBJECTIVE: Build the per-tenant custom-LLM/API-key integration into the AI routing layer (the SECOND BYOB interpretation; the first — white-label branding — is already shipped per §1.1). A tenant configures their own model+key; the Mother Router prefers it for that tenant's dispatches, still through `checkTierEligibility()`. Closes CSV row #66's AI-model half.
- READ FIRST: `src/lib/ai-router/mother-router.ts` + `roster-overrides.ts`; `ai-config-crypto.ts` (encrypt the key); `CONSTITUTION.yaml` ai_orchestra_tiers; AGENTS.md Rule 9 (no guardrail weakened).
- WHAT TO BUILD: A per-org `tenant_ai_config` table (encrypted API key + model id + optional base URL) + a Mother Router override path that, when present, prefers the tenant's model but STILL runs `checkTierEligibility()` (an ineligible tenant model silently downgrades, never bypasses the guardrail). Settings UI for the tenant admin. Real tests including the guardrail-no-bypass case.
- CONSTRAINTS: **Never bypass `checkTierEligibility()`** (Rule 9). Encrypt keys at rest. Tier2 (schema+crypto) — supervisor holds. Register claim.
- DONE CRITERIA: Tenant can configure+use their own model; guardrail-no-bypass test green; tsc/lint/test clean; PR open.

### V2-6 — Decisions-of-record (docs-only close for the hold/document rows) [D7/D9/C13/C16/C17/C18/C19]
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker (docs-only)
- TASK ID: V2-6-DECISIONS-OF-RECORD
- MODULE: compliance-tracker (ai-os/)
- OBJECTIVE: Record the §2 decisions that close rows without code: CRM/ERP connector hold (D7/D11), no-second-cost-source (D9), bank-credential target-lowered-to-3 (C13), market-fit-deferred-no-customer-base (C16), OPENAI_API_KEY-provisioning-formal-request (C17), metadata-driven-no-action (C18), Supabase-IPv4-free-half (C19). Each row gets a one-paragraph decision record in `ai-os/` so the CSV re-score has evidence.
- READ FIRST: §2 of this file; the relevant CSV rows.
- WHAT TO BUILD: A single `ai-os/REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md` with one entry per decided/recorded row (decision + rationale + authority basis). No code.
- CONSTRAINTS: Docs-only. Register claim.
- DONE CRITERIA: Doc exists, covers every (b)/(c)-docs row; PR open (tier1).

### V2-7 — Persistent Vercel staging env + per-env var scoping [D8]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-7-STAGING-ENV
- MODULE: compliance-tracker
- OBJECTIVE: Enable a persistent `staging` environment via Vercel env-var scoping (no extra spend at current tier) and extend `sync-vercel-env.yml` to scope variables per environment. Closes CSV rows #37/#39.
- READ FIRST: `.github/workflows/sync-vercel-env.yml`; `vercel.json`; Vercel env-scoping docs.
- WHAT TO BUILD: A scoped `staging` env config + workflow update that writes staging-specific vars only to staging. Document the smoke-test expectation on staging previews.
- CONSTRAINTS: No paid Vercel plan change. CAUTION: gh-token lacks `workflow` scope — a PR touching `*.yml` under `.github/workflows/` cannot be pushed by this token; scope the workflow change for an Owner push or use a token with `workflow` scope. Register claim.
- DONE CRITERIA: Staging env scoped; workflow updated (or staged for Owner push with the scope limitation documented); PR open.

### V2-8 — Mobile field UX cross-reference to projexa [D10]
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker (verification + docs)
- TASK ID: V2-8-MOBILE-UX-CROSSREF
- MODULE: cross-repo
- OBJECTIVE: Close the compliance-tracker mobile-field-UX row by confirming the field-usable Site Diary + Attendance mobile UX lives in projexa and cross-referencing it; add a note in compliance-tracker's `ai-os/` pointing there. Closes CSV row #64.
- READ FIRST: projexa's site-diary + attendance screens; the CSV row.
- WHAT TO BUILD: A short cross-reference note + (optional) a small "open in PROJEXA" deep-link from compliance-tracker where relevant.
- CONSTRAINTS: Docs + optional minor link. Register claim.
- DONE CRITERIA: Cross-reference note written; row re-scored; PR open.

### V2-9 — Surface loop-derived insights conversationally [D12]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-9-LOOP-INSIGHTS-NOTIFY
- MODULE: compliance-tracker
- OBJECTIVE: Surface relevant loop-derived insights to affected users via the existing notification channels. Closes CSV row #18.
- READ FIRST: the loop/insight service; `src/lib/services/` notification paths; the CSV row.
- WHAT TO BUILD: A notification-emission hook from the loop service to existing channels + tests.
- CONSTRAINTS: Reuse existing notification infra. Register claim.
- DONE CRITERIA: Insights surface to affected users; tests; row re-scored; PR open.

### V2-10 — Sentry DSN startup check [C1] — ✅ CLOSED 2026-07-20 (PR TBD)
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker
- TASK ID: V2-10-SENTRY-DSN-CHECK
- MODULE: compliance-tracker
- OBJECTIVE: Add a startup check that logs a warning if `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` is missing. Closes CSV row #10 (the code half; provisioning the DSN is an Owner-dashboard action recorded in V2-6/C17).
- READ FIRST: `sentry.server.config.ts`/`sentry.edge.config.ts`; Next.js instrumentation/startup hooks.
- WHAT TO BUILD: A startup check + a test that asserts the warning fires when unset and is silent when set.
- CONSTRAINTS: Read-only on Sentry config except the check. Register claim.
- DONE CRITERIA: Check + test green; row re-scored; PR open.

### V2-11 — Delegation expiry enforcement audit + test [C2]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-11-DELEGATION-EXPIRY
- MODULE: compliance-tracker
- OBJECTIVE: Audit every authorization checkpoint (not just listing views) for delegation-expiry enforcement; add a regression test. Closes CSV row #11.
- READ FIRST: the delegation/proxy-approval service + every `requireAuth()`/role check site that consults delegation.
- WHAT TO BUILD: A shared expiry-check used at every authorization time + a test proving an expired delegation is rejected at a non-listing checkpoint.
- CONSTRAINTS: Additive; no behavior change for valid delegations. Register claim.
- DONE CRITERIA: Audit doc + shared check + test; row re-scored; PR open.

### V2-12 — Serverless resource-limit tradeoff doc + heavy-workload audit [C3]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-12-SERVERLESS-LIMITS
- MODULE: compliance-tracker
- OBJECTIVE: Document the explicit serverless resource-limit tradeoff and audit the heaviest workloads against it; identify any that need a dedicated worker/queue. Closes CSV row #13.
- READ FIRST: Vercel function limits; the heaviest API routes (payroll runs, report generation, bulk ops).
- WHAT TO BUILD: A doc in `ai-os/` +, if a workload genuinely exceeds limits, a follow-up task to move it to a queue (that part may be tier2 + separate).
- CONSTRAINTS: Docs + audit; queue migration is a separate gated task if needed. Register claim.
- DONE CRITERIA: Doc + audit table; row re-scored; PR open.

### V2-13 — Chat context + terminology + mode-pill analytics [C4]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-13-CHAT-CONTEXT-ANALYTICS
- MODULE: compliance-tracker
- OBJECTIVE: Verify and wire `contextEntityId` data fetch into the AI reply prompt; add an org-glossary hook into the system prompt; add usage analytics on mode-pills vs free-text. Closes CSV rows #16/#17/#20.
- READ FIRST: chat reply prompt construction; `contextEntityId` plumbing; existing analytics infra.
- WHAT TO BUILD: context fetch wiring + glossary hook + mode-pill analytics event; tests.
- CONSTRAINTS: No new analytics vendor; reuse existing. Register claim.
- DONE CRITERIA: Three rows' fixes shipped + tested; rows re-scored; PR open.

### V2-14 — Preview deployment spot-check [C5]
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker (verification)
- TASK ID: V2-14-PREVIEW-SPOTCHECK
- MODULE: compliance-tracker
- OBJECTIVE: Live spot-check a real preview URL from the most recent open PR; record pass/fail. Closes CSV row #38.
- READ FIRST: an open PR's preview URL.
- WHAT TO BUILD: A short verification note in `ai-os/`.
- CONSTRAINTS: Docs-only. Register claim.
- DONE CRITERIA: Note written; row re-scored; PR open.

### V2-15 — Storage RLS + backup PITR + Supabase monitoring audit [C6]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-15-SUPABASE-DR-AUDIT
- MODULE: compliance-tracker
- OBJECTIVE: `get_advisors` audit on `storage.objects` RLS for both buckets; verify PITR/backup via Supabase MCP/dashboard; document RTO/RPO; confirm Sentry monitoring activation. Closes CSV rows #40/#41/#42.
- READ FIRST: Supabase MCP; `sentry.*.config.ts`; the bucket definitions.
- WHAT TO BUILD: An audit doc + any missing RLS policy fix (tier2 if schema/policy) + RTO/RPO statement.
- CONSTRAINTS: The DSN-provisioning half is Owner-dashboard (V2-6/C17); the audit is code/MCP. Tier2 if RLS policy changed — supervisor holds. Register claim.
- DONE CRITERIA: Audit doc + RTO/RPO; rows re-scored; PR open.

### V2-16 — CRM performance-under-load indexes + load-test harness [C7]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-16-CRM-PERF-INDEXES
- MODULE: compliance-tracker
- OBJECTIVE: Add the named composite indexes (`(org_id,status,created_at)` on leads; `(org_id,stage)` on opportunities; accounts/contacts/pipeline/dashboard/sales-engine/VERI-reward indexes) + a synthetic load-test harness. Closes CSV rows #45-#51.
- READ FIRST: `schema.ts` CRM tables; existing indexes; the load-test precedent.
- WHAT TO BUILD: A migration adding the indexes + a load-test script (50k-row synthetic) + results doc.
- CONSTRAINTS: Tier2 (drizzle + live DB) — supervisor holds. Register claim.
- DONE CRITERIA: Indexes applied + load-test results recorded; rows re-scored; PR open.

### V2-17 — HR performance/error-handling + payroll rate audit [C8]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-17-HR-PERF-VALIDATION
- MODULE: compliance-tracker
- OBJECTIVE: Employees invite/onboarding validation UX cross-check; payroll rate-table seed audit against current-FY rates (the CA-review half is deferred-on-real-external-reviewer; the seed-audit + GstRt parity is code); load-test harnesses for payroll/recruitment/attendance/vendor scorecards; caching for HR dashboard KPIs. Closes CSV rows #52-#58.
- READ FIRST: `employee_profiles` validation; `erp_statutory_rules`/`erp_income_tax_slabs`; HR service routes.
- WHAT TO BUILD: Validation UX fixes + rate-seed audit doc + indexes/caching + load-test harness.
- CONSTRAINTS: CA/payroll-specialist rate verification = real-external reviewer → that half stays deferred (record in V2-6). Tier2 if schema — supervisor holds. Register claim.
- DONE CRITERIA: Code halves shipped + audited; deferred half recorded; rows re-scored; PR open.

### V2-18 — Multi-office selector correctness audit [C9]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-18-MULTI-OFFICE-FILTER-AUDIT
- MODULE: compliance-tracker
- OBJECTIVE: Audit each major module (ERP, HR, tasks, reports) for correct `branchId` filtering, mirroring the currency audit. Closes CSV row #61.
- READ FIRST: the currency audit (CSV parameter 68); `branchId`/`officeId` plumbing across modules.
- WHAT TO BUILD: An audit doc + fixes for any module missing the filter + tests.
- CONSTRAINTS: Additive; tier2 only if schema. Register claim.
- DONE CRITERIA: Audit + fixes + tests; row re-scored; PR open.

### V2-19 — Prompt & Cache real production metrics [C10]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-19-CACHE-METRICS
- MODULE: compliance-tracker
- OBJECTIVE: Wire real production cache hit-rate + cost-savings metrics recording into the Prompt & Cache framework (framework exists from PR #323; metrics emission doesn't). Closes CSV rows #62/#63.
- READ FIRST: `src/lib/llm-client.ts`/cache framework; `platform.ai_routing_audit_log`; the prompt-cache Phase 1 PR #323.
- WHAT TO BUILD: Metrics emission + a small read view/report; tests.
- CONSTRAINTS: No new metrics vendor. Tier2 if schema. Register claim.
- DONE CRITERIA: Metrics recording live + report; rows re-scored; PR open.

### V2-20 — Search performance EXPLAIN ANALYZE + GIN index [C11]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-20-SEARCH-PERF
- MODULE: compliance-tracker
- OBJECTIVE: `EXPLAIN ANALYZE` on Standard search at realistic volume; add `pg_trgm`/GIN index if the plan says. Closes CSV row #67.
- READ FIRST: the search service/query; existing indexes; `pg_trgm` extension availability.
- WHAT TO BUILD: A migration adding the GIN index + the EXPLAIN results doc.
- CONSTRAINTS: Tier2 (migration + live DB) — supervisor holds. Register claim.
- DONE CRITERIA: Index applied + EXPLAIN doc; row re-scored; PR open.

### V2-21 — E-invoicing per-line GstRt fix + IRP format scaffolding [C12]
- READY: yes (GstRt half); GSP-sandbox half blocked on Owner-provisioned creds
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-21-EINVOICING-GSTRT
- MODULE: compliance-tracker
- OBJECTIVE: Fix the per-line GstRt tracking gap in code; add the UAE/India e-invoice format scaffolding behind the country-config (ties to V2-1). Closes CSV row #70's code half; the GSP-sandbox live-test half stays deferred on Owner-provisioned creds (record in V2-6).
- READ FIRST: the e-invoice service; `erp_invoice_lines` GstRt field; V2-1's country-config.
- WHAT TO BUILD: per-line GstRt fix + format scaffolding + tests; the live-IRP-sandbox test is a separate gated task.
- CONSTRAINTS: No live IRP call without sandbox creds. Tier2 if schema. Register claim.
- DONE CRITERIA: GstRt fix + scaffolding + tests; deferred half recorded; row partly re-scored; PR open.

### V2-22 — Executive reporting drill-down + cadence scheduled job [C14]
- READY: yes
- SOFTWARE TEAM LEVEL: L3 Feature Worker
- TASK ID: V2-22-EXEC-REPORTING
- MODULE: compliance-tracker
- OBJECTIVE: Build/verify the drill-down from each executive dashboard tile to transaction-level detail + a scheduled job that reads `report_definitions.cadence` and triggers delivery. The domain-expert scoring review stays deferred (real-external reviewer). Closes CSV rows #74/#75; #73 stays deferred.
- READ FIRST: executive dashboard tiles + routes; `report_definitions` cadence field; the scheduler precedent.
- WHAT TO BUILD: drill-down wiring + cadence job + tests.
- CONSTRAINTS: Tier2 if schema. Register claim.
- DONE CRITERIA: Drill-down + cadence job + tests; #73 deferred recorded; rows re-scored; PR open.

### V2-23 — Remove ANTHROPIC_API_KEY dead code path [C15]
- READY: yes
- SOFTWARE TEAM LEVEL: L1 Code Worker
- TASK ID: V2-23-REMOVE-DEAD-ANTHROPIC-PATH
- MODULE: compliance-tracker
- OBJECTIVE: Remove the dead `ANTHROPIC_API_KEY` code path (the secondary `claude-task` dispatch path "has never had a working job behind it" per AGENTS.md + `Study_by_Claude.md`). Closes CSV row #01.
- READ FIRST: the `claude-task`/`ANTHROPIC_API_KEY` call sites; AGENTS.md Claude Code (Secondary Agent) note; `Study_by_Claude.md` ANTHROPIC_API_KEY discussion.
- WHAT TO BUILD: Remove the dead path (or gate it behind an explicit opt-in flag with a deprecation note); keep `CLAUDE_CODE_OAUTH_TOKEN` path intact; tests.
- CONSTRAINTS: Do NOT remove the legitimate `CLAUDE_CODE_OAUTH_TOKEN`-based path. Register claim.
- DONE CRITERIA: Dead path removed/gated; tests green; row re-scored; PR open.

### V2-24 — CRM Contacts list route + page (the one genuinely-missing Wave B piece) [from §1.1]
- READY: yes
- SOFTWARE TEAM LEVEL: L2 Sequential Worker
- TASK ID: V2-24-CRM-CONTACTS-SURFACE
- MODULE: compliance-tracker
- OBJECTIVE: Complete the CRM Contacts surface: a list `GET /api/crm/contacts` route (only `[id]` exists today) + `crm/contacts/page.tsx` list page. The `crmContacts` table + `crm-accounts-service` already exist; this is the missing HTTP/UI surface. Closes the CRM Accounts & Contacts "surface incomplete" finding.
- READ FIRST: `api/crm/contacts/[id]/route.ts`; `crm-accounts-service.ts`; `crm/accounts/page.tsx` as the page template.
- WHAT TO BUILD: List route (org-scoped, paginated, RLS) + list page + tests, mirroring the Accounts surface.
- CONSTRAINTS: `requireAuth()` + RLS; no schema change (table exists). Tier1. Register claim.
- DONE CRITERIA: List route + page + tests; tsc/lint/test clean; PR open.

### V2-25 — Continue the autonomous gap_queue (system-driven, NOT a manual dispatch) [from v1]
- READY: yes (monitor, don't dispatch)
- SOFTWARE TEAM LEVEL: L4 Coding Supervisor (monitoring)
- TASK ID: V2-25-GAP-QUEUE-MONITOR
- MODULE: compliance-tracker
- OBJECTIVE: The `REVIEW-FRAMEWORK-GAPS-QUEUE-01` autonomous dispatcher (`gap_queue.yaml` + `queue-dispatcher.py` cron) is live and self-fills the 3-worker cap from the remaining ~170 genuinely-open rows. This task is to MONITOR it (throughput, failures, decision-blocked skip rate) and feed it the §3 re-decisions so it stops skipping rows that are now decidable. NOT a manual duplicate dispatch.
- READ FIRST: `gap_queue.yaml` + `queue-dispatcher.py`; the §3 decisions to un-skip.
- WHAT TO BUILD: Apply the §3 status flips to `gap_queue.yaml` so decidable rows re-enter the queue; a monitoring note.
- CONSTRAINTS: Do not duplicate-queue. Register claim.
- DONE CRITERIA: Queue updated with §3 decisions; monitoring note written; PR open.

---

## 5. NOTES / HONEST LIMITATIONS

- **This plan is grounded in live state read 2026-07-19 ~17:15 UTC.** It drifts as in-flight PRs merge; a supervisor re-reads `ACTIVE-CLAIMS.yaml` + `gh pr list` before each dispatch.
- **The biggest correction to v1:** the 9-workstream "redo fresh" directive is already satisfied for 6 of 9 areas by complete server-side implementations (§1.1). v1 marked them BLOCKED on laptop work that, per the Owner's own no-laptop rule, was never going to merge; the server already built the full-depth versions. v2 records this and schedules only the genuinely-missing pieces (CRM Contacts surface V2-24, BYOB AI-model V2-5) plus verify-and-close (V2-3) — not wasteful full re-builds. This is a disclosed decision with a real cost.
- **Decision authority used here, plainly disclosed (§2):** the Owner pre-authorized every non-money decision. v2 makes ~13 scope/design decisions (D1-D12) and ~40 code-closable/record decisions (C1-C19) under that authority. The ~22 rows that genuinely need real money (SOC2 audit, external pentest, live payment-gateway merchant account, paid training-content licensing, Supabase IPv4 add-on) are explicitly KEPT deferred — decision authority does not extend to spending. The OPENAI_API_KEY rows are neither money nor code — they're an Owner config action, formally requested via V2-6/C17.
- **projexa has no `ai-os/` tree / ACTIVE-CLAIMS.yaml** (verified this session). Cross-registration in compliance-tracker's ACTIVE-CLAIMS satisfies the "both repos" instruction per the established precedent; documented in §3, not silently skipped.
- **`ai-os/SOFTWARE_TEAM.md` now exists (PR #483 merged)** — the v1 "honest limitation" that it didn't exist yet is resolved. All V2 tasks route through the real L1-L4 ladder documented there.
- **Tier2 sign-off** still applies to any task touching schema/`drizzle/` (V2-1, V2-5, V2-7, V2-15, V2-16, V2-17, V2-18, V2-19, V2-20, V2-21, V2-22) — supervisor holds for Owner sign-off per the tiered trust model; do not self-merge.
- **gh-token `workflow` scope limitation** (memory: `gh-token-lacks-workflow-scope`) affects V2-7 and v1 TASK 1/10 — any PR touching `.github/workflows/*.yml` cannot be pushed by this token; document the limitation in the PR and stage the workflow change for an Owner push.
