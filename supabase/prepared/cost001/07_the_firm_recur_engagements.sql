-- =============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron replacement for a Vercel cron
-- File:   supabase/prepared/cost001/07_the_firm_recur_engagements.sql
-- Status: PREPARED, NOT APPLIED. Nothing in this file has been executed against
--         any database. Apply only per README.md (owner, SQL editor as postgres,
--         one file at a time). Branch-only work order: "Prepare, do not execute."
-- -----------------------------------------------------------------------------
-- WHAT THE VERCEL CRON DID
--   Route:     GET/POST /api/internal/the-firm/recur-engagements/run
--   Schedule:  30 7 * * *  (UTC; vercel.json "crons" entry)
--   Handler:   src/app/api/internal/the-firm/recur-engagements/run/route.ts:19-30
--              (CRON_SECRET bearer check, then generateRecurringEngagements())
--   Logic:     src/lib/services/firm-engagement-service.ts:90-128  generateRecurringEngagements()
--              src/lib/services/firm-engagement-service.ts:20      RECURRENCE_MONTHS
--                { monthly: 1, quarterly: 3, half_yearly: 6, annually: 12 }
--              src/lib/services/firm-engagement-service.ts:22-26   addMonthsToDateStr()
--   Steps:
--     1. Orgs with the `the_firm` product branch enabled:
--        compliance.org_product_branch_enablements (is_enabled = true)
--          JOIN platform.product_branches ON id = product_branch_id
--          WHERE branch_key = 'the_firm'.
--        (Live column names verified: enablements.product_branch_id / is_enabled /
--        org_id; product_branches.id / branch_key. The FK target is the PLATFORM
--        table, not compliance.product_branches -- see CLAUDE.md R74 notes.)
--     2. Per org, inside withTenantContext({orgId, clientIds: <all org clients>}),
--        select firm_engagements WHERE org_id = org AND recurrence_type <> 'none'
--        AND next_occurrence_date <= today AND status <> 'terminated'.
--        Orgs with zero clients are skipped. RLS on firm_engagements is
--        `org_id = current_org_id() AND client_id = ANY(current_client_ids())`,
--        so an engagement whose client row no longer exists in the org is
--        invisible to the TS -- mirrored here with an EXISTS on compliance.clients.
--     3. For each due row: if RECURRENCE_MONTHS[recurrence_type] is undefined ->
--        skip (continue). Else INSERT a clone (org_id, client_id, service_line,
--        title, scope_of_work, fee_type, fee_amount, billing_frequency,
--        start_date = today, lead_partner_user_id, budgeted_hours,
--        recurrence_type = 'none', created_by_id; end_date/next_occurrence_date
--        NULL, status default 'active') and UPDATE the SOURCE row:
--        next_occurrence_date = addMonthsToDateStr(next_occurrence_date, months),
--        updated_at = now. The source keeps generating; clones never recur.
-- -----------------------------------------------------------------------------
-- SWITCH-ON NOTE (why this is a behaviour change, not a no-op port)
--   The TS's step-1 read runs on the raw `db` export (src/lib/db/index.ts ->
--   DATABASE_URL), which in production authenticates as `app_runtime`
--   (rolbypassrls = false, verified live 2026-09-22).
--   compliance.org_product_branch_enablements has RLS ENABLED + FORCED with the
--   app_runtime policy `org_id = compliance.current_org_id()`; that function reads
--   the GUC `app.current_org_id`, set only inside withTenantContext()
--   (src/lib/db/tenant-scoped.ts:472). The cross-org step-1 read has no tenant
--   context, so it has returned ZERO orgs since ~2026-08-23 and steps 2-3 never
--   ran. A pg_cron job runs as `postgres` (rolbypassrls = true), so scheduling this
--   function RE-ENABLES recurring-engagement cloning for every the_firm org. That
--   is the intent of PROJEXA-COST-001, but it is a real switch-on and the owner
--   signs it off explicitly (README decision table). Dry-run 2026-09-22: 1 org has
--   the_firm enabled; firm_engagements has 0 rows, so a first run acts on 0 rows.
-- -----------------------------------------------------------------------------
-- OWNER DECISION #4 -- month-end arithmetic (p_month_end)
--   addMonthsToDateStr() uses JS Date.setUTCMonth(), which OVERFLOWS past
--   month-end: 2026-01-31 + 1 month -> "Feb 31" -> 2026-03-03; 2026-11-30 + 3 ->
--   2027-03-02; 2026-05-31 + 1 -> 2026-07-01. Postgres `date + interval 'N months'`
--   CLAMPS instead: 2026-01-31 + 1 month -> 2026-02-28 (2024 -> 02-29).
--   This function takes `p_month_end text default 'clamp'`:
--     'clamp'    = Postgres interval semantics (DEFAULT). Recommended: it keeps a
--                  month-end anchor on month-end and is what the FM/PPM cron and
--                  the rest of the schema already do.
--     'overflow' = replicates JS setUTCMonth exactly, via make_date(target y/m, 1)
--                  + (day - 1). Validated live 2026-09-22 against 9 sample dates
--                  (both columns agreed with the hand-computed JS results).
--   THE CREATION PATH STILL OVERFLOWS: createEngagement()
--   (firm-engagement-service.ts:66) seeds the FIRST next_occurrence_date with the
--   same addMonthsToDateStr(), and it keeps running in the Next.js app regardless
--   of which value is chosen here. Picking 'clamp' therefore means "first hop
--   overflows (TS), every later hop clamps (SQL)" until the TS is aligned in a
--   separate PR; picking 'overflow' keeps today's drift-prone behaviour but
--   consistent end-to-end. The owner must pick one; the default only encodes the
--   recommendation. To run with the other value, schedule
--   `select compliance.cron_the_firm_recur_engagements('overflow');` instead.
-- -----------------------------------------------------------------------------
-- OTHER OWNER DECISION POINTS (see README.md decision table)
--   * Switch-on (above).
--   * Catch-up semantics kept as-is: a source row several intervals behind is
--     advanced ONE interval per daily run (and therefore cloned once per day
--     until it catches up), exactly like the TS. Not "fixed" here.
--   * Unknown recurrence_type values (anything other than none/monthly/quarterly/
--     half_yearly/annually) are skipped and counted, like the TS `continue`.
-- -----------------------------------------------------------------------------
-- FIDELITY / SAFETY NOTES
--   * Atomic: a single `WITH due AS (UPDATE ... RETURNING) INSERT ...` statement.
--     If the clone insert fails, the source advance rolls back with it.
--   * Overlap-safe: UPDATE row locks + READ COMMITTED re-check mean a second
--     concurrent run re-evaluates `next_occurrence_date <= today` on the already-
--     advanced row and skips it; a transaction-scoped advisory lock additionally
--     stops two runs of this job from interleaving at all.
--   * Idempotent per day for on-schedule rows: once advanced, a row is not due
--     again until its next interval. (No unique constraint exists on
--     firm_engagements beyond the PK -- verified live -- so idempotency rests on
--     the advance, same as the TS.)
--   * The UPDATE's RETURNING list only carries columns the update does not touch,
--     so "post-update values" equal the source values the TS clones from.
--   * "today" is the UTC calendar date (TS: toISOString().slice(0,10); DB TZ UTC).
-- -----------------------------------------------------------------------------
-- COLUMNS VERIFIED LIVE 2026-09-22 (information_schema.columns, pcrjmlpuqsbocqfwoxod)
--   firm_engagements: id, org_id, client_id, service_line (enum firm_service_line),
--     title, scope_of_work, fee_type (enum firm_fee_type, default 'fixed'),
--     fee_amount (numeric), billing_frequency (default 'monthly'), start_date (date),
--     end_date (date), status (text, default 'active'), lead_partner_user_id,
--     created_by_id, updated_at (timestamptz), recurrence_type (text, default
--     'none'), next_occurrence_date (date), budgeted_hours (numeric)
--   org_product_branch_enablements: org_id, product_branch_id, is_enabled
--   platform.product_branches: id, branch_key (UNIQUE)
--   clients: id, org_id
--   Drift noted: schema.ts declares updated_at as timezone-naive timestamp();
--     live is timestamptz. Names match; no column drift.
-- =============================================================================

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

-- Functions default to EXECUTE for PUBLIC; nothing but the pg_cron job (postgres,
-- the owner) should call this. SECURITY INVOKER (the default) is deliberate.
revoke execute on function compliance.cron_the_firm_recur_engagements(text, date) from public;

-- -----------------------------------------------------------------------------
-- SCHEDULE (commented out on purpose -- owner runs this line, after README steps;
-- substitute 'overflow' in the command if OWNER DECISION #4 goes that way)
-- -----------------------------------------------------------------------------
-- select cron.schedule('cost001-the-firm-recur-engagements', '30 7 * * *', $$select compliance.cron_the_firm_recur_engagements();$$);

-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- select cron.unschedule('cost001-the-firm-recur-engagements');
-- drop function if exists compliance.cron_the_firm_recur_engagements(text, date);
