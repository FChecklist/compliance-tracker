-- ============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron port -- cron 23: pipeline-stuck-deal-digest
-- ============================================================================
-- STATUS      : PREPARED, NOT APPLIED. Owner rule: "Prepare, do not execute.
--               Branch only." Only the SELECT half was dry-run read-only on
--               2026-09-22 (counts in README_b.md).
-- Vercel route: GET /api/internal/pipeline-stuck-deal-digest/run
-- Vercel cron : "50 9 * * *"  (vercel.json:29 -- daily 09:50 UTC)
-- Route file  : src/app/api/internal/pipeline-stuck-deal-digest/run/route.ts:21
-- Mirrors     : src/lib/services/pipeline-stuck-deal-digest-service.ts
--                 :16     STUCK_THRESHOLD_DAYS = 30
--                 :25-33  groupStuckDealsByOwner()  (one row per owner, never per deal)
--                 :36-43  summarizeStuckDeals()     (1 deal -> name/stage/days;
--                          N deals -> count + longest)
--                 :45-83  runPipelineStuckDealDigest():
--                          :46-50  crm_opportunities.stage not in (won, lost), owner_id set
--                          :53-59  latest crm_stage_history.changed_at per opportunity
--                                  (entity_type = 'opportunity')
--                          :64-66  since = latest change ?? created_at;
--                                  daysInStage = floor((now - since) / 86400000)
--                                  >= 30 -> stuck
--                          :72-81  one 'deadline_reminder' per owner,
--                                  metadata { kind, opportunityIds }
--
-- WHY THIS EXISTS: see 04_metric_alerts.sql's header (app_runtime has no
-- BYPASSRLS, so this route has read zero rows since ~2026-08-23 -- live
-- evidence: the last 'pipeline_stuck_deal_digest' rows are dated 2026-08-21;
-- a pg_cron job runs as postgres and re-enables it -- intended, owner-signed).
--
-- DEDUP CONVENTION (OWNER DECISION #3 / #7): `p_dedup boolean default true`
--   skips an owner who already has an UNREAD notification with type
--   'deadline_reminder' and metadata->>'kind' = 'pipeline_stuck_deal_digest'.
--   The digest is the entity, so the key is (user, type, kind). The TS already
--   sets metadata.kind -- no key is added by this port -- so `p_dedup => false`
--   reproduces today's TS behaviour EXACTLY, and today's TS behaviour is:
--   LIVE, 4 owned open deals are all 77 days in stage (2 owners); with
--   p_dedup => false this writes 2 rows per day (one per owner) FOREVER until
--   the deals move stage or lose their owner -- exactly what the Vercel cron
--   did from 2026-08-16 to 2026-08-21 (12 rows = 6 days x 2 owners, all
--   still unread). With p_dedup => true the dry-run shows 0 rows today,
--   because those 12 unread rows already carry the kind key.
--
-- OWNER DECISION POINTS (this file)
--   #23a Threshold is a parameter (`p_stuck_threshold_days default 30`) so the
--        owner can tune it without editing the function; the message text
--        "for 30+ days" uses the same parameter.
--   #23b `crm_opportunities` and `crm_leads` carry the live SECURITY DEFINER
--        trigger auto_register_asset_trg, but this function only READS them
--        (it writes notifications only), so no trigger fires.
--
-- SWITCH-ON (owner runs): apply file -> select compliance.cron_pipeline_stuck_deal_digest(p_dry_run => true);
--   -> uncomment cron.schedule below -> remove the Vercel cron entry in a
--   separate reviewed PR (vercel.json is out of this task's scope).
-- ============================================================================

create or replace function compliance.cron_pipeline_stuck_deal_digest(
  p_dedup                boolean     default true,
  p_dry_run              boolean     default false,
  p_stuck_threshold_days int         default 30,
  p_now                  timestamptz default now()
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  g         record;
  v_message text;
  v_owners  int := 0;
  v_deals   int := 0;
  v_deduped int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('pipeline_stuck_deal_digest')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  for g in
    with open_owned as (
      -- :46-50  open (not won/lost) opportunities that have an owner
      select o.id, o.org_id, o.name, o.stage, o.owner_id,
             -- :53-59, :64  latest stage change for this opportunity, else created_at
             coalesce((select max(h.changed_at)
                       from compliance.crm_stage_history h
                       where h.entity_type = 'opportunity' and h.entity_id = o.id),
                      o.created_at) as since
      from compliance.crm_opportunities o
      where o.stage not in ('won', 'lost')
        and o.owner_id is not null
    ),
    stuck as (
      -- :65-66  daysInStage = floor((now - since) / 86_400_000)
      select *, floor(extract(epoch from (p_now - since)) / 86400)::int as days_in_stage
      from open_owned
    )
    -- :70  groupStuckDealsByOwner()
    select owner_id,
           count(*)::int                                  as deal_count,
           max(days_in_stage)                             as max_days,
           jsonb_agg(id order by since, id)               as opportunity_ids,
           (array_agg(name  order by since, id))[1]       as first_name,
           (array_agg(stage order by since, id))[1]       as first_stage,
           (array_agg(days_in_stage order by since, id))[1] as first_days
    from stuck
    where days_in_stage >= p_stuck_threshold_days
    group by owner_id
    order by owner_id
  loop
    if p_dedup and exists (
      select 1 from compliance.notifications n
      where n.user_id = g.owner_id and n.type = 'deadline_reminder' and n.is_read = false
        and n.metadata->>'kind' = 'pipeline_stuck_deal_digest'
    ) then
      v_deduped := v_deduped + 1;
      continue;
    end if;

    -- :36-43  summarizeStuckDeals()
    if g.deal_count = 1 then
      v_message := '"' || g.first_name || '" has been in ' || g.first_stage || ' for '
                   || g.first_days::text || ' days with no stage change.';
    else
      v_message := g.deal_count::text || ' deals have been stuck in their current stage for '
                   || p_stuck_threshold_days::text || '+ days (longest: ' || g.max_days::text || ' days).';
    end if;

    -- :73-79  one row per owner
    if not p_dry_run then
      insert into compliance.notifications (user_id, title, message, type, metadata)
      values (
        g.owner_id,
        'Deals stuck in pipeline',
        v_message,
        'deadline_reminder',
        jsonb_build_object(
          'kind', 'pipeline_stuck_deal_digest',
          'opportunityIds', g.opportunity_ids)
      );
    end if;

    v_owners := v_owners + 1;
    v_deals  := v_deals + g.deal_count;
  end loop;

  -- :82  { ownersNotified, dealsCovered }
  return jsonb_build_object(
    'ownersNotified', v_owners, 'dealsCovered', v_deals,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_pipeline_stuck_deal_digest(boolean, boolean, int, timestamptz) is
  'COST-001 pg_cron port of runPipelineStuckDealDigest() (pipeline-stuck-deal-digest-service.ts:45-83). Prepared, owner-applied.';


-- ============================================================================
-- SCHEDULE (OWNER ACTION -- commented out; same "50 9 * * *" as vercel.json:29)
-- ============================================================================
-- select cron.schedule('cost001-pipeline-stuck-deal-digest', '50 9 * * *', $$select compliance.cron_pipeline_stuck_deal_digest();$$);
--
-- Exact TS behaviour (no dedup -- 2 rows/day/owner forever on today's data):
-- select cron.schedule('cost001-pipeline-stuck-deal-digest', '50 9 * * *', $$select compliance.cron_pipeline_stuck_deal_digest(p_dedup => false);$$);

-- ============================================================================
-- ROLLBACK (OWNER ACTION -- commented out)
-- ============================================================================
-- select cron.unschedule('cost001-pipeline-stuck-deal-digest');
-- drop function if exists compliance.cron_pipeline_stuck_deal_digest(boolean, boolean, int, timestamptz);
-- Rows written by this function: metadata->>'kind' = 'pipeline_stuck_deal_digest'
-- (indistinguishable from the TS's own 12 existing rows -- same key, by design).
