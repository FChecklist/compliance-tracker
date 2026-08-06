# PROGRESS -- task-20260806-230711-escalation-durably-disable-veridian-dire

## Completed
- [x] Confirmed unit identity/config: `veridian-directive-engine.service` is a **user** unit
      (`~/.config/systemd/user/veridian-directive-engine.service`), `Restart=always`,
      `WantedBy=default.target` -- matches SPEC exactly.
- [x] Ran `systemctl --user disable veridian-directive-engine.service` -- real output:
      `Removed "/home/rajat/.config/systemd/user/default.target.wants/veridian-directive-engine.service"`
      (a live symlink was genuinely present at that moment and was removed; exit 0).
- [x] Re-verified live state at `2026-08-06T23:13:17.191406588Z`:
      `systemctl --user is-enabled` -> `disabled` (rc=1),
      `systemctl --user is-active` -> `inactive` (rc=3),
      `default.target.wants/` symlink count for this unit -> `0`.
- [x] Did NOT restart the unit at any point. Did NOT modify the unit file, the drop-in
      override, or any other file -- only the enablement symlink was touched, via `disable`.
- [x] Recorded real outcome into the real DB via `superboss-register.py` (never raw SQL):
      `WRK-20260806-231310-ae55` (log-work, linked to `INS-20260806-110053-187a`) and
      `ACT-20260806-231324-a069` (log-action, real evidence/timestamps in `--result`).

## Remaining
- [ ] None for this escalation's scope. Root-cause fail-closed code fix (why the
      enablement symlink keeps re-materializing -- journal shows repeated
      `Preset files don't specify rule for veridian-directive-engine.service. Enabling.`
      entries coinciding with unrelated `systemctl --user reload` calls from other
      dispatch/worker services, and `systemctl status` reports `preset: enabled` for
      this unit) is explicitly out of scope here and remains with
      `UMR-20260806-102737-d780`.

## Evidence caveat (honest, not hidden)
This action guarantees disabled+inactive as of the timestamps recorded above. Because
something in the dispatch pipeline appears to re-run preset evaluation for this unit on
unrelated reload cycles (observed once live during this session, corrected by re-running
`disable`), the symlink could theoretically reappear on a future reload. That risk is the
real subject of `UMR-20260806-102737-d780`'s broader fail-closed fix, not this task.
