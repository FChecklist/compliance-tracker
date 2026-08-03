# PROGRESS -- task-20260803-103115-pm-decision--authorize-real-fix-of-gap-4

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, MASTER-TRACKER.yaml (GAP-403-VS-500-CLM-HR-PERFORMANCE,
      GAP-EMAIL-INTELLIGENCE-500-VS-403, MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, no conflicting active claim found

## Remaining
- [ ] Investigate root cause: migration drift vs missing requireErpEnabled-style gate,
      for each of: /api/clm/templates, /api/clm/clauses, /api/hr/attendance,
      /api/performance-reviews/reviews
- [ ] Apply the genuinely correct fix per endpoint
- [ ] Independently retest all 5 endpoints live against the real site (confirm 403 with
      user-facing explanation, not raw 500)
- [ ] Update MASTER-TRACKER.yaml honestly with the real resolution
- [ ] Commit + push (branch, PR, CI)
