-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the CRM lead follow-up alerts move off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/crm-lead-followup-alerts/run", 15 11 * * *.
--
-- WHAT
--   compliance.cron_crm_lead_followup_alerts(p_dedup boolean = true, p_dry_run boolean = false, p_now timestamptz = now(),
--     p_branch_key text = 'sales') returns jsonb: one 'deadline_reminder' per overdue lead to its owner, for every org with the
--     sales branch enabled.
--   cron job 'cost001-crm-lead-followup-alerts' at '15 11 * * *' (UTC), command: select compliance.cron_crm_lead_followup_alerts();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/27_crm_lead_followup_alerts.sql: the function text is copied unchanged except that the dollar-quote tag is fn where the prepared file used the bare pair. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Notification dedup stays ON (decisions 3 and 7). Org discovery uses distinct org ids (27a).
--
-- LIVE COUNTS 2026-09-26 (read only)
--  27 orgs have the sales branch enabled; 0 overdue leads: the first run writes 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts notification rows with metadata kind crm_lead_followup_overdue.
--
-- FIRST LIVE CALL: select compliance.cron_crm_lead_followup_alerts(p_dry_run => true);
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0641_build001_cron_crm_lead_followups.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_crm_lead_followup_alerts(
  p_dedup      boolean     default true,
  p_dry_run    boolean     default false,
  p_now        timestamptz default now(),
  p_branch_key text        default 'sales'
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
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
$fn$;

comment on function compliance.cron_crm_lead_followup_alerts(boolean, boolean, timestamptz, text) is
  'COST-001 pg_cron port of notifyOverdueLeadFollowUpsForAllOrgs() (crm-service.ts:2223-2287). Prepared, owner-applied.';


-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_crm_lead_followup_alerts(boolean, boolean, timestamptz, text) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-crm-lead-followup-alerts') THEN
      PERFORM cron.unschedule('cost001-crm-lead-followup-alerts');
    END IF;
    PERFORM cron.schedule('cost001-crm-lead-followup-alerts', '15 11 * * *', $cron$select compliance.cron_crm_lead_followup_alerts();$cron$);
  END IF;
END
$do$;

COMMIT;
