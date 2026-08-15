# PROGRESS -- task-20260718-072002-ai-model-lifecycle---benchmarking--ongoi

Spec: VERIDIAN Review Framework gap-closure, 3 findings under "AI Model Lifecycle & Benchmarking / Ongoing Quality Monitoring":
1. [High] Per-role quality regression tracked over time (extend promptfoo-style scoring to a recurring job)
2. [High] Cost-per-quality-point tracked per model (depends on #1)
3. [High] Provider-outage historical incident correlation with role failures (outage-window table + correlation query)

## Completed
- [x] Re-synced branch to origin/main (was 1326 commits behind; prior invocations 1-13 never did real work -- all blocked on stale credit_accountant_rejected false-positive per task.yaml history, now cleared)
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml -- no collision with another session's in-flight work on this area
- [x] Dispatched Explore agent to survey current state of: promptfoo config, roster.ts/model-tier-eligibility.ts, token-usage-service.ts, cost tracking, provider-outage/incident tables in schema.ts, and MASTER-TRACKER.yaml/COMPLETED.yaml for prior partial work on this exact gap

## Remaining
- [ ] Read Explore agent findings; confirm which of the 3 findings are genuinely still open vs already resolved by code that's moved since the eval was written
- [ ] Design + implement (only for findings confirmed still-open):
  - [ ] Per-role quality regression: DB table for recurring eval-run scores + a recurring job/script that runs promptfoo-style scoring per role and writes results over time
  - [ ] Cost-per-quality join: query/service joining token-usage-service cost data with the quality table above, keyed by model/role
  - [ ] Outage-correlation: outage-window table + correlation query against role/task failure log
- [ ] Register claim in ai-os/boss/ACTIVE-CLAIMS.yaml before starting real code edits
- [ ] Do NOT touch permission-service.ts's shared ERP_ACTION_ROLES table structure (additive only if needed)
- [ ] Add tests for new services
- [ ] Commit, push, open PR
