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

## Remaining
- [ ] Move this session's ACTIVE-CLAIMS.yaml entry to recently_completed
- [ ] Final report table to user
- [ ] Flag the stale resource-governor EMERGENCY_STOP lock to the Owner as a
      separate, unresolved finding (not fixed by this task)
