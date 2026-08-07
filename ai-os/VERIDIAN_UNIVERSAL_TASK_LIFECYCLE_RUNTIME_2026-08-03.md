# VERIDIAN Universal Task Lifecycle Runtime — v1.0

**Real dispatch UMR for this task** (`umr_tasks` table, `/opt/veridian/ai-os/memory/superboss-register.sqlite`,
confirmed by direct query, not narrated): `UMR-20260803-041743-d271`
(`owner-task-20260803-041739-2425948`, unit `task-...-ocid-032-veridian-universal-task-lifecyc.service`).
Cited parent, per this task's own prompt: `UMR-20260803-041700-a741`. **Real numbering correction, found
and applied by this task (see `ai-os/boss/ACTIVE-CLAIMS.yaml` for the full note)**: the live registry
confirms `UMR-20260803-041700-a741`'s own dispatch unit is `...-ocid-031-veridian-universal-software-exe`
(Universal Software Execution Engine) and *this* task's own unit is literally `...-ocid-032-...-task-lifecyc`
— i.e. this document is real **OCID-20260803-032**, not OCID-031 as
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s table had it. That table already carried one
self-corrected numbering error (the 036/037 row, per `UMR-20260803-045159-ec55`); this is a second,
independent one, corrected here from the live dispatch registry rather than propagated. The same live-query
method confirms real **OCID-20260803-033 = "Universal End User Work Orchestration Runtime"** (unit
`...-ocid-033-veridian-universal-end-user-wor`, `UMR-20260803-041851-085a`, status `running` as of this
writing — a real, currently-active sibling session, not a future placeholder) and real **OCID-20260803-030
= "Universal Decision Engine"** (unit `...-ocid-030-veridian-universal-decision-eng`, matches PR #772's own
title, corroborating this correction independently).

Also cites, per this task's own prompt: `UMR-20260803-040844-4a33` (OCID-022) through `UMR-20260803-041459-7c97`
(OCID-030) in order, `UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program),
`UMR-20260802-165606-4413` (OCID-020, the still-open certification gate), `UMR-20260802-164659-9a31` (server
artifact traceability audit), `UMR-20260802-165034-5747` (the standing gatekeeper rule), and
`UMR-20260802-165434-cd91` (the unified project memory).

**Status: documentation only.** This artifact implements no code, changes no database, changes no UI/UX,
changes no AI/prompt behavior. Every claim below is either (a) real, live, evidenced state as of 2026-08-03,
cited to a file:line or an existing canonical artifact, or (b) an explicitly labeled gap already on record
elsewhere in this repo's own governance trail, or newly named here from the task-lifecycle angle specifically
because no prior artifact had organized it this way. Nothing here is invented, redesigned, or proposed as new
architecture, new tables, or new UI — consistent with the OCID-020 implementation lock (`SEC-07`,
`ai-os/CONSTITUTION.yaml`), which permits discovery and documentation to continue while implementation stays
locked.

**Mandatory inputs read in full before writing, not summarized from memory:** `ai-os/CONSTITUTION.yaml`'s
`task_lifecycle` (TASK-01..05), `guardrail_protocols` (GP-01..30), `audit_organization` (AUDIT-01..04), and
`resilience_and_monitoring` (RES-01..02) sections; `UNIVERSAL_TASK_WRAPPER_DESIGN.md` (repo root, the real
2026-07-11 `activity_log` design, Phase 1 of which has since shipped); `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`;
PR #768's real, currently-open, currently-**truncated** document for OCID-023 (see §0 below); `src/lib/db/schema.ts`'s
real `tasks`/`taskExecutionPlan`/`taskAgentExecutions`/`activityLog`/`orchestraExecutions`/`approvalWorkflow*`/
`instructionCommitments`/`notifications`/`auditLogs`/`entityRelationships` tables; `src/lib/services/task-service.ts`,
`src/lib/task-execution-engine.ts`, `src/lib/escalation-ladder.ts`, `src/lib/services/approval-workflow-service.ts`,
`src/lib/monitor-protocol.ts` and its 6 real Tier-1 monitors, `src/lib/services/exception-taxonomy.ts`,
`src/lib/qa-precompletion-gate.ts`, `src/lib/handover-protocol.ts`, `src/lib/services/veri-todo-service.ts`,
`src/components/veri-chat/ChainSelector.tsx`.

---

## 0. Overlap check performed (per the standing PM decision, `UMR-20260803-045159-ec55`)

Before writing, this task checked whether OCID-023 (Universal End User Work Model, the sibling flagged as the
real duplication risk) has already merged content covering task status/delegation/transfer/escalation/approval/
completion/audit/history. **It has not**: PR #768 is still open, unmerged, on `main` as of this commit. Beyond
that, its own committed document (`ai-os/VERIDIAN_UNIVERSAL_END_USER_WORK_MODEL_2026-08-03.md` on that branch)
is **truncated mid-sentence at line 31** — it ends `src/lib/db/schema.ts`'s real `tasks`/`tickets`/`pmsIssues`/
`activityLog`/`comments`/`taskChatMessages`/`documents`/` followed by a stray `... more files changed` line, an
artifact this task recognizes from its own prior experience of a Bash-tool large-output truncation bug bleeding
into a committed file rather than staying in a terminal. That document has not yet reached its own task/status
section. Since OCID-023 has not merged real content on this ground, this document proceeds as its own artifact
per the PM decision's explicit instruction, rather than folding into an unmerged, incomplete sibling. Whoever
next reviews/merges PR #768 should independently flag that truncation to OCID-023's own worker — not silently
fixed here, since that file is out of this task's scope (a different task's open PR).

---

## 1. Task definition

VERIDIAN does not have one single "task" table today — it has **five real, independently-lifecycled activity
shapes**, exactly as `UNIVERSAL_TASK_WRAPPER_DESIGN.md` named them in 2026-07-11 and as `TASK-04`
(`ai-os/CONSTITUTION.yaml`) now formalizes: a customer-created compliance task (`tasks`), a task's AI-planned
execution (`taskExecutionPlan` + `taskAgentExecutions`), any LLM call across any Orchestra Layer
(`orchestraExecutions`), an AI Dev Team dispatch (`/api/ai/team/dispatch`), and a background loop run
(`src/lib/loops/*.ts`). **The real, existing unifying definition of "a task" in this codebase is `activity_log`'s
`activityType` enum** (`schema.ts:1511`): `customer_task | orchestra_call | ai_team_dispatch | loop_run`. This
document treats "task" in the universal sense this enum already establishes — not a new definition, the one
that shipped.

## 2. Task creation

Real entry point: `createTask()`, `src/lib/services/task-service.ts:133`. A customer task is created directly
against the `tasks` table; `dynamicChainId`, `modePill`, `chainPathKeys`/`chainPathLabels` (task-service.ts:147-149)
are accepted at creation time when the task originated from VERI Chat's Chain Selector (§6). AI Dev Team dispatch
and loop-run creation go through their own entry points (`/api/ai/team/dispatch`, `src/lib/loops/*.ts`) and, per
`TASK-04`'s Phase 1, now also write a real `activity_log` row (`lifecycleStage: 'requested'`) at creation — closing
the "AI Dev Team dispatches leave no record at all" gap `UNIVERSAL_TASK_WRAPPER_DESIGN.md` identified. **Real,
honest gap**: `activity_log`'s Phase 2 (pairing every `tasks`/`orchestraExecutions` write with an `activity_log`
insert) is not yet shipped (`TASK-04`'s own `gap` field) — so today, a customer task's creation is fully recorded
in `tasks` but not yet mirrored into the universal `activity_log` envelope. This is the single largest concrete
gap standing between today's reality and the "zero lost task" target (§35).

## 3. Task identifier

Every task-bearing table (`tasks`, `taskExecutionPlan`, `taskAgentExecutions`, `activityLog`, `orchestraExecutions`)
uses Drizzle's `.primaryKey().$defaultFn(() => createId())` — a cuid2-style ID generated at insert time, not a
separate sequence. There is no cross-table "one ID for the whole activity" today; a single real-world task can
legitimately have a `tasks.id`, N `taskExecutionPlan.id`s, N `taskAgentExecutions.id`s, and N `orchestraExecutions.id`s,
each independently generated. `activity_log.detailId` (schema.ts:1511) is the real, existing soft-pointer meant
to be the "one queryable identity" — a text column, not a real FK (`detailTable` varies), by design, per
`UNIVERSAL_TASK_WRAPPER_DESIGN.md`'s own Option B tradeoff. `pmsIssues.number` (schema.ts:4096) is the one real
exception — a genuine human-readable per-project auto-sequence, scoped to the PMS issue tracker only, not tasks
generally.

## 4. Task classification

Two real, separate classifiers exist, scoped to different activity types — not one universal classifier:
AI Dev Team dispatch is classified into a complexity tier (`mechanical`/`integrative`/`judgment`,
`src/lib/model-tier-eligibility.ts`, AGENTS.md Rule 10) at dispatch time, gating which models may receive it.
Customer/high-impact actions are classified via `detectHighImpactAction()`'s 9 real categories (`GP-10`,
`PARTIALLY_ENFORCED`, "real for that surface only"). `activity_log.activityType` (§1) is the coarse, top-level
classification every activity carries regardless of these finer classifiers.

## 5. Task priority

`tasks.priority` (schema.ts, int, default 0) drives real queue ordering; `lastReprioritizedAt`/
`lastReprioritizationReason` (values `overdue | due_within_24h | due_within_72h`) record why a task's priority
changed, not just that it did. `pmsIssues.priority` uses its own `pmsIssuePriorityEnum` = `no_priority | urgent |
high | medium | low`. `tickets.priority` uses a separate `priorityEnum` (default `medium`) plus `slaPolicyId`.
**Real, honest gap**: these three priority models are real but independent — there is no single cross-activity
priority scale today (a `tasks.priority=5` and a `pmsIssues.priority='urgent'` are not commensurable without
application-level mapping). `veri-todo-service.ts`'s `listVeriTodos()` (§30) is the one real place that sorts
across all three by merging them in application code, not by a shared underlying scale.

## 6. Task context

The real context-carrying mechanism for a customer task originating from VERI Chat is the **Chain Selector**
(`src/components/veri-chat/ChainSelector.tsx`): `ChainSelectorResult = { title, modePill?, pathKeys?,
skippedChainSelector }` (line 242), with `modePill` derived from the first path segment of the user's selected
option chain. This is carried into task creation via `tasks.dynamicChainId` and `createTask()`'s `modePill`/
`chainPathKeys`/`chainPathLabels` inputs (§2), and feeds `resolvedWorkerAgentId` for zero-LLM structured dispatch
(§18). Multi-tenant context (`orgId`, `clientId`, `userId`) is a real, mandatory column on every task-bearing
table, enforced via RLS/`withTenantContext` — this is the one form of "context" that is universal across every
activity type today, not activity-type-specific.

## 7. Task owner

Every task-bearing table's `orgId`/`clientId`/`userId` triad is mandatory (NOT NULL, enforced by RLS policy) —
a task without an owning tenant cannot be inserted. This is the real mechanism behind this document's own
mandated principle "every task always has an owner": it is not a policy statement without a mechanism, it is a
database-level constraint, already enforced, on every real task-bearing table checked in this pass.

## 8. Task assignee

`tasks.assignedById` (schema.ts:1238, Wave 15) distinguishes self-assigned from assigned-by-another tasks, read
by the Home UI's "assigned to me" vs "assigned by me" views. `pmsIssues.assigneeId`/`assignedById` are the
equivalent pair for PMS issues, with `pmsIssueAssignees` as a join table (supporting multiple assignees per
issue — `tasks` has no equivalent multi-assignee join table). `approvalWorkflowStepDefinitions.approverRole`
assigns an approval step to a role, not a specific user, resolved at decision time via RBAC rank (§15).

## 9. Task delegation

**Real, honest finding: there is no generic task-delegation mechanism.** The only real delegation-shaped code
path is `createChainedTask()`, `src/lib/services/crm-service.ts:884` — a private helper, called from two CRM
flows (lines 905, 915), that creates a **new, separate follow-up task** from an AI-recommended CRM action (e.g.
"Follow up: {lead name}"). This is task *spawning*, not delegation of an existing task's ownership — the
original task (if any) is untouched. `loop-prevention.ts`'s `wouldCreateCycle()` / `task-dependency-graph.ts`'s
`recordTaskEscalationEdge()` (`GP-20`, `PARTIALLY_ENFORCED`) are wired at this exact call site, so this one real
delegation-adjacent path is cycle-checked — but it is the only one, and it always targets a brand-new task, so
it can structurally never itself trigger the cycle-refusal branch it protects against (`GP-20`'s own stated gap).

## 10. Task transfer

**Real, honest finding: no `transferTask`/`reassignTask` function exists anywhere in `src/lib`** (confirmed by
this task's own discovery pass, and independently corroborated by `crm-service.ts`'s `createChainedTask` being
the closest analog and not actually being a transfer — see §9). `tasks.assignedById` (§8) can distinguish who
assigned a task, but no service function mutates it after creation. This is a real, named gap, not an
oversight in this document: task transfer, as a first-class operation, does not exist in VERIDIAN today.

## 11. Task splitting

**Real, honest finding: no task-splitting mechanism exists.** The only real parent/child hierarchy in the
codebase is `pmsIssues.parentIssueId` (schema.ts:4104, "self-FK — sub-issues"), and it belongs to the PMS issue
tracker specifically, not to `tasks`. A `tasks` row cannot be split into sub-tasks by any real, existing code
path.

## 12. Task merging

**Real, honest finding: no task-merging mechanism exists**, for the same reason as §11 — confirmed by grep
(`mergeTask`, `subtask` return nothing task-relevant in `src/lib`).

## 13. Task dependencies

`entity_relationships` (schema.ts:966) is the real, generic, already-shipped graph-edge table (`sourceType`,
`sourceId`, `targetType`, `targetId`, `relationshipType`) capable of representing a task dependency, but it is
used today specifically for escalation edges via `recordTaskEscalationEdge()` (§9), not for general task-to-task
dependency modeling. `taskExecutionPlan.stepNumber` (schema.ts:1277) gives an ordered, single-task-scoped
dependency (step N depends on step N-1 completing) — this is real and enforced within one task's own execution
plan, but there is no real cross-task dependency graph ("task B cannot start until task A completes") beyond
the one escalation-edge use case.

## 14. The task status model

The real status model is **plural, not singular** — five real, independently-evolving status vocabularies exist
side by side, confirmed by direct grep, none invented for this document:

| Table | Column | Real values |
|---|---|---|
| `tasks` | `status` (free text) | `pending \| in_progress \| completed \| failed \| cancelled` |
| `taskExecutionPlan` / `taskAgentExecutions` | `status` (free text) | default `pending`, no enumerated comment |
| `activityLog` | `lifecycleStage` | `requested \| classified \| validated \| executing \| reviewing \| completed \| failed \| closed` (schema.ts:1519) |
| `activityLog` | `reviewDecision` | `approved \| rejected` (nullable) |
| `approvalWorkflowInstances` | `status` (real pg enum) | `pending \| approved \| rejected \| cancelled` |
| `approvalWorkflowStepInstances` | `status` (real pg enum) | `pending \| approved \| rejected \| skipped` |
| `instructionCommitments` | `status` | `pending \| done_as_asked \| drifted \| resolved` |
| `tickets` | `status` (free text) | `open \| in_progress \| resolved \| closed` |

`activityLog.lifecycleStage` is the real universal one, per `TASK-04` and `UNIVERSAL_TASK_WRAPPER_DESIGN.md`'s
own "Lifecycle stage mapping" table — a deliberate collapse of the source Constitution's 18 narrative stages
down to 8 real, distinguishable ones, with stages 12-18 (documentation/learning/scoring/etc.) treated as side
effects of reaching `completed` rather than separately-tracked transitions, "to avoid documentation theater"
(that design doc's own words, still accurate). This document adopts that same 8-stage model as the real,
canonical universal status model rather than proposing a 9th.

## 15. Task approvals

Real gate: `decideApprovalStep()`, `src/lib/services/approval-workflow-service.ts:320`. Order, as actually
coded: (1) step must be `pending`; (2) `isSelfApproval()` blocks the instance creator from approving their own
request — real, enforced no-self-certification, matching AGENTS.md Rule 7c and `AUDIT-01`'s "the org that
performs work never certifies its own work"; (3) RBAC rank check (`ROLE_RANK`); (4) an ABAC deny-only policy
check (`checkAbacDenyPoliciesWithDb`, `GP-02`'s 2026-07-18 addition — narrows what RBAC already allowed, never
widens it). On rejection, the whole `approvalWorkflowInstance` rejects immediately (no partial-rollback
concept). On approval, `approvalsReceived` increments against `requiredApprovals`; once quorum is met, the step
approves and `advanceWorkflow()` runs. This is real, working, multi-approver-capable approval infrastructure —
not a design.

## 16. Task escalation

Real ladder: `escalation-ladder.ts`'s `LADDER` (lines 122-126) = `chief_software_engineering_officer` →
`chief_operating_officer` → `super_boss`. `nextEscalationRung()` (line 135) starts at CSEO for
`SOFTWARE_FIRST_REASONS` (`engine_not_found`, `engine_execution_failed`, `worker_agent_unavailable`,
`package_execution_failed`, `package_missing_information`) and at COO for everything else (`guardrail_repeated_failure`,
`budget_limit_hit`, `loop_limit_hit`, `low_confidence_closure`, `monitoring_rule_violation`,
`critical_risk_closure`). `task-execution-engine.ts` calls into this module at 4 real call sites — it does not
define its own separate ladder, so there is exactly one real escalation ladder in this codebase, not several.
Escalation claims are staleness-checked via `evaluateEscalationClaim()`: a claim older than `timeoutMs` since
`lastEscalatedAt` becomes reclaimable, consuming a retry against `maxRetry` until `retry_exhausted` — this is
the real, closest-existing analog to a per-task timeout (§21), scoped specifically to the escalation-claim
path, persisted in `monitor_task_state`.

## 17. Task AI escalation

Real decision point: `executeTask()`, `task-execution-engine.ts:2125`. Branch order, as actually coded: if
`engineKey` is set → `executeEngineDispatch()` (deterministic VCEL calculator, zero LLM cost, classified
`FULL_SOFTWARE`); else if `resolvedWorkerAgentId` is set (a completed VERI Chat Chain Selector choice, §6) →
`executeStructuredDispatch()` (also zero-LLM); only if **neither** deterministic path is available does the
function fall through to LLM planning. Every branch calls `recordExecutionOutcome()`
(`capability-learning-service.ts`, lines 2158-2163) tagged `FULL_SOFTWARE` or otherwise, so whether a given
capability actually needed AI is itself a tracked, queryable fact — not asserted, measured. This is the real
mechanism behind this document's mandated principle "AI only participates when software cannot complete the
task deterministically": it is the literal `if/else if/else` order of the real dispatcher, not a policy
aspiration.

## 18. Task software execution

`executeEngineDispatch()` (§17) runs VCEL calculators (`src/lib/engines/*.ts`) — plain deterministic TypeScript
math, zero LLM calls, zero token cost. This is the first-tried branch in `executeTask()`'s real order, ahead of
both structured dispatch and LLM planning, making deterministic software execution the actual default, not a
secondary fallback.

## 19. Task monitoring

Real structured contract: `monitor-protocol.ts`'s `VALID_STATUS = ["ok","escalate"]`,
`VALID_ACTION = ["none","escalate","retry","log_only"]`, validated by `validateMonitorReportFields()`. Six real
Tier-1 (deterministic rule-engine) monitors are wired at real call sites: `approval-decision-monitor.ts`
(`APPROVAL_GRANTED`/`APPROVAL_REJECTED`), `workflow-completion-monitor.ts` (`WORKFLOW_STARTED`/
`WORKFLOW_COMPLETED`), `task-completion-monitor.ts` (`TASK_CREATED`/`TASK_COMPLETED`), plus 3 more scoped to
board meetings, meeting-intelligence generation, and webhook delivery outcomes — 11 of ~30 documented event
types (`RES-02`). Monitoring order is real and deterministic-first, per `RES-02`'s rule: "deterministic
software monitor first, then narrow low-tier AI monitor, then escalate to higher-tier AI" — the Tier 2/3
model-backed monitors remain designed but not built (`RES-02`'s own honest gap, with each of the ~19 unbuilt
event types traced to one of 3 concrete, named blockers — not skipped for convenience).

## 20. Task heartbeat

**Real, honest finding: no generic per-task heartbeat exists.** `grep heartbeat` across `src/lib` returns
nothing task-related. The one real "heartbeat"-named column found in this pass lives one layer up, at the
AI-OS orchestration layer, not the application layer: `umr_tasks.last_heartbeat`
(`superboss-register.sqlite`, confirmed via `PRAGMA table_info`) — the real dispatch-tracking table this very
document's own UMR chain lives in. This document's own dispatch row (`UMR-20260803-041743-d271`) is itself a
real, live instance of that mechanism. The closest **application-level** analog is `escalation-ladder.ts`'s
`lastEscalatedAt` (§16, §21) — real, but scoped to escalation claims specifically, not a general "is this task
still alive" signal for every activity type.

## 21. Task timeout

Two real, independent timeout mechanisms exist, at two different layers — no single universal task timeout:
(1) `escalation-ladder.ts`'s `timeoutMs`/`evaluateEscalationClaim()` (§16), application-layer, scoped to
escalation claims. (2) At the AI-OS orchestration layer, `quality-gate.sh`'s own documented
timeout-as-failed-gate design (cited in this task's own prior-session governance trail, real RCA
`task-20260727-043407`) — a build/test gate that times out is treated as a real gate failure, not silently
ignored, and is the real mechanism the credit-accountant.py deterministic-rejection logic already relies on
(see `ai-os/boss/ACTIVE-CLAIMS.yaml`'s own OCID-020-continuation entry for a real, worked example of this).
This task's own invocation counter (`.task.lock`, `worker.log`, visible in this branch's own prior-task
`PROGRESS.md` content as "invocation 2/20" before this task's own commit replaced it) is a third, real,
already-operating bounded-retry mechanism at the same orchestration layer.

## 22. Task recovery

Real mechanism: `withAutomaticRecovery<T>(fn, opts?)`, `src/lib/services/exception-taxonomy.ts:36` — retries
`fn()` up to `opts.maxRetries ?? 1` extra times, only for errors `classifyError()`'s `{kind, retryable}`
taxonomy marks retryable; throws immediately once retries are exhausted or the error is non-retryable. Real,
shipped compensating-action rollback exists at exactly 2 call sites (`GP-29`): `erp-fixed-assets-service.ts`'s
depreciation-batch/asset-disposal flow (`voidDraftJournalEntry`, preventing a duplicate GL posting on a
follow-up write failure) and the shared approval-decide route (`withAutomaticRecovery` around the
finalize-after-approve step). This is real, working, in-process recovery — scoped to the highest-value
financial/approval flows identified so far, not a universal containment protocol (`GP-29`'s own honest gap).

## 23. Task resumption

**Real, honest finding: no persisted, generic "resume this task" concept exists at the application layer** —
`withAutomaticRecovery` (§22) is an in-process retry within a single function call, not a resumable-from-crash
task state machine. The real, working resumption mechanism in this codebase lives at the **AI-OS orchestration
layer**, one level above the `tasks` table: this very task's own systemd unit (`veridian-worker@task-...service`),
`.task.lock`, and `worker.log` are the real artifacts that let a task be re-invoked and continue from its own
`PROGRESS.md`-recorded state after an interruption — the same mechanism the OCID-020 continuation session (§21)
used to genuinely resume a background sweep across multiple invocations rather than restart from zero. This is
real and already operating for AI-OS-dispatched tasks specifically; it is not a mechanism `tasks`/`activity_log`
rows themselves expose to a customer-facing "resume my task" action.

## 24. Task completion

Real gate: `checkQaPreCompletionGate()`, `src/lib/qa-precompletion-gate.ts` — passes only if
`handoverValidationPassed === "yes"`, or an `overrideReason` of at least 10 characters is supplied; otherwise
fails with a named reason (`handover_not_submitted` / `handover_validation_not_passed:{value}`). Wired as the
`HANDOVER_PROTOCOL_LEAF` guardrail at dispatch time and checked again before `activity_log.lifecycleStage`
flips to `completed` (`src/app/api/ai/team/review/route.ts`). **Nuance on `handover-protocol.ts`**: its async
`submitHandover()`/`acceptHandover()` DB functions genuinely have zero live callers (confirmed independently by
this task's own discovery pass, corroborating `qa-precompletion-gate.ts`'s own header) — but the module is not
entirely dead: its pure `decideAcceptance()` is called live from `activity-log-service.ts:242`, and
`validateHandoverFields()` is the live `HANDOVER_PROTOCOL_LEAF` guardrail itself. Completion, as actually
enforced today, is a structured self-assessment gate, not a bare status flip.

## 25. Task verification

Real, layered verification, not one mechanism: `claim-verification.ts`'s `computeClaimConfidenceScore()`
grep-verifies an AI output's own backtick-quoted file-path/`identifier()` claims against this repo's real
current state (`GP-08`/`GP-09`) — narrow by design, scoped to two claim shapes, not a semantic fact-check.
`AUDIT-02`'s real gate: every AI Dev Team dispatch output is checked for hedging/low-confidence language;
if flagged, `requiresAudit:true` triggers a GUARDRAIL_PRODUCT-level review automatically. At the process layer,
AGENTS.md Rule 10 makes doer/auditor cross-review a real, CI-enforced merge gate
(`.github/workflows/mandatory-audit-check.yml`) — a PR from a non-judgment-tier role's dispatch branch cannot
merge without a comment starting `AUDIT: PASS`/`AUDIT: FAIL`. Honest limitation, stated the same way both of
those mechanisms' own source documents state it: this verifies an audit verdict was *asserted*, not that it
was rigorous.

## 26. Task audit

Real table: `audit_logs` (schema.ts:626) — append-only at the DB grant level (migrations `0005`, `0225` revoke
UPDATE/DELETE), with a generic AFTER-trigger backstop on `users`/`compliance_items`/`erp_journal_entries`/
`erp_payment_entries` writing `db_trigger.*`-prefixed rows if application-level `logActivity()` is bypassed —
i.e. even a code path that forgets to call the audit helper still produces a row on those 4 tables. Real audit
org, `src/lib/ai-team/roster.ts`: `chief_audit_officer` (`AUDIT_EXECUTIVE` team) heads a 4-level Guardrail Team
hierarchy (`ai_safety_auditor`, `audit_activity_monitor`, `internal_auditor`) — `AUDIT-01`'s "the org that
performs work never certifies its own work" principle, implemented as real roster roles, not new ones invented
for this document.

## 27. Task traceability

The real, operating traceability mechanism spanning this entire OCID-022 through OCID-034 chain **is** the UMR
convention itself: every real task carries a `umr_tasks` row (`superboss-register.sqlite`) with its own
`umr_id`, citing a parent `umr_id` in its own prompt text (not a DB-enforced FK — a convention, the same honest
limitation class as every other cooperative-registry mechanism in this repo, per `ai-os/boss/ACTIVE-CLAIMS.yaml`'s
own header). This document's own header (top of file) is a real, live instance of that convention, including
the numbering self-correction it performed by querying that same table directly rather than trusting a prior
narrative citation (§ header). `ai-os/boss/COMPLETED.yaml` and `ai-os/boss/ACTIVE-CLAIMS.yaml` are the two real
canonical logs this traceability writes into at, respectively, close and start of real work.

## 28. Task reuse

Real, existing query-before-building protocol: `ai-os/MASTER_INDEX.yaml` — the canonical instruction (repeated
in this repo's own `CLAUDE.md`) is to query this index before creating any new script/table/register across
compliance-tracker/projexa/veda-advisors/claude-control, specifically to avoid building a parallel mechanism
that already exists. `capability_registry` (a real table in `superboss-register.sqlite`, confirmed present)
and `capability-learning-service.ts`'s `recordExecutionOutcome()` (§17) are the real mechanism for a narrower,
execution-level form of reuse: whether a given capability was actually resolved by software or needed AI is
tracked so future dispatches of the same capability can prefer the cheaper, already-proven deterministic path.

## 29. Task analytics

Real, partial: `controls-health-audit.ts`'s `getControlsHealthSnapshot()` aggregates a rolling 30-60min window
of `audit_logs` (`AUDIT-03`'s L3 real mechanism), surfacing compensating-JE-void and orphaned-approval-finalization
counts. `token_usage_ledger` (named in `GP-23`'s own gap note) is the real per-dispatch cost/usage record, but
`GP-23` itself is honest that "no universal per-task report" exists yet — task-level analytics today are real
but fragmented across `controls-health-audit.ts`, `token_usage_ledger`, and `capability_registry`, not unified
in one queryable surface.

## 30. The task dashboard

**Real, honest finding, corrected in this pass**: `src/app/(app)/tasks/page.tsx` exists, but its actual
rendered content is **compliance items** (`ComplianceItem` type, priority/status badges), not `tasks` rows —
the route name and its real content do not match. The closest real cross-activity task view is **VERI To
Do**: `listVeriTodos()`, `src/lib/services/veri-todo-service.ts:34`, surfaced at `GET /api/home/todos`.
**Correction to how this was described elsewhere in this repo's own governance trail** (`ai-os/CONSTITUTION.yaml`'s
`resilience_and_monitoring` RES-02 gap note calls it "a query-time UNION view" — this task's own direct read of
the function found that description imprecise): it is not a SQL `UNION`/DB view — it runs three separate
Drizzle queries (`tasks` filtered to `pending`/`in_progress`, `instructionCommitments` filtered to `pending`,
`pmsIssues` via `pmsIssueAssignees` filtered to non-terminal status) and merges/sorts the three result arrays
in **application code**, by `priority DESC, createdAt ASC`. This distinction matters for anyone building on top
of it: there is no DB-level view to query directly, only the service function. `activity_log`'s Phase 3 (a real
query surface, `UNIVERSAL_TASK_WRAPPER_DESIGN.md`) remains the not-yet-built path to a true unified dashboard.

## 31. Task notification

Real table: `notifications` (schema.ts:581), `notificationTypeEnum` = `deadline_reminder | assignment |
status_change | comment | system | mention | instruction_mismatch`. **Real, honest gap**: no single
`notification-service.ts` exists — inserts happen ad hoc across 12+ real call sites (`fm-visitor-service.ts`,
`metric-alert-service.ts`, `task-nudge-digest-service.ts`, `ticket-service.ts`, `automation-rule-service.ts`,
`report-schedule-service.ts`, `compliance-service.ts`, `task-service.ts`, `risk-escalation-service.ts`,
`loop-insight-notifier.ts`, `instruction-mismatch-audit.ts`, `cost-guard.ts`, and the task-comments route).
This is the real reason `RES-02`'s own gap note names `NOTIFICATION_DELIVERED` as un-monitorable today: no
shared creation helper, and no delivered/read-timestamp column exists to hook a monitor onto.

## 32. Task synchronization

The real, universal synchronization guarantee across every task-bearing table is multi-tenant isolation, not
cross-device/cross-session state sync: every real query goes through RLS/`withTenantContext`, enforced at the
database layer, so no task from one org can ever be visible to another regardless of which client reads it.
**Real, honest gap, not independently verified in this pass**: whether any real-time push/live-refresh
mechanism exists for a task changing status while a user has it open was out of scope for this document's
discovery pass — not claimed either way, and should not be assumed from this document.

## 33. Task history

Three real, distinct history surfaces, not one: `audit_logs` (§26, append-only, the authoritative
who/what/when record); `taskChatMessages` (schema.ts:1323, `role: user|assistant|system`, read/written in
`task-service.ts`'s `getTask()` and `report-cadence-service.ts`) — the real per-task conversation thread;
`comments` (schema.ts:570, generic `entityType`/`entityId`) — free-text human commentary, not itself
audit-logged as a distinct event type beyond its own insert.

## 34. Task certification

Real, existing gate, not proposed here: `SEC-07` (`ai-os/CONSTITUTION.yaml`) — real implementation,
gap-closure, production changes, completion certification, and platform freeze under the ERP Functional
Completeness Master Program stay locked until OCID-020 (`UMR-20260802-165606-4413`) is independently verified
complete, with the explicit unlock sequence OCID-038 (implementation) → OCID-039 (production certification) →
OCID-040 (final certification + freeze). Nothing in this document changes, weakens, or advances that sequence —
this is a documentation-only OCID within the still-locked window, exactly as `SEC-07` and the OCID-020
implementation lock require.

## 35. The zero-lost-task target

Stated honestly as a **real, existing design target with a known, partial gap** — not a certified guarantee.
`UNIVERSAL_TASK_WRAPPER_DESIGN.md`'s whole premise is closing "you'd have to query 4+ tables with incompatible
shapes, and one activity type leaves no record at all" — Phase 1 of that design has shipped (`TASK-04`: AI Dev
Team dispatch and loop runs now write real `activity_log` rows at creation, closing the worst case of a task
existing with literally zero record). **What remains real and open, stated plainly**: Phase 2 (pairing every
`tasks`/`orchestraExecutions` write with an `activity_log` insert) has not shipped, so a customer task today is
fully recorded in `tasks` itself but not yet mirrored into the universal envelope — not lost, but not yet
queryable through the one universal surface either. "Zero lost task" is therefore accurate today in the sense
that mattered most (no activity type is invisible), and not yet accurate in the sense of "every task visible
through one query" — that second sense depends on Phase 2 and Phase 3, both still open, both already honestly
named as such in `TASK-04`'s own gap field rather than newly discovered here.

## 36. Readiness for OCID-033

Real, live-verified (§ header): OCID-20260803-033 is **"Universal End User Work Orchestration Runtime"**
(`UMR-20260803-041851-085a`, unit `task-...-ocid-033-veridian-universal-end-user-wor.service`), confirmed
`status: running` in `umr_tasks` at the time this document was written — a real, currently-active concurrent
session, not a future dependency waiting on this document. Per this repo's own overlap-resolution discipline
(§0, `UMR-20260803-045159-ec55`), that session's own worker is responsible for checking this document (once
merged) for genuinely-new-vs-duplicate ground before finalizing its own scope — the same check this task
performed against OCID-023. This document's own real, checkable readiness signal for that check: sections most
likely to overlap with "End User Work Orchestration" are §6 (Task Context / Chain Selector), §17 (Task AI
Escalation), and §30 (the task dashboard / VERI To Do) — all three describe existing mechanisms from the
task-lifecycle angle specifically (status/ownership/completion), not from the end-user-experience angle
(what the user sees/clicks); OCID-033's worker should treat that as the real seam, not assume zero overlap
exists just because the topics are named differently.

---

## Explicit non-certifications (per this OCID's own directive)

This document does **not** certify, and explicitly states as not yet true: that a single universal task ID
exists across all 5 activity shapes (§3); that task delegation, transfer, splitting, or merging exist as real
operations (§9-§12); that a generic per-task heartbeat or resumption mechanism exists at the application layer
(§20, §23); that task notifications are delivered through one shared, monitorable service (§31); that
cross-device task synchronization has been verified either way (§32); that the task dashboard route
(`tasks/page.tsx`) actually shows tasks (§30); or that "zero lost task" is complete in the "one universal
query" sense, as opposed to the "no activity type is invisible" sense it has actually achieved (§35). Platform
freeze and final certification remain deferred to the real OCID-020 → OCID-038 → OCID-039 → OCID-040 sequence
(§34), unaffected by this document.

Canonical artifact created: this file. Amends the existing UMR chain
(`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, `ai-os/OS.yaml`, `ai-os/MASTER_INDEX.yaml`); does not start a
new one.
