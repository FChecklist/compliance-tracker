# PROGRESS -- task-20260731-042738-resolve-pr-610-vs-pr-657-crm-dashboard-o

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this task's claim, pushed it standalone before real work
- [x] Read PR #610 full diff (1298 lines) and PR #657 full diff (429 lines) via `gh pr diff`
- [x] Determination: REAL OVERLAP, not complementary. Both PRs create the identical file
      `src/app/api/crm/sales-pipeline/route.ts` with incompatible response shapes (#610: GET
      returns `{deals, targets}` raw+normalized deal data for client-side aggregation plus a POST
      for monthly targets; #657: GET returns a single pre-aggregated `SalesPipelineOverview`
      object, GET-only). Both also add Sales Pipeline visibility to CRM UI reachable from
      `/crm` (#610 via a new dedicated `/crm/sales-pipeline` page + nav link; #657 via an inline
      widget appended to `/crm/page.tsx` itself). This is the same underlying gap
      ("getSalesPipelineOverview() computed real data but nothing in-app ever rendered it"),
      attacked twice independently -- exactly the KNOWN_CONTEXT's suspicion, confirmed by real
      diff comparison, not title-only.
- [x] Compared completeness: #610 is the more complete implementation -- 6 KPI tiles (Sales
      Value/Hold%/Lost%/Success%/Health%/Regret%) built directly against an Owner-supplied
      mockup, cross-filtering across every chart/table/heading, 2 bar charts + a monthly
      trend line chart + KPI table, a new `crm_sales_targets` DB table (with RLS + indexes,
      added after a real audit round caught the initial RLS gap), 20 dashboard unit tests +
      a migration-content RLS test + 2 tenant-isolation tests. #657 is a thinner widget: 4 stat
      tiles + 2 bar charts, reuses the existing `getSalesPipelineOverview()` read-only, no new
      DB table, no cross-filtering, no monthly targets/trend, 6 route-wiring tests only (no
      aggregation-logic tests needed since it does none). #657's own PR body does not reference
      #610 or the Owner mockup -- consistent with it having been dispatched without checking
      whether this gap already had an in-flight/stalled attempt.
- [x] Confirmed via `git merge-tree --write-tree origin/main origin/<pr610-branch>`: #610's real
      conflicts against current main are only in shared append-only governance files
      (ai-os/boss/ACTIVE-CLAIMS.yaml, ai-os/registry/terminology-guardrail-exemptions.yaml,
      drizzle/meta/_journal.json) plus one real code conflict in crm-service.ts -- none of these
      are conflicts with PR #657 itself (#657 has not merged to main).
- [ ] Rebase PR #610's branch onto current main in a dedicated worktree (not this task's own
      worktree -- following this repo's established pr***-fix worktree pattern), resolve the
      4 real conflicts, verify tests/build, push.
- [ ] Append comparison + decision to KERNEL_CONSOLIDATION_STATUS.md's Workstream D section
      (file not present in this repo checkout as of 2026-07-31 -- searching for its real location
      before assuming it doesn't exist).

## Remaining
- [ ] Finish rebase of PR #610, verify CI
- [ ] Record decision (keep #610 rebased + CI green; flag #657 as the redundant/thinner
      duplicate for its own owning session to close -- out of this task's scope to touch #657
      directly per its own CONSTRAINTS)
- [ ] Update KERNEL_CONSOLIDATION_STATUS.md if a real path for it is found
