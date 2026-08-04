# OCID-068 — Universal Governance Runtime Consolidation: Owner Review Package (States 1-6)

Real UMR for this dispatch: **`UMR-20260804-164614-bc46`** (the nine-state-execution-machine
addendum), plus a further real requirement-specification addendum **`UMR-20260804-170055-a069`**
(the structured OCID/UMR/PR/commit/file-path traceability requirement, §4e), both citing real parent
`UMR-20260804-164106-3fb8` (OCID-068 itself), real grandparent `UMR-20260804-095259-325a`
(OCID-066), and the real cited governance directive `UMR-20260804-051521-7099`. Reference gate:
OCID-020 (`UMR-20260802-165606-4413`).

**This document executes states 1 through 6 of the real nine-state execution machine only.** State
7 (the implementation gate) is reached at the end of this document and this document **stops
there**, exactly as specified. No file was merged, no function was removed, no script was converted
into a wrapper, no database, table, or registry was changed. Every command run to produce this
document was read-only (`cat`/`Read`/`grep`/`wc -l`/read-only SQL/`systemctl status`/`crontab -l`).

## 0. State 7 gate check — OCID-020 status, confirmed before proceeding past state 6

Independently checked, not assumed: **OCID-020 (`UMR-20260802-165606-4413`) is NOT verified
complete.** Real, current evidence:
- The real production regression this platform-wide gate depends on
  (`GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS`) was root-caused and fixed this same session
  (migration `0312` applied to production, independently re-verified live: 4/4 fresh real users get
  a real `200` from `/api/me`), but the fix itself is still sitting in an unmerged PR (#900) pending
  genuine independent review — not yet a real, closed, merged state.
- The broader OCID-020 certification chain (OCID-038 → OCID-039 → OCID-040, the standing hard rule
  already governing OCID-021 and the Group E chain) has not independently, completely cleared.
- This session directly witnessed, live, real end-user-facing regression work still active during
  the same window this document was produced (multiple OCID-020-labeled worker dispatches running
  concurrently, e.g. `task-20260804-164230-pm-decision-proceed-with-real-conflict-r`).

**Conclusion: state 7's condition ("OCID-020 status equals verified") is false. This document stops
here.** State 8 (real implementation) and state 9 (final verification) are not started, will not be
started, and require a fresh, explicit, real-time Owner confirmation in chat specifically
authorizing state 8 — not this document, not the original directive text — before any such work
begins.

---

## STATE 1 — Discovery Inventory

Scoped from the full `/opt/veridian/scripts/` tree (85 Python + 21 shell = 106 files) down to the
real governance-relevant set via a targeted pattern search (`umr_tasks`, `task.yaml`,
`ACTIVE-CLAIMS`, `MASTER-TRACKER`, `umr_id`, `UMR-2026`, `resource_governor`,
`dispatch-owner-task`, `veridian-task.py`, `OCID-`, `registry`), then narrowed to the files that
genuinely participate in task/UMR/artifact/status creation or registry read/write (the wider
61-file candidate list included false positives — generic mentions of the word "registry" in
unrelated report-generator scripts — excluded from the table below with a note).

### 1a. Real governance scripts (21 files read in full across 4 parallel discovery passes)

| File | Role (one line) |
|---|---|
| `veridian-task.py` | Sole real writer of `task.yaml` / `CONTROLLER.yaml` sync |
| `task-gateway.py` | Governed front-door/orchestrator (`submit`/`start`/`log`/`close`/`status`) for one real dispatch path |
| `dispatch_core.py` | Pure concurrency-gating primitive (lock + slot + resource headroom) |
| `dispatch-owner-task.sh` | Second, independent owner-dispatch front door (bypasses task-gateway.py) |
| `dispatch-docworker-task.sh` | Narrow, manual docworker-dispatch wrapper around `veridian-task.py create`, with an undisciplined direct `sed` patch |
| `resource_governor.py` | Sole owner of the `umr_tasks` queue/dispatch cycle, real Stage 4/5/6 duplicate-PR guard |
| `resource_governor_tick_loop.sh` | Sole invoker of `resource_governor.py --tick`/`--reconcile-stale`, every 30s |
| `dispatch-tick.py` | Consolidation of `supervisor-sweep.sh` + `queue-dispatcher.py` + `module-queue-dispatcher.py` |
| `phase-continuation-tick.py` | Consolidation of `auto_phase_continuation.py`; phase-plan-driven dispatch via `task-gateway.py` |
| `status-remediation-tick.py` | Consolidation of `veridian_status_monitor.py` + `veridian_remediation_dispatcher.py --apply` |
| `auto_phase_continuation.py` | **Dead** predecessor of `phase-continuation-tick.py`, no live trigger, still fully runnable |
| `worker-entrypoint.sh` | Sole real entrypoint for every `veridian-worker@*` unit |
| `doc-worker-entrypoint.sh` | Sole real entrypoint for every `veridian-docworker@*` unit (intentional fork) |
| `supervisor-entrypoint.sh` | Sole real entrypoint for every `veridian-supervisor@*` unit |
| `supervisor-sweep.sh` | **Dead**, superseded by `dispatch-tick.py`'s `supervisor_sweep_tick()` |
| `veridian-task-watchdog.py` | Stall/loop detection + RCA auto-escalation — **currently disabled at the trigger level** |
| `sweep_awaiting_approval.py` | **Dead by design**, one-time 2026-07-31 backlog remediation utility |
| `superboss-register.py` | Schema/CRUD owner for `umr_tasks` + 10 other registry tables |
| `directive_engine.py` | `DIRECTIVE.yaml` → dispatch pathway, real documented duplicate-guard (PR #617 fix) |
| `owner_status.py` | Read-only `umr_tasks` reporting tool |
| `plan_generator.py` | Plan/DAG generation; owns `check_reuse_before_dispatch()` (real but unwired) |
| `sync-controller-back.py` | `task.yaml` → `CONTROLLER.yaml` sync (terminal tasks only) |
| `system-sync.py` | 5 independent drift/staleness detectors, one of which restarts blocked units |
| `veridian_remediation_dispatcher.py` | Narrow CI/merge auto-fix classes + human-drafted remediation prompts |
| `regenerate_master_index.py` | Wholesale `MASTER_INDEX.yaml` rewrite, manual-only (not cron-wired) |
| `wiring_query.py` | Thin, read-only, in-process convenience wrapper over `superboss-register.py` |

### 1b. Real data stores discovered

| Store | Real state |
|---|---|
| `/opt/veridian/ai-os/memory/superboss-register.sqlite` | **Real, live, 1.03GB.** Owns 11 tables incl. `umr_tasks` (2,227 real rows, confirmed via direct read-only query, newest rows timestamped the same day as this document). |
| `/opt/veridian/ai-os/umr_tasks.db` | **Dead decoy.** Zero tables. Zero references anywhere in `/opt/veridian/scripts/` (confirmed by exhaustive grep across all 4 discovery passes). An earlier, separate finding this session incorrectly treated this file as *the* real UMR store and concluded no query access existed — that was a real error, now corrected (see PR #912, correcting already-merged PR #907). |
| `ai-os/tasks/*/task.yaml` (per-task files) | Real, live, owned exclusively by `veridian-task.py`'s `save_task()`. |
| `ai-os/CONTROLLER.yaml` | Real, live, synced by `veridian-task.py` (on create/checkpoint) and `sync-controller-back.py` (terminal tasks). |
| `ai-os/boss/ACTIVE-CLAIMS.yaml` | Real, live. **No file in any of the 4 discovery passes writes to this file directly** — it is maintained entirely by hand/by AI-authored commits, not by any governance script. |
| `ai-os/MASTER-TRACKER.yaml`, `ai-os/OS.yaml`, `ai-os/MASTER_INDEX.yaml` | Real, live governance registries. `regenerate_master_index.py` is the only script found that writes `MASTER_INDEX.yaml` (manual-only). No script writes `MASTER-TRACKER.yaml`/`OS.yaml` — also hand/AI-commit-maintained. |

### 1c. Real systemd trigger inventory (from `~/.config/systemd/user/*`, live `systemctl` state)

| Unit | Real target script | Live state |
|---|---|---|
| `veridian-worker@.service` | `worker-entrypoint.sh %i` | Start-only, no `[Install]` (deliberate, post-OOM-kill fix) |
| `veridian-docworker@.service` | `doc-worker-entrypoint.sh %i` | `WantedBy=default.target` |
| `veridian-supervisor@.service` | `supervisor-entrypoint.sh %i` | Start-only, `Restart=no` |
| `veridian-task-watchdog.service`+`.timer` | `veridian-task-watchdog.py` | **Timer disabled/inactive — confirmed live** |
| `veridian-governor-tick.service` | `resource_governor_tick_loop.sh` | `Restart=always`, enabled, no timer (always-on loop) |
| `veridian-cron-dispatch-tick.timer` | `dispatch-tick.py` (via `run-logged.sh`) | Enabled/active, `EMERGENCY_STOP`-gated, part of documented closed set of 18 |
| `veridian-dispatch-tick.timer` | `dispatch-tick.py` (direct) | **Enabled/active, NOT `EMERGENCY_STOP`-gated, added 2026-07-31 outside the documented closed set — a live, undocumented second trigger for the same script** |
| `veridian-cron-phase-continuation-tick.timer` | `phase-continuation-tick.py` | Enabled/active, single timer, `EMERGENCY_STOP`-gated |
| `veridian-cron-status-remediation-tick.timer` | `status-remediation-tick.py` | Enabled/active, single timer, `EMERGENCY_STOP`-gated |
| (none found) | `supervisor-sweep.sh` | No live trigger — only reachable by manual invocation (this session ran it manually) |
| (none found) | `auto_phase_continuation.py` | No live trigger — historical crontab entry retired, superseded |

---

## STATE 2 — Real Call Graph

```
OWNER / INTERACTIVE SESSION                    AUTOMATED TRIGGERS (systemd)
        |                                              |
        |  (no shared choke point — see §4a)           |
        v                                              v
 dispatch-owner-task.sh                    veridian-governor-tick.service (always-on)
   -> superboss-register.py                    -> resource_governor_tick_loop.sh
        (check-content-duplicate,                    -> resource_governor.py --tick
         log-instruction)                                  -> scan_stuck_tasks()
   -> resource_governor.py --submit                         -> dispatch_one() per queued row
        -> upsert_umr_task() [NEW UMR ROW]                       -> find_pr_for_task_identity()
                                                                        (Stage 4/5/6 dup-PR guard)
                                                                   -> _perform_spawn()
                                                                        -> veridian-task.py create
                                                                             [NEW task.yaml]
 task-gateway.py submit/start              veridian-cron-dispatch-tick.timer  }  BOTH point at
   -> tight_task_validation.py             veridian-dispatch-tick.timer      }  dispatch-tick.py,
   -> ddl_authorization_check.py                  -> dispatch-tick.py             live + uncoordinated
   -> superboss-register.py claim-task-key             -> supervisor_sweep_tick()
        [NEW task_claims ROW, real dup guard]               -> systemctl start veridian-supervisor@
   -> veridian-task.py create [NEW task.yaml]          -> resume_interrupted_workers_tick()
                                                              -> resource_governor.submit()
                                                                   [routes through real dedup]
                                                              -> gap_queue_tick()
                                                                   -> veridian-task.py create
                                                                        [NEW task.yaml, NO umr_tasks
                                                                         row, NO Stage 4/5/6 guard]
                                                              -> module_queue_tick()
                                                                   -> veridian-task.py create
                                                                        [same gap as gap_queue_tick]

                                            veridian-cron-phase-continuation-tick.timer
                                                 -> phase-continuation-tick.py
                                                      -> already_dispatched() [weak heuristic]
                                                      -> task-gateway.py submit + start
                                                           [NEW task.yaml via the gated path,
                                                            but NEVER via resource_governor.submit(),
                                                            so Stage 4/5/6 guard never runs here either]

 dispatch-docworker-task.sh (manual)
   -> veridian-task.py create [NEW task.yaml, ONLY EMERGENCY_STOP-gated]
   -> sed -i task.yaml   [direct, unlocked, non-atomic field edit]

worker-entrypoint.sh / doc-worker-entrypoint.sh (run by systemd once a unit is started)
   -> preflight-guard.py [own-task resource/budget checks ONLY — no cross-task/cross-session check]
   -> claude -p ...
   -> veridian-task.py checkpoint [UPDATE, not creation]
   -> on success: systemctl start veridian-supervisor@<id>  (worker-entrypoint.sh only)

supervisor-entrypoint.sh
   -> if review.json exists for THIS task_id: exit 0 (narrow, same-task_id-only dedup)
   -> claude -p (review) -> review.json -> gh pr create [NEW PR] -> gh pr merge (autonomous, Rule 12)
```

**Key structural fact, stated once and referenced throughout**: the real `umr_tasks`-level
duplicate-PR guard (`resource_governor.py`'s Stage 4/5/6, `find_pr_for_task_identity`) is real and
functionally correct — but it is wired into exactly **one** of at least **five** real, independent
paths that create a new `task.yaml`/task_id (`resource_governor._perform_spawn`,
`dispatch-tick.py:gap_queue_tick`, `dispatch-tick.py:module_queue_tick`,
`phase-continuation-tick.py:dispatch` via `task-gateway.py`, `dispatch-docworker-task.sh`). The
other four either have no duplicate guard at all, or a weaker, independently-reimplemented
heuristic (`existing_scope_conflict()`, `already_dispatched()`) that is documented, in the
discovery passes above, to have real, understood false-negative windows.

---

## STATE 3 — Canonical File Selection, With Evidence

| File | Classification | Evidence |
|---|---|---|
| `veridian-task.py` | **CANONICAL** | Sole file that writes `task.yaml`/`CONTROLLER.yaml` (confirmed: grep found no other script performs an equivalent write, except the one narrow `sed` exception in `dispatch-docworker-task.sh`, item below). 4+ independent real callers. |
| `resource_governor.py` | **CANONICAL** | Sole file with `_ensure_umr_table`/write-lock discipline for `umr_tasks`; explicit RCA-fix docstring citing the real `veridian-task-watchdog.timer` 9h18m incident. |
| `superboss-register.py` | **CANONICAL** | Schema/migration owner for `umr_tasks` + 10 other tables; every other file that touches those tables either imports this module in-process (`wiring_query.py`, `resource_governor.py`) or issues a raw SQL read against the same DB path it created (`directive_engine.py`, `owner_status.py`) — no file independently reimplements the schema. |
| `dispatch_core.py` | **CANONICAL / HELPER** | Correctly scoped pure concurrency primitive; its own docstring states it "never itself decides WHAT to dispatch"; 8 real confirmed importers, zero creation logic. |
| `dispatch-tick.py` | **CANONICAL** | Explicit, documented consolidation of 3 predecessor scripts (`supervisor-sweep.sh`, `queue-dispatcher.py`, `module-queue-dispatcher.py`), confirmed via `README-dispatch-consolidation.md`'s own mapping table. |
| `resource_governor_tick_loop.sh` | **CANONICAL / HELPER** | Sole invoker of `resource_governor.py`'s tick+reconcile cycle; no other file starts this loop. |
| `phase-continuation-tick.py` | **CANONICAL** | Explicit, documented consolidation of `auto_phase_continuation.py`, confirmed sole target of its systemd timer. |
| `status-remediation-tick.py` | **CANONICAL** | Explicit, documented consolidation of `veridian_status_monitor.py` + `veridian_remediation_dispatcher.py --apply`. |
| `worker-entrypoint.sh` | **CANONICAL** | Literal `ExecStart=` target of `veridian-worker@.service`, confirmed via 5 live running instances at investigation time. |
| `doc-worker-entrypoint.sh` | **CANONICAL** | Literal `ExecStart=` target of `veridian-docworker@.service`; own header documents it as an intentional, justified fork (real subscription auth + Playwright MCP), not accidental duplication. |
| `supervisor-entrypoint.sh` | **CANONICAL** | Literal `ExecStart=` target of `veridian-supervisor@.service`; directly wired from both `worker-entrypoint.sh`'s success path and `dispatch-tick.py`'s discovery sweep. |
| `task-gateway.py` | **CANONICAL for its one governed path** (self-described as WRAPPER/orchestrator over `veridian-task.py`+others, but is itself the authoritative governance-gate sequencing layer — not a duplicate of what it wraps) | Own docstring states this explicitly; confirmed 5 real callers (`phase-continuation-tick.py`, `auto_phase_continuation.py`, `directive_engine.py`, `automation_rule_engine.py`, `prompt_gateway/gateway.py`). |
| `directive_engine.py` | **CANONICAL** | Real, documented duplicate-guard fix for a specific historical incident (PR #617, redispatched 6x same day) — not dead code, not a wrapper. |
| `plan_generator.py` | **CANONICAL for plan/DAG generation** | Real tables (`plans`/`plan_steps`), real capability resolution. Its `check_reuse_before_dispatch()` sub-function is real but **UNWIRED** (see §4c). |
| `sync-controller-back.py` | **CANONICAL** | Sole file confirmed to both read AND write `task.yaml` (idempotent, `master_synced_at` marker) outside of `veridian-task.py` itself. |
| `system-sync.py` | **CANONICAL** | 5 independently-justified detectors, each citing a specific real incident; only file confirmed to directly restart a blocked unit outside the governed dispatch path (flagged as a parallel resume mechanism, §4d). |
| `veridian_remediation_dispatcher.py` | **CANONICAL** for its narrow mechanical-fix classes | Real self-test, real fixture cleanup, explicit judgment/mechanical split. |
| `regenerate_master_index.py` | **CANONICAL, manual-only** | Explicitly not cron-wired per its own docstring; real checksum-guard, real non-destructive backup. |
| `wiring_query.py` | **HELPER** | Thin, genuinely non-duplicative, read-only (`mode=ro`) convenience layer. |
| `owner_status.py` | **HELPER** | Small, real, read-only; makes zero writes anywhere (confirmed by grep for write ops). |
| `veridian-task-watchdog.py` | **CANONICAL in code, but currently non-live** | Real, well-engineered dedup (`find_active_umr_by_identity` scoped to its own `rca-<task_id>` escalations), real anti-injection whitelist — but its timer is confirmed `disabled`/`inactive` right now. |
| `dispatch-owner-task.sh` | **DUPLICATE dispatch entry point** (not a wrapper) | Confirmed: never calls `task-gateway.py` (zero string matches); independently reimplements "dedupe → register → link work-item," going through `resource_governor.py` instead; applies none of `task-gateway.py`'s governance battery (`tight_task_validation.py`, `ddl_authorization_check.py`, `claim-task-key`, OWNER_ENGINE gate, credit-accountant propose). |
| `dispatch-docworker-task.sh` | **WRAPPER with one undisciplined side-effect** | Calls the real `veridian-task.py create` (not a duplicate of the creation logic), but its own `sed -i` patch to `task.yaml`'s `service:` field bypasses `veridian-task.py`'s own flock/atomic-write convention — the one place in the whole inventory a `task.yaml` is edited outside `save_task()`. |
| `supervisor-sweep.sh` | **OBSOLETE / SUPERSEDED** | Named explicitly in `dispatch_core.py`'s own docstring as one of 3 root causes of the 2026-07-26 OOM-kill incident; `README-dispatch-consolidation.md` has an explicit mapping row `supervisor-sweep.sh → dispatch-tick.py`; confirmed no live systemd/cron trigger — this session's own use of it (per the earlier PR-conflict-resolution cycle) was a manual, one-off invocation, not a live path. |
| `sweep_awaiting_approval.py` | **OBSOLETE by design** | Own docstring: "one-time backlog sweep, 2026-07-31"; zero live callers found anywhere. |
| `auto_phase_continuation.py` | **OBSOLETE / DUPLICATE, dead but dangerous** | Byte-for-byte near-identical logic to `phase-continuation-tick.py`, confirmed no live trigger (crontab entry retired), but **fully runnable on disk with none of the concurrency-gating fixes** its successor has — a real re-trigger risk, not just historical noise. |
| `/opt/veridian/ai-os/umr_tasks.db` | **DEAD DECOY ARTIFACT** (data file, not code) | Zero tables, zero references anywhere in `/opt/veridian/scripts/` across all 4 discovery passes — already independently caused one real, disclosed error this session (a merged PR, since corrected, wrongly concluded "no umr_tasks query access exists" because of this file's misleading name). |
| `veridian-dispatch-tick.timer` | **DUPLICATE TRIGGER** (unit file, not code) | Points at the exact same `dispatch-tick.py` as `veridian-cron-dispatch-tick.timer`; added 2026-07-31 outside the documented closed set of 18; not `EMERGENCY_STOP`-gated unlike its sibling; no README entry acknowledging it. |

---

## STATE 4 — Complete Merge Specification

**No action in this section is performed by this document.** This is the specification for what
state 8 (locked, not authorized) would need to execute, once OCID-020 is verified and a fresh
explicit Owner confirmation is given.

### 4a. Files to remain CANONICAL, unmerged (no change)
`veridian-task.py`, `resource_governor.py`, `superboss-register.py`, `dispatch_core.py`,
`dispatch-tick.py`, `resource_governor_tick_loop.sh`, `phase-continuation-tick.py`,
`status-remediation-tick.py`, `worker-entrypoint.sh`, `doc-worker-entrypoint.sh`,
`supervisor-entrypoint.sh`, `task-gateway.py`, `directive_engine.py`, `plan_generator.py`,
`sync-controller-back.py`, `system-sync.py`, `veridian_remediation_dispatcher.py`,
`regenerate_master_index.py`, `wiring_query.py`, `owner_status.py`.

**Real function mapping (unchanged, for traceability):** task creation →
`veridian-task.py:cmd_create/save_task`; task update → `veridian-task.py:cmd_checkpoint`; UMR row
creation → `resource_governor.py:submit → superboss-register.py:upsert_umr_task`; duplicate-PR
guard → `resource_governor.py:find_pr_for_task_identity` (called only from `dispatch_one`); worker
lifecycle → `worker-entrypoint.sh`/`doc-worker-entrypoint.sh`; review/merge →
`supervisor-entrypoint.sh`.

**Real database mapping (unchanged):** `umr_tasks`, `instructions`, `work_items`, `actions`,
`system_index`, `log_index`, `execution_log`, `known_fixes`, `knowledge_engine`,
`capability_registry`, `route_replay`, `wiring_registry`, `task_claims` — all in
`superboss-register.sqlite`, all schema-owned by `superboss-register.py`. `plans`/`plan_steps` —
same physical file, owned by `plan_generator.py`.

**Real entry-point mapping (unchanged):** see State 1c's systemd table.

### 4b. File to become a thin wrapper
`dispatch-docworker-task.sh` — its `sed -i` patch to `task.yaml`'s `service:` field should be
replaced with a real, disciplined call into `veridian-task.py` (e.g. a new `--service-template
docworker` flag on `cmd_create`, reusing `save_task()`'s own flock/atomic-write path) instead of an
unlocked direct file edit. The rest of the script (EMERGENCY_STOP check, unit
stop/disable/re-enable sequencing) is real and specific to the docworker redirect problem it
solves and should remain.

### 4c. Files/functions to be wired in, not removed
- `plan_generator.py:check_reuse_before_dispatch()` — real, functional, currently unwired into
  `resource_governor.py:submit()`'s actual gate logic (only referenced in a docstring as an intended
  write target for `umr_tasks.metadata_json.reuse_check_result`). Recommendation for state 8 (not
  executed here): wire this as an advisory annotation on every `submit()` call, matching its own
  documented "never blocks" design — this does not change its advisory nature, only ensures the
  advisory signal is actually recorded, per its own stated purpose.
- `veridian-task-watchdog.timer` — confirmed disabled/inactive. Recommendation for state 8: either
  re-enable it (its own escalation-dedup logic is real and sound) or explicitly document why it
  stays off, rather than leaving it silently dormant.

### 4d. Files/units to be removed or explicitly retired
- `supervisor-sweep.sh` — superseded, no live trigger, but still directly runnable (this session ran
  it manually, successfully, alongside the live `dispatch-tick.py` mechanism that already
  reimplements its exact logic under a real concurrency gate). Recommendation: delete or rename with
  a `.deprecated` suffix, and update this session's own operating habit to prefer
  `dispatch-tick.py`'s tick cycle (or a direct, explicit `systemctl --user start
  veridian-supervisor@<id>` per task) over re-invoking this file.
- `sweep_awaiting_approval.py` — one-time-by-design, already served its purpose (2026-07-31 backlog).
  Recommendation: delete or archive; do not re-run without first re-verifying its `CONTROLLER.yaml`
  targeting still matches current task-state semantics.
- `auto_phase_continuation.py` — dead, but a real re-trigger hazard (fully functional, pre-fix
  concurrency behavior). Recommendation: delete outright, not just leave dormant — its continued
  presence on disk is itself the risk, independent of whether anything currently points at it.
- `/opt/veridian/ai-os/umr_tasks.db` — dead, zero references, actively misleading name.
  Recommendation: delete.
- `veridian-dispatch-tick.timer` — duplicate trigger for `dispatch-tick.py`. Recommendation: disable
  and remove one of the two timers (keep `veridian-cron-dispatch-tick.timer`, since it is the one
  that is both `EMERGENCY_STOP`-gated and part of the documented closed set; the other was added
  2026-07-31 without an update to the closed-set README, which is itself a process gap to close
  alongside the removal), or explicitly document both as intentional with updated reasoning in the
  README if the Owner wants the redundancy.

### 4e. New requirement (addendum `UMR-20260804-170055-a069`): structured OCID -> UMR -> PR -> commit -> file-path traceability

**Real Owner requirement, added to this merge specification, not implemented here.** The Owner has
directly requested that the linkage between an OCID number, its real UMR, the PR(s) and commit(s)
that closed it, and the real file path(s) it touched, exist as deterministic, foreign-keyed,
structured database rows — not free text scattered across `ACTIVE-CLAIMS.yaml`/`MASTER-TRACKER.yaml`
prose (which is exactly how this document itself, and every prior OCID registration doc this session
produced, currently records that linkage: as narrative citations like "OCID-053
(`UMR-20260804-033853-2a17`), PR #867"). This is a real, legitimate gap: State 1-5 above traced the
real `umr_tasks` table (`superboss-register.sqlite`) and confirmed it stores `umr_id` +
`task_identity` + status/tier/timestamps, but has **no column or linked table for OCID number, PR
number, commit hash, or file path** — that information exists only as prose in governance markdown
files today, exactly as this new requirement observes.

**This is real implementation on live core infrastructure** (a schema change to `umr_tasks` or a new
linked table in `superboss-register.sqlite`) and is explicitly **not performed by this document** —
it stays behind the same state 7 gate as the rest of OCID-068's merge specification, requiring OCID-020
independently verified complete plus a fresh, explicit, real-time Owner confirmation before any real
schema change proceeds. What follows is the required design proposal only.

**Design proposal (two real options, for Owner review — neither implemented):**

*Option A — new linked table, `ocid_artifact_links`, foreign-keyed to `umr_tasks.umr_id`:*
```sql
CREATE TABLE ocid_artifact_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ocid_number TEXT NOT NULL,          -- e.g. 'OCID-053'
  umr_id TEXT NOT NULL REFERENCES umr_tasks(umr_id),
  repo TEXT NOT NULL,                 -- e.g. 'FChecklist/compliance-tracker'
  pr_number INTEGER,                  -- nullable: an OCID may be UMR-registered before a PR exists
  commit_sha TEXT,                    -- nullable: filled once merged
  file_path TEXT,                     -- one row per real file touched, or NULL for a PR-level row
  link_kind TEXT NOT NULL,            -- 'registration' | 'discovery' | 'fix' | 'certification' | ...
  created_at TEXT NOT NULL,
  UNIQUE(ocid_number, umr_id, repo, pr_number, file_path)
);
CREATE INDEX idx_ocid_links_ocid ON ocid_artifact_links(ocid_number);
CREATE INDEX idx_ocid_links_umr ON ocid_artifact_links(umr_id);
CREATE INDEX idx_ocid_links_pr ON ocid_artifact_links(repo, pr_number);
```
Real trade-off: additive, does not touch `umr_tasks`'s existing schema/callers at all (lowest-risk
of the two options), but requires a real write call-site to be added wherever an OCID/UMR/PR
relationship becomes known — the natural real chokepoints, per State 2's own call graph, would be
`resource_governor.py:submit()` (real UMR creation) and `supervisor-entrypoint.sh`'s `gh pr create`/
`gh pr merge` call sites (real PR/commit creation) — both already CANONICAL, single-chokepoint
files per State 3, so wiring a single new INSERT into each would not introduce a new duplicate
creation path.

*Option B — additive columns directly on `umr_tasks`:* `ocid_number TEXT`, `pr_number INTEGER`,
`pr_repo TEXT`, `merge_commit_sha TEXT`. Real trade-off: simpler (no join needed for the common
one-UMR-one-PR case), but `umr_tasks` is a 1-row-per-dispatch-attempt table (2,227 real rows
today, many `rejected_duplicate`/`killed`) — an OCID can have multiple real UMR rows over time (this
session alone produced OCID-053 dispatches under both `UMR-20260804-033853-2a17` and
`UMR-20260804-160456-41b3`), and a single UMR can touch multiple files/commits, so a pure-columns
approach either forces denormalized repetition or loses the one-to-many file-path granularity
Option A's linked table captures natively. Option A is the stronger real proposal for that reason,
stated here for the Owner's own decision, not decided unilaterally.

Either option would let a real query answer "what closed OCID-053" or "what OCID does commit `X`
belong to" deterministically, instead of requiring a human/AI to re-derive it from prose each time —
exactly the real problem this session's own OCID-053..060 duplicate-PR incident (§4f below) made
concrete: had this linkage already existed as real rows, a simple query against `ocid_number =
'OCID-054'` would have surfaced PR #869 immediately, before any duplicate registration document was
ever drafted.

### 4f. The real, load-bearing gap this consolidation exists to close
Not a file to merge — a missing check. **No file anywhere in the governance script inventory
verifies whether a live interactive session is already working the same UMR/directive before an
automated `veridian-worker@` unit begins independent work on it**, and conversely, no file check the
reverse. Every real dedup mechanism found (`task-gateway.py`'s `claim-task-key`,
`resource_governor.py`'s `find_active_umr_by_identity`/Stage 4-6 duplicate-PR guard,
`supervisor-entrypoint.sh`'s `review.json` check, `directive_engine.py`'s
`find_in_flight_duplicate`) keys off state that only exists for **software-dispatched** work. This
is not a theoretical gap: this exact session independently, directly witnessed it produce 5 real
duplicate PRs (for OCID-053/054/055/056 and the GAP-API-ME-500 closure) when automated
`veridian-worker@` units picked up the same UMR-tagged PM directives that were simultaneously being
handled by hand in this interactive session, all starting within a 20-second window
(16:16:16–16:16:33 UTC). Closing this gap is a real, substantive design question (not just "call the
existing check") since interactive sessions have no `task_key`/`task_identity` to register against
today — this is flagged for the Owner's review package, not solved by this document.

---

## STATE 5 — Validation Report

**Zero-duplication check:** NOT clean. Two real, confirmed duplications found:
(1) `dispatch-owner-task.sh` duplicates `task-gateway.py`'s dedupe/register/dispatch sequence
independently rather than delegating to it; (2) `veridian-dispatch-tick.timer` duplicates
`veridian-cron-dispatch-tick.timer` as a live trigger for the same script. Both are named, with
evidence, in State 3/4 above — not silently passed.

**Complete traceability check:** Every real creation path for a task/UMR record was traced to its
originating function and file (State 2/4a). The one exception, disclosed rather than hidden:
whether `plan_generator.py:check_reuse_before_dispatch()` is called from `resource_governor.py`
itself could not be fully ruled out within the discovery passes' assigned file scope (that file was
read in full in a *different* cluster's pass, and cross-referenced — the two passes agree no such
call exists, but this is stated as cross-corroborated, not from a single authoritative read).

**Complete call-chain check:** Traced ≥2 levels deep for every file in the inventory (State 2).

**Complete artifact chain check:** Every real artifact-creation site (new `task.yaml`, new
`umr_tasks` row, new `task_claims` row, new PR, new `plans`/`plan_steps` row, new `system_index`
row) was named with its owning function (State 4a).

**Complete UMR chain check:** The real `umr_tasks` store was located, its schema owner identified
(`superboss-register.py`), its real writer identified (`resource_governor.py:submit`/`update`), and
independently queried live (2,227 real rows, confirmed) — correcting an earlier, real error this
session made believing no such store was queryable (see PR #912). Every UMR-string citation used
elsewhere in this document was checked against this same real table where the UMR was known.

**Complete UTR chain check:** No "UTR" (Universal Task Registry, per the OCID-058 directive's own
naming) creation/read/write function was found as a *separate* concept from the `task.yaml`
mechanism already traced above across all 4 discovery passes — either UTR is a planned, not-yet-real
construct (consistent with OCID-058's own framing, "real UTR/execution-architecture discovery, no
new architecture"), or it is a synonym for the existing `task.yaml`/`CONTROLLER.yaml` system already
fully traced here. Stated as an open question for the Owner, not resolved by assumption.

**Verdict: this discovery is complete for the 4 file clusters assigned, real, and internally
consistent, but is NOT a claim that literally every one of the 106 scripts under
`/opt/veridian/scripts/` was read** — the initial pattern-based scoping (State 1) is disclosed as
the filtering method, and a small number of borderline matches (e.g. scripts that mention "registry"
generically) were excluded with that reasoning stated, not silently dropped.

---

## STATE 6 — Owner Review Package Summary

**Real decisions this package asks the Owner to make, once OCID-020 clears and state 8 is
separately, explicitly authorized:**

1. Confirm the merge/wrapper/removal disposition in §4a-4d, or amend it.
2. Decide the disposition of the two live `dispatch-tick.py` timers (§4d) — this is itself an active,
   currently-running process irregularity, not merely a future cleanup item.
3. Decide whether to re-enable `veridian-task-watchdog.timer` or explicitly document its intended
   dormancy.
4. Decide how (or whether) to close the interactive-session/automated-dispatch collision gap (§4e) —
   the single most consequential, evidenced finding in this package, directly tied to a real
   incident this same session produced.
5. Confirm deletion of the two dead/dangerous files (`auto_phase_continuation.py`,
   `/opt/veridian/ai-os/umr_tasks.db`) and the two obsolete utilities
   (`supervisor-sweep.sh`, `sweep_awaiting_approval.py`).
6. Choose between Option A (new linked table, recommended) and Option B (additive columns) for the
   real, structured OCID -> UMR -> PR -> commit -> file-path traceability requirement (§4e), or
   direct a different design — this was added to this package by a real addendum
   (`UMR-20260804-170055-a069`) after states 1-6 were substantially drafted, and is included here as
   a design proposal only, not implemented.

No code, database, table, or registry was changed by this document. States 8 and 9 remain locked
pending independent OCID-020 verification and a fresh, explicit, real-time Owner authorization
naming state 8 specifically.
