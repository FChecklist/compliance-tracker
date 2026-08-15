# OCID-058 — Real Execution Traceability Report (2026-08-04)

**Status: verification only, no code/schema change.** Direct answer to this OCID's core question:
"confirm whether each [real execution path] genuinely creates one real UTR style record referencing
real UMR objects." Companion documents:
`ai-os/VERIDIAN_OCID_058_UTR_REGISTRY_2026-08-04.md` (record-type inventory),
`ai-os/VERIDIAN_OCID_058_EXECUTION_ARCHITECTURE_REPORT_2026-08-04.md` (path-by-path architecture).

## 1. Per-path answer

| Execution path | Real record created | References a real UMR object? |
|---|---|---|
| Interactive Owner/Super-Boss dispatch (`dispatch-owner-task.sh`) | `instructions` (INS-*) + `umr_tasks` (UMR-*) + `work_items` (WRK-*, `ai_task_id=$UMR_ID`) | **Yes, directly** — `work_items.ai_task_id` is the real `umr_id` at this step (`:83`). |
| Headless worker creation (`veridian-task.py cmd_create`) | `task.yaml` + a **second, separate** `work_items` row (`ai_task_id=task["id"]`) + `platform.ops_dev_tasks` row | **No** — `task.yaml` has no `umr_id` field (confirmed by reading this task's own file in full); the new `work_items` row's `ai_task_id` is the `task_id`, not the dispatch-time `umr_id`; no record anywhere carries both ids together. |
| Headless worker checkpoint/usage (`_auto_log_task_event`) | `actions` (ACT-*) row | **No** — `work_item_id`/`instruction_id` are passed as `None` (no `--work-item-id`/`--instruction-id` flag in the real call, `veridian-task.py:122-141`, confirmed against `log_action()`'s literal INSERT at `superboss-register.py:1070-1082`); not linked to `umr_tasks`, `work_items`, or `instructions` at all. |
| Cron/systemd resume tick (`dispatch-tick.py resume_interrupted_workers_tick`) | fresh `umr_tasks` row, `task_identity=task_id` | **Yes, but only forward from that point** — `task_identity` genuinely equals the real `task_id` here (`:221-227`), so this specific `umr_tasks` row is traceable to the task. Does not retroactively link the original dispatch-time `umr_id`, which used a different, throwaway `task_identity` (`owner-task-<ts>-<pid>`, §2 of the UTR Registry doc). |
| `/api/internal/ops-task-sync` → `platform.ops_dev_tasks` | one row per task, keyed on `opsTaskId` | **No** — no `umr_id` column exists on this table; the real caller never sends one (confirmed by reading `_sync_to_app()`'s payload construction in full, zero `"UMR"` references). |
| `/api/ai/team/dispatch` → `platform.task_register` (Instruction Contract/Execution Report) | one row per `taskId`, `level`, `roleKey` | **No** — confirmed by direct grep of `route.ts`, `task-register-service.ts`, `instruction-contract.ts`: zero references to `umr_tasks`, `superboss-register`, or a UMR-shaped id anywhere. |
| GitHub `repository_dispatch` (`zai-task`/`claude-task`, `ai-dispatch.yml`) | **none** | **N/A** — the workflow's two jobs contain only `echo` statements; nothing real executes, so no record of any kind is created, UMR-linked or otherwise. |

## 2. Honest overall answer

**No real execution path today creates a single UTR-style record that both (a) carries the full
multi-actor/identity/governance/execution/business/evidence context the Owner's UTR proposal
describes and (b) reliably references a real UMR object across the task's full lifecycle.**

The one genuine, verified UMR reference (`work_items.ai_task_id = umr_id`, owner-dispatch step) is
real but momentary — it exists in exactly one row, written at the instant of dispatch, and is never
carried forward into the `task.yaml`/`ops_dev_tasks`/`task_register` records that represent the
*same* piece of work for the rest of its life. From the moment a headless worker task is actually
created, the real trail is: `task_id` (task.yaml, ops_dev_tasks.opsTaskId) — completely disconnected
from the `umr_id` that authorized the dispatch which created it, connected only by incidental
timing and free-text prompt content, not a database key. A human or script trying to answer "show
me every real record for UMR-20260804-035943-3c38, end to end" would have to: (1) find the
`umr_tasks` row, (2) find the `work_items` row where `ai_task_id` matches it (real, direct), (3)
then manually correlate that to a `task.yaml`/`ops_dev_tasks` row by **timestamp proximity and
prompt-text similarity only** — there is no query that joins them.

This is a real, concrete confirmation of the gap already named at a higher level of abstraction in
`ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md` §4 ("no cross-reference
convention connecting a task row back to a specific UMR knowledge record") — this document adds the
call-site-level evidence for exactly where that connection breaks, and confirms it breaks
differently (and separately) at each of the five real record types found.

## 3. What this does NOT mean

- It does **not** mean the underlying execution is broken. Every real path in §1 (except the
  GitHub stub) does real, verified work: tasks really get dispatched, really get resource-governed,
  really run, really checkpoint, really sync to the app database. The gap is in **cross-referencing
  the records these real mechanisms produce**, not in whether the mechanisms themselves function.
- It does **not** mean the Owner's `[UMR-...]`-tagged dispatch convention is fake — §0 of the UTR
  Registry document independently re-confirmed all 7 parent-chain ids are real, live `umr_tasks`
  rows. The convention is real at the dispatch instant; what's missing is its propagation into the
  records created downstream of that instant.

## 4. Recommendation (not authorized by this document — verification only)

Per this OCID's own explicit instruction, this finding is **held for a PM decision**, not
implemented here. If a future PM decision authorizes real implementation, it should decide between
(not pre-decided here):

1. **Thread `umr_id` through**: add a `umr_id` column to `task.yaml`'s schema (and
   `platform.ops_dev_tasks`), populated at `cmd_create` time from whatever UMR the dispatch step
   generated — the smallest real change, but requires `dispatch-owner-task.sh` to pass its `$UMR_ID`
   through to the eventual `cmd_create` call (currently these are two separate, unlinked script
   invocations with no parameter passed between them).
2. **Build the genuine six-context UTR table** the Owner originally proposed, with `umr_id` as a
   required foreign key from day one, and migrate `work_items`/`task_register` to reference it
   instead of duplicating task-tracking logic across five places.
3. **Do nothing new, document the seam**: accept that `umr_id` is a dispatch-time authorization
   record, and `task_id`/`opsTaskId`/`task_register.taskId` are lifecycle records for a different,
   deliberately separate concern, and only maintain the mapping informally as this document and its
   companions now do.

Any of these is new execution architecture and explicitly out of scope for OCID-058 itself.

## 5. Registration

- Canonical artifact: this file, plus
  `ai-os/VERIDIAN_OCID_058_UTR_REGISTRY_2026-08-04.md` and
  `ai-os/VERIDIAN_OCID_058_EXECUTION_ARCHITECTURE_REPORT_2026-08-04.md`.
- To be indexed in `ai-os/OS.yaml` and registered as a gap in `ai-os/MASTER-TRACKER.yaml`.
- No schema, code, or database change made by this document.
