# PROGRESS -- task-20260729-110351-build-extend-calculation-track-engines

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and `ai-os/boss/ACTIVE-CLAIMS.yaml` per protocol before picking work
- [x] Located the real "PHASE-2-CROSSREF" the spec refers to: there is no such markdown file anywhere in this repo
      (confirmed via repo-wide grep). It is the `sap_reports` table in the external sqlite DB
      `/opt/veridian/ai-os/memory/sap_mapping.sqlite` (`veridian_mapping_status` + the `engine_track` column added by
      PR #624, "Complete sap_reports engine_track classification (67 calculation / 9 hybrid / 4 workflow)").
- [x] Queried it for `engine_track='calculation' AND veridian_mapping_status IN ('BUILD_NEW', LIKE 'EXTEND_EXISTING(%)')`
      -- 36 rows (CO-001/003/005/006, CRM-006, FI-AA-004/006/007, FI-AP-001..007, FI-AR-001/002/005/006/007,
      FI-GL-002/007/008, HCM-005/006, MM-004/008, PS-001/005/007, SD-004/005/006/008, Treasury-004/005).
- [x] **STOPPED before building anything: found a hard, exact collision.** `git log --all` shows another branch,
      `worker/task-20260729-092858-build-extend-calculation-track-engines` (same task title, started ~94 min before
      this session, at 2026-07-29T09:31:54Z vs. now 2026-07-29T11:05Z -- well inside the 4h non-stale window),
      already pushed a claim commit (`5ce7bfc0`) to `ai-os/boss/ACTIVE-CLAIMS.yaml` on its own branch (not yet on
      `main`) for **the identical 36-row scope**, word-for-word ("Claiming the 36 sap_reports rows (engine_track=
      calculation, veridian_mapping_status BUILD_NEW/EXTEND_EXISTING) from the Phase 2 cross-reference"). No PR from
      that branch exists yet (`gh pr list` clean for it) -- its tip commit is only the claim registration, no actual
      engine code yet, so it's ambiguous whether that session is still actively working or stalled, but it is not
      abandoned by the letter of the ACTIVE-CLAIMS staleness rule.
- [x] Per `ACTIVE-CLAIMS.yaml`'s own protocol point 4 ("do NOT silently work around it or silently pick a different
      gap without saying so"), did not proceed with implementation and did not register a competing claim. Reported
      the collision to the user for a decision instead of burning the 36-engine build twice.

## Remaining
- [ ] Blocked on user decision: (a) wait for `worker/task-20260729-092858-...` to land/go stale, (b) have this
      session take an explicit, non-overlapping split of the 36 rows, or (c) confirm the other session is dead and
      take the full scope over.
- [ ] Once unblocked: build/extend the 36 `BUILD_NEW`/`EXTEND_EXISTING` calculation-track engines and register each
      in the wiring registry immediately per-engine (not batched), per spec.
