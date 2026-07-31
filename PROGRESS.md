# PROGRESS -- task-20260731-073923-add-measured-memory-limits-to-25-systemd

## Completed
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, pushed (e4bc2862)
- [x] Confirmed real 27 units; confirmed the 2 that already have limits:
      veridian-worker@.service and veridian-worker-enduser@.service
      (MemoryHigh=2G/MemoryMax=3G/MemorySwapMax=1G, from 2026-07-26 OOM RCA)
- [x] Queried MemoryCurrent/MemoryPeak for all 27 units; read entrypoint
      scripts for every unit lacking historical data to classify real risk
      before triggering any invocation (b02399f2)
- [x] Discovered mid-run: 17 of 19 cron units carry
      `ConditionPathExists=!.../locks/resource-governor-EMERGENCY_STOP`, and
      that sentinel has been present since 2026-07-30T18:20:20Z with no
      auto-clear (manual-clear-only per resource_governor.py) -- silently
      skipping every scheduled tick of those units for ~15h. Did not clear it
      (out of this task's scope; flagged as a separate real finding below).
- [x] Ran 4 real invocations that were NOT gated by that sentinel:
      session-metadata-60min (live MemoryPeak=8,232,960 B), and a real brief
      start/stop of glm-proxy (idle MemoryCurrent=11,866,112 /
      MemoryPeak=12,181,504 B). health-check-15min (1,777,192,960 B) and
      system-sync (1,032,192 B) already had real historical MemoryPeak from
      their own natural timer runs (unit still loaded).
- [x] Read live MemoryCurrent/MemoryPeak for directive-engine
      (6,901,760/44,109,824 B) and governor-tick (774,144/710,688,768 B)
      without restarting either (both actively running real work).
- [x] Wrote reasoned, individually-justified estimates (not a flat number)
      for the 19 units that could not be safely live-measured: 11 cron units
      blocked by the EMERGENCY_STOP condition, plus dispatch-tick/
      phase-continuation-tick/status-remediation-tick/sync-controller-back
      (can dispatch new real work or push/merge/rerun against GitHub),
      sync-verdian-ai-data (destructive local-DB schema drop+recreate),
      task-watchdog (its own auto-recovery path can restart an active
      veridian-worker@ unit -- forbidden by this task's own CONSTRAINTS while
      23+ were actively running), and docworker@/supervisor@ (real Claude
      subscription spend; docworker@ also real headless-Chromium browsing of
      external sites).
- [x] Wrote all 25 drop-ins under ~/.config/systemd/user/<unit>.d/override.conf
- [x] `daemon-reload` run; before/after `systemctl --user list-units
      --state=active` diff is identical (nothing disturbed)
- [x] Verified MemoryMax/MemoryHigh non-infinity for all 25 units
      (including the 2 template units via a synthetic instance name query)
- [x] Appended summary to /opt/veridian/ai-os/KERNEL_CONSOLIDATION_STATUS.md,
      committed+pushed there (279d558, repo veridian-ai-os,
      branch pre-workflow-main)

- [x] Moved this session's ACTIVE-CLAIMS.yaml entry to recently_completed
      (see entry at ai-os/boss/ACTIVE-CLAIMS.yaml:3960)

## GATE_FAIL investigation (attempt 2/2, 2026-07-31T13:37Z)
Quality gate failed twice on this task's PR: quality-gate-0.json =
lint pass / build TIMED OUT (124, 3600s); quality-gate-1.json = BOTH lint
and build TIMED OUT (124, 3600s). Investigated rather than blind-retrying:
- [x] Confirmed this task's entire committed diff to this repo is 2 files
      only (`PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`) -- zero source
      code changed (`git diff --name-only b02399f2^..e9caf63c`). A diff with
      no code cannot itself cause `bun run lint`/`bun run build` to hang.
- [x] Read `scripts/quality-gate.sh` in full: its own inline RCA history
      (task-20260727-043407, task-20260730-183017,
      task-20260730-183100-rebase-pr-652--sd-006) already documents this
      exact failure mode at length -- host-wide RAM/swap exhaustion from
      many concurrent `veridian-worker@` units each running their own
      `next build`/`eslint` at once, serialized today via a shared flock +
      single 3600s outer timeout, still not always enough under peak load.
- [x] Confirmed LIVE at investigation time: `uptime` = load average
      32-33 (many-fold oversubscribed), `free -h` = 13Gi/15Gi RAM used,
      swap 4.0Gi/4.0Gi (100%) exhausted, multiple concurrent `node`/`claude`
      build-shaped processes in `ps aux` -- matches the documented root
      cause exactly, live, not just historically.
- [x] Conclusion: this GATE_FAIL is the same known, already-being-worked
      host-wide build-contention issue, not a defect this task introduced
      or can fix from within its own diff/scope. Editing `quality-gate.sh`
      further would duplicate the 3 RCA tasks already actively iterating on
      it today and is outside this task's own scope (systemd memory
      limits, already complete).
- [x] Per this task's own protocol (2nd consecutive failure of the
      identical approach -> stop, do not attempt a 3rd time): stopping
      here rather than re-running lint/build against an unrelated,
      already-tracked infra flake. No further auto-fix attempt made.

## Remaining
- [ ] Final report table to user
- [ ] Flag the stale resource-governor EMERGENCY_STOP lock to the Owner as a
      separate, unresolved finding (not fixed by this task)
