-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 (row-level security on the dpdp tables that have it off; roll-back script included)
--
-- DPDP compliance programme, Wave 2 (database safety). Turns row-level security ON for every table in the dpdp schema that has it OFF.
-- The live project had about twenty such tables (identity, session, membership, consent and others) because they were made with db:push, which
-- writes no migration. This migration does not name them: it finds them at apply time, so it is right whatever the live state is.
--
-- WHY THIS CANNOT BREAK A WORKING PATH (read every caller, 2026-10-05):
--  * the app (dpdp-app/src) and every edge function (supabase/functions/*) reach dpdp only through public.dpdp_* functions (rpc); none calls
--    .from() on a dpdp table. The one .from() in the repo is storage, not a table (dpdp-app/src/lib/client.ts, handled in 0698).
--  * the public.dpdp_* functions are SECURITY DEFINER and owned by the table owner, who is not subject to row-level security (FORCE is NOT used).
--  * service_role (edge functions) has BYPASSRLS. pg_cron runs as the owner.
--  * the Next.js app (src/) never queries a dpdp table (src/app/api/dpdp/access-log/route.ts only mentions one in a comment).
--  * app_runtime, the server-side pooler role, keeps exactly the access it has today through one explicit policy per newly protected table
--    (dpdp_app_runtime_all). That role is never handed to a browser.
-- What changes: anon and authenticated (the roles a browser can become) can no longer read or write any dpdp table directly, whatever grants
-- they may hold. Tables that already had RLS on, with their own policies, are not touched.
--
-- Which tables were switched is written to dpdp.rls_hardening_log so the roll-back is exact:
--   drizzle/down/0697_dpdp_rls_on_for_every_dpdp_table.down.sql
-- Idempotent: a second run finds nothing to do.

create table if not exists dpdp.rls_hardening_log (
  table_name text primary key,
  enabled_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
alter table dpdp.rls_hardening_log enable row level security;
revoke all on table dpdp.rls_hardening_log from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dpdp'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
       and c.relname <> 'rls_hardening_log'
     order by c.relname
  loop
    execute format('alter table dpdp.%I enable row level security', r.relname);
    insert into dpdp.rls_hardening_log (table_name) values (r.relname) on conflict (table_name) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'dpdp' and tablename = r.relname and policyname = 'dpdp_app_runtime_all') then
      execute format('create policy dpdp_app_runtime_all on dpdp.%I for all to app_runtime using (true) with check (true)', r.relname);
    end if;
  end loop;
end
$$;

comment on table dpdp.rls_hardening_log is 'Tables whose row-level security drizzle/0697 switched on (and gave app_runtime one explicit policy). Used by the roll-back script.';
