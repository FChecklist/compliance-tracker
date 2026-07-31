# PROGRESS -- task-20260731-073923-add-measured-memory-limits-to-25-systemd

## Completed
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, pushed (e4bc2862)
- [x] Confirmed real 27 units; confirmed the 2 that already have limits:
      veridian-worker@.service and veridian-worker-enduser@.service
      (MemoryHigh=2G/MemoryMax=3G/MemorySwapMax=1G, from 2026-07-26 OOM RCA)
- [x] Queried MemoryCurrent/MemoryPeak for all 27 units; read entrypoint
      scripts for every unit lacking historical data to classify real risk
      before triggering any invocation

## Risk classification for the 25 (before running anything)
RUN FOR REAL (safe/idempotent/read-only, no dispatch/push/destructive/restart):
  audit-pipeline-security, cost-usage-60min, credit-ledger-prune,
  file-inventory, generate-wiring-registry, knowledge-registry-multisource,
  security-check, session-metadata-60min, software-catalog-gen, sync-repos,
  sync-vercel-env, veridian-self-check (12)

USE EXISTING HISTORICAL MemoryPeak (already ran naturally, unit still loaded):
  health-check-15min (1.78GB), system-sync (1.03MB) (2)

USE LIVE MemoryCurrent/MemoryPeak, DO NOT RESTART (active real work per spec):
  directive-engine, governor-tick (2)

START BRIEFLY THEN STOP (persistent but currently inactive, no dependents):
  glm-proxy (1)

ESTIMATE ONLY, NOT measured -- explicitly skipping real invocation because it
would spawn new real work, push to a shared repo, run destructive schema
drop/recreate, or (task-watchdog) could restart an active veridian-worker@
unit, which CONSTRAINTS explicitly forbids:
  dispatch-tick, phase-continuation-tick, status-remediation-tick,
  sync-controller-back, sync-verdian-ai-data, task-watchdog, docworker@,
  supervisor@ (8)
  -- docworker@/supervisor@ additionally: real Claude subscription spend +
     (docworker@) headless-Chromium browsing of external sites -- real cost/
     risk, not just "inconvenient", flagging to user rather than triggering.

## Remaining
- [ ] Run the 12 safe real invocations, capture MemoryPeak after each
- [ ] Start/stop glm-proxy, capture MemoryCurrent
- [ ] Write reasoned estimates for the 8 skip-listed units
- [ ] Write drop-in override.conf for all 25 units
- [ ] daemon-reload; before/after active-units diff
- [ ] Verify MemoryMax/MemoryHigh non-infinity for all 25
- [ ] Append summary line to KERNEL_CONSOLIDATION_STATUS.md
- [ ] Commit + push; final report table to user
