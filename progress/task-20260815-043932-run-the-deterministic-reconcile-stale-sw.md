# PROGRESS -- task-20260815-043932-run-the-deterministic-reconcile-stale-sw

## Completed

## Remaining
- [ ] Read ACTIVE-CLAIMS.yaml, register claim
- [ ] Mint child UMR under UMR-20260806-071025-1d28 via superboss-register.py
- [ ] Run python3 resource_governor.py --reconcile-stale, capture verbatim output
- [ ] Record per-row umr_id + evidence (transitioned) or reason (declined)
- [ ] Re-query trailing 24h owner_dispatch_gateway numbers (before vs after)
- [ ] If sweep can't reconcile UMR-20260806-103954-6f42 despite proof, report as real defect (no hand edit)
- [ ] Write before/after numbers + sweep output into child UMR row
- [ ] record-completion via agent_work_briefing.py
