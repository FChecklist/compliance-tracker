# AI Escalation Matrix — What's Actually Wired

**Written 2026-07-14, Priority 12 (OPEN-07 point 10).** `Consutitution.docx`'s
"AI Escalation Matrix" (`ai-os/audit-tree/01-consutitution.yaml` lines 70-101)
describes escalation as one unifying artifact — a single ladder any AI agent
climbs when it can't handle something. The real codebase has no such single
mechanism. It has **5 independently-built, independently-triggered systems**
that each do a piece of what "escalation" means, built in different waves for
different reasons, with no shared arbiter between them.

This document is a reference, not a redesign: it names each mechanism, states
in plain language what triggers it and what it does when triggered, cites
real call sites (verified by grep against this repo, not assumed from a
header comment), and is explicit about where the 5 do **not** talk to each
other. Nothing here changes any of the 5 files.

---

## 1. `escalation-ladder.ts` — task-failure authority ladder

**File:** `src/lib/escalation-ladder.ts`

**What it is:** a 3-rung executive ladder — CSEO (Chief Software Engineering
Officer) → COO (Chief Operating Officer) → Super Boss — for a task-execution
failure that needs a human-authority-equivalent AI role to look at it. Level 5
(the Owner) is human and outside this module's reach by construction; Super
Boss is the highest AI-reachable rung.

**What triggers it:** a caller passes an `EscalationReason` (e.g.
`engine_not_found`, `engine_execution_failed`, `worker_agent_unavailable`,
`package_execution_failed`, `budget_limit_hit`, `loop_limit_hit`,
`monitoring_rule_violation`, `low_confidence_closure`, `critical_risk_closure`)
to `nextEscalationRung()`. Software-shaped failures (engine/worker/package
defects) start at CSEO; everything else (policy/governance-shaped triggers)
starts at COO.

**What happens:** `nextEscalationRung()` alone is pure — it just returns which
rung to escalate to. The stateful half, `claimEscalation()`, persists a
single-owner lock + retry/timeout counter per `(org, task, monitor)` in
`monitor_task_state`: a claim is accepted, rejected as
`already_owned_by_other_agent` if a different agent already owns it (unless
stale past `timeoutMs`), or rejected as `retry_exhausted` once `maxRetry` is
hit — "no infinite retry, no infinite escalation."

**Real callers, verified:**
- `src/lib/task-execution-engine.ts` calls `nextEscalationRung()` directly (no
  persisted claim) at 4 sites: chain monitoring-rule violations, structured
  dispatch-tool failures (`worker_agent_unavailable`), VCEL engine dispatch
  failures (`engine_not_found`/`engine_execution_failed`), and instruction-
  package execution failures (`package_execution_failed`).
- `src/lib/monitors/dispatch-completion-monitor.ts` and
  `src/lib/monitors/approval-decision-monitor.ts` both call the full
  `claimEscalation()` (persisted lock) with reason `monitoring_rule_violation`.
- `src/lib/guardrail-registrations.ts` uses `nextEscalationRung()`'s rung
  title/authority text only, to compose a rejection message for a low-
  confidence or critical-risk closure — it never calls `claimEscalation()`,
  so no actual lock/retry-counter claim happens at that call site. Referenced,
  not claimed.

---

## 2. `floor-tier-escalation.ts` — per-chat-call model escalation

**File:** `src/lib/floor-tier-escalation.ts`

**What it is:** a deterministic, regex-based bump from the platform floor-
tier model (GPT-OSS-120B, cheap/fast) to a stronger model for **one single
LLM call**, when a signal suggests the floor tier can't be trusted for that
call. Reserved for floor-tier calls only — never overrides an org's own BYO
model.

**What triggers it:**
- Pre-call (`checkPreCallEscalation()`): the user is re-asking/correcting a
  prior answer, the action is flagged high-impact, a prior task already
  failed, or (a 5th, proactive signal used directly by callers rather than
  through this function) the request classified as `NOVEL` with no approved
  instruction package.
- Post-call (`detectLowConfidenceResponse()`): the floor tier's own reply
  hedges ("I'm not sure", "I cannot determine", etc.).

**What happens:** unlike the other 4 mechanisms, this one does not route to a
different role or persist any state — the caller swaps `effectiveConfig` to
`escalatedPlatformConfig()` and **re-runs the same call** on the stronger
model. Verified real call sites: `src/lib/services/chat-service.ts` (pre-call
gate before the first reply, post-call retry on a hedging reply) and
`src/lib/task-execution-engine.ts` (pre-call gate before planning starts,
post-call retry in `executePackageDispatch()`).

---

## 3. `model-tier-eligibility.ts` — static dispatch-time trust gate

**File:** `src/lib/model-tier-eligibility.ts`

**What it is:** the odd one out of the 5 — not a reaction to a failure at
all, but a static allowlist checked **before** a task is ever dispatched.
Every model is mechanical-tier eligible; only a fixed, hand-maintained set is
integrative-eligible, and a smaller set is judgment-eligible
(`z-ai/glm-5.2`, `openai/gpt-5.5`). Default posture is most-restrictive —
a new model in `roster.ts` earns broader eligibility only via a deliberate
code change.

**What triggers it:** `checkTierEligibility(model, tier)` is called at
dispatch time, before a role/model is assigned to a task.

**What happens:** if the model isn't eligible for the task's complexity tier,
the caller gets an `{ eligible: false, reason, guidance }` result instead of a
dispatch. Separately, `requiresMandatoryAudit(model)` flags any non-judgment-
eligible model's output as requiring a mandatory audit — the CI enforcement
for AGENTS.md's "doer != auditor" rule.

**Real callers, verified:** `src/lib/ai-team/dispatch-repo.ts` and
`src/app/api/ai/team/dispatch/route.ts` both call `checkTierEligibility()` at
the actual dispatch layer; `src/lib/ai-team/agent-directory-service.ts` calls
`isModelEligibleForTier()`/`requiresMandatoryAudit()` to annotate directory
listing data, not to gate a live dispatch.

---

## 4. The Auditor → Higher-AI loop

**File:** `src/lib/services/capability-audit-service.ts`

**What it is:** the mechanism that's supposed to notice a capability that
keeps needing AI reasoning and ask whether it's closable in software. Its own
header comment explains the design in detail; the short version:
`shouldAuditCapability()` gates the Auditor (the existing `chief_audit_officer`
role) to look at a given `(capability, version)` pair **at most once**; if the
Auditor says the gap is software-closable, `dispatchProposalToHigherAI()`
routes a `TightTask` to an engineering role (integrative-tier only) via
`dispatch-repo.ts`'s `repository_dispatch`.

**What triggers it:** a call to `runCapabilityAudit(capabilityId)`.

**The honest, load-bearing caveat:** as of this writing, **`runCapabilityAudit`
has zero real callers anywhere in the deployed app** — no cron job, no API
route, no other service invokes it. `vercel.json`'s cron list has jobs named
`audit-cadence/run` and `secrets-audit/run`, neither of which touches this
function. This is not a design flaw this doc is introducing — it's the exact,
pre-existing gap `ai-os/MASTER-TRACKER.yaml`'s OPEN-07 entry names as point
(4)/point (A). Wiring a real trigger (a cron via `/api/ai/team/dispatch`) is
separate, in-progress Priority 12 work owned directly by the Super Boss
session, not part of this document or this PR. Until that lands, this
mechanism is real, tested code that nothing in production actually calls.

Separately: this loop **never calls `escalation-ladder.ts`** at all — no
`nextEscalationRung()`, no `claimEscalation()`. Its own "escalation" (Auditor
→ Higher AI) is a completely separate code path with its own state
(`needsImprovement`, `capability_improvement_proposals.status`), not a rung on
the CSEO/COO/Super-Boss ladder.

---

## 5. `dispatch-completion-monitor.ts` — fail-closed pattern

**File:** `src/lib/monitors/dispatch-completion-monitor.ts`

**What it is:** a Tier-3 (GPT-OSS-120B-backed) monitor that watches AI Dev
Team dispatches stuck in a non-terminal `lifecycle_stage` past a threshold
(`listStuckActivities()`) and classifies whether each one looks genuinely
complete or abandoned.

**What triggers it:** `runDispatchCompletionSweep()` running over every stuck
`activity_log` row.

**What happens:** one model call classifies the dispatch into a
`MonitorReportFields` shape (`status: "ok" | "escalate"`, etc.), run through
the same `validateMonitorReportFields()` gate every Tier-1 monitor report
goes through. The fail-closed pattern worth naming explicitly: **any** failure
mode — no platform model configured, an HTTP/network error, malformed JSON,
or a well-formed-but-invalid report — is treated identically and forced to a
synthetic `status: "escalate"` report. Nothing is ever silently dropped or
silently treated as "fine." A genuine or forced `escalate` status then calls
`claimEscalation()` (escalation-ladder.ts's own persisted single-owner lock)
with reason `monitoring_rule_violation` — this is the one mechanism, of the
5, that actually calls into mechanism #1 directly.

---

## Where these do **not** connect

This is the part the source doc's "one Escalation Matrix" framing glosses
over. Concretely, verified against real code, not assumed:

1. **Only #5 (dispatch-completion-monitor) actually calls #1
   (escalation-ladder)'s persisted claim.** Mechanisms #2 (floor-tier),
   #3 (model-tier-eligibility), and #4 (Auditor loop) never call
   `claimEscalation()` or `nextEscalationRung()` at all. Four conceptually
   related "escalation" systems, three of which have zero code-level
   awareness that the ladder even exists.

2. **The Auditor → Higher-AI loop (#4) and the executive ladder (#1) are
   fully independent state machines that can both be "escalating" the same
   underlying capability with no arbitration between them.** A capability
   that's both being audited (`needsImprovement: "in_progress"`) and hitting
   repeated task-execution failures (which route through #1's
   `package_execution_failed`/`engine_execution_failed` reasons) has two
   unrelated escalation threads running in parallel — nothing cross-checks
   one against the other, and nothing would stop, say, CSEO being escalated
   to on the same capability the Auditor already dispatched to an engineering
   role for.

3. **Two of the 5 mechanisms can fire on adjacent failure branches of the
   very same function with no shared arbitration.**
   `task-execution-engine.ts`'s `executePackageDispatch()` is the concrete,
   verified example: a hedging-but-successful package response triggers
   floor-tier escalation (#2, retry on a stronger model); a thrown exception
   from the same package execution instead triggers `nextEscalationRung()`
   (#1, `package_execution_failed`). These are sequential/alternative
   branches of one function (not literally the same event firing twice), but
   there is no single file that decides, for a given failure shape, which of
   the 5 mechanisms should own it, in what order, or whether more than one
   legitimately should.

4. **#3 (model-tier-eligibility) is a pre-dispatch gate, not a reactive
   escalation at all.** It's included here because the source doc's
   "Escalation Matrix" framing and this codebase's own `EscalationReason`
   naming treat trust/tier decisions as part of the same governance family,
   but structurally it answers a different question ("may this model even
   attempt this?") than the other 4 ("something already went wrong, who
   handles it now?"). Grouping it with the other 4 under one "Escalation
   Matrix" heading is a framing choice, not a code-level integration.

5. **#4's real-world reachability gap compounds all of the above.** Since
   `runCapabilityAudit()` has no live caller yet (see §4), the Auditor →
   Higher-AI thread of "escalation" is currently theoretical in production —
   any apparent gap in how it interacts with #1/#2/#3 is moot until it's
   actually triggered by something.

**Bottom line:** there is no single `resolveEscalation()` entry point, no
shared "escalation event" type, and no arbiter file. Each of the 5 mechanisms
is real, independently useful, and does what its own header comment says —
but "AI Escalation Matrix" as one unified system, in the sense the source doc
describes, does not exist in this codebase today. This document is the
closest thing to that single reference point, and it is deliberately a
cross-reference, not a claim that the underlying systems are unified.
