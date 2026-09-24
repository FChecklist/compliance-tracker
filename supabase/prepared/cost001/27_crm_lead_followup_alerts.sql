-- ============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron port -- cron 27: crm-lead-followup-alerts
-- ============================================================================
-- STATUS      : PREPARED, NOT APPLIED. Owner rule: "Prepare, do not execute.
--               Branch only." Only the SELECT half was dry-run read-only on
--               2026-09-22 (counts in README_b.md).
-- Vercel route: GET /api/internal/crm-lead-followup-alerts/run
-- Vercel cron : "15 11 * * *"  (vercel.json:33 -- daily 11:15 UTC)
-- Route file  : src/app/api/internal/crm-lead-followup-alerts/run/route.ts:22
-- Mirrors     : src/lib/services/crm-service.ts
--                 :2223-2249  notifyOverdueLeadFollowUpsForOrg():
--                              today = UTC date (toISOString().slice(0,10));
--                              crm_leads where org_id = org, next_action_date
--                              not null and <= today, owner_id not null,
--                              status not in (converted, lost); one
--                              'deadline_reminder' per lead to its owner,
--                              metadata { kind: 'crm_lead_followup_overdue', leadId }
--                 :2273-2287  notifyOverdueLeadFollowUpsForAllOrgs():
--                              org discovery = listOrgIdsWithBranchEnabled('sales'),
--                              per-org try/catch, { orgsProcessed, orgsFailed, totalNotified }
--               src/lib/services/product-branch-service.ts
--                 :108-116    listOrgIdsWithBranchEnabled(): platform.product_branches
--                              findFirst by branch_key (NO is_active/status filter),
--                              then compliance.org_product_branch_enablements where
--                              product_branch_id = that id and is_enabled = true
--
-- WHY THIS EXISTS: see 04_metric_alerts.sql's header (app_runtime has no
-- BYPASSRLS, so this route has read zero rows since ~2026-08-23; a pg_cron
-- job runs as postgres and re-enables it -- intended, owner-signed).
--
-- DEDUP CONVENTION (OWNER DECISION #3 / #7): `p_dedup boolean default true`
--   skips a lead owner who already has an UNREAD notification with type
--   'deadline_reminder', metadata->>'kind' = 'crm_lead_followup_overdue' and
--   the same metadata->>'leadId'. The TS already sets both keys -- nothing is
--   added by this port -- so `p_dedup => false` reproduces today's TS
--   behaviour EXACTLY: one row per overdue lead per day until the owner acts
--   (the TS's own docstring at :2216-2221 says re-notify daily is intended).
--
-- OWNER DECISION POINTS (this file)
--   #27a Org discovery: the TS mapped enablement rows to org ids WITHOUT
--        de-duplicating (:115), so an org with two enablement rows for the
--        same branch would be processed -- and its owners notified -- twice
--        per run. This port uses `select distinct org_id`. Live today there
--        are 27 orgs with 'sales' enabled; the distinct/non-distinct counts
--        are equal (dry-run), so no behaviour differs on current data.
--   #27b The branch is looked up by `p_branch_key default 'sales'` exactly as
--        the TS does: platform.product_branches has BOTH an is_active and a
--        status column, and the TS ignores both. Mirrored (ignored).
--   #27c `crm_leads` carries the live SECURITY DEFINER trigger
--        auto_register_asset_trg, but this function only READS it.
--
-- LIVE COLUMN CHECK (2026-09-22): crm_leads.next_action_date is `date`,
--   owner_id/status text, org_id text NOT NULL; org_product_branch_enablements
--   (org_id, product_branch_id, is_enabled); platform.product_branches
--   (id, branch_key). All present.
--
-- SWITCH-ON (owner runs): apply file -> select compliance.cron_crm_lead_followup_alerts(p_dry_run => true);
--   -> uncomment cron.schedule below -> remove the Vercel cron entry in a
--   separate reviewed PR (vercel.json is out of this task's scope).
-- ============================================================================

create or replace function compliance.cron_crm_lead_followup_alerts(
  p_dedup      boolean     default true,
  p_dry_run    boolean     default false,
  p_now        timestamptz default now(),
  p_branch_key text        default 'sales'
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  o           record;
  l           record;
  v_branch_id text;
  v_today     date;
  v_orgs      int := 0;
  v_failed    int := 0;
  v_notified  int := 0;
  v_deduped   int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('crm_lead_followup_alerts')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :2224  today = new Date().toISOString().slice(0, 10)  (UTC date)
  v_today := (p_now at time zone 'UTC')::date;

  -- product-branch-service.ts:109-110  findFirst by branch_key; none -> []
  select id into v_branch_id
  from platform.product_branches
  where branch_key = p_branch_key
  order by created_at, id
  limit 1;

  if v_branch_id is null then
    return jsonb_build_object(
      'orgsProcessed', 0, 'orgsFailed', 0, 'totalNotified', 0,
      'branchFound', false, 'dryRun', p_dry_run);
  end if;

  -- product-branch-service.ts:111-115  enabled orgs (OWNER DECISION #27a: distinct)
  for o in
    select distinct org_id
    from compliance.org_product_branch_enablements
    where product_branch_id = v_branch_id
      and is_enabled = true
    order by org_id
  loop
    begin
      -- :2226-2236  overdue leads for this org
      for l in
        select id, name, owner_id, next_action_date
        from compliance.crm_leads
        where org_id = o.org_id
          and next_action_date is not null
          and next_action_date <= v_today
          and owner_id is not null
          and status not in ('converted', 'lost')
        order by next_action_date, id
      loop
        -- :2239  if (!lead.ownerId || !lead.nextActionDate) continue
        continue when nullif(l.owner_id, '') is null or l.next_action_date is null;

        if p_dedup and exists (
          select 1 from compliance.notifications n
          where n.user_id = l.owner_id and n.type = 'deadline_reminder' and n.is_read = false
            and n.metadata->>'kind' = 'crm_lead_followup_overdue'
            and n.metadata->>'leadId' = l.id
        ) then
          v_deduped := v_deduped + 1;
          continue;
        end if;

        -- :2240-2244
        if not p_dry_run then
          insert into compliance.notifications (user_id, title, message, type, metadata)
          values (
            l.owner_id,
            'Lead follow-up overdue',
            'Lead "' || l.name || '" was due for follow-up on '
              || to_char(l.next_action_date, 'YYYY-MM-DD') || '.',
            'deadline_reminder',
            jsonb_build_object(
              'kind', 'crm_lead_followup_overdue',
              'leadId', l.id)
          );
        end if;
        v_notified := v_notified + 1;
      end loop;

      v_orgs := v_orgs + 1;

    exception when others then
      -- :2281-2284  per-org try/catch: one org's failure never stops the rest
      v_failed := v_failed + 1;
      raise warning 'cost001 cron_crm_lead_followup_alerts: org % failed: % (%)', o.org_id, sqlerrm, sqlstate;
    end;
  end loop;

  -- :2286  { orgsProcessed, orgsFailed, totalNotified }
  return jsonb_build_object(
    'orgsProcessed', v_orgs, 'orgsFailed', v_failed, 'totalNotified', v_notified,
    'deduped', v_deduped, 'branchFound', true, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_crm_lead_followup_alerts(boolean, boolean, timestamptz, text) is
  'COST-001 pg_cron port of notifyOverdueLeadFollowUpsForAllOrgs() (crm-service.ts:2223-2287). Prepared, owner-applied.';


-- ============================================================================
-- SCHEDULE (OWNER ACTION -- commented out; same "15 11 * * *" as vercel.json:33)
-- ============================================================================
-- select cron.schedule('cost001-crm-lead-followup-alerts', '15 11 * * *', $$select compliance.cron_crm_lead_followup_alerts();$$);
--
-- Exact TS behaviour (no dedup):
-- select cron.schedule('cost001-crm-lead-followup-alerts', '15 11 * * *', $$select compliance.cron_crm_lead_followup_alerts(p_dedup => false);$$);

-- ============================================================================
-- ROLLBACK (OWNER ACTION -- commented out)
-- ============================================================================
-- select cron.unschedule('cost001-crm-lead-followup-alerts');
-- drop function if exists compliance.cron_crm_lead_followup_alerts(boolean, boolean, timestamptz, text);
-- Rows written by this function: metadata->>'kind' = 'crm_lead_followup_overdue'
-- (indistinguishable from the TS's own rows -- same key, by design).
