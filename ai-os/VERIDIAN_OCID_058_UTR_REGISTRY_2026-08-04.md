# OCID-058 — Real UTR Registry (2026-08-04)

**Status: discovery and verification only.** Per this OCID's own dispatch text, this document
"shall not redesign execution and shall only certify the existing execution architecture." No
schema change, no code change, no database write beyond the `SELECT` queries used to verify facts
below. Parent chain: OCID-057 (`UMR-20260804-035943-3c38`), OCID-056 (`UMR-20260804-035904-142e`),
OCID-055 (`UMR-20260804-035817-6300`), OCID-054 (`UMR-20260804-035759-1eb2`), OCID-053
(`UMR-20260804-033853-2a17`), OCID-020 (`UMR-20260802-165606-4413`), OCID-021
(`UMR-20260802-173631-ca85`) — all 7 independently re-confirmed as real, live rows in
`umr_tasks` (see §0). Builds on, and does not contradict,
`ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md`'s §4 finding that no
structured six-context UTR model exists — this document goes one level deeper: it enumerates
**every real task-tracking record type that actually exists today**, across every real execution
path, and checks each one against a real UMR object, rather than stopping at "no UTR exists."

## 0. Parent-chain verification (real, direct query)

Queried `/opt/veridian/ai-os/memory/superboss-register.sqlite`'s `umr_tasks` table directly
(`SELECT umr_id, task_identity, status, tier, source_trigger, task_kind, ts_submitted FROM
umr_tasks WHERE umr_id=?`) for all 7 parent-chain ids. All 7 are real, live rows:

| umr_id | task_identity | status | tier | source_trigger |
|---|---|---|---|---|
| UMR-20260804-035943-3c38 | owner-task-20260804-035942-3123896 | running | 1 | owner_dispatch_gateway |
| UMR-20260804-035904-142e | owner-task-20260804-035903-3121810 | running | 1 | owner_dispatch_gateway |
| UMR-20260804-035817-6300 | owner-task-20260804-035816-3118844 | running | 1 | owner_dispatch_gateway |
| UMR-20260804-035759-1eb2 | owner-task-20260804-035757-3117668 | running | 1 | owner_dispatch_gateway |
| UMR-20260804-033853-2a17 | owner-task-20260804-033852-3054959 | running | 1 | owner_dispatch_gateway |
| UMR-20260802-165606-4413 | owner-task-20260802-165605-60124 | running | 2 | owner_dispatch_gateway |
| UMR-20260802-173631-ca85 | owner-task-20260802-173629-205629 | running | 3 | owner_dispatch_gateway |

**OCID-012**: `git grep -n "OCID-012"` across this entire repo returns **zero hits**. No matching
`umr_tasks` row, no matching document. Consistent with this session's own prior discovery pattern
(per this dispatch's own text: checked multiple times already this session, always zero matches).
Not registered as real. Flagged back to the Owner again, as instructed — this looks like a
recurring artifact of whatever generates these dispatch-prompt templates, not a real reference.

## 1. Real task-tracking record types that exist today (the actual "UTR" candidates)

Five genuinely distinct, real, independently-keyed record types were found. None of them is the
six-context (identity/governance/execution/business/knowledge-reference/evidence) model the Owner's
UTR proposal describes. Each is a real, narrower-purpose record with its own ID namespace.

### 1a. `umr_tasks` (the real UMR queue/ledger) — `superboss-register.py:2668-2686`

`umr_id TEXT PK, task_identity, ts_submitted, tier, status, source_trigger, task_kind, unit_name,
tenant_id, inputs_json, outputs_json, logs_ref, metric_snapshot_json, ts_dispatched, ts_sigterm,
ts_completed, reason, metadata_json, utm_source, utm_medium, utm_campaign, utm_content, utm_term`.
Written only by `upsert_umr_task()` (`superboss-register.py:2986-3042`), called only from
`resource_governor.py`'s `submit()` (`resource_governor.py:568-611`). This is a **governance/queue**
record (concurrency cap, EMERGENCY_STOP gate, tier-based priority) — it has no "actor" field beyond
`source_trigger` (a free string like `owner_dispatch_gateway`), no structured identity beyond
`task_identity` (a free string, format varies by caller — see §2), and no business/knowledge-
reference/evidence fields at all — those would have to live in `metadata_json`.

### 1b. `instructions` / `work_items` / `actions` (the Owner↔AI operational ledger) — `superboss-register.py:119-181`

- `instructions`: `instruction_id (INS-*), utm_*, raw_text, metadata_json` — the raw ask.
- `work_items`: `work_item_id (WRK-*), instruction_id, software_task_id, ai_task_id, cache_id,
  ai_cache_id, utm_*, status, metadata_json` — links an instruction to "the thing that will do it,"
  via **two different, both-optional** foreign-key-shaped columns (`software_task_id`,
  `ai_task_id`) that are populated inconsistently by different real callers (§2).
- `actions`: `action_id (ACT-*), work_item_id, instruction_id, utm_*, result, metadata_json` — a
  single logged action, with `work_item_id`/`instruction_id` **nullable and, per §2, frequently
  left NULL by real callers**.

These three tables carry real identity (`*_id`) and a real status/result, but — confirmed by direct
read of the full `CREATE TABLE` text — no named `actor_context`, `identity_context`, or
`governance_context` column anywhere. Everything beyond the flat columns is an opaque
`metadata_json` blob with no enforced shape.

### 1c. `task.yaml` (the per-worker-task file) — `veridian-task.py` `cmd_create` (~`:280-335`)

`id, title, status, repo, branch, workspace, task_dir, service, created_at, last_checkpoint_at,
completed_steps[], remaining_steps[], files_modified[], checkpoints[], execution_seconds,
restart_count, token_usage, hold_for_owner_signoff`. This repo's own worktree for **this task**
(`/opt/veridian/ai-os/tasks/task-20260804-045439-register-ocid-058--universal-task-regist/task.yaml`)
was read directly as a live example: it has **no `umr_id` field, and no `ai_task_id`/
`software_task_id` field either** — confirmed by reading the file in full. `checkpoints[]` carries
real timestamped status snapshots (governance/execution-shaped), but again no separately-named
identity/actor/governance-context fields — it is a flat worker-lifecycle record, not a UTR.

### 1d. `platform.ops_dev_tasks` (the app-side mirror) — `src/lib/db/schema.ts:1190-1205`

`id (cuid), opsTaskId (unique), title, repo, branch, status, prUrl, softwareTaskId, aiTaskId,
executionSeconds, restartCount, lastCheckpointNote, createdAt, lastSyncedAt`. Written via
`POST /api/internal/ops-task-sync` (`src/app/api/internal/ops-task-sync/route.ts:53-85`), whose
real caller is `veridian-task.py`'s `_sync_to_app()` (`:29-70`). **No `umr_id` column exists on this
table**, and the real caller never sends one — `softwareTaskId`/`aiTaskId` are read straight from
the ops-side task dict's own (usually-unset — see §2) fields, never from a UMR string.

### 1e. `platform.task_register` (the AI Dev Team Instruction Contract / Execution Report) — `src/lib/db/schema.ts:11412-11423`

`id, taskId (unique), level ("L0"-"L5"), scope, roleKey, status, instructionContract (jsonb),
executionReport (jsonb, nullable), createdAt, updatedAt, completedAt`. Written via
`registerInstructionContract()` / `recordExecutionReport()` in
`src/lib/ai-router/task-register-service.ts` (`:41-171`), called from
`/api/ai/team/dispatch`'s `route.ts` (`:284-333`, `:640-649`) when a `softwareTeamLevel` is
declared. This is the **closest existing real analog** to a structured task-registry record — its
`instructionContract` JSON shape (`src/lib/ai-router/instruction-contract.ts:30-49`) carries
`taskId, level, roleKey, objective, preconditions, input, process, constraints,
expectedOutputFormat, validationCriteria, successCriteria, failureCriteria, retryPolicy,
escalationRule, documentationRequirements, evidenceRequired, handoverRequirements, expectedSteps` —
real fields covering execution/evidence/governance-*shaped* concerns, but as the Owner's own
Universal Tightened Instruction Template vocabulary, not as separately-named
`actorContext`/`identityContext`/`governanceContext` objects, and confirmed by direct grep of
`instruction-contract.ts`: **zero occurrences of any of those three field names**. Also confirmed:
`taskId` here is yet another independent ID namespace — no `umr_id` field anywhere in this table or
its TS shapes, and no reference to `superboss-register.sqlite`/`umr_tasks` anywhere in `route.ts` or
`task-register-service.ts` (direct grep, zero hits).

## 2. Cross-reference reality — do any of these actually link to a real UMR object?

Only **one** real, code-level link from any of the above back to `umr_tasks` was found, and it is
partial and inconsistent, not a universal join key:

- **Owner/Super-Boss dispatch** (`dispatch-owner-task.sh:55-86`): logs `instructions` (real
  `instruction_id`), then calls `resource_governor.py --submit` with
  `task_identity="owner-task-<timestamp>-<pid>"` (`:60-69`) — **not** the eventual `task.yaml`
  `id` (which does not exist yet at this point) — getting back a real `umr_id`, then logs
  `work_items` with `--ai-task-id "$UMR_ID"` (`:83`). So **at the instant of owner dispatch**,
  `work_items.ai_task_id` genuinely equals a real `umr_id`. This is the one real, confirmed link.
- **Once a headless worker task is actually created** (`veridian-task.py` `cmd_create`), a
  **second, separate** `work_items` row is auto-logged via `_auto_log_task_event("create", task,
  ...)` → `log-work --ai-task-id task["id"]` (`veridian-task.py:117-121`) — here `ai_task_id` is
  the **task_id** (e.g. `task-20260804-045439-...`), not the `umr_id` from the dispatch step above.
  Direct read of this task's own `task.yaml` confirms it carries **no `umr_id` field at all** to
  bridge back to the dispatch-time UMR row. The two real IDs (`UMR-...` from dispatch,
  `task-...` assigned at creation) are never written to a shared record together — the only
  linkage between them is **incidental**: the owner's original prompt text (relayed verbatim into
  the tmux session per `dispatch-owner-task.sh:90-98`) and rough timestamp proximity, not a
  database foreign key.
- **Worker checkpoint/usage logging** (`_auto_log_task_event("checkpoint"/"record_usage", ...)`,
  `veridian-task.py:122-141`): calls `log-action` with **no `--work-item-id` and no
  `--instruction-id` flag at all**. Confirmed by reading `log_action()`'s own INSERT
  (`superboss-register.py:1070-1082`): `args.work_item_id`/`args.instruction_id` are passed
  straight through, so every real worker checkpoint's `actions` row is written with
  `work_item_id=NULL, instruction_id=NULL` — disconnected from both the `work_items` row created at
  `cmd_create` and from any `umr_id`.
- **Cron/systemd resume** (`dispatch-tick.py` `resume_interrupted_workers_tick()`, `:191-231`):
  re-submits an interrupted worker via `resource_governor.submit(task_spec={"task_identity":
  task_id, ...})` (`:221-227`) — here `task_identity` **is** the real `task_id`, so a fresh
  `umr_tasks` row created on resume genuinely does carry the task_id as its `task_identity`. This
  is real and correct **only for the resume path**, and only from that tick forward — it does not
  retroactively link the original dispatch-time `umr_id` either.
- **`platform.ops_dev_tasks`**: confirmed via direct grep of `_sync_to_app()` and its payload
  construction — zero references to `umr_id`/`"UMR-"` anywhere near it. No link.
- **`platform.task_register`** (AI Dev Team): confirmed via direct grep of `route.ts`,
  `task-register-service.ts`, `dispatch-outcomes.ts` — zero references to `umr_tasks`,
  `superboss-register`, or a UMR id (one comment in `dispatch-outcomes.ts:17` mentions
  `superboss-register.py`'s `check_duplicate()` only as a design analogy, not a real call). No link.
- **GitHub `repository_dispatch`** (`zai-task`/`claude-task`, `.github/workflows/ai-dispatch.yml`):
  the entire workflow is 31 lines, two jobs (`dispatch-log`, `zai-agent`), both **only `echo`
  statements** — no real API call, no DB write, no script invocation of any kind. Zero UMR
  registration is possible here because nothing real executes at all. This matches AGENTS.md's own
  admission that the `claude-task` path "has never had a working job behind it."

## 3. Honest conclusion — the real gap (per this OCID's own instruction: report, do not build)

A true multi-actor UTR record structure — one record type, with separately-named
`actor_context`/`identity_context`/`governance_context` (plus execution/business/knowledge-
reference/evidence) fields, that every real execution path writes to and that cross-references a
real UMR object by a consistent key — **does not exist in the live schema today**, confirmed by
direct reading of every real schema definition and every real write call site involved (§1-§2), not
assumed from the earlier 2026-08-03 discovery document alone (this document independently
re-verified and extends that finding down to the actual call-site level).

What exists instead is **five real, independently-keyed, partially-overlapping record types**
(`umr_tasks`, `instructions`/`work_items`/`actions`, `task.yaml`, `platform.ops_dev_tasks`,
`platform.task_register`), each covering one slice of "task tracking" for one execution path, with
only one confirmed real (and immediately superseded) cross-link between any two of them. Building
the missing unified structure would be new execution architecture — explicitly out of scope for
this OCID. This finding is held for a PM decision on whether it becomes a real implementation task
under OCID-021 or a later phase (see the companion Execution Traceability Report's §4
recommendation for the specific shape options this would need to choose between).

## 4. Registration

- Canonical artifact: this file, plus its two companions:
  `ai-os/VERIDIAN_OCID_058_EXECUTION_ARCHITECTURE_REPORT_2026-08-04.md` and
  `ai-os/VERIDIAN_OCID_058_EXECUTION_TRACEABILITY_REPORT_2026-08-04.md`.
- To be indexed in `ai-os/OS.yaml`, following the existing registration pattern.
- Cites `UMR-20260804-035943-3c38` (OCID-057, this dispatch's own id) and the full parent chain in
  §0. Extends, does not contradict, `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md`.
- No schema, code, or database change made by this document. Discovery and verification only.
