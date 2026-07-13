-- Priority 12 (OPEN-07 point 8 follow-on, 2026-07-14): one-time backfill of
-- org_product_branch_enablements for the 'construction' branch, before
-- requireConstructionEnabled() enforcement goes live on
-- construction-reports-service.ts and the Reports & Analysis Engine
-- dispatcher (report-engine-service.ts#executeReportDefinition).
--
-- Built from real usage, not guessed: queried live via Supabase MCP
-- (2026-07-14) across every construction_* table (boqs, categories,
-- activities, work_progress_entries, attendance, site_diaries, kpi_entries,
-- expense_entries, labour_roster) -- exactly 2 orgs have any real
-- construction data and neither had an is_enabled row for 'construction'
-- (zero rows existed for this branch at all, for any org):
--   - projexa_demo_org ("Skyline Builders (PROJEXA Demo)"): heavy real
--     usage across every table (6 categories, 13 activities, 2 BOQs, 45
--     progress entries, 112 attendance rows, 10 site diaries, 10 KPI
--     entries, 12 expenses, 14 roster rows) -- the PROJEXA demo tenant.
--   - obux019rsc5nzxjx93rrpc1j ("PROJEXA Load Test loadtest-..."): 1
--     category + 1 BOQ -- a load-test org, included anyway since it has
--     real (non-zero) rows, matching drizzle/0185's own inclusive
--     precedent ("built from real usage, not guessed").
-- Every other org (including demo_org/demo_co_*, which only have
-- ERP/sales/interior-design activity) has zero rows in any construction_*
-- table and is correctly left disabled.
insert into compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
select o.org_id, pb.id, true, now()
from (
  values
    ('projexa_demo_org'),
    ('obux019rsc5nzxjx93rrpc1j')
) as o(org_id)
cross join (select id from compliance.product_branches where branch_key = 'construction') pb
on conflict (org_id, product_branch_id) do nothing;
