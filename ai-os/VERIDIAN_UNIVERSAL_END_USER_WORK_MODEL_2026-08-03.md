# VERIDIAN Universal End User Work Model — v1.0

**UMR:** `UMR-20260803-040929-9713` (`owner-task-20260803-040927-2381049`), the real dispatch UMR
for this task (`umr_tasks` table, `/opt/veridian/ai-os/memory/superboss-register.sqlite`, confirmed
by direct query, not narrated). **Correction (2026-08-05, per `UMR-20260805-083603-9efa`):** this
document originally also self-minted a separate "artifact UMR" (`UMR-20260803-042019-844f`),
believing it followed the same convention `ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md`
used for its own artifact UMR — that self-minted ID was never really registered anywhere (verified
via the 3-step method in `ai-os/MASTER-TRACKER.yaml`'s `GAP-SELF-MINTED-ARTIFACT-UMR-FABRICATION`
entry) and is removed here; this document now cites only its real dispatch UMR above. Parent, per this task's own
prompt: `UMR-20260803-040844-4a33` — confirmed by the same direct query to be the real
`owner_dispatch_gateway` row that created `task-20260803-040852-ocid-022-...` itself (`task_kind:
veridian_task_create`); it is a real, correctly-cited UMR, not a mislabeled one. Also cites, per
this task's own prompt: `UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program),
`UMR-20260802-165606-4413` (OCID-020 certification directive), `UMR-20260802-164659-9a31` (server
artifact traceability audit), `UMR-20260802-165034-5747` (standing gatekeeper rule),
`UMR-20260802-165434-cd91` (unified project memory), `UMR-20260802-165541-c27d` (recovery
framework).

**Status: documentation only.** This artifact implements no code, changes no database, changes no
UI, changes no UX, changes no AI/prompt behavior. Every claim below is either (a) real, live,
evidenced state as of 2026-08-03, cited to a file:line or an existing canonical artifact, or (b) an
explicitly labeled gap already on record elsewhere in this repo's own governance trail, or newly
named here from the task-model angle specifically because no prior artifact had stated it that way.
Nothing here is invented, redesigned, or proposed as new architecture, new tables, or new UI.

**Mandatory inputs read before writing, in full, not summarized from memory:**
`ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` (OCID-022's real, complete artifact —
read directly from that task's own live workspace since, at read time, that sibling task was still
`in_progress` finishing its own registration/commit steps but its document content was already
complete); `UNIVERSAL_TASK_WRAPPER_DESIGN.md` (repo root — the existing, real, 2026-07-11
design-only proposal for a universal work-item envelope, `activity_log`, whose Phase 1 has since
shipped); `ai-os/CONSTITUTION.yaml`'s `task_lifecycle` (TASK-01..05), `guardrail_protocols`
(GP-01..30), and `audit_organization` (AUDIT-01..04) sections — the canonical, machine-readable
rules this document is grounded in, not restated as new policy; `src/lib/db/schema.ts`'s real
`tasks`/`tickets`/`pmsIssues`/`activityLog`/`comments`/`taskChatMessages`/`documents`/
`notifications`/`auditLogs`/`scopedDelegations`/`approvalRequests` table definitions;
`src/lib/services/task-service.ts`, `ticket-service.ts`, `delegation-service.ts`; and
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` for the real, current % status of the adjacent systems
(VERI Chat, Multi Tenant, End-to-End Testing) a task's lifecycle depends on.

**Honest disclosure on "OCID-021," inherited verbatim from OCID-022's own document rather than
re-derived, since the same discrepancy applies identically to this task's prompt**: the prompt
cites "the OCID-021 implementation lock ... permits discovery and matrix building to continue." The
real, literal OCID-021 (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, 2026-08-03 amendment) is the
Category A/B production-DB governance split (`CONSTITUTION.yaml`'s `SEC-06`) — closed and merged,
topically unrelated to end-user work modeling, and not itself an "implementation lock" on anything.
The real gating mechanism is `UMR-20260802-165606-4413` (OCID-020's own certification directive),
which is confirmed **not yet independently verified complete** as of this writing (this repo's own
`PROGRESS.md` lineage and `ai-os/boss/ACTIVE-CLAIMS.yaml`'s most recent OCID-020 entries show the
certification sweep `blocked`, not closed). This does not block this task: it was scoped as
documentation-only from the start, which the lock explicitly permits. Recorded here for the Owner's
awareness, not silently corrected into the directive's own text — same posture OCID-022 took.

---

## 1. What is work

"Work" in VERIDIAN is any unit of effort an end user initiates, is assigned, or is asked to review,
that has a beginning, a real owner, and an outcome. This is not a new definition — it is the
generalization already implicit across the five real, currently-separate places VERIDIAN records
work today, each independently confirmed live:

- A **task** (`tasks` table, `src/lib/db/schema.ts:1225-1275`) — a to-do assigned to a person.
- A **ticket** (`tickets` table, `schema.ts:5496-5522`) — a help-desk/support request, with its own
  SLA and escalation machinery (§11 below).
- A **project-management issue** (`pmsIssues`, `schema.ts:4088-4121`) — the PROJEXA/PMS module's
  Linear-style unit of work, with per-project sequencing and multi-assignee support.
- A **compliance item** (`compliance_items`, pre-existing, the platform's original work object) —
  out of this document's direct scope (it already has its own mature lifecycle, audit trail, and
  UI), but structurally the same shape as the other three and worth naming so a reader does not
  wonder why it is absent.
- An **AI Dev Team dispatch or background loop run** — internal, AI-facing work, not end-user work,
  tracked separately (see §1.1) and explicitly out of this document's scope per its own mandate
  ("Prohibited... AI").

This document is scoped to the first three (and, by direct analogy, `compliance_items`): real,
end-user-facing units of work a person creates, is assigned, or acts on. **Every end user input
becomes one task** (§3) is the organizing rule; "work" is the general noun, "task" (§2) is what a
single real unit of that work is called in this codebase's actual data model.

### 1.1 A universal work envelope already exists, is already the endorsed direction, and is honestly incomplete

This is the single most important piece of prior art this document must not duplicate.
`UNIVERSAL_TASK_WRAPPER_DESIGN.md` (repo root, 2026-07-11, design-only) already identified this
exact problem — five different activity types with no shared identity — and recommended **Option
B**: a thin, additive `activity_log` envelope table, with `tasks`/`tickets`/`pmsIssues`/
`orchestraExecutions` staying as the detail layer underneath it, never replaced. `CONSTITUTION.yaml`
canonicalizes this as **TASK-04** (`universal_activity_log`, status `ENFORCED` for the mechanism
that exists): `activityType` enum (`customer_task | orchestra_call | ai_team_dispatch | loop_run`),
`lifecycleStage` (`requested → classified → validated → executing → reviewing → completed|failed →
closed`), `detailTable`/`detailId` pointing at the real row.

**Real, current, honestly-checked status (direct grep of every real `recordActivity()` call site,
not inferred from the design doc's own aspirational phasing)**: Phase 1 shipped (`activity_log`
table exists, `schema.ts:1511-1610`), but **only the `ai_team_dispatch` activity type is actually
wired** — every real call site is in `src/app/api/ai/team/dispatch/route.ts`. `customer_task` and
`orchestra_call` — the two activity types that would cover real end-user work — have **zero** real
call sites anywhere in `src/`. Phase 2 of the design doc's own phasing (wiring `tasks` and
`orchestraExecutions`' existing write paths to also insert an `activity_log` row) has not shipped.
Phase 3 (a real cross-activity query surface) and Phase 4 (recursive-delegation/deadlock detection)
have not shipped either — `CONSTITUTION.yaml` says as much in TASK-04's own `gap` field.

**What this means for this document, stated plainly**: there is no single database table today that
already holds "every end-user task, uniformly." The real, live source of truth for end-user work is
still the three separate tables named in §1 above. This document therefore grounds every section
below in those three real tables as they exist today, and treats `activity_log`/TASK-04 as the
already-endorsed, already-designed, not-yet-built path to true unification — the correct target for
a future implementation OCID to wire Phase 2 onto, not a reason to invent a fourth, competing
"universal task" table.

---

## 2. What is a task

A task, in the sense this document uses the word (matching `CONSTITUTION.yaml`'s `TASK-02`,
`customer_task_validation`), is one row in one of the three real tables named in §1: `tasks`,
`tickets`, or `pmsIssues`. Each carries the same minimal real shape, confirmed by direct schema
read: a unique identifier (§4), a title/subject, a status drawn from a real (if not yet unified)
enum (§5), an owner/assignee (§6), timestamps, and — for `tickets` and `pmsIssues` — additional
structure (SLA fields, per-project sequencing) their domain requires.

`CONSTITUTION.yaml`'s `TASK-02` already states the correct, real, currently-enforced validation
posture for a customer-created task, and this document adopts it rather than restating a stricter
rule: *"Customer-created tasks (not AI-dispatch) get a LIGHTER validation than TightTask — reject
only genuinely degenerate briefs (empty/placeholder/single-character), never the full 3-required-
field schema. A human writing 'Follow up with vendor X' is a normal, complete task."* Real
mechanism: `task-tightening.ts`'s `validateTaskBrief()`, deliberately lighter than the AI-dispatch
`TightTask` schema (`TASK-01`) a human end user is never subjected to. `TASK-03` (`full_40_field_
task_schema`) records, honestly, that a full ~40-field Identity/Input/Process/Output/Handover/
Closure schema was considered and deliberately **not built** for customer tasks — status
`POLICY_ONLY` — because it would be a disproportionate, high-risk change to a live, 13-real-column,
customer-facing table for a problem (AI agents dropping work) that `TASK-01` already solves at the
2 real AI-dispatch entry points where incidents actually happened. This document does not revisit
that decision.

---

## 3. Every end user input becomes one task

This is a rule this document is asked to state, not a fully-enforced mechanical guarantee today —
stated honestly rather than glossed over. What is real:

- **Explicit task creation is real and universal for its own surface**: any end user creating a
  task via `POST /api/tasks` (→ `createTask()`, `task-service.ts:133`) gets exactly one `tasks` row.
  Any end user filing a support request gets exactly one `tickets` row (`ticket-service.ts`). Any
  end user creating a PMS issue gets exactly one `pmsIssues` row. Each of these three real creation
  paths already guarantees "one input, one row" for its own domain.
- **What is not yet real**: there is no single, cross-cutting enforcement point that guarantees
  *every* end-user-initiated action anywhere in the product — a conversation message, a report
  request, a workflow trigger — becomes a `tasks`/`tickets`/`pmsIssues` row or an `activity_log`
  row. `CONSTITUTION.yaml`'s own `TASK-04` gap field says this plainly: `customer_task`/
  `orchestra_call` activity is not yet flowing into the one place ("show me every task in the
  system") that would make this rule mechanically verifiable end-to-end. A VERI Chat conversation
  message, for example, is real, persisted, and audited (`chat-service.ts`, `orchestraExecutions`),
  but is not currently classified as "a task" in the `tasks`/`tickets`/`pmsIssues` sense — it lives
  in the conversation/message model, a fourth real shape this document does not fold in, consistent
  with the mandate that VERI Chat itself is out of this document's design scope.

**The honest current rule, grounded in what's real**: every end user input that goes through one of
the three real task-creation surfaces named above becomes exactly one task/ticket/issue row, with
full lifecycle tracking as described in the rest of this document. Extending that guarantee to every
other end-user-facing surface (chat, reports, workflows) is exactly the work Phase 2 of TASK-04
(`activity_log`) was designed to do and has not yet been dispatched — named here as the concrete,
already-designed next step, not invented fresh by this document.

---

## 4. Task uniqueness and identifier

Every real task/ticket/issue row's primary key is a CUID2 (`text('id').primaryKey().$defaultFn(()
=> createId())`, `@paralleldrive/cuid2`) — globally unique, non-sequential, not guessable, not
reused. This is the real, existing identifier scheme for `tasks`, `tickets`, and `pmsIssues` alike;
this document does not propose a new ID scheme.

One real exception, already built and already reusable: `pmsIssues.number` (`schema.ts:4097`) is a
per-project auto-incrementing integer, paired with `projects.issueSequence`/`issuePrefix`, giving PMS
issues a real, human-readable display identifier in the familiar `PROJ-123` shape. Neither `tasks`
nor `tickets` has an equivalent human-readable identifier today — an end user refers to a task or
ticket by its title, not a short code. This is a real, honestly-named gap for a future OCID, not
something this document invents a fix for.

**Uniqueness beyond the primary key**: `src/app/api/tasks/duplicates/route.ts` +
`task-dedup-service.ts::scanForDuplicateTasks()` already implement real, embedding-similarity-based
duplicate-task detection — an on-demand, manager-gated scan that surfaces candidate duplicates for
human review; it never auto-merges or auto-rejects. This is the real, existing mechanism for "is
this task actually a duplicate of one that already exists" — this document names it as the real
answer to the uniqueness question beyond "the primary key is unique," rather than proposing a new
dedup mechanism.

---

## 5. Task state model

Each of the three real task-shaped tables carries its own real, independently-enforced status
value — there is no single shared enum today, a fact worth stating plainly rather than implying a
unification that has not happened:

| Table | Real status values | Enforced by |
|---|---|---|
| `tasks` | `pending, in_progress, completed, failed, cancelled` (free text, validated in code) | `task-service.ts:37`'s `VALID_STATUSES`, checked in `updateTask()` |
| `tickets` | `open, in_progress, resolved, closed` (free text) | `schema.ts:5506`, `ticket-service.ts` |
| `pmsIssues` | per-project custom statuses (`pmsIssueStatuses`), each mapped to one of a real Postgres enum's 6 groups: `backlog, unstarted, started, completed, cancelled, triage` (`pmsStatusGroupEnum`, `schema.ts:4005`) | per-project status configuration |
| `activity_log` (§1.1, not yet populated by real end-user tasks) | `lifecycleStage`: `requested → classified → validated → executing → reviewing → completed|failed → closed` | `TASK-04` |

**A real, already-documented honest limitation, stated in this codebase's own comments** (not a new
finding — `task-service.ts` around line 469): `tasks.status`'s 5 values cannot express *blocked*,
*delegated*, *waiting on a dependency*, or *inactive* — 4 of the 6 monitored-state categories a
prior gap-closure pass named as the target set. Overdue detection (`checkTaskOverdue()`,
`isTaskOverdue()`, `task-service.ts:477-510`) was built to notify on the one state it *can*
express (a task past its `dueDate` that is not `completed`/`cancelled`); the other 4 categories
remain genuinely unreachable without a schema change this document does not propose.

**Terminal states**: `completed`, `failed`, `cancelled` for `tasks`; `resolved`, `closed` for
`tickets`; the `completed`/`cancelled` status groups for `pmsIssues`. No table currently
distinguishes "terminal and correct" from "terminal and abandoned" beyond these named values.

---

## 6. Task ownership

Every real task/ticket/issue row has exactly one real, non-ambiguous owner column at any given
time — ownership is a single foreign key, not a set, in the current data model:

- `tasks.userId` — the assignee, i.e. the current owner. `tasks.assignedById` (Wave 15) separately
  records who assigned it, so "owned by me" (`listMyTodos()`, `task-service.ts:423-437`) and
  "assigned by me" (`listAssignedByMe()`, `task-service.ts:442-456`) are two real, distinct, already
  -built queries — a manager's own personal to-do list is never padded with work they only handed to
  someone else.
- `tickets.assigneeId` — the current owner, plus `ticketTeams` for queue-level routing before an
  individual owns it.
- `pmsIssues.assigneeId` (a denormalized single-owner cache) alongside `pmsIssueAssignees` (the real
  multi-assignee join table, `schema.ts:4122`) — PMS issues are the one real table in this trio that
  already supports more than one simultaneous owner, by design, for that module's own workflow.

Ownership is always scoped to one org (`orgId`) and, where applicable, one client (`clientId`) —
real, live multi-tenant isolation (§25) already prevents one org's task from ever surfacing as
another org's, regardless of who nominally owns it.

---

## 7. Task assignment

Assignment is real, live, and generic today via the same update path every other field on a task
goes through: `PATCH /api/tasks/[id]` → `updateTask()` (`task-service.ts:346-408`) accepts a new
`status`/`title`/`description`/`priority`; reassigning the owner (`userId`) is not currently a field
that route validates or restricts beyond normal auth/RLS — there is no dedicated `/assign` endpoint
with its own business rules (e.g. "only a manager can reassign," "the new assignee must belong to
this org's team") for `tasks` specifically. `tickets` has real, dedicated assignment machinery one
layer richer: `ticketTeams` for queue-based routing, and `escalationRules.escalateToUserId`/
`escalateToTeamId` (§11) as an automatic, condition-triggered assignment override. `pmsIssues` has
real per-issue multi-assignee support via `pmsIssueAssignees`, distinct from the single-owner
`tasks`/`tickets` model.

No cross-table "assignment history" exists today independent of the audit log (§14) — a
reassignment is visible as an `auditLogs` row (action recorded via `logActivity()`) and as the
current value of the owner column, not as a dedicated assignment-events table.

---

## 8. Task delegation

Delegation, in the sense of "authority over a scope of work, not just one row's owner column being
changed," is a real, already-built, general-purpose mechanism — not something specific to tasks that
this document needs to invent: **`scopedDelegations`** (`schema.ts:1926-1938`, Wave 173,
`delegation-service.ts`). A delegator (`delegatorUserId`) grants a delegate (`delegateUserId` or, for
role-wide delegation, `delegateRoleKey`) authority over a real, typed scope
(`delegationScopeTypeEnum`: `task | workflow | project | module | communication_type |
approval_type`) and an optional `scopeId` narrowing it to one specific entity, with a real
`expiresAt` and `revokedAt` — delegation is time-bound and revocable, not a permanent handover.

This is the real, existing answer to "can someone else act on my behalf for this task without me
losing ownership of it": `scopeType: 'task'` with a `scopeId` pointing at one real `tasks.id` is
already a supported, real case of this table, distinct from simple reassignment (§7) — the original
owner does not change, but the delegate gains real, checkable authority for the duration of the
grant.

---

## 9. Task transfer

Transfer — permanently handing a task to a new owner, as distinct from a time-bound delegation
(§8) — has no dedicated table or endpoint in this codebase today. It is, in practice, the same
generic `PATCH /api/tasks/[id]` reassignment described in §7: changing `userId` to a new value is
what a "transfer" looks like at the data-model level. There is no separate `transferredFrom`/
`transferredAt` audit column distinguishing "this was reassigned by a manager" from "this was
handed off by the original owner" — both produce the same `updateTask()` call and the same
`auditLogs` entry shape. This is a real, honestly-named gap: a future OCID could distinguish
transfer from ordinary reassignment (e.g. requiring the outgoing owner's or a manager's explicit
confirmation) without needing new tables — `scopedDelegations`' own `scopeType: 'task'` shape, or a
dedicated transfer-confirmation step ahead of the existing `updateTask()` write, are both realistic,
low-risk extensions of what already exists; this document does not choose between them.

---

## 10. Task approval

Approval for a task is not a single mechanism — it is the composition of two real, already-built
systems, cited rather than redesigned:

1. **`approvalRequests`** (`schema.ts:2971-2988`) — the generic, polymorphic maker-checker table
   used across modules (policy publish, RPT approval, SOP, and, by the same `entityType`/`entityId`
   pattern, applicable to a task). `status` (`approvalRequestStatusEnum`, `schema.ts:2971`:
   `pending | approved | rejected`), `requestedById`, `approvedById`, `rejectionReason`. Handled by
   `src/app/api/approvals/[id]/route.ts`.
2. **The high-impact-action confirmation gate** — `CONSTITUTION.yaml`'s `HAB-02`/`HAB-04`
   (`human_ai_boundary`), already cited by OCID-022's own document (§2.4 of that artifact) as
   directly relevant to end-user trust. `HAB-04` (**ENFORCED**): the real UI-facing interaction is a
   4-way choice — Approve Once / Edit & Approve / Reject / Always Approve for this type — persisted
   per user and revocable (`approval_preferences` table), not a binary Confirm/Cancel re-decided
   every time. `HAB-02` (**PARTIALLY_ENFORCED**): 9 categories of high-impact action require this
   confirmation via `checkHighImpactConfirmation()`; the real, honest gap is that this is wired at
   one real call site (`task-service.ts::createTask`) rather than as unconditional middleware across
   every route yet — this document does not re-litigate that gap, only cites it accurately.

A task's own status transitions (§5) are not themselves gated by `approvalRequests` today — an
end user can move their own task from `pending` to `completed` without a separate approval step
unless a specific workflow (outside `tasks` itself, e.g. an ERP approval chain) requires it. Where
approval is genuinely required for a task-shaped entity, `approvalRequests` is the real, reusable
mechanism to point at; this document does not propose a task-specific approval table.

---

## 11. Task escalation

Escalation is real, tiered, and production-grade for **tickets** specifically, and real but
narrower for **tasks**:

- **Tickets**: a full, real, already-shipped escalation system — `businessHoursSchedules`,
  `slaPolicies`, `escalationRules` (with `thresholdPercent`, `escalateToTeamId`/`escalateToUserId`,
  `notifyUserIds`), and `ticketEscalationEvents` (an idempotency log — one row per rule firing, so
  the same breach never re-escalates twice) — all real tables, `schema.ts:5525-5595`. Cron logic:
  `checkTicketEscalations()`/`checkTicketSlaBreaches` in `ticket-service.ts`.
- **Tasks**: no tiered escalation exists. What is real is overdue *detection*, not escalation:
  `checkTaskOverdue()` (`task-service.ts:492-510`) notifies the assignee and the assigner when a
  task's `dueDate` has passed and its status is not terminal — a single-level, re-alert-until-
  resolved notification (mirroring `checkTicketSlaBreaches`' own re-alert pattern), not a multi-tier
  hand-off to a manager or a different team the way ticket escalation is.
- **PMS issues**: no dedicated escalation mechanism found; issues rely on manual reprioritization
  and the module's own board/sprint workflow.

The real, reusable pattern already exists (the ticket escalation system) and is not currently
generalized to tasks or PMS issues — a future OCID extending escalation to tasks has a real,
proven, already-tested reference implementation to extend rather than a green field.

---

## 12. Task completion

"Done" is represented differently per table, each real and already enforced:

- `tasks`: `status = 'completed'`. There is no dedicated `completedAt` timestamp column on `tasks`
  itself — one API response shape (`task-service.ts:391`) uses `updatedAt` as a stand-in, which is
  accurate only because a completing update is, definitionally, the most recent update at that
  moment. `updateTask()` fires a real, once-only side effect on the genuine transition into
  `completed` (not on every save of an already-completed task, via `didFeatureComplete()`): an audit
  trigger (`recordAuditTrigger`, `event: "feature_completed"`) and a Narrow Monitor registration
  (`runTaskCompletionMonitor`) — both best-effort, logged on failure, never blocking the status
  update that already committed.
- `tickets`: a real, dedicated `resolvedAt` timestamp (`schema.ts:5508`), separate from the
  `status = 'resolved'`/`'closed'` values — resolution time is a real, queryable fact, not inferred
  from `updatedAt`.
- `pmsIssues`: completion is inferred from `statusId` mapping to the `pmsStatusGroupEnum` group
  `'completed'`; a separate `completionPercentage` (service-maintained integer) tracks partial
  progress toward that terminal state.

---

## 13. Task reopen

Reopening a task/ticket/issue — moving it from a terminal status back to a non-terminal one — has
**no dedicated action, guardrail, or audit-specific event anywhere in this codebase for
`tasks`/`tickets`/`pmsIssues`**, confirmed by direct search. The only real "reopen" implementation
that exists at all is domain-specific and unrelated: `POST /api/erp/periods/[id]/reopen` (accounting
period reopen, an ERP-module concept, not a general work-item concept).

For a task/ticket/issue, "reopening" today is indistinguishable, at the data-model level, from any
other status PATCH back to a non-terminal value — `updateTask()`'s own `VALID_STATUSES` check
permits `completed → pending` exactly as freely as `pending → completed`, with no separate
guardrail, required reason field, or distinct audit event for the reverse transition. This is a
real, honestly-named gap: a future OCID could add a lightweight, reason-required reopen path
(reusing the existing `updateTask()`/`auditLogs` machinery rather than new tables) without
redesigning anything; this document does not choose the exact shape of that fix.

---

## 14. Task auditability

Every write to a task/ticket/issue is auditable today via **`auditLogs`** (`schema.ts:626-660`) —
the real, unified, append-only log across this entire platform, not something specific to tasks.
Real, load-bearing properties, confirmed directly: the table has no `UPDATE`/`DELETE` grant for the
`app_runtime` role at the database level (migration `0225`) — an audit row, once written, cannot be
altered or removed by the application itself. Each row captures `action` (a free-text verb),
`entityType`/`entityId` (polymorphic — `'task'` is a real, live value), `userId`/`apiKeyId`,
denormalized `actorName`/`actorRole` snapshots (so a later role change never rewrites history),
`orgId`/`clientId`, and `ipAddress`/`userAgent`. Written via `logActivity()` (`src/lib/audit.ts:55`),
called from `task-service.ts` and `tasks/[id]/comments/route.ts` among many other real call sites.

This satisfies `GP-18` (`guardrail_protocols`, Audit, **ENFORCED**, mechanism: `audit_logs +
orchestraExecutions`) for the task domain specifically. `AUDIT-04` (`audit_organization`, "no task
is ever permanently complete... a completed task's original approval can become stale and trigger
re-audit") is real policy but status `POLICY_ONLY` — it depends on `activity_log`'s queryable state
(TASK-04, §1.1), which is not yet populated for real end-user tasks; this document names that
dependency rather than re-deciding it.

---

## 15. Task history

"History" — the full, chronological set of everything that has happened to one task — is real and
complete as *data* (every write is in `auditLogs`, every comment is in `comments`, every chat
message is in `taskChatMessages`) but has **no dedicated task-history query or UI surface today**,
confirmed by direct search of `src/app/(app)/tasks/`. Compare to `compliance_items` and `notices`,
which already have a real "Activity" tab (`src/app/(app)/compliance/[id]/page.tsx:514-533`) that
maps `auditLogs` rows into a simple chronological feed — the same pattern is not yet reused for the
task detail page. This is a real, concrete, low-risk extension opportunity (reuse the existing
`Activity` tab pattern against `entityType='task'`) rather than a gap requiring new data.

---

## 16. Task timeline

A "timeline" (a history rendered as a temporal sequence, distinct from a flat activity list) has the
same status as §15: the underlying, timestamped data is real and complete (`createdAt`/`updatedAt`
on the task row itself, `createdAt` on every `auditLogs`/`comments`/`taskChatMessages` row tied to
it), but no dedicated timeline component exists in `src/components/` today, and no task detail page
currently renders one. This document names timeline and history as the same real underlying data
serving two different presentation needs — not two separate mechanisms to build — consistent with
the mandate that this document does not design UI.

---

## 17. Task attachments

There is no dedicated `attachments` table. The real, existing, already-general-purpose mechanism is
**`documents`** (`schema.ts:373-424`): `fileUrl` (a private object-storage path, never a public
URL), `fileType`, `fileSize`, a generic **`linkedEntityType`/`linkedEntityId`** polymorphic pair
(Wave 61, explicitly built so a new module attaches files to its own entities — e.g. `'pms_issue'`
— without a new foreign key or a new table), `category`, plus real versioning
(`parentDocumentId`/`versionNumber`/`isLatestVersion`) and real retention fields (§27). Storage:
Supabase's `"compliance-documents"` bucket (`document-service.ts:16`), private by default, always
resolved via a server-issued signed URL, never a public path.

A task's attachments, when a future implementation wires them up, are the same real `documents` row
shape used everywhere else in the platform — `linkedEntityType = 'task'`/`'ticket'`/`'pms_issue'`,
`linkedEntityId = <the real row's id>` — not a new attachments concept.

---

## 18. Task chat

Two real, distinct channels exist on a task today, and this document is careful not to conflate
them, matching OCID-022's own §2.3/§3.1 finding exactly (same underlying files, re-verified
independently in this pass):

1. **Task comments** — `comments` table (`schema.ts:570-577`, polymorphic `entityId`/`entityType`),
   reused for tasks at `entityType='task'` via `src/app/api/tasks/[id]/comments/route.ts` (both
   GET and POST are real and live), with a real in-app notification to the task's owner on every
   new comment. This is genuine, real-time-enough, human-to-human discussion on a task.
2. **Task chat** — `taskChatMessages` (`schema.ts:1323`) via `src/app/api/tasks/[id]/chat/route.ts`
   (47 lines). **Confirmed, still-real limitation, independently re-verified by direct read of that
   route file in this pass**: it only inserts the end user's own message and returns — there is no
   LLM call anywhere in that handler. An end user typing into a task's chat thread today gets no AI
   reply, unlike a conversation-level VERI Chat thread (`chat-service.ts::sendMessage()`, a real,
   live LLM round trip). This is the same gap `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 6
   and OCID-022 §3.1 already name — not a new finding, and not fixed by this document (VERI Chat
   behavior is explicitly out of this document's scope).

For the purpose of this work model: a task's real, currently-functional discussion channel is
**comments**, not chat — worth stating plainly so a future OCID scoping "add task discussion" does
not duplicate what `comments` already does.

---

## 19. Task decisions

There is no dedicated "decision" field or table on `tasks`/`tickets`/`pmsIssues` today. The closest
real, existing mechanisms, each narrower than a general task-decision concept:

- **`approvalRequests.rejectionReason`** (§10) — a real, recorded reason when an approval tied to a
  task-shaped entity is rejected, but only exists when an `approvalRequests` row was created for
  that entity in the first place.
- **`problemRecords.rootCause`** (`schema.ts:5648`) — a real "why did this happen and what did we
  decide" field, but scoped specifically to ITIL-style problem management, not general tasks.
- **A task's own status transition itself** is, today, the only universal "decision record" every
  task has — moving to `completed`/`failed`/`cancelled` is a real, audited (§14) fact, but carries
  no structured "why," only whatever free text is in `description` or a comment (§18).

This is a real, honestly-named gap: there is no single place to answer "what was decided about this
task, and why" beyond reconstructing it from comments and audit-log entries. This document does not
propose a new decision-record table; it names the gap so a future OCID can weigh whether extending
`approvalRequests` (already polymorphic) or `comments` (already polymorphic, could carry a
`isDecision` flag) is the lower-risk path, without inventing a third mechanism.

---

## 20. Task artifacts

Distinct from attachments (§17, end-user-uploaded files): "artifacts" here means what a task's own
execution *produces*. Two real, already-existing sources, neither invented by this document:

- **`taskExecutionPlan`/`taskAgentExecutions`** — real tables recording an AI-planned/executed
  task's step-by-step plan and each step's own output, FK'd to `tasks` (referenced directly in
  `UNIVERSAL_TASK_WRAPPER_DESIGN.md`'s own problem statement, §1.1 above). This is real,
  already-structured output for the subset of tasks that go through AI planning/execution.
- **`documents`** (§17) — when a task's output is a file (a generated report, an exported document),
  the same polymorphic `linkedEntityType='task'` pattern applies; artifact and attachment share one
  real underlying table, distinguished only by who produced the file (the end user vs. the task's
  own execution), not by a different schema.

There is no separate "artifacts registry" beyond these two real, already-existing surfaces — this
document does not propose consolidating them.

---

## 21. Task reports

**Confirmed, direct finding, honestly stated**: no report in this codebase's real reporting surface
(`src/app/(app)/reports/page.tsx`, `.../reports/create/page.tsx`) is task/ticket/issue-specific
today. `reports/page.tsx` is built around `/api/compliance/stats` and `/api/compliance` —
compliance-item-centric. `reports/create/page.tsx` is a generic AI-assisted report builder
(`/api/reports/ai-builder/analyze`), capable in principle of querying any table an org's data
allows, but not pre-built with a task/ticket-specific template or saved report today. This is a
real, named gap for a future OCID — the real reporting infrastructure (`report-catalog-service.ts`,
`report-engine-service.ts`, 1790 real lines) is generic enough to extend to task/ticket reporting
without a new engine; this document does not propose new reporting infrastructure, only names that
the extension has not happened yet.

---

## 22. Task analysis

Real, already-existing analytical mechanisms that already operate on tasks specifically, distinct
from general reporting (§21):

- **Duplicate-task analysis** (§4) — `task-dedup-service.ts::scanForDuplicateTasks()`, real,
  embedding-similarity-based, manager-gated.
- **Overdue analysis** (§11/§12) — `isTaskOverdue()`/`checkTaskOverdue()`, a real, pure, unit-tested
  decision function plus its cron-driven notification consumer.
- **Model/dispatch-outcome analysis** — `model-scorecard-service.ts`, real, but scoped to
  AI-dispatch activity (`activity_log`'s `roleKey`/`complexityTier` columns, §1.1), not general
  end-user tasks — named here only to be precise about what it does and does not cover.

There is no general-purpose "task analytics" surface (throughput, cycle time, workload distribution
across a team) comparable to what exists for compliance items — a real, honestly-named gap, not
fixed by this document.

---

## 23. Task notifications

Real, live, and already firing from multiple real call sites today: the **`notifications`** table
(`schema.ts:581-593`) — `userId`, `title`, `message`, a real typed `notificationTypeEnum`
(`deadline_reminder | assignment | status_change | comment | system | mention |
instruction_mismatch`), `isRead`, and a `metadata` jsonb payload specific to the notification type.
Confirmed real call sites relevant to tasks specifically: `task-service.ts:501` (overdue,
`deadline_reminder`) and `tasks/[id]/comments/route.ts` (new comment, notifying the task owner) —
both already live, not aspirational. The same table is reused across the platform (ticket events,
compliance deadlines, risk escalations, automation rules, cost guards) — this document does not
propose a task-specific notification mechanism; the real, general one already covers tasks.

---

## 24. Task search

Real, live, and confirmed **incomplete for two of the three real task-shaped tables**: the global
`⌘K` search (`src/components/search-command.tsx`) has two real modes. Standard search
(`/api/search` → `searchAll()`, `search-service.ts`) covers exactly three entity types, confirmed by
direct read of `search-command.tsx:28-39` and `search/route.ts:9-22`: `compliance_items`, `tasks`,
`clients`. Semantic search (`/api/search/semantic`, embeddings-backed) covers `compliance_items`,
`notices`, `documents`, `other`. **`tickets` and `pmsIssues` are not indexed by either search mode
today** — a real, concrete, honestly-named gap: `tasks` is searchable, `tickets`/`pmsIssues` are
not, despite all three being real, live task-shaped work objects by this document's own §1/§2
definition.

---

## 25. Task permissions

Task permissions rest on two real, independently-operating layers, neither invented by this
document:

1. **Role-based access control** — `userRoleEnum` (`schema.ts:12-16`: `admin, manager, member,
   viewer, veridian_admin, branch_manager, senior_professional, team_member, client_viewer,
   external_auditor, stage_0`), enforced at the route level via `requireAuth`/`requireRole`/
   `requireRoleOrScope` (`src/lib/supabase/auth-guard.ts`) — every task-related API route already
   requires this per `CLAUDE.md`'s own hard rule.
2. **Deny-only ABAC overlay** (`GP-02`, `src/lib/abac.ts` + `abac_policies` table) — evaluated after
   RBAC has already allowed an action, can only narrow access RBAC already granted, never widen it.
   Real and wired into `approval-workflow-service.ts`; not confirmed wired into the generic
   `tasks`/`tickets` CRUD paths specifically as of this pass — named honestly rather than assumed.

Real multi-tenant scoping (**`withTenantContext()`**, `src/lib/db/tenant-scoped.ts:65-80`) is the
mechanism underneath both of the above: it sets real Postgres session GUCs (`app.current_org_id`,
`app.current_client_ids`, `app.current_user_id`) under the dedicated `app_runtime` role (not the
RLS-bypassing `postgres` role), read by real Postgres RLS policies. This is what actually prevents
one org's task from being visible to another org's user, independent of role — a database-enforced
guarantee, not just an application-layer filter, confirmed called in 49/51 real service files.

---

## 26. Task visibility

Distinct from permissions (§25, "is this user allowed to act on this task") is visibility ("does
this user see this task in a list at all"). Real, current visibility rules, confirmed by direct
read: `listMyTodos()` scopes to `tasks.userId = current user` (owned-by-me); `listAssignedByMe()`
scopes to `tasks.assignedById = current user AND userId != current user` (assigned-by-me,
deliberately excluding self-assigned tasks from padding out a manager's delegation view, per that
function's own comment). A general, unfiltered "every task in the org" listing exists (bounded by
RLS/org scope, §25) for roles with the rank to see it. `pmsIssues` visibility follows the PMS
module's own project-membership model, not covered by this document's task-specific citations
above. No task/ticket/issue table has a dedicated `visibility` or `isPrivate` column today —
visibility is entirely a function of ownership + role + org scope, not a per-row setting an end user
can independently configure. This is a real, accurate description of current behavior, not a gap
this document is flagging as needing a fix.

---

## 27. Task retention

Real retention machinery exists today on exactly one of the tables this document covers, and it is
not `tasks`/`tickets`/`pmsIssues` — it is **`documents`** (§17): `retentionPeriodDays`,
`disposalDate` (computed at set-time), `legalHold`, `isDisposed`/`disposedAt`/`disposedById`
(`schema.ts:399-406`, Wave 91). Confirmed by direct schema check: **none of `tasks`, `tickets`, or
`pmsIssues` has any retention, soft-delete, or archival column** — the sole exception is
`pmsIssues.isArchived` (`schema.ts:4104`), a real, simple archive flag with no retention-period or
disposal-date semantics attached to it. This is a real, honestly-named gap: a task or ticket, once
created, has no defined retention period and no soft-delete path — it is either a live row or,
today, permanently a live row (no deletion mechanism exists at all for these three tables, confirmed
by search).

---

## 28. Task synchronization

There is no push-based, real-time synchronization mechanism for task/ticket/issue state changes
across clients today, confirmed by direct search of `src/` for a WebSocket/SSE-based task-update
channel — none exists. The real, current mechanism is standard request/response: a client fetches
current state via the real REST API (`GET /api/tasks`, `/api/tickets`, etc.) on navigation/refresh,
and the `notifications` table (§23) is the real async "something changed" signal an end user sees
without a full page reload, itself delivered by whatever polling/refresh mechanism the notification
dropdown in `AppTopbar.tsx` uses (not independently re-verified as real-time push in this pass — not
claimed as more than it is). Multi-tenant RLS (§25) guarantees that whichever client fetches state,
it fetches the *correct*, consistently-scoped state for its own org — synchronization of
*correctness* is real and strong; synchronization of *latency* (how fast one user's change appears
to another user's open screen) is not push-based today. Named honestly as a real, current
characteristic of the system, not invented as a gap to alarm over — most of this platform's
real, live usage does not depend on sub-second cross-client task-state propagation.

---

## 29. Task recovery

Two genuinely different "recovery" concepts exist in this repository, and conflating them would be
inaccurate, so this document keeps them separate, consistent with the Explore pass that fed this
document's own discovery:

1. **AI-OS internal task/worker recovery** (`UMR-20260802-165541-c27d`, the recovery framework this
   task's own prompt cites) — covers worker/supervisor/task-lifecycle failure classes for the
   AI-agent dispatch system itself (checkpoint/resume, restart counts, `pending_review` gates). This
   is real, live, and already documented, but it is an internal, AI-Dev-Team-facing mechanism — it
   is not surfaced to end users and does not recover an end user's own task/ticket data.
2. **End-user, product-level task recovery** — i.e., "an end user accidentally deleted or
   irreversibly changed their own task; can it be recovered." **Confirmed, direct finding: no such
   mechanism exists for `tasks`, `tickets`, or `pmsIssues`.** There is no soft-delete, no undo, no
   trash/recycle-bin concept for any of the three real task-shaped tables (consistent with §27's
   finding that none of them has a deletion mechanism at all — there is, in a narrow sense, nothing
   to "recover from" today because there is no destructive delete path in the first place; the real
   gap is the absence of the whole category, not a broken recovery flow within it).

This is a real, honestly-named, product-level gap distinct from the AI-OS's own — already mature —
recovery framework; a future OCID extending recovery to end-user work items should build on the same
audit-log-backed reconstruction pattern already proven for AI-OS task recovery, not invent a
separate paradigm, but this document does not choose that design.

---

## 30. Task lifecycle summary

Pulling the real, current state of every section above into one place, without restating any of it
as a new rule:

1. **Creation** (§2/§3): an end user creates a task/ticket/issue through one of three real,
   independently-validated creation surfaces; each guarantees exactly one row, uniquely identified
   (§4).
2. **Assignment/ownership** (§6/§7): the row has exactly one real owner (or, for `pmsIssues`, real
   multi-assignee support); reassignment is a generic update, not a distinctly modeled event.
3. **Delegation** (§8), where used, layers time-bound, revocable authority over that owner without
   changing who owns the row.
4. **Execution and discussion** (§17/§18/§20): attachments and artifacts accumulate via the shared
   `documents` mechanism; discussion happens via real, live `comments` (chat, §18, lacks an AI reply
   path — out of this document's scope to fix).
5. **Approval/escalation**, where required (§10/§11): `approvalRequests` and, for tickets
   specifically, a full real SLA/escalation system; tasks have overdue detection but not tiered
   escalation.
6. **Completion** (§12): a real terminal status per table, each independently enforced; `tickets`
   alone has a dedicated resolution timestamp distinct from its status value.
7. **Reopen** (§13), where it happens, is currently indistinguishable at the data-model level from
   any other status change — a real, named gap.
8. **Throughout, not as a separate stage**: every write is audited (§14) via the platform-wide,
   append-only `auditLogs`; notifications (§23) fire on the real events already wired; visibility
   and permissions (§25/§26) are enforced continuously via RLS + RBAC/ABAC, not just at creation.
9. **Retention/recovery** (§27/§29): neither exists today for these three tables at the product
   level — every task/ticket/issue, once created, persists indefinitely with no defined disposal
   path and no recoverable-delete mechanism, a real, named gap distinct from the AI-OS's own,
   already-mature internal recovery framework.
10. **The already-designed, not-yet-built unifying layer** (§1.1): `activity_log`/TASK-04 is the
    real, existing, Owner/architecture-endorsed path to giving every one of the above stages one
    shared, queryable identity across `tasks`/`tickets`/`pmsIssues`/AI-dispatch activity alike — its
    Phase 1 shipped for AI-dispatch activity only; Phases 2-4, which would extend it to real
    end-user tasks, remain open, scoped, and ready for a future OCID to pick up without redesigning
    anything this document or `UNIVERSAL_TASK_WRAPPER_DESIGN.md` already worked out.

---

## Handoff to OCID-024 (and any later-numbered directive)

This document implements nothing and blocks nothing that was not already blocked. It is the first
canonical, end-user-work-model artifact for the VERIDIAN platform, grounded entirely in real,
currently-live tables, services, and constitution rules — `tasks`, `tickets`, `pmsIssues`,
`activity_log`/TASK-04, `comments`, `taskChatMessages`, `documents`, `notifications`, `auditLogs`,
`scopedDelegations`, `approvalRequests`, and the real RBAC/ABAC/RLS permission stack. Every gap named
above (task reopen, task decisions, task transfer, task-level escalation, task/ticket search
coverage, task reporting/analytics, task retention/recovery, and Phase 2-4 of the universal
`activity_log` envelope) already maps to a real, existing mechanism a future implementation OCID
would extend — none require a new architecture, a new table family, or a parallel work-item concept.

Per this repository's own standing gatekeeper rule (`UMR-20260802-165034-5747`), any future
directive that wants to close one of these gaps must re-verify live state before dispatching real
implementation work — this document is a point-in-time synthesis (2026-08-03) and will go stale as
real work lands, exactly like `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` and
`ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md`, both already cross-referenced above.

**Not acted on.** No implementation, database change, UI change, UX change, or AI/prompt change has
been made under this UMR. Awaiting Owner review, consistent with the OCID-020 implementation lock
this directive was scoped to respect (§ header, "Honest disclosure on 'OCID-021'" above).

Canonical artifact: this file,
`ai-os/VERIDIAN_UNIVERSAL_END_USER_WORK_MODEL_2026-08-03.md` — new, not a duplicate of any existing
file (confirmed via this session's `ai-os/boss/ACTIVE-CLAIMS.yaml` claim entry, and via the direct
`git log --all --name-only` check for `UNIVERSAL_TASK_WRAPPER_DESIGN.md` that surfaced the one real
piece of prior art this document builds directly on rather than duplicating).
