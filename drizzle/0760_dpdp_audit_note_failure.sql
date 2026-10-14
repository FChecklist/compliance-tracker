-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7, fix 4: the audit trail records nothing). Applied by the project manager.
--
-- Finding (2026-10-14, read-only): dpdp.audit_event is empty because nothing the trail records has happened since it went live (2026-10-06 08:20 UTC): every
-- AI-link call since then carried a token that matches no link (a recurring probe answered 410), no one has signed in, and there were no changes to record.
-- The write path itself is covered by tests, but it has never run against a live link, and a failure of the Edge Function to write (for example a missing or
-- wrong DPDP_AUDIT_SEAL_KEY) was only visible in the function log, so "0 rows in dpdp.audit_failure" could not be read as "no write failed".
--
-- This adds the one function the Edge Functions call when a write fails: a CODE only (never a value) goes into dpdp.audit_failure, which the daily job already
-- counts and reports. service_role only. Additive; roll-back: drizzle/down/0760_dpdp_audit_note_failure.down.sql.

create or replace function public.dpdp_audit_note_failure(p_source text, p_error text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into dpdp.audit_failure (source, error) values (left(coalesce(p_source, 'edge_function'), 60), left(coalesce(p_error, 'unknown'), 120));
exception when others then
  null; -- a fault in noting a fault must never reach the caller
end
$$;

revoke all on function public.dpdp_audit_note_failure(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_audit_note_failure(text, text) to service_role;
