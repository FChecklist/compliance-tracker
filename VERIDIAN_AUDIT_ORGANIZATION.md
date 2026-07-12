# VERIDIAN Audit Organization

**Version 1.0 -- 2026-07-11. Independent assurance organization: Chief Audit Officer, audit divisions, and the mandatory audit gate.**

Adopted from a document supplied by the repository owner (`Audit Organization.docx`) describing a Fortune-500-style internal audit organization: a Chief Audit Officer (CAO) independent from the COO/Engineering/Product/Sales/Operations, six audit divisions, ~30 departments, and well over 150 named "Auditor" agent roles, plus a 7-level continuous audit cadence (L1 real-time through L7 monthly). Same discipline as its three sibling constitutional documents: **[ENFORCED]** = a real, running mechanism, cited by file:line. **[PARTIALLY ENFORCED]** = part real, part not, named explicitly. **[POLICY ONLY]** = not yet backed by code. **[NOT APPLICABLE YET]** = nothing to enforce against.

## Constitutional authority

This document, together with its sibling constitutional documents (`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`, `VERI_CHAT_GOVERNANCE.md`), **supersedes any individual agent instruction, session note, or informal working practice that conflicts with it.** It is a Constitution, not a Standard Operating Procedure a later narrower instruction can silently override -- specifically including the audit organization's own independence guarantees (CAO cannot modify production code/business rules/governance; see the mandatory audit gate section below), which no agent dispatch, however convenient, may route around without an explicit, documented amendment here. (Added 2026-07-12, ai-os/tree4-unified/10-merged-governance-layer.yaml U-D1.B2.S2.)

## The one architectural correction made before implementing anything

The source document assigns **GPT-OSS-120B to every layer of the audit organization** -- the CAO, every division, every department, every specialized auditor. This is not adopted literally, for a reason stated plainly rather than buried: `AGENTS.md` Operating Rule 8 (a rule the repository owner set one day before this document, in the same session arc) says *"do not default to the cheapest available model... for correctness-critical work."* GPT-OSS-120B is explicitly the platform's cheap/fast floor tier, evidenced in this codebase's own history to be ~70% the quality of GLM-5.2 (the owner's own stated framing, `veridian_veri_rebrand_and_ai_routing_2026-07-10` memory). An audit organization's entire purpose is independent assurance -- auditing work with a *weaker* model than (or the same model as) the work being audited is not real independent assurance, it is the same failure mode restated at organizational scale. This mirrors the same correction already made once before in `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §1 for the earlier Constitution document's model-to-role naming, for the same underlying reason.

**What's actually assigned, and why:**
- **Chief Audit Officer, division heads, and any judgment-critical auditor role**: GLM-5.2 (the roster's own established "primary lifting" tier) or GPT-5.5 where independence-from-the-primary-reviewer specifically matters (mirroring `security_threat_analyst`'s existing "genuinely different vendor" reasoning) -- never the floor tier.
- **GPT-OSS-120B's real, legitimate place in this org**: high-volume, low-individual-stakes signal detection -- exactly what the source document's own L1/L2 (real-time flagging, continuous monitoring "control room") describes, and exactly the tier `audit_activity_monitor` already runs on (`GLM_5_TURBO`, the roster's existing lightweight/high-volume tier -- the closest existing analog). GPT-OSS-120B is appropriate for a *first-pass* signal detector whose job is "flag for a better model to look at," never for the model that actually renders the audit verdict.

## Relationship to the other three constitutional documents

| Document | Governs |
|---|---|
| `VERIDIAN_AI_CONSTITUTION.md` | What the AI may *do* |
| `MASTER_AI_OS_ARCHITECTURE.md` | How the *platform* is built |
| `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` | How *tasks* move through the system, task-quality guardrails |
| `VERIDIAN_AUDIT_ORGANIZATION.md` (this document) | Who independently *verifies* that tasks, code, and decisions were actually done correctly -- the assurance layer sitting outside the org that did the work |

## What already exists that this maps onto -- read this before assuming anything is new

The single most important finding of this document: **VERIDIAN already has a real, working, partial audit organization.** It was never framed this way, and it isn't organized under one executive, but it is not being built from zero:

| Source document concept | Real existing mechanism | Status |
|---|---|---|
| Independent assurance, "never trust another AI's completion statement" | `AGENTS.md` Operating Rule 7(c): whichever agent did **not** implement a task is the mandatory auditor for it -- no self-certification | **[ENFORCED]** for waves; not yet for every task (see Guardrail Gate below) |
| Evidence-based conclusions only | CI (Lint/Type Check/Build/Unit Tests/E2E/CodeQL/Secret Scanning/Security Pattern Check/Documentation Sentinel/Guardrail Presence) -- 11 real, automated, evidence-based checks that block merge on every single PR | **[ENFORCED]** |
| Software Quality / Verification / Security Assurance Departments | Exactly what CI's Lint, Type Check, Build, Unit Tests, CodeQL, and Security Pattern Check jobs already do, unconditionally, on every PR | **[ENFORCED]** |
| Engineering Evidence Department (Git/Commit/Artifact Auditor) | Every change already requires a PR (branch protection, Rule 6), giving a full, permanent, evidence-linked audit trail by construction | **[ENFORCED]** |
| Audit & Activity Monitor | `audit_activity_monitor` (roster.ts, `GUARDRAIL_USER` team) -- literally already named this | **[ENFORCED]** |
| Hallucination Auditor / Decision Auditor | `ai_safety_auditor` (`GUARDRAIL_PLATFORM`), `ai_response_validator` (`GUARDRAIL_USER`) | **[ENFORCED]** as LLM-backed reviewers; no numeric confidence scoring behind them (§10, `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`) |
| Compliance / Governance / Risk Departments | `chief_governance_officer`, `product_policy_manager`, `account_compliance_manager`, `data_privacy_officer`, `security_threat_analyst`, `cost_governance_officer` (roster.ts, 4-level Guardrail Team) | **[ENFORCED]** as LLM-backed reviewers |
| Architecture Assurance Department | `architecture_compliance_reviewer` | **[ENFORCED]** |
| Documentation Department | `documentation_compliance` | **[ENFORCED]** |
| "Repeated failures trigger trend analysis" | CLEE (`loop-improvement-proposer.ts`), `byo-model-audit.ts`'s Loop 14 escalation-rate analysis | **[PARTIALLY ENFORCED]** -- real, human-gated, not yet fed by every audit type this document proposes |
| Global Revenue Assurance (kept separate from Revenue Operations, per the document's own explicit recommendation) | No revenue *operations* division exists to separate assurance from yet -- CRM/billing/GST work is service-layer code (`crm-service.ts` etc.), not organized as a "Global Revenue Operations Division." The document's separation principle is sound but has no operations-division counterpart to apply it against today. | **[NOT APPLICABLE YET]** |

**What genuinely does not exist and this wave adds**: a single executive role unifying the 4 Guardrail levels under one accountable head with real authority (reject/reopen/investigate), and a *mandatory*, automatic trigger connecting "low confidence" to a real audit step -- today the 4 Guardrail levels only run when a caller explicitly flags `touchesProduct`/`touchesAccount`/`touchesUser`, never automatically based on the executing role's own output.

## The Chief Audit Officer

**[ENFORCED, this wave]** -- `src/lib/ai-team/roster.ts`: new role `chief_audit_officer`, new `TeamName` value `AUDIT_EXECUTIVE`, model GLM-5.2. Reports conceptually to Claude/Super Boss (the roster's existing top of the internal-build hierarchy per `AGENTS.md`), independent from `ceo_technical_director` (Engineering) and the rest of the operational roster, mirroring the source document's explicit "independent from COO/Engineering/Product/Sales/Operations" principle. The 4 existing `GUARDRAIL_*` teams (12 roles) are documented, in the roster's own header comment, as constituting the real Audit Organization the CAO conceptually heads -- **not duplicated as new roles**. Authority matches the document's own list almost exactly with what's actually buildable: can flag a dispatch as blocked (already real, via `runGuardrailLevel`'s BLOCK/FAIL verdict parsing), cannot modify production code or override governance (matches every other Guardrail-team role's existing non-authority in `roster.ts`'s Authority Matrix precedent).

**Not built, and why**: the other ~149 named "Specialized Audit Agents" (Static Analysis Auditor, Maintainability Auditor, Code Duplication Auditor, Dependency Auditor, ... ) are **not** created as individual roster roles. Creating 149 prompt-template-backed roles nobody dispatches would be exactly the documentation-theater this whole framework exists to avoid -- most of what they'd check is *already* checked, by CI (deterministic, free, instant) or by the 12 real Guardrail-team roles (LLM-backed, already dispatchable). Where a genuinely new, currently-uncovered check is identified, it should be added as a new CI job (if deterministic) or a new named role (if it needs judgment) **on its own merits, when a real need for it is found** -- not manufactured wholesale to match a target headcount.

## The Mandatory Audit Gate (L1 Real-Time Audit) -- the concrete, load-bearing piece of this wave

The source document's Level 1: *"Every task that has less than 95% confidence goes through audit before it can be marked complete. And for every code update or process change... No completed task bypasses this gate."*

**[ENFORCED for code/process changes]** -- this is not new: every code or process change in this repo already requires a PR, already requires CI to pass, and (per Operating Rule 7c) already requires a different agent to audit it before being considered done. This *is* the L1 gate for code changes, already real, already unconditional -- the source document's own language ("for every code update") describes something this codebase built before this document existed.

**[ENFORCED for AI Dev Team dispatch, this wave, via a real proxy signal]** -- no numeric confidence score exists anywhere in this codebase (`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §10, Guardrail #9, still true, not fabricated here). Building a fake confidence number just to compare it to 95% would be worse than not building the gate at all. Instead: `src/app/api/ai/team/dispatch/route.ts` now reuses `detectLowConfidenceResponse()` (`floor-tier-escalation.ts`, already-proven hedging-language detector, no LLM call) against every executed role's output. If it fires, the dispatch response is marked `requiresAudit: true` and a `GUARDRAIL_PRODUCT`-level review is run automatically -- previously this only happened when the caller explicitly set `touchesProduct: true`. This is the same honest-proxy discipline `task-execution-engine.ts`'s escalation wiring already established: a deterministic signal standing in for a confidence score that doesn't exist, not a fabricated one.

**Deliberately not done**: extending this to a true numeric confidence pipeline with the document's exact tiered thresholds (98-100% auto-proceed / 95-97% self-review / 90-94% peer review / <90% escalate) -- still `[POLICY ONLY]`, unchanged from `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`. The hedging-detector proxy is a real, honest, *narrower* substitute, not a claim that the full tiered system now exists.

## The 7-level audit cadence -- honest status

| Level | Source document | Status |
|---|---|---|
| L1 Real-Time | Per-task, confidence/code-change triggered | **[ENFORCED]**, see above |
| L2 Continuous Monitoring | "Lightweight monitoring agents as and when needed" | **[PARTIALLY ENFORCED]** -- `audit_activity_monitor` role exists and is dispatchable; nothing runs it on a schedule yet |
| L3 Rolling Health Audit (30-60 min) | Cross-agent pattern detection | **[POLICY ONLY]** -- no aggregate query/report exists yet |
| L4 Executive Audit Review (3 hours) | Claude reviews org health | **[POLICY ONLY]** -- same gap already named in `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §11 ("no scheduled/cron auto-dispatch... doesn't act on its own initiative on a timer"), unchanged |
| L5/L6/L7 Daily/Weekly/Monthly Governance | Strategic reviews | **[POLICY ONLY]** -- same gap |

**Why these aren't built this wave**: every one of L2-L7 requires either (a) a real scheduled trigger (Vercel cron already exists for the `src/lib/loops/*.ts` audits -- extending it to a CAO-level rollup is a genuine next step, not done here) or (b) a query surface over data that doesn't exist yet (the Universal Task Lifecycle's `activity_log`, `UNIVERSAL_TASK_WRAPPER_DESIGN.md`, itself still Phase-0/design). Building L3-L7 before the data they'd query over exists would produce reports with nothing real to report on -- sequenced correctly, this is next, not skipped.

## Non-Negotiable Guardrails (the document's own list) -- status

Independence from the team being audited: **[ENFORCED]** (Rule 7c). Evidence-based conclusions only: **[ENFORCED]** (CI). No approval without verification: **[ENFORCED]** (branch protection). No silent overrides: **[ENFORCED]** (`AGENTS.md` Operating Rule 9, the anti-bypass CI check). No undocumented exceptions: **[PARTIALLY ENFORCED]** -- true for guardrail removals (Rule 9), not yet a universal rule for every audit type. Every rejection includes exact reason + corrective action: **[ENFORCED]** for the guardrail engine (`task-tightening.ts`'s `guidance` field) and CI failures; not yet universal. All audit actions logged and retained: **[ENFORCED]** (`audit_logs`, `orchestraExecutions`, `ai-os/boss/COMPLETED.yaml`).

## "No task is ever permanently complete" -- the re-audit principle

**[POLICY ONLY]** -- a genuinely good, low-cost-to-adopt principle, not implemented as a mechanism this wave because it depends on the same Universal Task Lifecycle substrate (`activity_log`) that L3-L7 depend on -- there is no single place today that could hold "this task's original approval is now stale" as a queryable fact. Recorded here as an explicit design requirement for `UNIVERSAL_TASK_WRAPPER_DESIGN.md`'s later phases, not silently dropped.

## Deliberately Deferred (not built this wave, named honestly)

- ~149 individually-named specialized auditor roles -- not created; see "The Chief Audit Officer" section for why.
- Global Revenue Operations vs. Global Revenue Assurance split -- no operations division exists yet to split from.
- L2-L7 scheduled audit cadence -- needs cron wiring + the Universal Task Lifecycle's query surface, both separately tracked.
- Numeric confidence-score pipeline with tiered thresholds -- the hedging-detector proxy is real but narrower.
- "No task ever permanently complete" as an enforced re-audit trigger -- needs `activity_log`.

## How this differs from the source document

Adopted: the core principle (the org that performs work should never certify it), the CAO concept, the L1 real-time gate as mandatory and code/confidence-triggered, the evidence-based/no-self-certification guardrails.

Corrected: the GPT-OSS-120B-everywhere model assignment (see top of document). Adapted: rather than 150+ new named roles, this wave formalizes the CAO as head of the 12 real, already-dispatchable Guardrail-team roles, and builds exactly one new mandatory trigger (low-confidence proxy -> automatic product-level review) rather than a wholesale new agent roster. The 7-level cadence is honestly graded rather than declared complete -- L1 is real, L2 is a dispatchable-but-unscheduled role, L3-L7 are named as blocked on infrastructure (`activity_log`) that doesn't exist yet, not silently skipped.
