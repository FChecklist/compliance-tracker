# VERIDIAN Universal Software Execution Engine v1.0

**UMR:** `UMR-20260803-041700-a741` (OCID-031, this document's own real directive, per real PM
decision `UMR-20260803-063016-8bfc`), parented to `UMR-20260803-040844-4a33` (OCID-022) through
`UMR-20260803-041459-7c97` (OCID-030) in order, the ERP Functional Completeness Master Program
(`UMR-20260802-173631-ca85`),
OCID-020 (`UMR-20260802-165606-4413`), the server artifact traceability audit
(`UMR-20260802-164659-9a31`), the gatekeeper rule (`UMR-20260802-165034-5747`), and the unified
project memory (`UMR-20260802-165434-cd91`). Amends the existing UMR chain and the existing canonical
artifact index (`ai-os/OS.yaml`); does not start a new chain.

**What this is:** a documentation-only artifact defining how VERIDIAN executes work that has already
been decided — the mechanics of running, tracking, and completing a task/function/workflow/report/
analysis once software (or, where explicitly permitted, AI under software supervision) has determined
what to do. Every claim below is grounded in real, already-built mechanisms in the live
`compliance-tracker` repository and its companion infrastructure scripts, verified by direct file/line
reads via a dedicated discovery pass, not designed here.

**What this is not:** not a new architecture, not a new task/rule/workflow/function/report/analysis
engine, not a database change, not an implementation of anything, and not a decision engine — *what*
gets decided and *when AI is invoked* are the subjects of sibling documents (see §0 below). This
document is the layer immediately downstream of a decision: once something has been decided, how does
it actually run to completion, get tracked, retried, audited, and reused.

---

## 0. Honest scope boundary and a real numbering error, found and resolved

**Numbering error, found during discovery, resolved by a real PM decision:** this task's own working
directory was labeled `ocid-031`, and that label was correct all along. At the time this document was
being drafted, its own citation chain mistakenly cited `UMR-20260803-041459-7c97` — which is real, but
is OCID-030's own UMR ("VERIDIAN Universal Decision Engine," PR #772), not this document's. Real PM
decision `UMR-20260803-063016-8bfc` independently verified this document's real content ("VERIDIAN
Universal Software Execution Engine") is OCID-031, citing the real, correct parent UMR
`UMR-20260803-041700-a741`. This was a wrong citation on this document's own part, not a genuine
dispute between documents: PR #772 is, and always was, the real OCID-030 (confirmed separately by
`UMR-20260803-052107-71fa`); this document is the real OCID-031. Both are now correctly and
consistently labeled. Same class of citation error as the OCID-026/027/028/029/030 corrections
already recorded in `VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §1/§1b.

**Cross-referenced, not duplicated — adjacent real/open documents found during discovery:**

| Document | Real subject | Relationship to this document |
|---|---|---|
| PR #772, `VERIDIAN_UNIVERSAL_DECISION_ENGINE_2026-08-03.md` | What VERIDIAN decides to do next — Mother Router, guardrail-engine.ts, policy-enforcement-engine.ts, approval-workflow-service.ts | Upstream. Decisions this document's engines execute are made there; this document does not re-derive decision logic. |
| PR #775, `VERIDIAN_DETERMINISTIC_EXECUTION_AND_AI_ESCALATION_RUNTIME_2026-08-03.md` | End-user input normalization (chat/voice/mode-pills/Chain Selector), when software completes work vs. escalates to AI, AI result validation/audit | Upstream/adjacent. That document covers the *decision point* of software-vs-AI; this document covers what happens to *either* outcome once execution actually starts (the "Software Executes AI Result" handoff in that document's §24 is the entry point into this document's §2/§9). |
| PR #773, `VERIDIAN_UNIVERSAL_ORGANIZATION_RUNTIME_2026-08-03.md` | Org structure, people, roles, approval/delegation/succession | Cross-referenced for §29 (role-based execution) — this document does not re-derive the role model. |
| PR #774, `VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` | Browser/PWA/server state sync, offline, conflict resolution | Distinct concern (data/state consistency across clients) from execution (task/function/workflow lifecycle) — no section overlap found; both use the word "traceability"/"performance"/"certification" but for different subjects. |

This document's own mandated section list (execution principles through readiness for OCID-032) has
no equivalent single document elsewhere in the open PR set as of this writing — the gap it fills is
real, not duplicate.

---

## 1. Execution principles

Every decision produces exactly one execution path: VERIDIAN has no dual-write, no shadow-execution,
and no A/B execution mechanism for the same task. The single, real entry point for turning a decided
task into running work is `executeTask()` in `src/lib/task-execution-engine.ts` (2125), reached only
through `createTask()` (`src/lib/services/task-service.ts:133-188`) → `POST /api/tasks`. Four
non-negotiable, real, already-enforced properties hold for every execution:

1. **One identifier.** Every task row has a single primary key; every AI-team dispatch produces exactly
   one `InstructionContract`/`ExecutionReport` pair (`src/lib/services/task-register-service.ts`,
   reached from `POST /api/ai/team/dispatch`); every engine call gets exactly one
   `calculationInvocations` row (`src/lib/engines/engine-invocation.ts:32`).
2. **Traceable and auditable.** `src/lib/audit.ts`'s `logActivity()` is the single call site every route
   is meant to use, run inside the same `withTenantContext` transaction as the write it logs, so
   write+audit commit or roll back together — not two independent writes that can drift.
3. **Updates the existing UMR chain and canonical artifact.** This document itself follows that rule:
   it amends `ai-os/OS.yaml`'s index and `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s existing chain,
   not a new one (§35).
4. **AI never executes software responsibilities.** Every engine in `src/lib/engines/*` (accounting,
   costing, GRC, analytics, compliance, etc.) is pure/deterministic code — "engines compute, AI never
   invents a number" (the operative discipline named directly in `grc-workflow-engine.ts`'s header).
   Where AI is involved at all, `policy-enforcement-engine.ts`'s `enforcePolicy()` (107) is a mandatory
   pre-call gate, and `src/lib/model-tier-eligibility.ts`'s `checkTierEligibility()` (75) restricts which
   models may even attempt judgment-tier work — software validates and executes; AI does not
   self-certify (AGENTS.md Rule 10).

Execution always reuses existing capabilities: `src/lib/task-execution-engine.ts`'s
`resolveTaskCapability()` (1889) and `src/lib/services/capability-learning-service.ts`'s
`deriveCapabilityKey()` (23) exist precisely so the same (mode pill, path) pair always resolves to the
same learned, reused capability rather than a fresh one being built per request. No parallel execution
path is created for the same task — see §27 (zero-duplication execution) for the concrete, currently
*imperfect* state of this principle (documented honestly, not glossed over).

## 2. Task execution

`src/lib/task-execution-engine.ts`'s `executeTask()` (2125) is the real, general-purpose task engine for
product-facing work (distinct from the AI-dev-team's own dispatch — see §5). It drives: guardrail
evaluation (`enforcePolicy`, `evaluateGuardrails`), free-text/LLM task planning where applicable, engine
invocation (§4), capability learning, and escalation (handoff to PR #775's decision boundary when
software cannot complete the task deterministically). `dispatchTool()` (89) is the real function-call
dispatcher within task execution — currently a 22-branch `if (codeReference === "...")` sequence (e.g.
`get_compliance_stats`, `list_departments`, `update_compliance_status`), not a lookup-table registry;
noted honestly as a real, working mechanism with a real, unglamorous implementation shape, not
described as more elegant than it is.

## 3. Function execution

Function-level execution is split across two real, coexisting layers, not unified into one dispatcher:

- **Domain computation functions**: `src/lib/engines/` (32 files) — accounting, banking, costing,
  inventory, HR, payroll, CRM, sales, security, marketing, procurement, logistics, fixed-asset,
  project-management, data-quality, document-processing, mathematical, GRC, analytics, plus per-country
  modules under `in/` and `ae/`. All pure functions; called through `src/lib/engines/engine-invocation.ts`'s
  `invokeEngine()` (32), which looks up the current `engineVersion` from the `computationEngines` table,
  runs the function, and writes a `calculationInvocations` audit row on success or failure — this
  wrapper is the real, general execution+audit boundary for every engine call.
- **AI-callable action functions**: `task-execution-engine.ts`'s `dispatchTool()` (89, see §2).

`src/lib/engines/compliance-engine-registry.ts`'s `getComplianceEngine()` (line ~30) is the real
per-country resolver, binding India (`incomeTax/tds/gst`) and UAE (`vat/corporateTax`) modules; it
throws explicitly for any unregistered country rather than fabricating a rule — this is the concrete
mechanism behind §30 (multi-brand execution)'s statement that country/brand coverage is real but
partial (India + UAE only, confirmed zero production callers of the broader multi-country registry
abstraction as of this writing, per this repo's own prior verified finding — see `MEMORY.md`-tracked
`country-config-architecture-state` for the equivalent finding recorded outside this repo).

## 4. Workflow execution

No single generic `class WorkflowEngine` exists. "Workflow execution" in this codebase means one
hand-built finite-state-machine service per domain, plus a shared pure-function toolkit:

- **`src/lib/services/construction-billing-workflow-service.ts`** (225 lines) — a real FSM:
  `CLAIM_STATUSES` (22: `milestone_achieved → drafted → submitted → client_approved →
  invoiced/rejected`), with `createProgressClaim/draftClaim/submitClaim/approveClaim/rejectClaim/
  invoiceApprovedClaim` transition functions, `STUCK_CLAIM_THRESHOLD_DAYS` (39) for stall detection,
  `listBillingDueQueue()`/`getClaimTimeline()` for worklist/timeline reads. Wired to 7 API routes under
  `src/app/api/construction/progress-claims/`.
- **`src/lib/engines/grc-workflow-engine.ts`** (107 lines) — pure, DB-free deterministic functions:
  `computeSlaStatus()` (13), `computePoshInquiryDeadline()` (29, POSH Act 2013 §11(4) 90-day statute),
  `validateIccComposition()` (45), `computeVendorRiskScore()` (81). Consumed by incidents/
  whistleblower/POSH/vendor-risk routes.

This is the real, honest state of "workflow execution": a per-domain pattern (a new domain workflow
means a new hand-built FSM service, not a config change to a shared orchestrator), not a limitation to
paper over.

## 5. Report execution

`src/lib/services/report-engine-service.ts` (1790 lines) is the real "Reports & Analysis Engine"
(built under a prior Owner directive, Priority 11). Its single dispatcher, `executeReportDefinition()`
(1596), handles 4 `execution_type` shapes per a `report_definitions` row:

- `deterministic_aggregation` — via `runAggregationFromConfig()` (330), resolved against a hardcoded
  `TABLE_REGISTRY` (208).
- `deterministic_formula` — via a `FORMULA_REGISTRY` (1379, also computing SPI/CPI/health-index
  metrics — see §6).
- `ai_recipe` — a grounded LLM call, re-run fresh each time (not cached/frozen).
- `external_service` — a passthrough marker for report types sourced outside this engine.

Also: `createReportDefinition/updateReportDefinition/deleteReportDefinition` (1551/1576/1586),
`promoteAiAnalysisToDefinition()` (1676, the real mechanism turning a one-off AI analysis into a
reusable, deterministic report definition — the concrete implementation of "every verified execution
becomes reusable," §1/§27), and `getFullReportCatalog()` (1735).

**Honest gap, not silently absorbed**: this engine's own header names the *older*, still-present,
bespoke report functions it exists to eventually replace — `construction-reports-service.ts` (17
functions), `erp-financial-report-service.ts` (4 functions), `custom-report-service.ts` (a per-entity
switch). Those were not found to be removed or migrated as of this discovery pass; two report-execution
mechanisms coexist today. See §27.

## 6. Analysis execution

Split across three real, coexisting locations, not one unified analysis engine:

- **`src/lib/engines/analytics-engine.ts`** (77 lines) — `analyzeTrend()`/`analyzeTrendExplained()`
  (9/22, linear regression via `simple-statistics`), `analyzeAnalyticsVariance()` (33),
  `compareToBenchmark()` (39), `forecastBaseline()` (46), `detectAnomaliesZScore()`/
  `detectAnomaliesIqr()` (54/61), `calculateCorrelation()` (72). `analyzeTrendExplained` is the file's
  own-documented sole real caller, wired into `task-execution-engine.ts`'s `trend_analysis_engine` case.
- **`src/lib/services/orchestra-analytics-service.ts`** — a separate, AI-usage-scoped analytics
  service, with a documented partial-coverage overlap against `analytics-engine.ts`'s own
  `kpi_calculator`.
- **`report-engine-service.ts`'s `FORMULA_REGISTRY`** (§5) — computes real analysis metrics (SPI/CPI/
  health indices) as part of report execution rather than a separate analysis pass.

## 7. Background execution

The real, live background-execution layer lives partly outside this Next.js repo, in the companion
infrastructure scripts this repo's own `AGENTS.md`/`ai-os/` docs directly reference:

- **`/opt/veridian/scripts/systemd/veridian-worker@.service`** — a systemd `--user` template unit,
  `ExecStart=/opt/veridian/scripts/worker-entrypoint.sh %i`, memory-capped (`MemoryHigh=2G`/
  `MemoryMax=3G`/`MemorySwapMax=1G`, added after a documented OOM-kill incident), deliberately with no
  `[Install]` section — units are started explicitly (`systemctl --user start`), never boot-activated
  (added after a second incident where enabled units auto-started en masse at boot).
- **`/opt/veridian/scripts/worker-entrypoint.sh`** (532 lines) — runs the actual work headlessly, with a
  pre-flight guard, a 5-minute background checkpoint loop, and a lifetime-invocation cap
  (`MAX_LIFETIME_INVOCATIONS=20`) that this document's own task consumed one unit of.
- **`/opt/veridian/scripts/supervisor-entrypoint.sh`** (434 lines) — post-work review: risk-tier
  classification, merge-via-PR or hold-for-sign-off (see AGENTS.md's 2026-07-31 autonomy amendment for
  the current state of the hold path).
- **`/opt/veridian/scripts/dispatch_core.py`** (364 lines) — the shared concurrency-gate primitive
  (`acquire_dispatch_lock()`, `has_free_slot()`) every real spawn call site on the box uses, closing a
  documented multi-path race that previously caused a real OOM-kill incident.

No queue library (BullMQ or equivalent) exists inside the Next.js application itself — confirmed no
`bullmq` references under `src/`. The real queue/concurrency layer is this external Python
`dispatch_core.py`/`dispatch-tick.py` pair plus `task.yaml`/systemd, not an in-app queue.

## 8. Scheduled execution

Not crontab — `/opt/veridian/ai-os/CRONTAB_APPROVED_SNAPSHOT.txt` documents all scheduled jobs retired
permanently (2026-07-29, "cron-consolidation-phase6") with an explicit "DO NOT re-add cron entries
here" instruction, and `worker-entrypoint.sh`'s own pre-flight guard hard-stops if a stray crontab entry
reappears. The real mechanism is a **closed set of 18** `veridian-cron-*.timer`/`.service` pairs under
`~/.config/systemd/user/` (e.g. `veridian-cron-dispatch-tick`, `veridian-cron-health-check-15min`,
`veridian-cron-cost-usage-60min`, `veridian-cron-security-check`), each with randomized-delay jitter and
a shared `ConditionPathExists=!.../resource-governor-EMERGENCY_STOP` kill-switch. Adding a 19th requires
an explicit Owner decision per that set's own README. `/opt/veridian/scripts/dispatch-tick.py` (971
lines) is the real script one of those timers runs — it consolidates supervisor-sweep, queue-dispatcher,
module-queue-dispatcher, and resume-interrupted-workers-after-reboot into one gated entry point.

## 9. Real-time execution

No Supabase Realtime channel subscription mechanism is wired into `src/lib` or `src/app` as of this
discovery pass (`.channel(` grep: zero hits). "Real time" in the actually-shipped system means
synchronous request/response execution through the same HTTP dispatch surfaces described in §2/§10 —
there is no separate live-push execution channel today. This is a real, honest gap, not a described
capability; a future OCID (§35, readiness for OCID-032) inherits this as an open item rather than this
document overstating a mechanism that does not exist.

## 10. Event-driven execution

Two real, coexisting mechanisms with meaningfully different maturity:

- **`src/lib/webhook-deliver.ts`** (101 lines) — outbound: `deliverWebhook()` (7) looks up active
  `webhooks` rows per org/event type, HMAC-SHA256 signs the payload, retries up to 3 attempts (§16).
- **`src/app/api/webhooks/vercel-deployment/route.ts`** — inbound: signature-verified
  (`verifyVercelSignature`), writes `deploymentEvents`, triggers `recordAuditTrigger`.
- **`src/lib/audit-event-triggers.ts`** — wires 9 of 10 named "audit trigger" events (Feature
  Completed, SOP Changed, Deployment, etc.) into automatic audit creation directly; the 10th (Code
  Changed) is wired through `.github/workflows/mandatory-audit-check.yml` instead — a deliberate,
  documented single (non-parallel) mechanism per event, not a gap.

**Honest gap, not silently absorbed**: `src/lib/event-bus.ts` (60 lines) is a real typed in-process
pub/sub (`subscribe()`/`publish()`), but its own header states plainly it ships with **zero production
call sites wired in, on purpose** — infrastructure built ahead of adoption. It is not durable across
serverless invocations either. Treat it as scaffolding, not a live event-driven execution path, until a
future task wires and durably backs it.

## 11. The execution queue

There is no single, unified in-app execution queue. Three real, distinct queue-like mechanisms exist
for three different kinds of work, and none of them is a shared abstraction the others build on:

1. **AI-dev-team dispatch queue** — governed by `/opt/veridian/scripts/dispatch_core.py`'s concurrency
   gate (a fixed worker-slot cap, currently 5 per the status-snapshot document's own observation of
   "queued behind the real 5-worker concurrency cap").
2. **Scheduled-job queue** — the 18-timer systemd set (§8), each independently jittered and gated.
3. **Report/analysis execution** — synchronous, request-scoped (`executeReportDefinition()`, §5); no
   queue, no background job — a report definition executes in the same request that asks for it.

## 12. Execution priority

Priority is enforced at the dispatch-gate layer, not inside a priority-queue data structure. The real
mechanism is `model-tier-eligibility.ts`'s tier classification (`mechanical`/`integrative`/`judgment`,
§13 below) — a model not yet trusted for judgment-tier work is refused that class of dispatch outright,
which is a priority/eligibility gate, not a scheduling priority in the traditional sense. No separate
priority-score/priority-queue implementation was found in this discovery pass; this is named honestly
as the real mechanism rather than implying a richer one exists.

## 13. Dependency execution

Dependency ordering is enforced by convention and explicit human/PM decision, not by an automated DAG
scheduler. The concrete, real example from this exact document chain: OCID-023 (`VERIDIAN Universal
End User Work Model`) correctly detected, via its own `task.yaml` `completed_steps`, that its sibling
OCID-022 document had not yet merged, and blocked itself on that dependency rather than proceeding —
confirmed via `systemctl --user status` + direct `task.yaml` read (per
`VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §1). This is a real, working dependency-respecting
pattern, but it is **manual and self-reported per task**, not a system-enforced dependency graph — a
task that failed to check its own dependencies would not be blocked by any external mechanism.

## 14. Parallel execution

Real, live, and the normal mode of operation on this server: up to 5 concurrent worker units
(`dispatch_core.py`'s slot cap, §11), each in its own isolated git worktree (per-task workspace under
`/opt/veridian/ai-os/tasks/`), coordinated cooperatively through `ai-os/boss/ACTIVE-CLAIMS.yaml`
(AGENTS.md Rule 11) rather than a technical lock. The real, honest limitation, stated plainly in that
file's own header: this is a cooperative registry enforced by each session's own discipline, not a
technical lock — nothing stops two sessions from claiming overlapping work simultaneously, the same
class of limitation as the guardrail-presence and audit-comment checks (§18/§21).

## 15. Sequential execution

The default execution shape for a single task: `createTask()` → guardrail evaluation → (engine
invocation | AI-team dispatch | tool dispatch) → audit write, in that order, inside one transaction
where the write and its audit row must commit or roll back together (`withTenantContext`, §22/§29). No
task's sequential steps run out of order or skip the guardrail step — `enforcePolicy()` is a mandatory
pre-call gate confirmed via 18 real call sites across `task-execution-engine.ts`, `crm-service.ts`,
`fde-service.ts`, `ai-report-builder-service.ts`, and others.

## 16. Execution validation

Real, multi-layered, not a single validation function: `policy-enforcement-engine.ts`'s
`enforcePolicy()` (107) validates business-purpose/prompt-injection/domain before any AI-adjacent
execution proceeds; `model-tier-eligibility.ts`'s `checkTierEligibility()` (75) validates a model is
allowed to attempt the requested tier of work; `guardrail-engine.ts`'s `evaluateGuardrails()` (62)
validates against an opt-in registry of named guardrails (currently 4 leaves wired:
`AI_TEAM_DISPATCH_LEAF`, `HANDOVER_PROTOCOL_LEAF`, `AI_WORKFORCE_LOOP_BUDGET_LEAF`,
`TASK_FREE_TEXT_PLANNING_LEAF` — honestly narrow, not exhaustive); `scripts/check-guardrail-presence.mjs`
validates, at CI time, that none of those markers has silently disappeared from a diff.

## 17. Execution confirmation

The real, named mechanism is "high-impact-action confirmation," one of the five guardrails
AGENTS.md Rule 9 explicitly protects from being weakened without Owner sign-off. Concretely: task
creation carries a `confirmed?`/`highImpactCategory?` field (§2's `createTask()` input shape,
confirmed via PR #775's own real citation of `src/lib/services/task-service.ts:133-188`) — a
high-impact action is distinguished from an ordinary one at the point of task creation, not
retrofitted after execution starts.

## 18. Execution logging

`src/lib/audit.ts`'s `logActivity()` (§1) is the single, real, intended call site for execution logging
across every route. `mother-router.ts`'s `logRoutingDecision()` (207) logs every model-resolution
decision specifically. `engine-invocation.ts`'s `invokeEngine()` (§3) logs every engine call. All three
write inside the same transaction as the work they log, so a logging failure and a work failure are not
independently possible outcomes of the same call.

## 19. Execution traceability

Traceability runs through three real, converging records for any given piece of work: the `task.yaml`
checkpoint array (per-task, written by `veridian-task.py checkpoint`, the primary execution trace for
the task-runner layer itself — confirmed via `task-20260729-112447`'s real `checkpoints:` array with
`execution_seconds`/`restart_count` fields), the `calculationInvocations` table (per engine call, §3),
and the `InstructionContract`/`ExecutionReport` pair (per AI-team dispatch, §1). No single unified trace
ID spans all three today — a real, honest gap noted for a future OCID rather than claimed solved.

## 20. Execution audit

Two distinct, real audit layers, not one: (1) `logActivity()`-based audit rows attached to individual
data writes (§18), and (2) `src/lib/audit-event-triggers.ts`'s named-event audit creation (§10),
covering higher-level milestones (Feature Completed, SOP Changed, Deployment, Code Changed) rather than
every individual write. AGENTS.md Rule 10's mandatory-audit-check (a human/agent-asserted
`AUDIT: PASS`/`FAIL` PR comment, CI-enforced as a merge gate for any non-judgment-tier-model dispatch
branch) is a third, process-level audit layer specific to AI-team-produced code changes — distinct from
both data-layer audit mechanisms above.

## 21. Execution retry

`worker-entrypoint.sh`'s background checkpoint loop (§7) plus its `MAX_LIFETIME_INVOCATIONS=20` cap is
the real retry ceiling for a single task across restarts — confirmed via this exact task's own
`task.yaml`, which recorded a real invocation count against that cap. Systemd's own `StartLimitBurst`
provides a separate, faster-timescale restart cap on top of that slow-drip one. `webhook-deliver.ts`'s
`deliverWebhook()` retries a failed outbound webhook delivery up to 3 attempts (§10). No generic
"retry any execution N times" wrapper exists across the codebase — retry is implemented per mechanism
(worker lifecycle, webhook delivery), not centrally.

## 22. Execution recovery

`mother-router.ts`'s `rollbackPolicy()` (654) is the real, live recovery mechanism for AI-routing policy
specifically: it deactivates the current policy and reactivates a prior one inside a transaction, then
invalidates the in-process cache immediately. More generally, a hard-stop condition in `task.yaml`
(e.g. the crontab-guard pre-flight check) functions as a recovery gate — it blocks the worker rather
than silently retrying past a policy violation, forcing an explicit human/PM decision before execution
resumes (the same "blocked, not silently retried" pattern this repo's own ACTIVE-CLAIMS entries
document repeatedly, e.g. the credit-accountant rejection cited in this document's own claim entry).

## 23. Execution rollback

**Honest, real limitation**: no "down"/rollback migration pattern exists in `drizzle/*.sql` (284 files
as of this discovery pass) — schema migrations are forward-only. `scripts/check-migration-collision.mjs`
is a CI-time collision detector (same-numbered-prefix files), not a rollback tool. The one real,
live rollback mechanism found is policy-scoped (`rollbackPolicy()`, §22), not general-purpose. This
document names this gap rather than describing a rollback capability that does not exist.

## 24. Execution timeout

The real, named, deliberate timeout behavior is `quality-gate.sh`'s documented "timeout-as-failed-gate"
design (RCA-derived, confirmed in this repo's own resolved ACTIVE-CLAIMS history): a `next build` step
that times out is treated as a failed gate, not silently ignored or auto-retried past. `worker-entrypoint.sh`
and its systemd unit provide the outer timeout/memory ceiling for the process as a whole
(`MemoryHigh`/`MemoryMax`, §7); no separate, generic per-execution timeout wrapper exists inside the
application code itself.

## 25. Execution monitoring

Real, but manual/spot-check rather than continuous: `ai-os/sentinel/VIOLATIONS.yaml` and `HEALTH.yaml`
are real files whose own last entries are documented as manual spot-checks, explicitly not a
continuously-running scanner ("does not cover the full validation_rules set"). The genuinely live,
continuous monitoring on this server is infrastructure-level: the 18-timer systemd set (§8) includes a
dedicated `veridian-cron-health-check-15min` timer. Application-level execution monitoring (e.g. a
dashboard of in-flight task health) was not found as a distinct real mechanism in this discovery pass —
named as a gap, not claimed.

## 26. Execution performance

No dedicated, generic execution-performance-tracking mechanism was found; performance data that does
exist is scoped to specific mechanisms already covered above — `calculationInvocations` rows carry
timing-adjacent data per engine call (§3/§18), and `task.yaml` checkpoints carry real
`execution_seconds` per task (§19, confirmed via `task-20260729-112447`'s real checkpoint data:
`execution_seconds: 1337`). There is no cross-cutting execution-performance dashboard or SLA-tracking
layer today.

## 27. Execution reuse

The concrete, real reuse mechanisms already in production: `resolveTaskCapability()`/
`deriveCapabilityKey()` (§1) for learned task capabilities; `promoteAiAnalysisToDefinition()` (§5) for
turning a one-off AI analysis into a reusable deterministic report; `superboss-register.py
check-duplicate` (the search-before-build mechanism named directly in this task's own SPEC and in
sibling documents' discovery, e.g. PR #772's cross-referenced use of it against
`system_index`/`wiring_registry`/`capability_registry`/`knowledge_engine`) as the real gate that
prevents redundant new mechanisms from being spun up ahead of AI-metered spend.

**Honest, real limitation, stated plainly rather than glossed over**: reuse is not yet complete across
the codebase. Real, currently-coexisting duplicate/parallel paths found during this discovery pass:

- **AI model/task routing**: `mother-router.ts`'s `resolveModel()` coexists with 35 other files calling
  `model-tier-eligibility.ts`/`orchestra-model-resolver.ts`/`roster.ts`/`llm-client.ts` directly,
  bypassing the Mother Router — a documented, deliberate, still-open partial migration.
- **AI-team dispatch**: three parallel dispatch surfaces (`/api/ai/team/dispatch` HTTP route,
  `dispatch-repo.ts` repo-write path, `scripts/ai-workforce-agent.mjs` CLI/systemd path) each
  independently re-implement tier-eligibility enforcement (AGENTS.md Rule 10 names all three
  explicitly); `dispatch-repo.ts` is real code with no live caller as of this discovery.
- **Reports**: `report-engine-service.ts`'s generic dispatcher coexists with the older bespoke report
  functions it was built to replace (§5).
- **DB access**: `withTenantContext`/`app_runtime` (RLS-enforced, §29) coexists with legacy direct
  `postgres`-role `DATABASE_URL` usage in routes not yet migrated onto the wrapper.

These are named here as the real, current state of "zero-duplication execution" (§35) — a stated
principle this codebase is still converging on, not one it has already fully achieved.

## 28. Execution standardization

The real standardization mechanisms already in force: `engine-invocation.ts`'s `invokeEngine()` wrapper
(§3) is the one standard boundary every engine call passes through, regardless of which of the 32
engine files it targets. `report-engine-service.ts`'s `execution_type` enum (§5) is the one standard
shape every report definition is expressed in, regardless of whether it resolves to aggregation,
formula, AI recipe, or external passthrough. `withTenantContext` (§29) is the one standard transaction
boundary for tenant-scoped writes. Each of these is a real, adopted standard for its own layer; there is
no single execution standard spanning tasks, engines, reports, and workflows simultaneously (consistent
with §4's honest "no single WorkflowEngine class" finding).

## 29. Multi-tenant execution

`src/lib/db/tenant-scoped.ts`'s `withTenantContext()` (82 lines) is the real, AGENTS.md-Rule-9-named
guardrail: runs a transaction using the dedicated `app_runtime` Postgres role (RLS-enforced, not the
plain `postgres`-role bypass some unmigrated routes still use), setting `app.current_org_id`/
`current_client_ids`/`current_user_id` via `set_config(name, value, true)`. Its own code comment
documents a real historical bug it fixed: `SET LOCAL x = $1` is invalid Postgres syntax (throws
`42601`) — every call through the earlier `SET LOCAL ${...}` form was silently broken until corrected
to `set_config()`. Used pervasively: confirmed call sites in `task-execution-engine.ts`,
`webhook-deliver.ts`, `report-engine-service.ts`, `construction-billing-workflow-service.ts`, and
others. Not every route is migrated onto this wrapper yet (§27's DB-access duplicate-path finding).

## 30. Multi-brand execution

The real, live mechanism is `src/lib/engines/compliance-engine-registry.ts`'s `getComplianceEngine()`
(§3), which resolves execution by country/jurisdiction rather than a generic "brand" concept — India
and UAE are the two real, wired jurisdictions as of this discovery pass; any unregistered country
throws explicitly rather than silently falling through to a default. This is the concrete
implementation-level answer to "multi brand execution" as this codebase actually has it built today:
real for 2 jurisdictions, explicitly not-yet-real (loud failure, not silent gap) for any other.

## 31. Role-based execution

Role-based gating for AI-team work is real and enforced at three dispatch surfaces
(`model-tier-eligibility.ts`, §12/§27); role-based gating for end-user/organizational work is the real
subject of the Universal Organization Runtime document (PR #773, cross-referenced not duplicated here,
§0) — that document's own §4/§5 ("Role, responsibility, and rights model," "Approval, limit, delegation,
transfer, and succession model") is the authoritative source for the org-role execution model this
document's engines consume as an input, not re-derive.

## 32. Zero-duplication execution

Restated plainly: this is a real, actively-pursued principle (`superboss-register.py check-duplicate`,
§27), not a fully-achieved state. §27 lists the concrete, currently-coexisting duplicate paths found
during this discovery pass. This document itself follows the principle it describes — it amends the
existing UMR chain and canonical-artifact index rather than creating new ones (§0/§35), and it
cross-references rather than re-derives the decision, escalation, org, and sync content already real in
sibling open PRs.

## 33. End-user transparency

The real, concrete transparency mechanisms already wired: `audit.ts`'s `logActivity()` rows are visible
through this application's own audit/history UI surfaces (out of this document's scope to re-derive —
see the End User Experience Foundation document, OCID-022, for the UI-facing transparency model); task
status is directly queryable via the same `task.yaml`/API surfaces this document's own engines write to.
This document does not introduce a new transparency mechanism — it names the existing one so a future
implementer does not build a second one.

## 34. Execution governance

Governance of execution itself runs through the same constitutional layer as everything else in this
codebase: `ai-os/CONSTITUTION.yaml`'s `SEC-07` (lines 652-656) is the real, current lock — real
implementation, gap closure, production changes, completion certification, and platform freeze under
the ERP Functional Completeness Master Program and specifically OCID-038/039/040 stay locked until
OCID-020 is independently verified complete. `SEC-07`'s own stated mechanism is honest about its limit:
"organizational/process gate today, not a runtime-enforced check" — the same class of limitation as
AGENTS.md Rule 9's guardrail-presence check and Rule 10's mandatory-audit-check. This document, being
documentation-only, is explicitly permitted to proceed under `SEC-07` (which locks implementation, not
discovery/documentation) — the same basis every sibling document in this OCID-022 through 040 chain has
relied on.

## 35. Execution certification and readiness for OCID-032

**No certification is claimed here.** Consistent with `SEC-07` and every sibling document in this
chain, this document does not certify that VERIDIAN's execution layer operates as one integrated,
gap-free system — §21/§23/§25/§26/§27 above each name real, honest gaps (no generic retry wrapper, no
migration rollback, spot-check-only monitoring, no cross-cutting performance dashboard, coexisting
duplicate execution paths) rather than a completed state.

**Readiness for OCID-032** (per this document's own SPEC, "readiness for OCID-032" is a required
closing section): this document hands off a grounded execution-mechanics map — task/function/workflow/
report/analysis/background/scheduled/event-driven execution, queueing, dependency/parallel/sequential
ordering, validation/confirmation/logging/traceability/audit, retry/recovery/rollback/timeout,
monitoring/performance, reuse/standardization, multi-tenant/multi-brand/role-based execution, and
governance — as the real, current baseline for whatever OCID-032 (per
`VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s table, "VERIDIAN Universal End User Work
Orchestration Runtime v1.0") builds on next. OCID-032's own worker should cross-reference this
document's §11-§15 (queueing/priority/dependency/parallel/sequential execution) rather than re-derive
them, per the same zero-duplication principle this document itself follows (§32). Real implementation
of any gap named above remains locked behind `SEC-07`/OCID-020 exactly as it does for every other
document in this chain.

Canonical artifact created: this file. Amends the existing UMR chain
(`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`) and canonical-artifact index (`ai-os/OS.yaml`); does not
start a new one.
