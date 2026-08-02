# PROGRESS -- task-20260802-171744-amendment--continuous-recovery-framework

## Completed
- [x] Read parent UMRs (UMR-20260802-054239-4251 Kernel reconciliation report;
      UMR-20260802-104058-25ba implementation matrix) and their existing
      amendment chain.
- [x] Found existing "Recovery matrix" amendment (UMR-20260802-165541-c27d)
      already merged to main (PR #725, commit 75cd6554) covering 7/8 failure
      classes this directive asks about -- gatekeeper check applied: extend,
      do not duplicate.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, flagged 3 sibling
      parallel sessions whose scope may already be covered by the same
      merged PR #725.
- [x] Verified real current server state: systemd unit files
      (veridian-worker@ Restart=on-failure/30s; veridian-supervisor@
      Restart=no), dispatch-tick.py's supervisor_sweep_tick() +
      resume_interrupted_workers_tick(), STUCK_TASKS_HEARTBEAT.json live
      contents, resource_governor.py fail-open network behavior,
      pm_triage_tick() escalation/cooldown logic.

## Remaining
- [ ] Write the amendment extending the Recovery matrix section with a
      distinct "audit failing" row + supervisor-recovery correction.
- [ ] Commit + push, open PR against UMR-20260802-054239-4251 /
      UMR-20260802-104058-25ba.
