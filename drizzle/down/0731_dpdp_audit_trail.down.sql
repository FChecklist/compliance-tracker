-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the DPDP audit-trail specification in chat on 2026-10-06 ("all approved", "ok, do it for dpdp"); this is its roll-back file and is not run unless the owner asks.
-- Roll-back of 0731_dpdp_audit_trail.sql. DESTROYS every audit row, access-log row, daily head, statistic and deletion certificate this migration's tables hold.
-- Do NOT run this on a database whose audit data matters; it exists so a failed rollout can be undone cleanly.
select cron.unschedule('dpdp-audit-daily') where exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'dpdp-audit-daily');

drop trigger if exists audit_from_event on dpdp.event;
drop trigger if exists audit_from_ai_action on dpdp.ai_action;
drop trigger if exists audit_from_ai_draft_insert on dpdp.ai_draft;
drop trigger if exists audit_from_ai_draft_confirm on dpdp.ai_draft;

drop function if exists public.dpdp_audit_append(text, text, text);
drop function if exists public.dpdp_audit_resolve_caller(text);
drop function if exists public.dpdp_audit_link_context(text);
drop function if exists public.dpdp_audit_fetch(text, text, bigint, integer, timestamptz, timestamptz);
drop function if exists public.dpdp_audit_chain_state(text);
drop function if exists public.dpdp_audit_count_exports(text, text, timestamptz);
drop function if exists public.dpdp_audit_count_recent(text, text, text, timestamptz);
drop function if exists public.dpdp_audit_recorded_heads(text, integer);
drop function if exists public.dpdp_audit_find_export(text);
drop function if exists public.dpdp_audit_record_heads(date);
drop function if exists public.dpdp_audit_mark_head_emailed(text, date);
drop function if exists public.dpdp_audit_lifecycle_plan(date);
drop function if exists public.dpdp_audit_mark_notice_sent(text, date, integer, text[]);
drop function if exists public.dpdp_audit_purge(text, date);
drop function if exists public.dpdp_audit_set_legal_hold(text, text, boolean, text);
drop function if exists public.dpdp_audit_set_hod(text, text, text[]);
drop function if exists public.dpdp_audit_staff_begin(text, text, text, text, jsonb);
drop function if exists public.dpdp_audit_staff_finish(text, integer);

-- The guard triggers refuse DELETE/TRUNCATE; drop the tables (DROP is not blocked by row triggers).
drop table if exists dpdp.audit_event;
drop table if exists dpdp.audit_access_log;
drop table if exists dpdp.audit_chain_head_daily;
drop table if exists dpdp.audit_notice_sent;
drop table if exists dpdp.audit_notice_recipient;
drop table if exists dpdp.audit_stats_daily;
drop table if exists dpdp.audit_deletion_certificate;
drop table if exists dpdp.audit_chain_anchor;
drop table if exists dpdp.audit_org_policy;
drop table if exists dpdp.audit_failure;

drop function if exists dpdp.audit_from_event();
drop function if exists dpdp.audit_from_ai_action();
drop function if exists dpdp.audit_from_ai_draft_insert();
drop function if exists dpdp.audit_from_ai_draft_confirm();
drop function if exists dpdp.audit_write(text, text, text, text, text, text, text, text, jsonb, jsonb, text);
drop function if exists dpdp.audit_type_of_kind(text);
drop function if exists dpdp.audit_purge_through(text, date);
drop function if exists dpdp.audit_event_chain();
drop function if exists dpdp.audit_event_guard();
drop function if exists dpdp.audit_block_truncate();
drop function if exists dpdp.audit_append_only_guard();
drop function if exists dpdp.audit_access_log_guard();
drop function if exists dpdp.audit_head_guard();
drop function if exists dpdp.audit_today_utc();