# OCID-058 — Real Execution Architecture Report (2026-08-04)

**Status: certification of existing architecture only** — per this OCID's own dispatch text, no
redesign. This document maps every real execution path this session could find and verify, citing
real files/line ranges, not narration. Companion documents:
`ai-os/VERIDIAN_OCID_058_UTR_REGISTRY_2026-08-04.md` (what record types exist),
`ai-os/VERIDIAN_OCID_058_EXECUTION_TRACEABILITY_REPORT_2026-08-04.md` (whether they connect).

## 1. Interactive session (Super Boss / Owner dispatch)

**Real front door**: `dispatch-owner-task.sh` (`/opt/veridian/scripts/`) — used whether the Owner
relays a prompt via a laptop Claude Code CLI session or runs it directly by SSH (per its own header
comment, `:1-8`). Real sequence, confirmed by direct read of the script:

1. Duplicate-content check: `superboss-register.py check-content-duplicate` (`:46-52`).
2. Logs the raw ask: `superboss-register.py log-instruction` → real `instruction_id` (`:55-56`).
3. Registers with the governor: `resource_governor.py --submit --spec-file ... --tier N
   --source-trigger owner_dispatch_gateway` (`:62-74`) → real `umr_id`, subject to
   `resource_governor.py`'s tier/concurrency-cap/`EMERGENCY_STOP` gate (`resource_governor.py:568-611`).
4. Links instruction → work item → UMR: `superboss-register.py log-work --ai-task-id "$UMR_ID"`
   (`:83-84`).
5. Relays into the live `tmux` session named `claude` via `tmux send-keys -l "[${UMR_ID}] ${PROMPT}"`
   (`:90-98`) — this is the real, verified source of the `[UMR-...]` tag convention this session's
   own PM-dispatch messages use (confirmed format match: `_new_id()`, `superboss-register.py:99-102`,
   produces exactly `UMR-YYYYMMDD-HHMMSS-<4 hex>`, matching every id cited in this OCID's parent
   chain, independently verified live in §0 of the UTR Registry document).

This is a real, working, verified pipeline — not aspirational. All 7 parent-chain UMR ids for this
OCID were independently confirmed live in `umr_tasks` with `source_trigger=owner_dispatch_gateway`.

## 2. Headless workers

**Real spawn mechanism**: the interactive session (or a supervisor script) calls
`veridian-task.py cmd_create` (`~:280-335`), which:

- Writes a real `task.yaml` under `/opt/veridian/ai-os/tasks/<task_id>/` (id, title, status, repo,
  branch, workspace, service, checkpoints, `hold_for_owner_signoff`).
- Auto-logs a `work_items` row: `_auto_log_task_event("create", task, ...)` →
  `log-work --ai-task-id task["id"]` (`veridian-task.py:117-121`).
- Mirrors to the app side: `_sync_to_app(task, ...)` → `POST /api/internal/ops-task-sync`
  (`veridian-task.py:29-70`) → upserts `platform.ops_dev_tasks` keyed on `opsTaskId`
  (`src/app/api/internal/ops-task-sync/route.ts:53-85`, schema at `src/lib/db/schema.ts:1190-1205`).
- Starts the unit directly: `systemctl --user start veridian-worker@<task_id>.service`
  (`veridian-task.py:326`) — **deliberately never `enable`**, per the 2026-08-01 24-unit OOM-kill
  RCA comment at the same location: boot-activation bypassed `dispatch_core.py`'s shared
  concurrency cap and OOM-killed the box; reboot recovery is instead handled by
  `dispatch-tick.py`'s `resume_interrupted_workers_tick()` (§3 below), which re-submits through
  `resource_governor.py`'s own cap.
- The spawned `veridian-worker@.service` runs `worker-entrypoint.sh`, which is the actual headless
  Claude Code CLI session doing real work in `task_dir/workspace` — **this document's own author is
  one live instance of this exact path**, confirmed directly (this task's own `task.yaml`, read in
  full, matches the shape above exactly, including a real `service:
  veridian-worker@task-20260804-045439-....service` line and real `checkpoints[]` history).
- Checkpoints/usage are logged the same auto-log way: `_auto_log_task_event("checkpoint"/
  "record_usage", ...)` → `superboss-register.py log-action` (`veridian-task.py:122-141`).

## 3. Cron / scheduled ticks

**Real mechanism**: cron itself is fully retired (`crontab -l` shows every real job line still
carrying its `#STOPPED-ALL-CRON-2026-07-26#` marker, confirmed live). Replaced by a closed set of
systemd `--user` timer/service pairs (`~/.config/systemd/user/README.md`, 2026-07-29 consolidation),
independently re-confirmed live via `systemctl --user list-timers 'veridian-cron-*'` **and**
`list-unit-files`: **21 real timers currently present** (18 from the original closed-set
consolidation, plus `veridian-cron-session-metadata-60min`, `veridian-dispatch-tick`, and
`veridian-task-watchdog`, all confirmed enabled/scheduled with real next-run times spread across
distinct minutes, not the old crontab's all-aligned-on-minute-0 pattern).

Of these, `veridian-cron-dispatch-tick` (`dispatch-tick.py`) is the one directly relevant to task
lifecycle: its `resume_interrupted_workers_tick()` (`:191-231`) finds any `task.yaml` left in a
non-terminal status whose `veridian-worker@` unit is not currently active, and re-submits it via
`resource_governor.submit(task_spec={"task_identity": task_id, ...}, source_trigger=
"dispatch-tick:resume_interrupted_workers")` (`:221-230`) — going through the same real
concurrency-cap/UMR-queue path as an original owner dispatch, not a raw `systemctl start`. The other
20 timers (health-check, security-check, cost-usage, credit-ledger-prune, file-inventory,
knowledge-registry, software-catalog-gen, sync-repos/vercel-env/verdian-ai-data, system-sync,
audit-pipeline-security, generate-wiring-registry, phase-continuation-tick, status-remediation-tick,
sync-controller-back, veridian-self-check, session-metadata, task-watchdog) run their own scripts
independently and are not part of the task/UMR lifecycle chain — confirmed by their own
`ExecStart=` lines, which invoke their respective standalone `*.py`/`*.sh` scripts, not
`veridian-task.py`/`resource_governor.py`.

**Known real historical gap (already documented, not rediscovered here)**: the same
`~/.config/systemd/user/README.md` records a real incident where the shared
`ConditionPathExists=!.../resource-governor-EMERGENCY_STOP` gate false-tripped for hours after the
2026-07-29 rollout, silently skipping ("start condition unmet," not a failure exit code) every real
trigger of the 10 lower-frequency units with zero payload execution and no alarm. Cited here for
completeness of the execution-architecture picture, not re-investigated by this document.

## 4. API / integration paths

Three real, distinct API/integration surfaces were found and verified, each with its own real
persistence target, none of them wired to any of the other three execution paths above:

- **`POST /api/internal/ops-task-sync`** (`src/app/api/internal/ops-task-sync/route.ts:21-85`):
  shared-secret-authenticated, upserts `platform.ops_dev_tasks` keyed on `opsTaskId`. Real, working,
  called by every `veridian-task.py` task-state transition (§2) — this is the one genuine bridge
  between the server-side task system and the product's own Supabase/Postgres database.
- **`/api/ai/team/dispatch`** (`src/app/api/ai/team/dispatch/route.ts`): the Mother
  Router/Software-Team L0-L5 dispatch surface (per `SOFTWARE_TEAM.md`). Persists routing-decision
  telemetry to `activity_log` (multiple call sites, `:120-559`) and, only when a `softwareTeamLevel`
  is declared, a real Instruction Contract / Execution Report pair to `platform.task_register`
  (`:284-333`, `:640-649`, service layer `src/lib/ai-router/task-register-service.ts:41-171`). This
  is a real, working, independently-audited (per `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md`)
  mechanism — but it is scoped to in-app AI Dev Team roster dispatch, not the OS-level
  worker/supervisor/cron lifecycle in §1-§3, and does not touch `superboss-register.sqlite` at all
  (confirmed: zero grep hits for `umr`/`superboss-register` in `route.ts` or its direct
  dependencies).
- **GitHub `repository_dispatch`** (`zai-task`/`claude-task`/`ai-task`/`codex-task`/`sentinel-task`
  event types, `.github/workflows/ai-dispatch.yml:4`): the entire workflow is 31 lines across two
  jobs (`dispatch-log`, `zai-agent`), and **both jobs contain only `echo` statements** — no real API
  call to any AI provider, no script invocation, no database write of any kind, confirmed by
  reading the file in full. This matches AGENTS.md's own documented caveat that the `claude-task`
  path "has never had a working job behind it" (`Study_by_Claude.md`'s ANTHROPIC_API_KEY
  discussion) — it is real infrastructure (the workflow genuinely exists and genuinely triggers on
  those event types) but produces zero real execution or task-tracking record today.

## 5. Summary picture

Four real, independently-operating execution surfaces exist: (1) interactive Owner/Super-Boss
dispatch → `resource_governor`/`umr_tasks` + `instructions`/`work_items`, (2) headless
`veridian-worker@` tasks → `task.yaml` + a second, separately-keyed `work_items` row +
`platform.ops_dev_tasks`, (3) the systemd timer set → mostly independent maintenance scripts, with
one (`dispatch-tick`) re-entering the UMR queue on worker resume, and (4) two API/integration
surfaces (`/api/ai/team/dispatch` → `platform.task_register`; GitHub `repository_dispatch` → a real
but currently-inert stub). All four are real and independently verified working (except the GitHub
`repository_dispatch` stub, confirmed inert). None of them share one common task-identity key or
write into one common UTR-shaped record — see the companion Execution Traceability Report for the
specific joins that do and do not exist.
