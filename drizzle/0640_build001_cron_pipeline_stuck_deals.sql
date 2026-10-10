-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the stuck-deal digest moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/pipeline-stuck-deal-digest/run", 50 9 * * *.
--
-- WHAT
--   compliance.cron_pipeline_stuck_deal_digest(p_dedup boolean = true, p_dry_run boolean = false, p_stuck_threshold_days integer = 30,
--     p_now timestamptz = now()) returns jsonb: one 'deadline_reminder' per deal owner for open deals in one stage for the threshold days.
--   cron job 'cost001-pipeline-stuck-deal-digest' at '50 9 * * *' (UTC), command: select compliance.cron_pipeline_stuck_deal_digest();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/23_pipeline_stuck_deal_digest.sql: the function text is copied unchanged except that the dollar-quote tag is fn where the prepared file used the bare pair. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Notification dedup stays ON (decisions 3 and 7). Without it the TypeScript wrote 2 rows a day for the same 4 deals.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  4 open owned opportunities, all stuck (longest 81 days), across 2 owners. Each owner already has 6 unread digest rows, so with
--  dedup on the first run writes 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts notification rows with metadata kind pipeline_stuck_deal_digest.
--
-- FIRST LIVE CALL: select compliance.cron_pipeline_stuck_deal_digest(p_dry_run => true);
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0640_build001_cron_pipeline_stuck_deals.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_pipeline_stuck_deal_digest(
  p_dedup                boolean     default true,
  p_dry_run              boolean     default false,
  p_stuck_threshold_days int         default 30,
  p_now                  timestamptz default now()
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
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
$fn$;

comment on function compliance.cron_pipeline_stuck_deal_digest(boolean, boolean, int, timestamptz) is
  'COST-001 pg_cron port of runPipelineStuckDealDigest() (pipeline-stuck-deal-digest-service.ts:45-83). Prepared, owner-applied.';


-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_pipeline_stuck_deal_digest(boolean, boolean, integer, timestamptz) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-pipeline-stuck-deal-digest') THEN
      PERFORM cron.unschedule('cost001-pipeline-stuck-deal-digest');
    END IF;
    PERFORM cron.schedule('cost001-pipeline-stuck-deal-digest', '50 9 * * *', $cron$select compliance.cron_pipeline_stuck_deal_digest();$cron$);
  END IF;
END
$do$;

COMMIT;
