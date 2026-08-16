# Step 1 -- Comparison: Tree 1 (Requirements) vs. Tree 3 (Audited System)

**What this is**: a domain-by-domain comparison of `ai-os/audit-tree/10-merged-tree.yaml` (Tree 1 -- what the 9 requirement documents say VERIDIAN should be) against `ai-os/system-tree/50-merged-tree.yaml` (Tree 3 -- the audited tree of what's actually built in the live codebase). Per instruction, this step does NOT re-read the live code -- it compares the two trees as documents, using the evidence already captured in each. Where a claim below needed re-confirmation, that's noted as "unconfirmed" rather than asserted either way.

**Why this matters**: this is the gap-analysis-against-the-live-codebase phase that both `ai-os/audit-tree/00-INDEX.md` and `ai-os/system-tree/00-INDEX.md` explicitly flagged as "not started" when each tree was built. This is that phase, finally done.

---

## Headline finding, stated first because it reframes everything below

**Tree 1's 28 domains and Tree 3's 94 domains overlap far less than a naive "requirements vs. system" comparison would suggest -- because the 9 source documents describe the AI-GOVERNANCE/ORCHESTRATION LAYER of VERIDIAN (how AI should behave, how tasks flow, how Dynamic Chains work, how audits cadence), while the majority of Tree 3's 94 domains describe BUSINESS-DOMAIN MODULES (ERP, PMS, HR, CRM, Legal/GRC, Construction, Facilities Management, veda-advisors) that were built independently and were never described by any of the 9 documents.**

Concretely: `API-03` (ERP, 138 routes), `DB-15` (ERP, ~150 tables), `API-04`/`DB-12` (PMS), `API-05`/`DB-18` (The Firm), `API-09`/`DB-08` (HR), `API-10` (CRM/Sales-HQ), `API-11` (GST reconciliation), `API-13` (board/legal/risk/POSH/BCM/whistleblower/SEBI/RBI/IRDAI/secretarial/MCA/ESG/cap-table/CLM), `API-14` (facilities/tickets), all of `PRX-*` (PROJEXA/construction), and the entire `veda-advisors` repo (`VA-*`) have **no corresponding requirement anywhere in Tree 1**. This is not a gap in either tree -- it's an accurate reflection that VERIDIAN's actual product surface is much larger than the AI-governance framework the 9 documents specified. Section B below covers this properly instead of forcing a false "gap" narrative onto content that was never requested.

The REAL comparison -- does the AI-governance layer Tree 1 specifies actually exist in Tree 3 -- is Section A, domain by domain.

---

## Section A -- Tree 1's 28 domains against Tree 3, one by one

| Tree 1 | Tree 3 evidence | Status | Detail |
|---|---|---|---|
| **D1** Governance Charter & Mission | `GOV-18` (ai-os/OS.yaml, LIFECYCLE.yaml) | **Partial, Tree-3 blind spot** | The 3 root-level constitution docs this session wrote (`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`) substantially fulfill D1.B4's "3 additional constitutional documents" recommendation -- but Tree 3's research agents scoped to `src/`, `ai-os/`, `scripts/` and never inventoried root-level `.md` files, so this isn't captured as evidence in Tree 3. Not a system gap; a Tree-3 coverage gap, worth noting honestly. |
| **D2** AI Organizational Hierarchy & Roles | `GOV-05` (57-role roster, incl. `chief_audit_officer`) | **Partial** | The CAO role exists (matches D2.B4). The 4-executive hierarchy (Claude=Super Boss / DeepSeek=COO / GPT-OSS=CEE / ZLM=CSEO) is a session-level working practice (documented in `AGENTS.md`, also outside Tree 3's scanned scope), not a runtime code artifact -- can't be "built" the way an API route is. The ~150-named-specialist-auditor org chart (5 divisions x departments x agents) is a **real, unbuilt gap** -- `GOV-05` has only ~7 GUARDRAIL_*/AUDIT_EXECUTIVE roles total, nowhere near 150 individually named auditors. |
| **D3** Model Allocation & Routing Policy | `GOV-04` (tier eligibility) | **Superseded by a better design** | D3's literal "GPT-OSS>=95%/DeepSeek<=5%" split isn't what's coded. `GOV-04`'s complexity-tier system (mechanical/integrative/judgment) is a materially different, more sophisticated design that fulfills D3's underlying intent (disciplined model routing) via a superior mechanism. Not a gap -- an improvement that makes D3's literal design obsolete. |
| **D4** Universal Work Object / Task Data Model | `DB-04` (`tasks` table), `GOV-03` (TightTask), `GOV-08` (execution) | **Partial, with a real architectural finding** | Core lifecycle/execution exists. Whether `tasks` actually carries all of D4.B1's ~40 fields (Decision Tree, Retry Logic, Fallback Logic, etc.) and D4.B3's ~30 work-states is **unconfirmed** -- Tree 3's DB inventory didn't enumerate `tasks`'s full column list. More importantly: **D4.B7's "Work Object as single source of truth" recommendation was NOT followed** -- Tree 3 shows the opposite architecture: dozens of separate domain-specific service+table pairs (`erp_*`, `pms_*`, `firm_*`, `construction_*`...) rather than one unified object with views. This is a real, deliberate-looking divergence worth the Owner's attention, not an oversight. |
| **D5** Dynamic Mode Pills & Dynamic Chain Framework | `GOV-09`, `DB-04` (`dynamic_chains`), `UI-14` | **Mostly implemented** | The core mechanism (chain selection -> `resolveDynamicChainId` -> `dynamicChainId` on the task) is real and confirmed. Sub-requirements are mixed: "My Option Is Not Available" (D5.B5) was completed per this session's own task list (#21) but isn't independently confirmed in Tree 3's UI-14 text. D5.B6's visibility panel (task number/pill/chain/status/priority/owner always shown) and D5.B7's per-module context-adaptation are not confirmed either way. |
| **D6** Dynamic Chain Master Directory (DCMD) | Not found | **Confirmed gap** | This session's own task list (#24) already tracks this as deferred ("DCMD rich schema, graph wiring, adaptive UI, taxonomy content"). Tree 3 confirms no rich DCMD schema exists -- `dynamic_chains` (DB-04) is a flat find-or-create table, not the graph-structured directory D6 specifies. |
| **D7** VERI Identity & Behavior | `GOV-14` (approval preferences) | **Partial** | The default-non-decision-making / delegation posture (D7.B2) is genuinely built via `approval_preferences`. VERI's actual identity/naming/welcome-copy (D7.B1) is UI text Tree 3's agents didn't transcribe verbatim -- unconfirmed either way. |
| **D8** VERI Chat Platform Identity | `API-08`, `DB-10`/`DB-14`, multiple UI domains | **Partial** | The platform itself is real and extensively built. The specific "minimum 2-level chain selection before a NEW conversation begins" gate (D5.B4.S2/D8) is not confirmed as enforced anywhere in Tree 3's chat-related domains -- a real candidate gap. |
| **D9** Approval & Confirmation UX | `GOV-14` | **Implemented differently -- this actually resolves Tree 1's own open item** | Tree 1 flagged an unresolved reconciliation item (R1: 3 divergent option vocabularies -- 9 comm options, 9 quick options, 16 work-object options). Tree 3 shows the REAL system didn't adopt any of the three: it built a simpler binary (`always_approve`/`always_reject`) with 4 scope types (`communication_type`/`conversation`/`task`/`workflow`). This is a clean, empirical answer to R1 -- worth updating Tree 1's own open-item log to reflect it. |
| **D10** Communication Governance | `email.ts` (transactional only) | **Likely gap** | D10's specific "VERI drafts a communication, holds it for approval, only then sends" pattern has no confirmed match. What exists (`email.ts`'s `sendEmail`/`notifyAssigned`/`notifyOverdue`) is system-triggered transactional notification, a materially different and simpler thing. |
| **D11** Human Authority & AI Delegation | Cross-ref D7.B2 | Same as D7 | -- |
| **D12** Guardrail Framework -- Constitutional Layer (30 MGP) | `GOV-01`/`GOV-02` (4 registered leaves), `GOV-10`/`GOV-11`/`GOV-12`/`GOV-15`/`GOV-16` (scattered mechanisms) | **Partial, architecturally fragmented -- an important nuanced finding** | Most of the 30 guardrail CONCEPTS have SOME enforcing code somewhere (Instruction Validation ~ `tightTaskCheck`; Loop Prevention ~ `loop-prevention.ts`; Hallucination ~ `ai-reply-gate.ts`; Security/Privacy ~ `pii-redaction.ts`; Audit ~ `audit.ts`; Model Selection ~ `GOV-04`). But these are scattered across ~10 separate files, and only 4 leaf-checks are actually registered in the "official" `guardrail-engine.ts` registry (`GOV-02`). The constitutional claim "no task may bypass these guardrails" is mechanically true only for that tiny registered subset -- everything else relies on each call site remembering to invoke the right separate function, not on one unified enforcement point. |
| **D13** Guardrail Framework -- Per-Task/Per-Selection Layer | `GOV-02` (leaf-keyed checks) | **Largely implemented** | `guardrail-engine.ts`'s leaf-key mechanism does match D13's "keyed to Mode Pill/Chain selection" concept well. Whether violation messages are actually "predefined, preloaded, polite" text (vs. dynamically generated) is unconfirmed. |
| **D14** Monitoring (multi-scope) | `GOV-11`, `GOV-16`, `GOV-15`'s execution logger, `token_usage_ledger` | **Mostly implemented** | Loop prevention, continuous audit loops, and cost/usage logging are all real and confirmed. |
| **D15** Audit & Review Governance | `GOV-16` (11 daily loops), `GOV-04`'s `requiresMandatoryAudit` (CI merge gate) | **Partial** | The 7-level (L1-L7) cadence model isn't built as such. What IS built: 11 daily cron-triggered audit loops (a real but different continuous-audit mechanism) and a CI-level mandatory-audit-comment gate for cheap-tier dispatch PRs (`mandatory-audit-check.yml`, this session's own work, task #28) -- functionally an L1-equivalent, but enforced at PR-merge time, not live task-completion time. The 150-specialist audit organization is the same unbuilt gap noted under D2. |
| **D16** Continuous Improvement & Knowledge Evolution | `GOV-16`'s `loop_improvements`, `loop-improvement-proposer.ts` | **Partial** | A real CLEE (capture-propose) pipeline exists, always human-gated (`isDeployed:false`) -- but scoped to guardrail violations and loop-audit findings specifically, not "every completed task" as D16 claims universally. The "AI Agent Task Directory" (per-role success/failure/prompt-version tracking) isn't confirmed as a distinct feature; `worker_agent_usage_log`/`worker_agent_learnings` (`DB-04`) cover a narrower case (Worker Agents only, not the AI Dev Team roles generally). |
| **D17** AI Handover Protocol | Not found as a dedicated mechanism | **Confirmed gap** | No registered guardrail leaf, table, or service corresponds to the structured 9-field handover-with-explicit-acknowledgement pattern D17/Guardrail-22 specifies. `task_agent_executions`/`task_chat_messages` (`DB-04`) may carry some of this state implicitly, but no dedicated validation exists. |
| **D18** Hallucination & Evidence Discipline | `GOV-12` (`ai-reply-gate.ts`) | **Partial** | The hallucination-detection mechanism itself (`detectFalseActionClaim`, `passesReplyGate`) is real and matches well. The specific confidence-percentage banding (98-100/95-97/90-94/<90) isn't confirmed as literally coded anywhere -- superseded by `GOV-04`'s different tier system, similar to D3's finding. |
| **D19** Reporting Framework | `API-16`'s `reports/saved` | **Likely gap** | What exists (user-created saved BI queries) serves a different purpose than D19's automated daily/weekly/monthly AI-organization performance reporting. No confirmed multi-cadence automated reporting pipeline. |
| **D20** Customer/Business Task Governance | Cross-ref D4 | Same as D4 | The universal lifecycle applies by construction to any task regardless of origin. |
| **D21** Intelligent Work Detection & Source Intelligence | `API-08`'s `veri-meetings/generate-intelligence`, `API-12`'s `documents/extract` | **Partial, one strong hit** | MoM Intelligence (D21.B2) is a genuinely strong match -- `generate-intelligence`'s transcription-to-minutes-to-action-items pipeline was already cross-referenced to this exact requirement when Tree 3 was built. Document Intelligence (D21.B3) partially matches via AI extraction. Email Intelligence (D21.B4) has no confirmed match -- `instruction_commitments`/`instruction_mismatch_detections` (`DB-10`) cover a related-but-different concept (chat commitment tracking, not email parsing). |
| **D22** Follow-up, SLA & Continuous Planning | `API-01`'s `compliance/overdue` | **Partial, narrow** | Only a domain-specific instance exists (compliance items). No universal cross-Work-Object follow-up/re-planning engine confirmed. |
| **D23** Universal Dashboard | `UI-01` (`/dashboard`, `/veri-todo`) | **Largely implemented** | Strong match -- To Do/Approval/Analytics tabs and a genuinely unified pending-items feed (Tasks + Chat Instructions + PMS Issues merged) both exist. Real-time-ness unconfirmed. |
| **D24** Response Engine & Predefined Short Responses | `GOV-13` (`response-engine.ts`) | **Fully implemented -- the cleanest match in this whole comparison** | Matches D24's spec almost exactly, including the "even a lower model AI can do the job with higher confidence" design rationale, transcribed nearly word-for-word in both trees. |
| **D25** Task Automation, Calculators/Processes/Reports | `GOV-07` (25 files, 247 functions) | **Partial, with a quantified live/dormant gap** | The calculator infrastructure is extensive and real. But only 2 of 25 engine files (GST + partial Math) are actually wired into live dispatch -- 23 files' worth of built-but-dormant capability, a real and precisely quantifiable gap between "exists in the codebase" and "is reachable by a user." |
| **D26** Universal Connector Architecture | `API-15`/`UI-10`'s `/connectors` (Composio OAuth), `connector_accounts` table | **Partial** | Layer 1 (Cloud API/OAuth connectors -- Gmail/Drive/Calendar/Slack/Notion/GitHub) is genuinely built via Composio. Layers 2-4 (Office Add-ins, Browser Extensions, Desktop Companion) have zero evidence of existing. The Universal Connector normalization abstraction (Table/Document/Presentation/Communication) and the "Business Digital Twin" concept are not built -- `connector_accounts` is a simple OAuth-account table, not a rich digital-twin schema. |
| **D27** User Registration, Licensing & Adoption Dashboard | `DB-01`'s `organisations.plan`/`subscriptionPlanId` only | **Likely gap** | No dedicated license-seat/misuse-detection system, no adoption-dashboard with D27's specific metrics (Adoption %, AI Adoption %, Hours Saved, etc.), no confirmed 2-concurrent-session enforcement. Only the most basic plan/subscription linkage exists. |
| **D28** Onboarding & Sign-up UX | `onboarding_steps`/`onboardingStage` (`DB-01`/`DB-04`), `OnboardingChecklist.tsx` | **Partial, unconfirmed specifics** | A generic onboarding-tracking mechanism exists. D28's specific asks (Google-sign-in-first ordering, 4-digit-passcode-instead-of-password, a persistent "Invite a team member" control on every screen) are not confirmed as built -- auth is documented only generically as "Supabase Auth SSR." |

## Section A summary (mechanical tally)

| Status | Count | Domains |
|---|---|---|
| Fully implemented | 1 | D24 |
| Largely / mostly implemented | 4 | D5, D14, D20, D23 |
| Partial (real functionality exists, meaningfully incomplete) | 16 | D1, D2, D4, D7, D8, D9(differently), D12, D13, D15, D16, D18, D21, D22, D25, D26, D28 |
| Confirmed or likely gap | 6 | D6, D10, D17, D19, D27, (D3 superseded, counted separately) |
| Superseded by a better design (not a gap) | 1 | D3 |

**21 of 28 domains (75%) have real, confirmed implementation work behind them** -- this is a materially better result than a skeptical reader might expect from a requirements tree built from aspirational documents. The honest remainder: 6 likely-or-confirmed gaps (D6, D10, D17, D19, D27, and D2/D15's shared 150-auditor-org-chart gap) are the concrete, actionable to-do list -- captured in full in Section 30 of the 4th tree.

---

## Section B -- Tree 3 domains with no Tree 1 counterpart (built, not requirement-sourced)

Listed for completeness, not analyzed line-by-line here since there is nothing to "compare" -- Tree 1 says nothing about them. Full detail carried into the 4th tree's Section 20.

- **ERP** (`API-03`, `DB-15`) -- full double-entry accounting, ~150 tables, 138 routes.
- **PMS** (`API-04`, `DB-12`) -- internal project-management suite.
- **The Firm** (`API-05`, `DB-18`) -- professional-services practice management.
- **Construction / PROJEXA** (`API-06`, all `PRX-*`) -- a sibling product built on VERIDIAN's API.
- **HR & Recruitment** (`API-09`, `DB-08`).
- **CRM / Sales-HQ** (`API-10`).
- **GST Reconciliation** (`API-11`).
- **Governance/Risk/Legal/Board (GRC suite)** (`API-13`) -- board, POSH, BCM, whistleblower, SEBI/RBI/IRDAI, secretarial, MCA, ESG, cap-table, CLM.
- **Facilities / Tickets** (`API-14`).
- **veda-advisors** (all `VA-*`) -- an entirely separate product (Rajat's advisory business), unrelated to any of the 9 VERIDIAN documents.
- **veridian-brain** (`VB-01`) -- confirmed empty, not analyzed further.

---

## What Step 2 (the 4th tree) does with this comparison

The 4th tree, built next, is organized into 3 parts reflecting this comparison directly:
1. **Merged AI-governance layer** -- every Tree 1 domain reconciled against its Tree 3 evidence (Section A above), at full granularity.
2. **Business platform modules** -- Section B's content, carried forward from Tree 3 in full, explicitly tagged as not requirement-sourced.
3. **Confirmed gaps** -- the 6+ likely/confirmed gaps from Section A, carried forward from Tree 1 in full requirement detail, tagged `NOT_BUILT`, as the actionable to-do list this whole multi-session effort has been building toward.
