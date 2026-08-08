# VERIDIAN Universal End User Work Orchestration Runtime v1.0

**OCID:** OCID-20260803-033 (this document's own task/branch label; see the numbering note in
§0.2 below for why this document does not simply trust the OCID number printed against this
title in `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s current table).
**UMR (this directive):** `UMR-20260803-055114` (task registration timestamp; parented per the
directive text to `UMR-20260803-041743-d271`, cited as "the real OCID-032 directive just
registered").
**Citing:** `UMR-20260803-040844-4a33` (OCID-022) · `UMR-20260803-040929-9713` (OCID-023) ·
`UMR-20260803-041000-70ae` (OCID-024) · `UMR-20260803-041047-03ee` (OCID-025) ·
`UMR-20260803-041122-b22d` (OCID-026) · `UMR-20260803-041211-b7b7` (OCID-027) ·
`UMR-20260803-041257-e9c3` (OCID-028) · `UMR-20260803-041351-0278` (OCID-029) ·
`UMR-20260803-041459-7c97` (OCID-030) · `UMR-20260803-041700-a741` (OCID-031) ·
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program) ·
`UMR-20260802-165606-4413` (OCID-020) · `UMR-20260802-164659-9a31` (server artifact
traceability audit) · `UMR-20260802-165034-5747` (the gatekeeper rule) ·
`UMR-20260802-165434-cd91` (the unified project memory).

**Type:** Documentation only. No code, no new database objects, no new architecture. This
document defines orchestration principles and cross-references real, already-built mechanisms;
it does not build anything.

**Status:** Draft, subject to the same `SEC-07` implementation lock (`ai-os/CONSTITUTION.yaml`)
as every other document in this chain — real implementation of anything described here stays
locked behind OCID-020's independent verification, then OCID-038, then OCID-039, in that order.
Nothing in this document unlocks or bypasses that gate.

---

## 0. How this document was produced

### 0.1 Mandatory discovery performed (zero-duplication check)

Before drafting, this task independently searched `src/lib/`, `src/app/api/`, `ai-os/`, and the
open-PR branches for OCID-022 through OCID-031 (nine documents: PRs #765–#768, #771–#775 as of
this writing) to confirm what already exists and avoid restating it. Real findings, with file
paths:

- **Task engine / task lifecycle:** `src/lib/services/task-service.ts` (status transitions,
  high-impact-action confirmation, dedup indexing, approval kickoff), `src/lib/db/schema.ts`
  (`tasks` table — status/priority/dueDate columns), `src/lib/task-tightening.ts` (ambiguity
  gate). Fully specified at the state-model level by OCID-023 (§5 state model, §7 assignment,
  §8 delegation, §9 transfer, §10 approval, §11 escalation, §12 completion, §13 reopen, §23 task
  notifications, §29 task recovery) — this document does **not** redefine any of these; it
  cross-references OCID-023 throughout.
- **Reprioritization:** `src/lib/services/task-reprioritization-service.ts` — real, but honestly
  implements only 1 of 8 intended axes (deadline proximity/overdue); the other 7 (SLA,
  dependency, business-risk, etc.) have no real backing columns yet. `task-nudge-digest-service.ts`
  batches overdue nudges. `task-prediction-service.ts` predicts completion time from historical
  velocity (deterministic, not ML).
- **Pending-work aggregation:** `src/lib/services/veri-todo-service.ts` (unions
  `tasks` + `instructionCommitments` + `pmsIssues` into one Home view), surfaced via
  `src/app/api/home/todos/route.ts`. `src/lib/services/work-dashboard-service.ts` /
  `src/app/api/work-dashboard/route.ts` aggregates tasks/compliance_items/tickets/
  approval_requests into 6 Tree-1 categories — explicitly **not** a unified Work Object (a prior,
  already-ratified decision, `DEC-03`).
- **Decision engine:** no single file; realized as the composition of
  `src/lib/ai-router/mother-router.ts` (model/provider routing + audit log — self-audited
  2026-07-20 as covering roughly 35 of its intended call sites, not all), `src/lib/llm-routing-gate.ts`
  (deterministic-intent-first gate), `src/lib/intent-engine.ts`. Named and specified as the
  "Universal Decision Engine" by OCID-030, including its own §4 (predictive decision model —
  model-inference-on-unstructured-input, fallback tier only) and §9 (when software asks the
  user — the actual next-best-action-adjacent territory). This document cross-references
  OCID-030 rather than restating its decision model.
- **Execution/workflow engine:** `src/lib/task-execution-engine.ts`, `src/lib/engines/grc-workflow-engine.ts`,
  `src/lib/services/approval-workflow-service.ts` (entity-agnostic maker-checker, configurable
  multi-step approval), plus per-module workflow services (procurement, construction billing/field).
- **Rule/policy engine:** `src/lib/policy-enforcement-engine.ts` (deterministic pre-LLM keyword
  gate), `src/lib/business-rule-validator.ts`, `src/lib/module-rules-resolver.ts`,
  `src/lib/abac.ts` / `abac-policy-service.ts`, `src/lib/guardrail-engine.ts`.
- **Notification engine:** no dedicated "engine" file — the real, single, reused mechanism is the
  `notifications` table (`src/lib/db/schema.ts`, enum `deadline_reminder | assignment |
  status_change | comment | system | mention | instruction_mismatch`), written by
  `task-service.ts` (overdue → `deadline_reminder`), `tasks/[id]/comments/route.ts`,
  `metric-alert-service.ts`, `task-nudge-digest-service.ts`; read via
  `src/app/api/notifications/route.ts` and `.../[id]/read/route.ts`. Push notifications
  (browser/service-worker push) are confirmed **not built** anywhere (OCID-025 §26).
- **Chat orchestration / VERI Chat / VERI Assistant:** `src/lib/services/chat-service.ts`
  (deterministic-routing-gate → LLM fallback, PII redaction, purpose-bound gating),
  `src/lib/services/veri-chat-service.ts` (context-linking, attachments, share-out/share-in),
  `src/components/veri-chat/` (`VeriComposer.tsx`, `ChainSelector.tsx`,
  `veri-chat-context.tsx`, `IntentCommandPalette.tsx`). "VERI Assistant" is documented elsewhere
  in this repo's own governance trail as an internal routing-migration workstream name, not (yet)
  a distinct end-user-facing product surface separate from VERI Chat — this document treats VERI
  Chat as the real, live surface and does not invent a second one.
- **Mode pills / option chain:** "Mode pill" is a real, live code concept — the fixed top-level
  mode buttons in `ChainSelector.tsx` / `capability-tree-service.ts` (`FIXED_MODES`,
  `byModePill`), with usage tracked by `adoption-metrics-service.ts`'s
  `computeModePillUsageRate()`. "Option chain" is **not** a `src/` code term; it is this OCID
  series' own name (OCID-024 §15, OCID-025 §13, OCID-026, OCID-028 §9) for what the code calls
  the Chain Selector — the cascading path picker that follows a mode-pill choice. This document
  uses "option chain" only as a synonym for the real Chain Selector, per that established
  mapping, and does not invent a new component.
- **Multi-device/session continuity, interruption recovery:** no dedicated module exists.
  `src/lib/supabase/auth-guard.ts` enforces `activeSessionCount` (a session *limit*, not
  recovery). `WorkspaceMemorySection.tsx` / `ai-os/priority21_workspace_memory_design.md` is the
  closest existing design artifact. OCID-025 §25 ("Session recovery") and OCID-028 §25–28
  ("End user device switch," "Chat continuity," "Task continuity," "UMR continuity") already
  document, precisely, what is real (durable-row continuity: a task/chat/UMR record itself is
  the same record from any device, because it lives server-side) versus what is not real
  (in-flight/unsaved draft state, or a cross-device recall of *where in a chain the user was*).
  This document does not re-derive that finding; it treats OCID-025/028 as the authority on the
  mechanism and adds only the end-user-facing orchestration promise layered on top (§17–19
  below).
- **`MASTER-TRACKER.yaml` / `IMPLEMENTATION_MATRIX_2026-08-02.md`:** no existing entries for
  "work orchestration," "next best action," "predictive work," or "assignment engine" — this is
  genuinely new documentation ground at the tracker level. No phrase match anywhere in `src/` or
  `ai-os/` for "next-best-action," "prioritization engine," "follow-up engine," or "minimum
  clicks" prior to this document. "Zero cognitive load" is explicitly flagged as an
  Owner-directive phrase absent from the code/governance trail in three prior docs (OCID-024
  §29, OCID-025 §31, OCID-030 §26), grounded there only in the Chain Selector + Invite-icon
  pattern — this document treats that finding as already-established and does not restate the
  investigation, only the conclusion (§28 below).

### 0.2 Numbering note

`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s table (as last amended by merged
PR #776) currently lists OCID-032 against this exact title ("VERIDIAN Universal End User Work
Orchestration Runtime v1.0"). That snapshot document has an independently confirmed,
already-corrected-twice systemic off-by-one drift in its own row numbering for the 026–030 range
(PR #776, citing PM decision `UMR-20260803-052107-71fa`) — in every prior case, the individual
task's own directive/branch/task-directory label was confirmed correct and the snapshot table was
the thing that was wrong. This task's own directive and its own task directory
(`task-20260803-055114-ocid-033-veridian-universal-end-user-wor`) agree with each other on
"OCID-033" for this exact title, and this task's own directive separately and explicitly cites a
distinct parent, "the real OCID-032 directive just registered" (`UMR-20260803-041743-d271`),
which is not the same as this document's own content. Per the established pattern, this document
proceeds as OCID-033 and flags the snapshot table's row 032/033 pair as needing the same class of
correction as a follow-up — not a blocker for this task. This note is registered in
`ai-os/boss/ACTIVE-CLAIMS.yaml` under this session's claim.

### 0.3 What "orchestration" means in this document

Every mechanism cited above already exists as a **capability**. What does not yet exist anywhere
in this repo's governance trail is a single document naming the **continuous, end-to-end
sequencing** of those capabilities from the end user's point of view — the promise that,
whatever the user does next, VERIDIAN has already surfaced the most important thing for them to
look at, without them having to go find it. That promise, and only that promise, is this
document's real subject. Every section below is either (a) a naming/sequencing layer over a real,
cited mechanism, or (b) an explicit, honestly-labeled gap.

---

## 1. Work orchestration principles

1. **Software decides first, asks only when necessary.** Consistent with OCID-030 §6–9: routine
   prioritization, reminders, and follow-up are deterministic (rule/data-driven), not
   LLM-generated per-request. The AI layer (VERI Chat, judgment-tier dispatch) is invoked only
   where the decision genuinely requires natural-language understanding or judgment, per
   OCID-026 §17–20 and OCID-030 §10–11's escalation rules — this document does not change those
   rules, it names where each participates in the orchestration sequence.
2. **One user, one worklist, many sources.** The user-facing surface for "what do I do next" is
   the existing `veri-todo-service.ts` union (tasks, instruction commitments, PMS issues) and the
   existing `work-dashboard-service.ts` 6-category rollup — not a new, competing worklist. Any
   future orchestration feature must render through these, not around them.
3. **Every task continues until completion or an explicit, recorded stop.** Ownership,
   state transitions, and what "done" means are OCID-023's domain (§5, §12–13); this document
   only adds the promise that the *system*, not the user, is responsible for noticing what needs
   to happen next along that lifecycle.
4. **Real gaps are named, not hidden.** Where no real mechanism exists yet (predictive work
   presentation beyond deterministic velocity, cross-device draft-state recall, push
   notifications), this document says so explicitly rather than describing an aspirational
   system as already built. See §31 for the consolidated gap register.

---

## 2. What the user sees first

The Home surface (`src/app/api/home/todos/route.ts` → `listVeriTodos()`) is, today, the real
"what do I see first" answer: the union of open tasks, instruction commitments, and PMS issues
assigned to or watched by the user, ordered by the one real prioritization axis that exists
(§4). `work-dashboard-service.ts`'s 6-category view is the secondary, cross-type-aggregate
answer for "what's on my plate across the whole platform." Orchestration principle: these two
existing surfaces, not a new dashboard, are where "sees first" is realized — any future work
should extend their ordering logic, not build a parallel landing surface.

## 3. What the user never sees

By design, the user does not see: raw AI-router provider/model selection (`mother-router.ts`'s
routing decision is internal), policy-enforcement-engine keyword-gate internals, guardrail-engine
validation internals, or the mechanics of which deterministic rule vs. which AI tier produced a
given task/notification. The user sees the *outcome* (a task, a notification, a chat answer) — the
routing and gating machinery behind it stays invisible per OCID-026's software-first model. This
is a naming statement, not a new requirement: it describes what OCID-026/030's existing
architecture already keeps hidden.

## 4. Next best action

No file, function, or documented mechanism named "next best action" exists anywhere in this
codebase or governance trail (confirmed by discovery, §0.1) — this is a genuine gap, not a
renamed existing feature. The closest real, deterministic building blocks toward it are:
`task-reprioritization-service.ts`'s single live axis (deadline proximity/overdue),
`task-prediction-service.ts`'s velocity-based completion estimate, and OCID-030 §9's "when
software asks the user" ambiguity-clarification model. A true next-best-action surface (ranking
across all open work by urgency + impact + user context, in one line, one click away) does not
exist and is not implemented by this document. Named here as an explicit target for OCID-034 and
beyond (§32), built from these existing primitives rather than a new ranking engine invented from
scratch.

## 5. Automatic task prioritization

Real today: one axis, deadline proximity/overdue, via `task-reprioritization-service.ts`,
surfaced through `task-nudge-digest-service.ts`'s batched nudges. Honestly not real: the other 7
axes (SLA, dependency chains, business risk, financial exposure, etc.) named in the original
8-axis intent have no backing data columns yet. Orchestration principle: as those axes get real
backing columns (an implementation task, not this document), they compose into the same single
prioritization surface named in §2 — this document does not authorize inventing a second,
competing prioritization mechanism.

## 6. Pending work discovery

Real and already unified: `veri-todo-service.ts`'s three-source union is the actual
"discover everything pending" mechanism. Orchestration principle: any new work-item type
(a new table, a new module) must register into this union at creation time, not require the user
to separately go looking in that module's own screen — this is the concrete meaning of
"the user never has to think about what to do next" for discovery specifically.

## 7. Predictive work presentation

"Predictive" in this codebase means one of two real, deterministic things (confirmed by
discovery): `task-prediction-service.ts`'s historical-velocity completion-time estimate, and
OCID-030 §4's model-inference-on-unstructured-input decision tier (VERI Chat free text, task
planning). Neither is an anticipatory "here's what you'll need before you ask" UX layer. That
layer does not exist. This document names it as a real gap (§31), not as something already
delivered under a different name — a prior mistake this OCID series has already made and
corrected twice (OS status-snapshot mislabels, §0.2) is exactly the failure mode of describing a
different mechanism as though it satisfies a new ask; this section deliberately avoids repeating
that pattern.

## 8. Automatic reminders

Real: the `notifications` table's `deadline_reminder` type, written by `task-service.ts` on
overdue detection, batched by `task-nudge-digest-service.ts` so a user gets one digest rather than
one notification per stale item. Orchestration principle: reminders are a rendering/timing layer
over this existing writer — this document does not introduce a second reminder-generation path.

## 9. Automatic follow up

Real, partial: `task-nudge-digest-service.ts` is the closest real "follow up on stale work"
mechanism, scoped to overdue tasks. No equivalent exists yet for stale instruction commitments or
stale PMS issues inside the same digest — named here as a real, scoped gap (extend the existing
digest's source union to match `veri-todo-service.ts`'s three sources, not build a second
follow-up mechanism).

## 10. Automatic assignment

Owned by OCID-023 §7 (assignment) at the task-state-model level. This document adds no new
assignment mechanism; it names assignment as one of the inputs the Home/work-dashboard surfaces
(§2) must reflect immediately — an assignment change is only "orchestrated" if it shows up in the
recipient's existing worklist without their needing to search for it, which is already how
`veri-todo-service.ts`'s query is structured (assignee-scoped).

## 11. Automatic reassignment

Owned by OCID-023 §9 (transfer) and OCID-029 §5 (the organization-structure lens on delegation/
transfer/succession — role- and org-hierarchy-driven reassignment, e.g. on exit or role change).
This document cross-references both rather than defining a third reassignment model; the
orchestration promise is the same as §10 — a reassigned item must disappear from the old owner's
worklist and appear in the new owner's, atomically, via the shared underlying record, not via a
separate notification the user has to act on to "accept" the handoff.

## 12. Automatic delegation support

Owned by OCID-023 §8 (delegation) and OCID-029 §5 (org-level delegation authority — who may
delegate what, and within what limits). This document's only addition: delegated work must
appear in the delegate's worklist through the same `veri-todo-service.ts`/`work-dashboard-service.ts`
surfaces used for directly assigned work, not a separate "delegated to me" screen the user must
remember to check.

## 13. Approval orchestration

Owned mechanically by `approval-workflow-service.ts` (entity-agnostic maker-checker,
configurable multi-step approval) and, at the UX level, by OCID-022 §2.4 (the existing
high-impact-action confirmation experience) and OCID-023 §10 (task-level approval state).
Orchestration principle: a pending approval is pending *work* like any other, and must surface
through the same worklist (§2), not a separate approvals inbox the user has to remember exists
— reusing `work-dashboard-service.ts`'s existing `approval_requests` category, which already
exists precisely for this reason.

## 14. Deadline orchestration

Real: `dueDate` on `tasks`, surfaced through `task-reprioritization-service.ts`'s one live axis
and `task-nudge-digest-service.ts`'s reminders (§8). Orchestration principle: a deadline is not
"orchestrated" merely by existing as a column — it is orchestrated when it changes the item's
position in the worklist (§5) and triggers a reminder (§8) without a separate manual step. Both
halves already exist and are already wired to each other; this section names that existing wiring
as the deadline-orchestration model rather than proposing a new one.

## 15. Document orchestration

No dedicated document-orchestration engine exists. Real, adjacent mechanisms: attachment handling
in `veri-chat-service.ts` (context-linking, attachments, share-out/share-in) and OCID-024/025's
attachment-input sections. Orchestration principle for documents: a document attached to a task or
chat thread must remain reachable from that same task/thread on any device (per OCID-028's
durable-row continuity model, §17 below), not require the user to re-locate it via a separate file
browser. This is a naming layer, not a new storage or versioning mechanism.

## 16. Report orchestration

No dedicated report-orchestration engine exists; report generation/discovery is OCID-026/027's
domain (function/report/analysis discovery and reuse-before-build). Orchestration principle: a
generated report is *work output*, and its existence/readiness should surface as a notification
(§8's mechanism) to whoever requested it, rather than requiring the requester to poll a reports
screen — this is a rendering-target statement, not a new report engine.

## 17. Chat orchestration

Owned by `chat-service.ts` / `veri-chat-service.ts` and specified end-to-end by OCID-024/025
(chat execution on each surface) and OCID-028 §26 (chat continuity across devices — the same
conversation record is reachable from any device, because it is a durable server-side row).
Orchestration principle added here: a chat thread that produced a task, an approval, or a
document should be reachable *from* that resulting artifact (a "how did this get created" trail),
not only in the other direction — consistent with OCID-023's existing §18 (chat) and §19
(decisions) task-artifact linkage, which this document reuses rather than duplicates.

## 18. VERI Assistant orchestration

As found in discovery (§0.1), "VERI Assistant" is documented elsewhere in this repo as an
internal routing-migration workstream name rather than a distinct, separately-orchestrated
end-user product surface today. This document does not invent a second assistant surface
alongside VERI Chat; it treats VERI Chat (§17) as the one real orchestration surface for
conversational work, and flags "VERI Assistant" as a naming question for a future OCID
(potential OCID-034+ scope) rather than silently assuming it already exists as something
separate.

## 19. AI escalation orchestration

Fully specified by OCID-026 §17–20 (software-completes vs. escalates, when AI is allowed/
prohibited) and OCID-030 §10–11 (when AI is escalated or prohibited at the decision-engine
level). This document adds no new escalation rule; the orchestration promise is only that an
escalation, once triggered, produces a visible, trackable work item (a task or notification) in
the same worklist as everything else (§2) — escalating to AI must not create an invisible,
untracked side channel.

## 20. Multi device continuity

Owned by OCID-028 §25 (end user device switch). Real: durable server-side records (a task, a
chat message, a UMR) are the same record regardless of which device reads them — continuity is a
property of the storage model, not a separate sync feature. Honestly not real: in-flight,
unsaved draft state (a half-typed chat message, a partially filled form) does not survive a device
switch, per OCID-028's own finding. This document's orchestration promise is scoped to what is
actually true: *completed and saved* work continues seamlessly across devices today; *in-progress,
unsaved* input does not, and is named as a real gap (§31), not glossed over.

## 21. Multi session continuity

Distinct from device continuity: `src/lib/supabase/auth-guard.ts`'s `activeSessionCount`
enforcement is a session *limit*, not a continuity guarantee — it caps concurrent sessions, it
does not carry state between them. No mechanism exists to resume a specific in-progress
interaction (e.g., an open Chain Selector step) from one session in another. Same honest
boundary as §20: durable records persist across sessions by construction; transient
in-session state does not, and this document names that as a gap rather than a delivered
feature.

## 22. Interruption recovery

Confirmed by discovery and by OCID-025 §25 as **NOT_YET_BUILT**: closing the app/tab mid-task, or
losing connectivity mid-input, does not currently preserve draft state anywhere client-side.
`WorkspaceMemorySection.tsx` / `ai-os/priority21_workspace_memory_design.md` is the nearest
existing design artifact toward this, but it is a design, not a shipped mechanism. This document
records interruption recovery as a real, named gap for future implementation (§31), consistent
with OCID-025's own honest finding — it does not claim this is solved.

## 23. Zero lost work

Split honestly into two halves, matching §20–22: **saved** work (a submitted task, a sent chat
message, a completed approval step) is never lost — it is a durable database row, already
protected by the same persistence guarantees as every other table in `src/lib/db/schema.ts`.
**Unsaved, in-progress input** (a draft) can be lost today on interruption or device switch, per
§20 and §22. "Zero lost work" as a full end-user promise is therefore not yet true; it is true
today only for the "saved" half. This document does not round that up to a completed guarantee.

## 24. Zero duplicate work

Two distinct meanings, both already real: (a) **artifact-level** zero-duplication — OCID-026/027's
search-before-build discovery model, which this document itself followed in §0.1 before
drafting; (b) **task-level** zero-duplication — `task-service.ts`'s dedup indexing, which
prevents the same real-world request from creating two separate task rows. Orchestration
principle: both already exist and are not modified here; this section only names them as the two
things "zero duplicate work" refers to, so a future reader does not conflate them.

## 25. Role based work presentation

Owned by OCID-029 §3–4 (people model, role/rights) for *who can see what*; `abac.ts` /
`abac-policy-service.ts` enforce it mechanically. Orchestration principle: the same worklist
surfaces named in §2 apply role-based filtering at the query layer (assignee/visibility scoping
already present in `veri-todo-service.ts`'s query), not via a second, role-specific worklist
implementation per role.

## 26. Personalized workspace

Real, partial: Home's todo union (§2) is already personalized by assignment/watch relationship.
No further personalization (layout preference, pinned items, custom ordering beyond the one
deadline axis) exists today. Named as a real, bounded gap rather than claimed as delivered.

## 27. The minimum clicks model

No file or doc uses this exact phrase prior to this document (confirmed by discovery). The real,
existing mechanism closest to it is the Chain Selector / option-chain pattern itself (OCID-024
§15, OCID-026): a single mode-pill choice cascades through a pre-narrowed set of next options
rather than requiring free navigation. Orchestration principle: "minimum clicks" is not a new UI
requirement this document invents — it is the existing Chain Selector's own design intent, named
explicitly here so future orchestration work is measured against it (fewer top-level choices
before reaching real work) rather than treated as unmeasured.

## 28. The minimum decision model

Directly grounded in OCID-030 §6–9 (when software decides vs. when it asks the user): the
existing decision engine is already designed to resolve routine choices deterministically and
surface a decision to the user only when genuinely ambiguous or high-impact (per
`task-tightening.ts`'s ambiguity gate and OCID-030 §9's own worked example, `GAP-ERP-CRM-403`).
This document names that existing design as "the minimum decision model" rather than proposing a
new one.

## 29. The zero cognitive load model

As found independently by three prior documents in this series (OCID-024 §29, OCID-025 §31,
OCID-030 §26), the literal phrase "zero cognitive load" is an Owner-directive framing, not a
pre-existing engineering term, and each prior investigation grounded it only in the Chain
Selector + Invite-icon pattern actually shipped. This document adopts that same, already-verified
conclusion rather than re-investigating it: "zero cognitive load" in this repo means "the Chain
Selector narrows every choice to a small, pre-computed set," not a distinct measurable engine.

## 30. End user productivity

Composite of the above: productivity is realized as fewer places to look (§2, §6), fewer decisions
forced onto the user (§28), and no repeated/duplicate effort (§24) — not a separate feature. No
dedicated productivity-measurement mechanism exists yet beyond `adoption-metrics-service.ts`'s
mode-pill usage rate and `routing-accuracy-report-service.ts`'s routing-tier accuracy; see §31 for
measurement gaps.

## 31. Performance targets

Reusing the real, already-established targets from this OCID series rather than inventing new
numbers: OCID-026 §34 and OCID-027 §19 (search performance), OCID-028 §31–32 (sync/response-time
targets). This document adds no new performance target of its own; orchestration is a
sequencing/naming layer over already-targeted mechanisms, and inherits their existing budgets.

## 32. Measurement and telemetry

Real, existing: `adoption-metrics-service.ts` (`computeModePillUsageRate()`),
`routing-accuracy-report-service.ts` (routing-tier accuracy). Not yet real: no telemetry exists
for "time from work becoming pending to user acting on it" (a genuine next-best-action /
orchestration-effectiveness metric) or for reminder/follow-up effectiveness (did a
`deadline_reminder` actually reduce time-to-completion). Named here as concrete measurement gaps
for OCID-034, not claimed as already instrumented.

---

## 33. Consolidated gap register (honest, not aspirational)

| Gap | Real current state | Where it's tracked |
|---|---|---|
| Next-best-action ranking surface | Does not exist; only single-axis deadline reprioritization exists | §4, §5 |
| Predictive/anticipatory work presentation | "Predictive" today means velocity estimate or AI-inference fallback tier, not anticipatory UX | §7 |
| Multi-source follow-up digest | Digest exists, scoped to tasks only, not instructions/PMS issues | §9 |
| In-progress draft continuity across devices/sessions | Confirmed NOT_YET_BUILT (OCID-025 §25) | §20–23 |
| Interruption recovery | Confirmed NOT_YET_BUILT; design-only artifact exists (`priority21_workspace_memory_design.md`) | §22 |
| Push notifications | Confirmed does not exist anywhere (OCID-025 §26) | §8 (implicit) |
| Orchestration-effectiveness telemetry | No metric exists for time-to-action or reminder effectiveness | §32 |
| Personalization beyond assignment scoping | No layout/ordering personalization beyond one deadline axis | §26 |
| Reprioritization's remaining 7 axes | Only 1 of 8 intended axes has real backing data | §5, §33 (this row) |

None of these gaps are closed by this document. They are named so OCID-034 and any
implementation work downstream of the OCID-020/038/039 unlock sequence has a real, current
starting list instead of re-discovering the same gaps from scratch.

---

## 34. Orchestration governance

This document does not create new governance machinery. It is subordinate to, and does not
modify: `ai-os/CONSTITUTION.yaml` (supreme), `AGENTS.md`'s Operating Rules (in particular Rule 9's
guardrail-presence protection and Rule 10's model-tier eligibility, both of which continue to
govern any future implementation of the gaps in §33), and the `SEC-07` implementation lock. Any
future work implementing a gap named in §33 must itself go through OCID-020's unlock sequence,
Rule 6's PR/CI gate, and — if it touches a judgment-tier decision — Rule 10's audit requirement.

## 35. Certification criteria

This document is documentation-only and therefore certifies nothing about running software. What
it does certify, as a documentation artifact: (a) the mandatory discovery in §0.1 was actually
performed against live server/repo state, not assumed; (b) every section above either
cross-references a real, cited mechanism or is explicitly labeled a gap in §33 — no section
describes an unbuilt capability as though it were live; (c) zero new database objects, engines,
or architecture were proposed, per the directive's own prohibition.

## 36. Readiness validation

Real, checked at the time of writing: no branch, PR, or `ai-os/boss/ACTIVE-CLAIMS.yaml` entry
existed for OCID-032 or OCID-033 before this task registered its own claim (§0.2 and this
document's own ACTIVE-CLAIMS entry). The nine prerequisite documents this document cross-references
(OCID-022 through OCID-031) exist as real, open-PR content as of this writing (PRs #765–#768,
#771–#775) — none are merged to `main` yet. This document is therefore itself unmerged,
cross-referencing other unmerged documents; readiness for anything beyond documentation remains
gated on those merges landing, independent of this document's own completion.

## 37. Readiness for OCID-034

This document is ready to hand off as a citable prerequisite for OCID-034 (per the snapshot's
current table, "VERIDIAN Continuous Platform Evolution Runtime v1.0" — itself flagged in
`VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` as overlapping significantly with this
document's own "search-first, reuse-first, zero-duplication" framing). Whoever picks up OCID-034
should read §0.1's discovery and §33's gap register first, and — per the already-established
cluster-overlap protocol in that snapshot document (§1a) — explicitly check whether OCID-034's
own requested scope is already covered here before drafting a fourth restatement of the same
zero-duplication principle this series keeps re-deriving.

---

**Canonical artifact created by this document:** this file,
`ai-os/VERIDIAN_UNIVERSAL_END_USER_WORK_ORCHESTRATION_RUNTIME_2026-08-03.md`. Amends the existing
UMR chain and existing canonical artifacts (`ai-os/OS.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml`); does
not start a new tracking mechanism.
