-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 roll-back
-- Undoes 0697 exactly: only the tables it switched on (named in dpdp.rls_hardening_log) are switched back off, and only the policy it added is dropped.
-- Tables that already had RLS on before 0697 are not in the log and are left alone.
do $$
declare
  r record;
begin
  if to_regclass('dpdp.rls_hardening_log') is null then
    return;
  end if;
  for r in select table_name from dpdp.rls_hardening_log order by table_name loop
    execute format('drop policy if exists dpdp_app_runtime_all on dpdp.%I', r.table_name);
    execute format('alter table dpdp.%I disable row level security', r.table_name);
  end loop;
end
$$;
drop table if exists dpdp.rls_hardening_log;
