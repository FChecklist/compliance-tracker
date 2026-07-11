# VERIDIAN Task Governance Constitution

**Version 1.0 -- 2026-07-11. AI Governance & Continuous Improvement Framework (AGCIF): task lifecycle, multi-agent orchestration, and mandatory tightening guardrails.**

Adopted from a document supplied by the repository owner (`Consutitution.docx`, "VERIDIAN AI OS -- AI Governance & Continuous Improvement Framework") describing a Universal Task Lifecycle, a 4-tier AI role hierarchy, and 30 Mandatory Guardrail Protocols. Same discipline as its two sibling constitutional documents: where a section is marked **[ENFORCED]**, a real, running mechanism verifies it, cited by file:line. Where marked **[PARTIALLY ENFORCED]**, part of the mechanism is real and part is not, named explicitly. Where marked **[POLICY ONLY]**, it is a governance rule not yet backed by code. Where marked **[NOT APPLICABLE YET]**, nothing exists yet for the rule to bind to.

## Relationship to the other two constitutional documents

VERIDIAN AI OS now has three constitutional documents, each governing a different axis, none duplicating the others:

| Document | Governs |
|---|---|
| `VERIDIAN_AI_CONSTITUTION.md` (v1.0, 2026-07-04) | What the AI may *do* -- business purpose, domain restriction, privacy, prompt security, multi-tenant isolation |
| `MASTER_AI_OS_ARCHITECTURE.md` (v1.0, 2026-07-06) | How the *platform* is built -- module reuse, RLS, branch-key naming, license discipline |
| `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` (this document, v1.0, 2026-07-11) | How *tasks* move through the system -- lifecycle stages, the AI role hierarchy, task-quality guardrails, escalation, and continuous improvement |

The source document itself proposed a fourth and fifth ("AI Engineering Standards Manual", "AI Quality Management System") -- **[POLICY ONLY]**, not created this wave. `MASTER_AI_OS_ARCHITECTURE.md` already covers a meaningful slice of what an Engineering Standards Manual would (module reuse, RLS mandate, license discipline); a dedicated AI-QMS (SLAs, formal corrective/preventive action tracking) remains a genuine gap, listed in "Deliberately Deferred" below rather than fabricated.

## Why this document exists now

The repository owner's own words: *"during execution the agents were missing the tasks. tasks those were tightened had success."* This is not a new observation -- it is the same pattern this codebase's own history already recorded independently, twice: `ai-workforce-agent.mjs`'s real dispatch failures (documented in that file's own `MAX_ITERATIONS` comment and in `veridian_docx_constitution_study` session memory's "Round 2"/"Phase 2 audit" entries) where a loose free-text brief burned the entire iteration budget with zero output, fixed only by manually rewriting the brief with an explicit scope cap and completion definition -- "the tightened-brief pattern is now the standard fix." This document's central, concrete contribution is making that fix **structural** rather than something a human or AI has to remember: see "Objective/Scope/Instruction Validation Guardrails" below.

---

## 1. The Governance Hierarchy

The source document proposes 5 levels (Execution Agent / Reviewer / Quality Controller / COO / Super Boss / Owner) mapped to specific named models (GPT-OSS-120B, DeepSeek Pro V4, ZLM 5.2, Claude Desktop Sonnet 5.0). This maps onto real infrastructure, but **not by literal model substitution** -- doing so would contradict evidence-based decisions this codebase already made and documented.

**[ENFORCED]** -- `AGENTS.md`'s "Super Boss (Claude Desktop, Sonnet 5.0, local machine)" role, added 2026-07-10, is exactly the source document's Level 4/Super Boss: takes orders only from the owner, can direct any other agent, cannot push/merge directly to `main` (Operating Rule 6 applies equally). This was a real, prior, independent formalization of the same role the new document describes -- not created by this wave, confirmed still current.

**[PARTIALLY ENFORCED, with an explicit correction]** -- the source document names GPT-OSS-120B/DeepSeek Pro V4/ZLM 5.2 as the Level 0-3 roles. In this codebase:
- **GPT-OSS-120B (via Groq/Cerebras)** genuinely is the platform's real default execution tier, but for **customer-facing Orchestra Layers** (`orchestra-model-resolver.ts`'s `PLATFORM_DEFAULT_MODEL`), not the internal AI Dev Team.
- The internal **AI Dev Team** (`src/lib/ai-team/roster.ts`, 51 roles across 16 teams) runs primarily on **GLM-5.2**, not GPT-OSS-120B or DeepSeek -- a deliberate, evidence-based decision (roster.ts's own header: real OpenRouter billing showed a $11.44-of-$12.34 cost concentration and real task failures on `deepseek-v4-flash`, so those 9 roles moved to GLM-5.2 on 2026-07-07). `DEEPSEEK_V4_PRO` is defined as a model constant but currently unassigned to any role.
- There is no role literally named "ZLM 5.2" in `roster.ts`; the closest functional match (repo-write code implementation) is spread across `fullstack_developer`/`senior_backend_engineer`/`frontend_engineer` plus the separately-authorized Z.ai GLM agent in `AGENTS.md`.
- **Conclusion, honestly stated**: treat the source document's role *responsibilities* (Chief Execution Engine / COO / CSEO) as adopted conceptually, mapped onto whichever real role/model is currently doing that job -- not as a literal instruction to rename or reassign models. A future session should not "fix" `roster.ts` to match the document's exact model names without re-confirming this doesn't regress the 2026-07-07 cost/quality findings.

**[POLICY ONLY]** -- a formal "COO" role with the source document's specific cross-agent-coordination/escalation-management authority does not exist as a distinct role. `chief_governance_officer` (Guardrail Platform level) and `ceo_technical_director` (Engineering) are the closest partial matches.

---

## 2. Universal Task Lifecycle

The source document specifies an 18-stage per-task lifecycle (Request -> Classification -> Risk Assessment -> Instruction Validation -> Resource Allocation -> Execution -> Continuous Monitoring -> Self Validation -> Peer Validation -> Escalation -> Completion -> Documentation -> Learning Capture -> Process Improvement -> Knowledge Update -> Performance Scoring -> Directory Update -> Continuous Loop Engineering -> Closed).

**[PARTIALLY ENFORCED]** -- this is a different concept from `ai-os/LIFECYCLE.yaml`'s 11-stage lifecycle, which tracks the *repository's own development process* (currently `MONITOR`), not individual tasks -- no naming collision, no duplication, but worth stating explicitly so a future session doesn't conflate the two. The real per-task lifecycle that exists is narrower: `tasks.status` (`pending`|`in_progress`|`completed`|`failed`|`cancelled`, `src/lib/db/schema.ts`), `taskExecutionPlan` (per-step plan with its own `status`), and `taskAgentExecutions` (`startedAt`/`completedAt`/`status`/`input`/`output`/`errorMessage` -- the closest real analog to Execution + Continuous Monitoring + Completion). Risk Assessment exists narrowly via `detectHighImpactAction()` (confirmation gate on task creation). Instruction Validation now exists for AI Dev Team dispatch specifically -- see next section. Self/Peer Validation exist at the *implementation-wave* level (doer+auditor entries in `ai-os/boss/COMPLETED.yaml`, Operating Rule 7), not generically for every task. Learning Capture/Process Improvement/Knowledge Update map to the existing CLEE pipeline (`loop-improvement-proposer.ts`'s `proposeLoopImprovement()`), human-gated (`isDeployed` always `false`).

**[POLICY ONLY]** -- Performance Scoring and Directory Update as *generic, every-task* mechanisms do not exist. `worker_agents.accuracyScore`/`usageCount` (see §5) is the closest real per-agent scorecard, but it is not updated per-task automatically for every dispatch in this codebase today.

## 3. Every Task MUST Contain (mandatory task metadata schema)

**[POLICY ONLY, deliberately not built this wave]** -- the source document specifies ~40 fields across Identity/Input/Process/Output/Handover/Closure for every task, including for *customer* tasks. The real `tasks` table (`src/lib/db/schema.ts` line 748) has 13 columns: `id, orgId, clientId, userId, assistantId, title, description, status, assignedById, projectId, dueDate, resolvedWorkerAgentId, priority`. Adding the full schema to a live, customer-facing SaaS table is a disproportionate, high-risk change for the actual problem being solved (agents dropping AI-dispatch work, not customers filling out compliance tasks incompletely) -- explicitly out of scope this wave, not silently dropped. What this wave *does* enforce is a scoped version of the same idea -- Objective/Scope/Success Criteria -- but only at the two AI-dispatch entry points where the real incidents happened (below).

## 4. Objective / Scope / Instruction Validation Guardrails -- the concrete fix for "tasks were missing"

**[ENFORCED, this wave]** -- this is the document's Guardrail #3 (Scope), #4 (Objective), and #5 (Instruction Validation), made mandatory and structural, not advisory:

- `src/lib/task-tightening.ts` -- `TightTask = { objective, scope, successCriteria, constraints? }`. `validateTightTask()` deterministically rejects a task missing any required field, a placeholder value ("TBD", "n/a", "..."), or a field too short to be actionable. `assembleTightTaskPrompt()` renders a validated task into the labeled brief actually sent to a model.
- `src/lib/guardrail-registrations.ts` -- populates `guardrail-engine.ts`'s Wave 157 registry, which has held **zero registered leaves in production since it shipped** (confirmed empty via code review this session; also independently recorded in `veridian_veri_rebrand_and_ai_routing_2026-07-10` session memory: *"The Guardrail Engine (Wave 157) is built but its registry is empty in production -- it passes everything trivially everywhere"*). Registers `ai_team.dispatch` and `ai_workforce.dispatch` as `input`-phase leaves.
- `src/app/api/ai/team/dispatch/route.ts` -- the Next.js dispatch endpoint now requires `{ objective, scope, successCriteria, constraints? }` instead of a free-text `task` string. A task that fails validation is blocked (HTTP 422) with the specific reason and guidance *before* classification or any model call, and the violation is recorded via `recordGuardrailViolation()` (feeds the CLEE loop, same as every other guardrail violation).
- `scripts/ai-workforce-agent.mjs` -- the actual script where the real incidents occurred now requires `AI_TEAM_TASK_OBJECTIVE`/`AI_TEAM_TASK_SCOPE`/`AI_TEAM_TASK_SUCCESS_CRITERIA` env vars (import-shared validator, no duplicated logic) and exits with a clear error before spending any OpenRouter budget if they're missing or under-specified.
- `.github/workflows/ai-team-workforce.yml` -- `workflow_dispatch` inputs changed from one free-text `task` field to four required-by-form fields (`objective`, `scope`, `success_criteria`, required; `constraints` optional), so a human triggering a manual dispatch is structurally guided toward a tight brief, not just told to write one.
- `src/lib/ai-team/dispatch-repo.ts` -- `dispatchRepoTask()` now takes a `TightTask` and validates before firing `repository_dispatch` (this function had zero live callers before this change, confirmed by repo-wide grep -- a zero-risk site to tighten).

**Deliberately not done, and why**: `high-impact-action-detector.ts`'s 9 categories were **not** retrofitted through the newly-populated Guardrail Engine this wave. `FOLLOWUPS.md`'s `FOLLOWUP-1` explicitly says that retrofit "should ship as its own wave with its own audit, not bundled into unrelated work" -- it touches a live, already-audited safety gate (Wave 146) for no functional gain to this wave's actual goal. This wave proves the registry is real, useful infrastructure via a genuinely new, additive consumer instead, leaving `FOLLOWUP-1` open and unchanged.

## 5. Mandatory AI Handover Protocol ("No AI Agent may simply say Done")

**[PARTIALLY ENFORCED]** -- real at the *implementation-wave* level: `ai-os/boss/COMPLETED.yaml` (Operating Rule 7, added 2026-07-09) requires a structured doer entry (summary, PR, date) and a separate auditor entry (verdict, summary) for every completed implementation task -- a bare "Done" has never been accepted there. GitHub Actions PR bodies for AI Workforce dispatches are also structured (role/objective/scope/success-criteria/files-changed, per this wave's workflow change above).

**[POLICY ONLY]** -- at the individual `taskAgentExecutions`/`tasks` row level (the generic per-task table, not just implementation waves), completion is a bare `status = 'completed'` with a free-form jsonb `output` -- nothing validates that `output` contains a summary, confidence, or known-risks field before a step is marked done. Closing this fully would mean adding a handover-shape validator at whichever code path flips `taskAgentExecutions.status` to `completed` (likely `task-execution-engine.ts`) -- scoped out of this wave to keep the change reviewable and because, unlike AI-dispatch tightening, no specific incident in this codebase's history was traced to a missing handover field. Named as a real, tracked gap rather than silently skipped.

## 6. AI Escalation Matrix

**[ENFORCED, customer-facing side]** -- `src/lib/floor-tier-escalation.ts` is a real, deterministic escalation mechanism: 3 pre-call signals (user correction, high-impact action, prior task failure) skip the floor tier (GPT-OSS-120B) entirely; a post-call hedging-language signal triggers one retry on GLM-5.2. Wired into `chat-service.ts` (Wave 114 memory) and `task-execution-engine.ts`'s free-text planning path (PR #116) and `fde-service.ts` (always escalated). **Known real gap, carried forward honestly**: `task_oa`'s other consumers (`gst/ai-review-report.ts`, `construction-ai-service.ts`, `crm-service.ts`, `veri-meeting-service.ts`, `visitor-intelligence-service.ts`, `api/ai/orchestrate/route.ts`) still don't run through this escalation layer.

**[POLICY ONLY]** -- no equivalent dynamic escalation exists *within* the internal AI Dev Team (`team-service.ts`) -- every role there is a static, fixed model assignment; there is no "GLM-5.2 answer low-confidence -> escalate to a different model" path for that roster. `floor-tier-escalation.ts`'s deterministic-signal pattern is a ready template to generalize for this, not yet done.

## 7. Mandatory Monitoring

**[ENFORCED]** -- `orchestraExecutions` (model/provider/tokens/cost/duration/status per call, Wave 22/23), `token_usage_ledger` (`src/lib/services/token-usage-service.ts`, AI Team + product spend), `audit_logs` (general activity, append-only by convention). `ai-workforce-agent.mjs`'s own `MAX_ITERATIONS`/`MAX_FILE_BYTES` are real, enforced circuit breakers for that specific script.

**[POLICY ONLY]** -- these circuit breakers (max iterations, max recursive delegation, deadlock detection) are not generalized into a reusable framework-level mechanism the way the source document's "Infinite Loop Prevention" section describes; each pipeline that needs one has hand-rolled its own (a real, if narrower, form of the same protection).

## 8. Loop Engineering / Continuous Learning / AI Improvement Framework

**[PARTIALLY ENFORCED]** -- the CLEE pipeline (`loop-improvement-proposer.ts`'s `proposeLoopImprovement()`) is real and now has this wave's Guardrail Engine violations as one more real feed into it (alongside high-impact-action confirmations and floor-tier escalation-rate analysis, Loop 14). Every proposal is human-gated (`isDeployed` hardcoded `false`) -- consistent with the source document's implicit expectation that improvements need approval before becoming standard, not auto-applied.

**[POLICY ONLY]** -- a generic "every completed task answers: what succeeded, what failed, why, can this be faster/cheaper/more reliable" structured questionnaire, run automatically per task, does not exist. What exists is narrower and reactive (a violation or a low-confidence signal triggers a proposal), not the source document's universal per-task retrospective.

## 9. AI Agent Task Directory

**[PARTIALLY ENFORCED]** -- `worker_agents` (27 real rows) + `workerAgentUsageLog` + `workerAgentVersions` + `workerAgentLearnings` is a genuine, DB-backed, per-agent performance/version/learning record -- closer to the source document's "AI Agent Task Directory" concept than anything built from scratch could be. **Known gap, unchanged by this wave**: `workerAgents.supervisorWorkerAgentId` (the "Digital Department" grouping column) has 0 of 27 rows populated -- present in the schema, never used.

## 10. Hallucination Prevention Framework

**[ENFORCED for policy/injection, POLICY ONLY for confidence scoring]** -- `policy-enforcement-engine.ts`'s `enforcePolicy()` (business-purpose/prompt-injection/domain checks) runs before every gated LLM call. The Guardrail Team's 4 levels (`GUARDRAIL_PLATFORM`/`PRODUCT`/`ACCOUNT`/`USER` in `roster.ts`) provide independent peer review for AI Dev Team output. **What does not exist**: a numeric confidence-score pipeline with the source document's specific thresholds (98-100% auto-proceed, 95-97% self-review, 90-94% peer review, <90% escalate) -- no code path computes or checks a confidence percentage against tiered thresholds today.

## 11. Three-Hour Governance Cycle / Self-Evolving Organization

**[POLICY ONLY]** -- no scheduled/cron-triggered governance review exists. This matches an already-known, previously-documented gap (`veridian_ai_dev_team_openrouter` session memory: *"no scheduled/cron auto-dispatch -- the AI Team responds to requests, it doesn't act on its own initiative on a timer"*). The Super Boss role (§1) performs this function interactively/on-demand today, not on a fixed timer. Named honestly rather than fabricating a cron job with no real reviewer behind it.

## 12. Customer Task Governance

**[PARTIALLY ENFORCED]** -- the source document asks that the same lifecycle apply to customer actions (Create Invoice, Approve Leave, etc.). The real mechanism that exists for this is `high-impact-action-detector.ts` + `task-service.ts`'s `createTask()` confirmation gate (delete/archive/payment/approval/rejection/compliance_submission/access_changes/data_export/configuration_changes all require explicit confirmation before creation) -- genuinely enforced, genuinely tested (Wave 146). The full 18-stage / 40-field lifecycle from §2-3 is **not** applied to customer tasks, by the same deliberate-descope reasoning as §3.

---

## 13. The 30 Mandatory Guardrail Protocols -- status

| # | Guardrail | Status | Where |
|---|---|---|---|
| 1 | Identity | [ENFORCED] | `requireAuth()` on every route |
| 2 | Authority | [ENFORCED] | `hasRole()`/RLS |
| 3 | Scope | [ENFORCED, this wave, for AI-dispatch] | `task-tightening.ts` (§4) |
| 4 | Objective | [ENFORCED, this wave, for AI-dispatch] | `task-tightening.ts` (§4) |
| 5 | Instruction Validation | [ENFORCED, this wave, for AI-dispatch] | `task-tightening.ts` + `guardrail-engine.ts` (§4) |
| 6 | Knowledge | [POLICY ONLY] | no "do I have sufficient knowledge" self-check exists |
| 7 | Evidence | [PARTIALLY ENFORCED] | `orchestraExecutions`/`audit_logs` capture evidence; no rule blocks a claim lacking it |
| 8 | Hallucination Prevention | [PARTIALLY ENFORCED] | §10 |
| 9 | Confidence | [POLICY ONLY] | §10 |
| 10 | Risk Classification | [PARTIALLY ENFORCED] | `detectHighImpactAction()`'s 9 categories are a real risk classifier for that surface only |
| 11 | Human Override | [ENFORCED] | `AGENTS.md` hierarchy, Owner > Super Boss, no agent may override |
| 12 | Prompt Integrity | [ENFORCED] | `resolveSafe()` in `ai-workforce-agent.mjs` hard-blocks writes to `ai-os/`/`.claude/`/`AGENTS.md`/etc.; `prompt-os-resolver.ts` is the single source of prompt content (no hardcoded system-prompt strings) |
| 13 | Tool Usage | [ENFORCED] | `TOOLS` allowlist + `execTool()` in `ai-workforce-agent.mjs`; deliberately no shell/exec tool |
| 14 | Model Selection | [ENFORCED, conceptually remapped] | `roster.ts`, see §1's correction |
| 15 | Coding Guardrail | [ENFORCED] | CI (lint/typecheck/build/test) + branch protection (Operating Rule 6); no direct push to `main` |
| 16 | Security | [ENFORCED] | secrets never in source (`SE-001`/`SE-003` in `SENTINEL.yaml`); BYOK keys encrypted at rest |
| 17 | Privacy | [ENFORCED] | RLS multi-tenant isolation (`VERIDIAN_AI_CONSTITUTION.md` §8) |
| 18 | Audit | [ENFORCED] | `audit_logs` + `orchestraExecutions` |
| 19 | Monitoring | [ENFORCED] | §7 |
| 20 | Loop Prevention | [PARTIALLY ENFORCED] | per-pipeline circuit breakers exist (`MAX_ITERATIONS`), not generalized -- §7 |
| 21 | Quality Assurance | [PARTIALLY ENFORCED] | CI + doer/auditor cross-review for waves; not generic per-task |
| 22 | Handover | [PARTIALLY ENFORCED] | §5 |
| 23 | Reporting | [PARTIALLY ENFORCED] | `COMPLETED.yaml`, `token_usage_ledger`; no universal per-task report |
| 24 | Continuous Improvement | [PARTIALLY ENFORCED] | §8 |
| 25 | Governance Compliance | [PARTIALLY ENFORCED] | CI gate + PR review; no single closing checklist |
| 26 | Self-Evaluation | [POLICY ONLY] | no mandatory structured self-assessment per task |
| 27 | Peer Review | [PARTIALLY ENFORCED] | doer/auditor pattern (waves); Guardrail Team levels (AI dispatch) |
| 28 | Knowledge Evolution | [ENFORCED] | `prompt_versions` versioning (Prompt-OS), migration history |
| 29 | Failure Containment | [PARTIALLY ENFORCED] | retries/error handling exist per pipeline; no universal containment protocol |
| 30 | Constitutional Compliance | [ENFORCED, structurally] | this document itself, `AGENTS.md`, `MASTER_AI_OS_ARCHITECTURE.md`, `VERIDIAN_AI_CONSTITUTION.md` -- no agent may bypass without Super Boss/Owner sign-off |

---

## Deliberately Deferred (not built this wave, named honestly)

- Full 40-field task metadata schema on the customer-facing `tasks` table (§3) -- disproportionate to the actual problem, no migration added.
- `FOLLOWUP-1` (retrofitting `high-impact-action-detector.ts` through the Guardrail Engine) -- unchanged, still its own future wave per `FOLLOWUPS.md`'s own stated reasoning.
- Handover-shape validation at the generic `taskAgentExecutions` row level (§5).
- Dynamic model escalation within the internal AI Dev Team roster (§6).
- Numeric confidence-score thresholds and tiered auto-proceed/review/escalate policy (§10, Guardrail #9).
- Three-hour cron-triggered governance review (§11).
- A dedicated AI Quality Management System document (SLAs, formal CAPA tracking).
- Literal renaming of `roster.ts` models to match the source document's GPT-OSS-120B/DeepSeek Pro V4/ZLM 5.2 naming -- deliberately not done; see §1's correction.

## How this differs from the source document

Adopted: the diagnosis (loose tasks fail, tight tasks succeed), the Objective/Scope/Instruction-Validation guardrails as the concrete fix, the role-hierarchy framing (Super Boss/CEE/COO/CSEO), the 30-guardrail structure as an audit checklist.

Adapted: every section is marked with its real enforcement status rather than presented as uniformly adopted. The 4-tier model-to-role mapping is treated as conceptual, not literal, where it would otherwise contradict this codebase's own evidence-based model choices (§1). The 40-field universal task schema and the three-hour cron governance cycle are named as policy-only rather than half-built to appear more complete than they are. The one guardrail with a directly traceable real-world failure in this codebase's own history (loose AI-dispatch briefs) is the one this wave actually enforces in code, not just documents.
