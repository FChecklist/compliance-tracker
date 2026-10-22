-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-20 -- rollback of 0754 (client log tables); run only if 0754 must be undone, after review.
-- WARNING: drops every captured client error/action row and every recorded fix. Take a copy first if the owner has used it.
begin;
drop table if exists compliance.client_error_issues;
drop table if exists compliance.client_log_events;
commit;