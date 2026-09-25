-- BR-204 (PROJEXA-BUILD-001, phase 2): one fingerprint of the database schema, used to prove that a migration's down file
-- restores exactly what its forward file changed (ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md, BR-206) and, scoped to
-- the touched schemas, by the PGlite replay (scripts/verify/rollback-replay.sh, BR-207).
--
-- Returns one row, two columns: n_objects (how many object strings were hashed) and schema_hash (md5 of all of them,
-- sorted, joined by newlines). Read-only: catalog and information_schema reads only.
--
-- Source: the schema-hash query of LIVE_FACTS_D09_D10_D11_RLS.md section (b), measured live 2026-09-25 (n_objects 14002,
-- hash 7a41f2f80cba84a822bd62fa72b29b16 at that time). The object strings of its six sections (columns, constraints,
-- indexes, policies, functions with the md5 of their definition and the SECURITY DEFINER flag, RLS flags) are unchanged.
-- Two changes:
--   1. The schema list is written once, in the sch CTE on the first line of the query, instead of in every section.
--      scripts/verify/lib/rollback-lib.mjs replaces that one list to scope the query (the PGlite replay hashes only the
--      schemas a migration touches). Keep the list on that one line.
--   2. Two grants sections were added, so a GRANT or REVOKE changes the hash: table grants (grantor, grantee, privilege,
--      grantable) and routine grants (grantor, grantee, privilege; by routine name, not by specific_name, because
--      specific_name carries the function oid, which changes when a down file recreates a dropped function).
--
-- Not covered (a change to these does not change the hash): triggers, sequences, enum values, extensions, column
-- collations, comments, and the auth, storage, cron and extensions schemas.
--
-- The role that runs it matters. information_schema views show only objects the current role holds a privilege on, and
-- the grants views show only grants whose grantor or grantee is a role the current role is a member of. The pg_catalog
-- sections (constraints, indexes, policies, functions, RLS) do not depend on the role. So a hash taken as app_runtime
-- differs from one taken as postgres: compare hashes taken by the same role only. The rehearsal procedure takes h0, h1
-- and h2 inside one DO block as postgres (Supabase MCP execute_sql), so its three values are comparable.
--
-- Also: md5 over string_agg ordered by the database's default collation; another engine or collation gives other values
-- for the same schema, so a hash is compared only with a hash from the same database.
with sch(nsp) as (values ('compliance'), ('platform'), ('dpdp'), ('public'))
, cols as (
  select 'col:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') s
  from information_schema.columns where table_schema in (select nsp from sch)
), cons as (
  select 'con:'||n.nspname||'.'||c.relname||'.'||k.conname||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (select nsp from sch)
), idx as (
  select 'idx:'||schemaname||'.'||tablename||'.'||indexname||':'||indexdef s from pg_indexes
  where schemaname in (select nsp from sch)
), pol as (
  select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') s
  from pg_policies where schemaname in (select nsp from sch)
), fn as (
  select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef::text s
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in (select nsp from sch) and p.prokind in ('f','p')
), rls as (
  select 'rls:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in (select nsp from sch)
), tgr as (
  select 'tgrant:'||table_schema||'.'||table_name||':'||grantor||'>'||grantee||':'||privilege_type||':'||is_grantable s
  from information_schema.role_table_grants where table_schema in (select nsp from sch)
), rgr as (
  select 'rgrant:'||routine_schema||'.'||routine_name||':'||grantor||'>'||grantee||':'||privilege_type s
  from information_schema.role_routine_grants where routine_schema in (select nsp from sch)
), allr as (
  select * from cols union all select * from cons union all select * from idx
  union all select * from pol union all select * from fn union all select * from rls
  union all select * from tgr union all select * from rgr
)
select count(*) n_objects, md5(string_agg(s, E'\n' order by s)) schema_hash from allr;
