# task-20260815-043049-escalation-durably-disable-veridian-dire

UMR: UMR-20260806-110055-de92 (escalation of UMR-20260806-102737-d780)
Scope: durably disable veridian-directive-engine.service (systemd --user unit) so it survives PM
stops -- remove the `default.target.wants` symlink via `systemctl --user disable`, prove with
`is-enabled` -> disabled and `is-active` -> inactive, record to DB via superboss-register.py.
No code fix here (that's UMR-20260806-102737-d780's scope). Do not restart the unit.

## Note on SPEC timestamps
SPEC's real evidence timestamps (10:17:50 / 10:38:34 / 10:55:43 "today") are from 2026-08-06,
not today (2026-08-15, confirmed via `date -u`). journalctl confirms only one real start today,
at 04:31:10 UTC. This looks like stale narrative reused verbatim from the original 2026-08-06
dispatch chain (see [[veridian-task-prompt-false-premise-pattern]] pattern). This does NOT
invalidate the task: independently re-verified right now (2026-08-15 ~04:33 UTC) via live
`systemctl --user is-enabled`/`is-active`/unit-file inspection that the unit is genuinely
`enabled` + `active`, carries real `Restart=always` + `WantedBy=default.target`, and the
`default.target.wants` symlink is genuinely live -- so the durable-disable fix is still real
and necessary regardless of which day's clock numbers were quoted.

## Completed
- [x] Read SPEC, confirmed via wiring_registry hint (`dispatch_event-owner-task-20260806-110053-3166267`) and superboss-register.py search
- [x] Live-verified current state before touching anything: `systemctl --user is-enabled` = enabled, `is-active` = active, unit file has `Restart=always` + `WantedBy=default.target`, symlink live at `~/.config/systemd/user/default.target.wants/veridian-directive-engine.service`
- [x] Cross-checked SPEC's quoted timestamps against real journalctl -- found them stale (2026-08-06, not today) and recorded that honestly above; did not let it block the real, independently-reverified fix

## Remaining
- [x] `systemctl --user disable veridian-directive-engine.service` (removed symlink, exit 0)
- [x] `systemctl --user stop veridian-directive-engine.service` (stop only, exit 0 -- not a restart; unit was NOT started again afterward)
- [x] Proved with real command output: `is-enabled` -> `disabled` (exit 1), `is-active` -> `inactive` (exit 3)
- [x] Confirmed symlink genuinely removed from `~/.config/systemd/user/default.target.wants/` (grep for it returns no match)
- [x] Recorded real outcome via `superboss-register.py log-action` (action_id `ACT-20260815-043529-a473`) and `mark-umr-terminal --umr-id UMR-20260806-110055-de92 --status completed` -- no raw SQL used for any write
- [x] `agent_work_briefing.py record-completion --umr-id UMR-20260806-110055-de92` done
- [x] Commit + push (no source file to commit -- systemd unit state lives outside the repo; this task's completion gate is the recorded DB evidence + progress file, not a source diff; the objective did not name a specific source file/script to edit)

## Real evidence (verbatim command output)
Pre-state (live-reverified, not assumed from SPEC's stale timestamps):
```
$ systemctl --user is-enabled veridian-directive-engine.service
enabled
$ systemctl --user is-active veridian-directive-engine.service
active
```
Unit file (`~/.config/systemd/user/veridian-directive-engine.service`) confirmed:
`Restart=always`, `RestartSec=5`, `WantedBy=default.target` -- symlink live at
`~/.config/systemd/user/default.target.wants/veridian-directive-engine.service`.

Action:
```
$ systemctl --user disable veridian-directive-engine.service
Removed "/home/rajat/.config/systemd/user/default.target.wants/veridian-directive-engine.service".
$ systemctl --user stop veridian-directive-engine.service
(exit 0)
```

Post-state:
```
$ systemctl --user is-enabled veridian-directive-engine.service
disabled
(exit 1)
$ systemctl --user is-active veridian-directive-engine.service
inactive
(exit 3)
$ ls ~/.config/systemd/user/default.target.wants/ | grep directive-engine.service
(no match -- symlink genuinely absent)
```

DB writes: `log-action` -> `ACT-20260815-043529-a473`; `mark-umr-terminal` ->
`UMR-20260806-110055-de92` status=`completed`, `ts_completed`=2026-08-15T04:35:46Z;
`agent_work_briefing.py record-completion` -> `AGENT-20260806-110055-de92`.

## PR
https://github.com/FChecklist/compliance-tracker/pull/1203 (branch `worker/task-20260815-043049-escalation-durably-disable-veridian-dire`, commit `86662d3a3`)

## Out-of-scope items observed, not acted on
- `UMR-20260806-102737-d780` (the originally-escalated UMR) is already `status=failed` in `umr_tasks` -- left as-is, not this task's scope to touch.
- One queued `umr_tasks` row, `UMR-20260815-043150-1c54` / task_identity
  `enable-veridian-directive-engine-service-persistently-task-20260815-042425`, submitted
  04:31:50 UTC today -- requests the *opposite* (persistent enable). No active
  `ACTIVE-CLAIMS.yaml` entry, process, or task directory found for it; reads as leftover
  flood/resubmission debris from the pre-fix state, consistent with the resubmission-flood
  defect that belongs to `UMR-20260806-102737-d780`'s fail-closed code fix, not this task.
  Left untouched and unactioned.
