-- Priority 12 (OPEN-07 decision c, Owner directive 2026-07-13): one-time
-- backfill of org_product_branch_enablements for the 'sales' branch, before
-- requireSalesEnabled() enforcement goes live on the CRM API surface.
--
-- Built from real usage, not guessed: every org with an existing row in
-- crm_leads or crm_opportunities as of 2026-07-13 (queried live via Supabase
-- MCP -- 11 orgs: demo_org + 10 demo_co_* seed companies). 'erp' needed no
-- backfill: demo_org is the only org with any ERP transactional usage and
-- already has an is_enabled=true row for 'erp' (demo_opbe_erp, seeded
-- 2026-07-06).
insert into compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled, enabled_at)
select o.org_id, pb.id, true, now()
from (
  values
    ('demo_org'),
    ('demo_co_1_sharma'),
    ('demo_co_2_meridian'),
    ('demo_co_3_campus'),
    ('demo_co_4_velocity'),
    ('demo_co_5_apex'),
    ('demo_co_6_horizon'),
    ('demo_co_7_grandvista'),
    ('demo_co_8_skyline'),
    ('demo_co_9_rise'),
    ('demo_co_10_wellness')
) as o(org_id)
cross join (select id from compliance.product_branches where branch_key = 'sales') pb
on conflict (org_id, product_branch_id) do nothing;
