-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved first-party visitor-journey tracking for veridian-aios.com in chat on 2026-10-06 ("ok do it"); this is its roll-back file and is not run unless the owner asks.
-- Roll-back of 0733_dpdp_visitor_journey.sql. DESTROYS every visit session, event, link and aggregate row.
select cron.unschedule('dpdp-visit-retention') where exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'dpdp-visit-retention');
drop function if exists public.dpdp_visit_retention(integer);
drop function if exists public.dpdp_visit_journey(text, text);
drop function if exists public.dpdp_visit_report(integer);
drop function if exists public.dpdp_visit_link(text, text, text);
drop function if exists public.dpdp_visit_count_only(jsonb);
drop function if exists public.dpdp_visit_ingest(jsonb);
drop function if exists dpdp.visit_funnel(timestamptz, timestamptz, timestamptz);
drop function if exists dpdp.visit_rate_hit(text, integer, integer);
drop table if exists dpdp.visit_rate;
drop table if exists dpdp.visit_agg;
drop table if exists dpdp.visit_link;
drop table if exists dpdp.visit_event;
drop table if exists dpdp.visit_session;