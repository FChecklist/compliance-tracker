# PROGRESS -- task-20260806-230715-root-cause-and-instrument-the-repeated-u

Mechanical blocker dispatch, cites parent UMR-20260806-103954-6f42 and
governing PM report contract UMR-20260806-042531-be9c. Real root cause of
veridian-directive-engine.service's repeated explicit stop is **not yet
identified** -- this file tracks instrumentation status, not a closure.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml / CONSTITUTION.yaml / OS.yaml per
      CLAUDE.md's "Read Before Starting Work" order.
- [x] Confirmed real evidence: `journalctl --user -u veridian-directive-engine.service`
      shows Started 10:38:34Z / Stopping+Stopped 10:39:05Z, and Started
      10:55:43Z / Stopping+Stopped 11:00:10Z (2026-08-06). `systemctl --user show`
      confirms Result=success, ExecMainStatus=0 -- rules out crash/OOM
      (MemoryMax=384M). Confirmed via `superboss-register.sqlite` that
      UMR-20260806-103954-6f42 is this task's own live parent row
      (status=running, ts_dispatched matches this task's start) -- not stale.
- [x] Step 1: minted real child UMR via the canonical registrar
      (`superboss-register.py insert-owner-proposal`), linked under parent
      UMR-20260806-103954-6f42: **UMR-20260806-231410-331d**
      (pm_decisions_pending id=295, decision_type=owner_proposal, status=open).
- [x] Step 2: instrumented the real stop path. Chosen mechanism: a
      `busctl --user monitor org.freedesktop.systemd1` D-Bus eavesdropping
      audit (real systemd/D-Bus facility, not a home-grown poller), piped
      through `jq`, watching for `Manager.StopUnit/KillUnit/RestartUnit/...`
      and `Unit.Stop/Kill/Restart` calls naming/targeting
      veridian-directive-engine.service, resolving the caller's PID via
      `GetConnectionUnixProcessID` (with a per-sender cache to reduce a
      real, self-demonstrated resolution race -- see below), logging to
      `/opt/veridian/logs/directive-engine-stop-audit.log`.
      Files (committed to `FChecklist/veridian-scripts` main,
      commit `0c076e4`→`b6c7be4` after rebase):
      - `/opt/veridian/scripts/directive-engine-stop-audit-monitor.sh` (live ExecStart)
      - `/opt/veridian/scripts/systemd/veridian-directive-engine-stop-audit.service` (reference copy)
      - `/opt/veridian/scripts/directive_engine_stop_audit_monitor.py` (abandoned alternative, kept for the record, NOT wired live)
      Installed live at `~/.config/systemd/user/veridian-directive-engine-stop-audit.service`,
      `enable --now`'d, `Restart=always`. Chose a D-Bus monitor over a plain
      `ExecStop=` hook because `ExecStop=` only fires *after* the stop job
      already began inside the target unit's own cgroup, with zero
      visibility into the external caller.
- [x] A first attempt at lower-latency PID resolution
      (`directive_engine_stop_audit_monitor.py`, persistent dbus-python
      `BecomeMonitor` daemon, single process, no subprocess-spawn race) hit
      a **reproducible crash**: the monitor connection receives its own
      D-Bus `Disconnected` signal immediately after `BecomeMonitor`
      succeeds (isolated with a minimal repro; suspected root cause:
      dbus-python's high-level `add_message_filter()`/`SessionBus()`
      wrapper issues an implicit `AddMatch` that a true eavesdropper
      connection can't send). Failed twice in a row (ad-hoc run + under
      systemd) -- per this task's own circuit-breaker protocol, stopped
      after the 2nd consecutive failure of that approach rather than
      reattempted a 3rd time. Reverted to the working busctl+jq mechanism.
- [x] Self-tested the live mechanism (`systemctl --user start` then
      `--user stop` on the target unit, 3 times across both script
      versions): the StopUnit call itself (method, real unit name, real
      timestamp) is captured correctly **every time**. PID resolution is
      honestly racy for a single-shot CLI caller like a bare
      `systemctl --user stop ...` (own connection closes before our
      resolve call completes) -- disclosed in the script's own header and
      in the log output (`sender_pid=<unresolved:...>`), not hidden.
- [x] Committed + pushed instrumentation to `FChecklist/veridian-scripts`
      main (that repo is a separate live-checkout repo, no branch
      protection configured -- edits there go live immediately per
      established convention for that repo, see systemd/README.md's own
      precedent for the memory-backup-prune exception).

## Remaining
- [ ] **Step 3 (in progress, not yet satisfied): leave the instrumentation
      running and wait for a real captured stop event with an actual
      resolved originating process.** The service is live and running
      (`veridian-directive-engine-stop-audit.service`, enabled,
      Restart=always) but the two real external stop events cited in the
      SPEC already happened 12+ hours before this instrumentation went
      live (10:39Z / 11:00Z vs. instrumentation live at 23:15Z) -- so no
      real *external* stop event has been captured yet, only self-tests.
      Watching for the next real occurrence; not closing this on a theory.
- [ ] Step 4: once a real external stop event is captured with a real
      resolved process, report it with the real evidence and propose a fix
      (do not implement without PM approval -- novel finding outside
      approved scope).
- [ ] Step 5: write the final real evidence + instrumentation file path
      back onto child UMR-20260806-231410-331d (a further
      `insert-owner-proposal --child-umr UMR-20260806-231410-331d` call
      once real evidence exists, matching this codebase's existing
      multi-row-per-child-umr convention).
