-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the-firm recurring engagements move off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/the-firm/recur-engagements/run", 30 7 * * *.
--
-- WHAT
--   compliance.cron_the_firm_recur_engagements(p_month_end text = 'clamp', p_today date = null) returns jsonb
--     for every the_firm org, clones each due recurring engagement as a one-off row and advances the source's next_occurrence_date
--     by its recurrence (monthly 1, quarterly 3, half_yearly 6, annually 12 months). One statement, so clone and advance are atomic.
--   cron job 'cost001-the-firm-recur-engagements' at '30 7 * * *' (UTC), command: select compliance.cron_the_firm_recur_engagements();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/07_the_firm_recur_engagements.sql: the function text is copied unchanged. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Decision 4: month-end dates CLAMP (31 Jan plus one month is 28 Feb), the Postgres behaviour, not the old JavaScript overflow.
--  createEngagement in src/lib/services/firm-engagement-service.ts still seeds the first next_occurrence_date with the overflowing
--  helper; aligning it is a separate change.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  1 org has the_firm enabled; firm_engagements 0 rows: the first run acts on 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run advances next_occurrence_date on source engagements and inserts one clone per due engagement.
--
-- FIRST LIVE CALL: This function has no dry-run parameter (the prepared file has none). To read its counts before the first scheduled run,
--   call it inside a transaction that is rolled back, with begin, the call and rollback in ONE execute_sql call: begin; select compliance.cron_the_firm_recur_engagements(); rollback;
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0634_build001_cron_the_firm_recur.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_the_firm_recur_engagements(
  p_month_end text default 'clamp',      -- OWNER DECISION #4: 'clamp' | 'overflow'
  p_today     date default null          -- null = current UTC date (testing override)
)
returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_today                      date := coalesce(p_today, (now() at time zone 'utc')::date);
  v_orgs_scanned               integer := 0;
  v_skipped_unknown_recurrence integer := 0;
  v_generated                  integer := 0;
begin
  if p_month_end is null or p_month_end not in ('clamp', 'overflow') then
    raise exception 'cron_the_firm_recur_engagements: p_month_end must be ''clamp'' or ''overflow'' (got %)', p_month_end;
  end if;

  -- Overlap guard: released automatically at transaction end.
  if not pg_try_advisory_xact_lock(hashtext('cost001:the-firm-recur-engagements')::bigint) then
    return jsonb_build_object('ran_at', now(), 'skipped', true,
                              'reason', 'another run of this job holds the advisory lock');
  end if;

  -- TS: orgsScanned = distinct orgs with the_firm enabled.
  select count(distinct e.org_id)
    into v_orgs_scanned
    from compliance.org_product_branch_enablements e
    join platform.product_branches pb on pb.id = e.product_branch_id
   where e.is_enabled
     and pb.branch_key = 'the_firm';

  -- Summary-only: rows the TS would `continue` past (recurrence_type not in
  -- RECURRENCE_MONTHS). Read-only.
  select count(*)
    into v_skipped_unknown_recurrence
    from compliance.firm_engagements fe
   where fe.recurrence_type <> 'none'
     and fe.recurrence_type not in ('monthly', 'quarterly', 'half_yearly', 'annually')
     and fe.next_occurrence_date <= v_today
     and fe.status <> 'terminated'
     and exists (select 1
                   from compliance.org_product_branch_enablements e
                   join platform.product_branches pb on pb.id = e.product_branch_id
                  where e.org_id = fe.org_id and e.is_enabled and pb.branch_key = 'the_firm')
     and exists (select 1 from compliance.clients c where c.id = fe.client_id and c.org_id = fe.org_id);

  -- Advance the source rows and clone them, atomically.
  with firm_orgs as (
    select distinct e.org_id
      from compliance.org_product_branch_enablements e
      join platform.product_branches pb on pb.id = e.product_branch_id
     where e.is_enabled
       and pb.branch_key = 'the_firm'
  ),
  due as (
    update compliance.firm_engagements fe
       set next_occurrence_date =
             case p_month_end
               when 'clamp' then
                 (fe.next_occurrence_date + make_interval(months => m.months))::date
               else
                 -- JS Date.setUTCMonth() replica: first of the target month, plus
                 -- (day - 1) days, so a day past that month's end rolls forward.
                 make_date(
                   extract(year  from fe.next_occurrence_date)::int
                     + ((extract(month from fe.next_occurrence_date)::int - 1 + m.months) / 12),
                   ((extract(month from fe.next_occurrence_date)::int - 1 + m.months) % 12) + 1,
                   1
                 ) + (extract(day from fe.next_occurrence_date)::int - 1)
             end,
           updated_at = now()
      from firm_orgs fo,
           (values ('monthly', 1), ('quarterly', 3), ('half_yearly', 6), ('annually', 12))
             as m (recurrence_type, months)                       -- RECURRENCE_MONTHS
     where fe.org_id = fo.org_id
       and fe.recurrence_type = m.recurrence_type                  -- implies <> 'none' and known
       and fe.next_occurrence_date <= v_today
       and fe.status <> 'terminated'
       and exists (select 1 from compliance.clients c
                    where c.id = fe.client_id and c.org_id = fe.org_id)   -- RLS client-scope mirror
    returning fe.id, fe.org_id, fe.client_id, fe.service_line, fe.title, fe.scope_of_work,
              fe.fee_type, fe.fee_amount, fe.billing_frequency, fe.lead_partner_user_id,
              fe.budgeted_hours, fe.created_by_id
  ),
  ins as (
    insert into compliance.firm_engagements
      (org_id, client_id, service_line, title, scope_of_work, fee_type, fee_amount,
       billing_frequency, start_date, lead_partner_user_id, budgeted_hours,
       recurrence_type, created_by_id)
    select d.org_id, d.client_id, d.service_line, d.title, d.scope_of_work, d.fee_type, d.fee_amount,
           d.billing_frequency, v_today, d.lead_partner_user_id, d.budgeted_hours,
           'none', d.created_by_id
      from due d
    returning id
  )
  select count(*) into v_generated from ins;

  return jsonb_build_object(
    'ran_at',                     now(),
    'today_utc',                  v_today,
    'month_end',                  p_month_end,
    'orgs_scanned',               v_orgs_scanned,               -- TS: orgsScanned
    'engagements_generated',      v_generated,                  -- TS: engagementsGenerated
    'skipped_unknown_recurrence', v_skipped_unknown_recurrence
  );
end;
$fn$;

-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_the_firm_recur_engagements(text, date) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-the-firm-recur-engagements') THEN
      PERFORM cron.unschedule('cost001-the-firm-recur-engagements');
    END IF;
    PERFORM cron.schedule('cost001-the-firm-recur-engagements', '30 7 * * *', $cron$select compliance.cron_the_firm_recur_engagements();$cron$);
  END IF;
END
$do$;

COMMIT;
