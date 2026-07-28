# PROGRESS -- task-20260728-032915-fix-pr-610-rls-gap-on-crm-sales-targets

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, checked out PR #610's own branch
      (worker/task-20260727-193351-sales-pipeline-interactive-dashboard--co),
      registered this session's claim there (right above the original
      authoring session's claim), pushed standalone before real work
- [x] Confirmed audit finding: `drizzle/0268_sales_pipeline_dashboard_targets.sql`
      created `compliance.crm_sales_targets` with zero RLS -- no ENABLE ROW
      LEVEL SECURITY, no policies, no org_id index, unlike every other
      org-scoped table (e.g. `0101_wave115_construction_boq_progress_diary.sql`)
- [x] Confirmed 0268 safe to amend in place: not yet merged to main, not
      referenced anywhere else in the repo (grepped)
- [x] Amended 0268: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` +
      `app_runtime_tenant_isolation` policy (`org_id = compliance.current_org_id()`)
      + `service_role_bypass_crm_sales_targets` policy, matching 0101's exact
      pattern. Added `idx_crm_sales_targets_org_id` and
      `idx_crm_sales_targets_org_id_month` indexes matching
      `getSalesPipelineDashboardData`'s org_id-only query and
      `setSalesTarget`'s org_id+month find-or-create query
      (`crm-service.ts`)
- [x] Checked for an existing DB-level RLS test to mirror (task spec
      suggested one might exist for `construction_boq_line_items`) --
      confirmed via grep none exists; the closest precedent,
      `tenant-isolation.test.ts`, explicitly documents in its own header
      that it only covers the app-level layer (mocks `withTenantContext`
      entirely), not DB-level RLS. No live DB/Supabase MCP available in
      this sandbox (no `DATABASE_URL`, no MCP tool). Added two things
      instead: (1) `src/lib/services/sales-pipeline-rls.test.ts`, a real
      DB-independent test that reads the actual migration SQL and asserts
      the RLS-enable clause, both policies, and both indexes are present
      -- 5/5 pass; (2) two new tests in `tenant-isolation.test.ts` covering
      `getSalesPipelineDashboardData`/`setSalesTarget`'s app-level org
      scoping, matching that file's existing mock pattern exactly
- [x] Verified: `npx tsc --noEmit` clean; `bun test
      src/lib/services/sales-pipeline-dashboard-service.test.ts` 20/20 pass
      (unchanged, no regression); `bun test
      src/lib/services/sales-pipeline-rls.test.ts
      src/lib/services/tenant-isolation.test.ts` 12/12 pass;
      `check-migration-collision.mjs` and `check-guardrail-presence.mjs`
      pass; `NODE_OPTIONS=--max-old-space-size=8192 bun run build` run to
      completion in the background (see result appended below once done)
- [x] Discovered but explicitly did NOT fix (out of this task's scope --
      RLS/index/build only): PR #610 already fails 2 pre-existing CI
      checks unrelated to RLS -- Asset Registry Coverage Check
      (`crm_sales_targets` neither registered nor exempted in
      `ai-os/registry/asset-registry-coverage.yaml`) and the terminology
      guardrail (`--diff-only`, pre-existing hardcoded 2026-07-27-era dates
      in `schema.ts`/`crm-service.ts` comments). Confirmed both are
      pre-existing by running each check with this session's diff stashed
      vs. applied -- byte-identical failing output either way, so neither
      was introduced by this fix. Flagging for the supervisor/original
      session, not fixing here.

## Remaining
- [ ] `bun run build` result pending -- running in background at time of
      this write, will update this section with the real exit code once
      it finishes (superseding the original session's disclosed
      never-completed build below)
- [ ] Awaiting fresh supervisor audit before merge (per task's own
      EXPECTED_OUTPUT -- not self-merging)
- [ ] Pre-existing Asset Registry Coverage Check + terminology guardrail
      CI failures on this PR, both confirmed unrelated to this fix (see
      above) -- left for the supervisor/original session to triage

# PROGRESS -- task-20260727-193351-sales-pipeline-interactive-dashboard--co

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this task's claim, pushed it standalone before real work
- [x] Confirmed crmOpportunities.stage gap: 5 legacy free-text values, none of the mockup's 8
      pipeline-status names exist anywhere in the codebase
- [x] Confirmed no existing "monthly revenue target" concept anywhere (grepped schema.ts +
      src/lib/services)
- [x] Researched existing win-probability/health-scoring logic (aiWinProbability is an opaque
      per-deal LLM score, no formula; getSalesPipelineOverview's winRate = won/(won+lost) is the
      only existing pipeline-aggregate formula) -- reused for Success %, derived Health % from
      average aiWinProbability over open deals
- [x] Added `crm_sales_targets` table (schema.ts) + hand-written migration 0268 (additive only,
      no changes to crm_leads/crm_opportunities)
- [x] Built pure aggregation module `sales-pipeline-dashboard-service.ts`: stage normalization
      (legacy 5 -> mockup 8 + canonical passthrough), KPI computations, both bar-chart
      aggregations, monthly trend + KPI table
- [x] 20 unit tests (`sales-pipeline-dashboard-service.test.ts`), all passing -- covers KPI math
      against a realistic multi-stage seeded set AND the cross-filter interaction
- [x] DB-fetch layer (`getSalesPipelineDashboardData`, `setSalesTarget` in crm-service.ts) +
      API routes (`src/app/api/crm/sales-pipeline/route.ts`)
- [x] Dashboard page (`src/app/(app)/crm/sales-pipeline/page.tsx`): 6 KPI tiles, 2 filter
      dropdowns (salesperson/month), 2 bar charts, monthly trend line chart + KPI table,
      scrollable deal-list panel, click-to-cross-filter on the Pipeline Status bars with a
      visible clear control and heading that reflects the active filter
- [x] Linked from `/crm` overview page
- [x] Verified: `npx tsc --noEmit` clean, `bun test` (20/20 pass), `eslint` clean on all new/
      touched files, `grep -rn "Sales Pipeline" src/` confirms the real route/screen exists,
      `check-migration-collision.mjs` and `check-terminology-guardrail.mjs --diff-only` both
      pass (added 3 real dated-comment exemption entries)
- [x] Committed + pushed

## Remaining
- [ ] `bun run build` (full production build) could not be completed in this session's sandbox:
      first attempt timed out at ~280s, second (backgrounded, 8GB heap) was silently killed
      (likely OOM) partway through Turbopack's build on this repo's large schema/route graph.
      Per this task's own circuit-breaker protocol (stop after 2 consecutive failures of the
      identical approach), not retried a 3rd time. tsc/eslint/tests all pass and are the
      verified proxies used instead -- recommend the supervisor auditor re-run
      `bun run build` with more time/memory before merge.
- [ ] No settings UI for `setSalesTarget` -- only a raw POST endpoint exists. Out of scope per
      the mockup (which shows the chart/table, not a target editor); flagging in case the Owner
      wants one.
- [ ] Awaiting fresh supervisor audit before merge (per task's own EXPECTED_OUTPUT -- not
      self-merging)
