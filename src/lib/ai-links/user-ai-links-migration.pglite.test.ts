/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-18 / U-19 stage A: offline proof of
// drizzle/0613_build001_link_project_scope.sql and its down file
// drizzle/down/0613_build001_link_project_scope.down.sql, on PGlite (real
// Postgres compiled to WASM, the engine scripts/replay-migrations-from-empty.mjs
// already uses). No live database is touched.
//
// BASE: platform.user_ai_links and compliance.api_keys exactly as they were
// live on 2026-09-25 (read with SELECT from information_schema.columns,
// pg_constraint, pg_indexes, pg_policies, information_schema.role_table_grants
// and pg_get_functiondef on project pcrjmlpuqsbocqfwoxod), plus the two
// functions that read them (platform.rpc_resolve_ai_link_token, drizzle/0584;
// compliance.lookup_api_key_by_hash, which RETURNS SETOF compliance.api_keys)
// and stub FK targets. Live is Postgres 17.6, PGlite is 18.3: 18 also lists
// NOT NULL constraints in pg_constraint, which only ever compares against
// itself here (every snapshot is taken on the same engine).
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. the always-aborted rehearsal of LIVE_FACTS section (b) reports
//      PASS_ROLLED_BACK on the base and leaves it unchanged;
//   2. the forward file applies, and a second run changes nothing;
//   3. the register rows BR-208, BR-211, BR-212, BR-290, BR-291 and the
//      amended BR-209 hold (their SQL verbatim);
//   4. every new column, constraint and index exists, the old product-blind
//      index is gone, existing rows are veridian and still resolve;
//   5. a projexa-shaped row inserts; a projexa row without project_id (or
//      token_hash, or expires_at, or with a plaintext token) fails;
//   6. two active veridian links for one (org, user) fail, while one
//      veridian and one projexa link for the same person succeed;
//   7. api_keys: key_kind and the project_ai-needs-project rule;
//   8. the Drizzle declarations in schema.ts match the migrated tables;
//   9. the down file refuses (and changes nothing) when a non-projexa row
//      has a NULL token;
//  10. the down file restores the base schema exactly, deletes projexa
//      links, switches off project_ai keys, keeps veridian links resolving,
//      and is safe to run twice; the forward applies again afterwards.
//
// Run: bun test --isolate src/lib/ai-links/user-ai-links-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { apiKeys, userAiLinks } from '@/lib/db/schema'

const REPO_ROOT = new URL('../../../', import.meta.url)
const FORWARD = readFileSync(new URL('drizzle/0613_build001_link_project_scope.sql', REPO_ROOT), 'utf8')
const DOWN = readFileSync(new URL('drizzle/down/0613_build001_link_project_scope.down.sql', REPO_ROOT), 'utf8')

// Live shape, 2026-09-25.
const BASE_SQL = `
CREATE ROLE app_runtime NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA compliance;
CREATE SCHEMA platform;

CREATE FUNCTION compliance.current_org_id() RETURNS text
  LANGUAGE sql STABLE SET search_path TO 'compliance', 'pg_temp'
  AS $fn$ SELECT NULLIF(current_setting('app.current_org_id', true), '') $fn$;

-- FK targets only (stubs).
CREATE TABLE compliance.organisations (id text PRIMARY KEY);
CREATE TABLE compliance.platform_applications (id text PRIMARY KEY);

CREATE TABLE compliance.api_keys (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  org_id text NOT NULL,
  scopes text NOT NULL DEFAULT 'read'::text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  domain_scope text,
  rate_limit_per_minute integer,
  issued_for_application_id text,
  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
  CONSTRAINT api_keys_org_id_fkey FOREIGN KEY (org_id) REFERENCES compliance.organisations(id),
  CONSTRAINT api_keys_issued_for_application_id_fkey FOREIGN KEY (issued_for_application_id) REFERENCES compliance.platform_applications(id)
);
CREATE INDEX api_keys_org_id_idx ON compliance.api_keys USING btree (org_id);
CREATE INDEX idx_api_keys_issued_for_application_id ON compliance.api_keys USING btree (issued_for_application_id);
ALTER TABLE compliance.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_preauth_read_api_keys ON compliance.api_keys FOR SELECT TO app_runtime
  USING (compliance.current_org_id() IS NULL);
CREATE POLICY app_runtime_preauth_update_api_keys_last_used ON compliance.api_keys FOR UPDATE TO app_runtime
  USING (compliance.current_org_id() IS NULL) WITH CHECK (compliance.current_org_id() IS NULL);
CREATE POLICY app_runtime_tenant_isolation ON compliance.api_keys FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id()) WITH CHECK (org_id = compliance.current_org_id());
CREATE POLICY service_role_bypass_api_keys ON compliance.api_keys FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.api_keys TO app_runtime, service_role;

CREATE FUNCTION compliance.lookup_api_key_by_hash(p_key_hash text) RETURNS SETOF compliance.api_keys
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'compliance', 'pg_temp'
  AS $fn$
  select * from compliance.api_keys where key_hash = p_key_hash limit 1;
$fn$;

CREATE TABLE platform.user_ai_links (
  id text NOT NULL,
  org_id text NOT NULL,
  user_id text NOT NULL,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT user_ai_links_pkey PRIMARY KEY (id),
  CONSTRAINT user_ai_links_token_key UNIQUE (token)
);
CREATE UNIQUE INDEX user_ai_links_one_active_per_user ON platform.user_ai_links USING btree (org_id, user_id)
  WHERE (status = 'active'::text);
CREATE INDEX user_ai_links_token_idx ON platform.user_ai_links USING btree (token) WHERE (status = 'active'::text);
ALTER TABLE platform.user_ai_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_org_scoped ON platform.user_ai_links FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id()) WITH CHECK (org_id = compliance.current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_ai_links TO app_runtime, service_role;

CREATE FUNCTION platform.rpc_resolve_ai_link_token(p_token text) RETURNS TABLE(org_id text, user_id text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'platform', 'compliance', 'pg_catalog', 'pg_temp'
  AS $fn$
BEGIN
  RETURN QUERY
  UPDATE platform.user_ai_links
  SET last_used_at = now()
  WHERE token = p_token AND status = 'active'
  RETURNING user_ai_links.org_id, user_ai_links.user_id;
END;
$fn$;
`

// Two rows shaped like the 2 live links (both active veridian-picker links,
// one per org), and two org keys. Synthetic ids and tokens.
const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const SEED_SQL = `
INSERT INTO compliance.organisations (id) VALUES ('org_demo'), ('org_projexa_demo');
INSERT INTO platform.user_ai_links (id, org_id, user_id, token, status, created_at, last_used_at)
VALUES ('link_a', 'org_demo', 'user_admin', '${TOKEN_A}', 'active', '2026-08-29 13:25:57+00', '2026-08-29 17:57:55+00'),
       ('link_b', 'org_projexa_demo', 'user_manager', '${TOKEN_B}', 'active', '2026-08-29 14:26:14+00', '2026-08-29 14:26:52+00');
INSERT INTO compliance.api_keys (id, name, key_hash, key_prefix, org_id)
VALUES ('key_proxy', 'PROJEXA proxy', 'hash_proxy', 'vk_proxy', 'org_projexa_demo'),
       ('key_demo', 'demo key', 'hash_demo', 'vk_demo_', 'org_demo');
`

// Modelled on the LIVE_FACTS section (b) schema hash, restricted to the two
// schemas of this base, with grants and triggers added (its own gap list).
const SNAPSHOT_CTE = `
with cols as (
  select 'col:'||table_schema||'.'||table_name||'.'||lpad(ordinal_position::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema in ('compliance', 'platform')
), cons as (
  select 'con:'||n.nspname||'.'||c.relname||'.'||k.conname||':'||k.contype::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('compliance', 'platform')
), idx as (
  select 'idx:'||schemaname||'.'||tablename||'.'||indexname||':'||indexdef s
  from pg_indexes where schemaname in ('compliance', 'platform')
), pol as (
  select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual, '')||':'||coalesce(with_check, '') s
  from pg_policies where schemaname in ('compliance', 'platform')
), fn as (
  select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef::text s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('compliance', 'platform') and p.prokind in ('f', 'p')
), rls as (
  select 'rls:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('compliance', 'platform')
), grants as (
  select 'grant:'||table_schema||'.'||table_name||':'||grantee||':'||privilege_type s
  from information_schema.role_table_grants where table_schema in ('compliance', 'platform')
), trg as (
  select 'trg:'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('compliance', 'platform')
), allr as (
  select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from fn union all select * from rls union all select * from grants union all select * from trg
)`
const HASH_SQL = `${SNAPSHOT_CTE} select md5(string_agg(s, E'\\n' order by s)) from allr`

let pg: PGlite

async function snapshot(): Promise<string[]> {
  const r = await pg.query<{ s: string }>(`${SNAPSHOT_CTE} select s from allr order by s`)
  return r.rows.map((x) => x.s)
}

// Runs one register query the way scripts/verify/sql-assert.mjs prints it:
// the single value as text.
async function scalar(q: string): Promise<string | null> {
  const r = await pg.query<{ v: string | null }>(`select ((${q}))::text as v`)
  return r.rows[0]?.v ?? null
}

async function fails(sqlText: string): Promise<string> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error(`expected this statement to fail: ${sqlText}`)
}

// The file body between BEGIN; and COMMIT;, for the rehearsal block.
function body(file: string): string {
  return file
    .split('\n')
    .filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;')
    .join('\n')
}

const FUTURE = `now() + interval '30 days'`

let s0: string[] = []
let s1: string[] = []

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
  await pg.exec(SEED_SQL)
  s0 = await snapshot()
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe('drizzle/0613_build001_link_project_scope on the 2026-09-25 base (PGlite)', () => {
  test('1. the always-aborted rehearsal reports PASS_ROLLED_BACK and leaves the base unchanged', async () => {
    const rehearsal = `do $rehearsal$
declare h0 text; h1 text; h2 text;
  q text := $q$${HASH_SQL}$q$;
begin
  set local lock_timeout = '3s';
  execute q into h0;
  execute $fwd$${body(FORWARD)}$fwd$;
  execute q into h1;
  execute $inv$${body(DOWN)}$inv$;
  execute q into h2;
  if h1 = h0 then raise exception 'FAIL forward changed nothing'; end if;
  if h2 <> h0 then raise exception 'FAIL inverse did not restore: % vs %', h0, h2; end if;
  raise exception 'PASS_ROLLED_BACK h0=% h1=% h2=%', h0, h1, h2;
end $rehearsal$;`
    const message = await fails(rehearsal)
    expect(message.startsWith('PASS_ROLLED_BACK')).toBe(true)
    expect(await snapshot()).toEqual(s0)
  })

  test('2. the forward file applies, changes the schema, and a second run changes nothing', async () => {
    await pg.exec(FORWARD)
    s1 = await snapshot()
    expect(s1).not.toEqual(s0)
    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
  })

  test('3. register rows BR-208, BR-211, BR-212, BR-290, BR-291 and the amended BR-209 hold', async () => {
    // BR-208
    expect(
      await scalar(
        "select count(*) from pg_constraint where conrelid = 'platform.user_ai_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%project_id IS NOT NULL%'",
      ),
    ).toBe('1')
    // BR-211
    expect(
      await scalar(
        "select is_nullable from information_schema.columns where table_schema = 'compliance' and table_name = 'api_keys' and column_name = 'project_id'",
      ),
    ).toBe('YES')
    // BR-212
    expect(
      await scalar(
        "select count(*) from pg_constraint where conrelid = 'compliance.api_keys'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%org_service%' and pg_get_constraintdef(oid) like '%project_ai%'",
      ),
    ).toBe('1')
    // BR-290
    expect(
      await scalar(
        "select count(*) from pg_constraint where conrelid = 'platform.user_ai_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%product%veridian%project_id is not null%token_hash is not null%token is null%expires_at is not null%'",
      ),
    ).toBe('1')
    // BR-291
    expect(
      await scalar(
        "select case when count(*) filter (where indexdef ilike 'create unique index%(user_id, project_id)%where%active%projexa%') = 1 and count(*) filter (where indexdef ilike 'create unique index%(org_id, user_id)%where%active%veridian%') = 1 and count(*) filter (where indexdef ilike 'create unique index%(org_id, user_id)%where%active%' and indexdef not ilike '%product%') = 0 then 1 else 0 end from pg_indexes where schemaname = 'platform' and tablename = 'user_ai_links'",
      ),
    ).toBe('1')
    // BR-209 as written counts the two kept VERIDIAN links (project-less by
    // design, PMD-26 OD-13), so it cannot reach 0 without revoking them.
    expect(await scalar('select count(*) from platform.user_ai_links where project_id is null and revoked_at is null')).toBe('2')
    // BR-209 amended (spec section 10.8: add product = 'projexa').
    expect(
      await scalar(
        "select count(*) from platform.user_ai_links where product = 'projexa' and project_id is null and revoked_at is null",
      ),
    ).toBe('0')
  })

  test('4. new columns, constraints and indexes exist; the old index is gone; existing rows are veridian and still resolve', async () => {
    const cols = await pg.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
       where (table_schema = 'platform' and table_name = 'user_ai_links') or (table_schema = 'compliance' and table_name = 'api_keys')`,
    )
    const col = (t: string, c: string) => cols.rows.find((r) => r.table_name === t && r.column_name === c)
    const expected: Array<[string, string, string, string, string | null]> = [
      ['user_ai_links', 'product', 'text', 'NO', "'veridian'::text"],
      ['user_ai_links', 'project_id', 'text', 'YES', null],
      ['user_ai_links', 'token_hash', 'text', 'YES', null],
      ['user_ai_links', 'authority_level', 'smallint', 'NO', '0'],
      ['user_ai_links', 'allowed_functions', 'ARRAY', 'NO', "'{}'::text[]"],
      ['user_ai_links', 'hide_personal', 'boolean', 'NO', 'true'],
      ['user_ai_links', 'label', 'text', 'YES', null],
      ['user_ai_links', 'expires_at', 'timestamp with time zone', 'YES', null],
      ['user_ai_links', 'created_by_user_id', 'text', 'YES', null],
      ['user_ai_links', 'call_count', 'integer', 'NO', '0'],
      ['user_ai_links', 'write_count', 'integer', 'NO', '0'],
      ['user_ai_links', 'token', 'text', 'YES', null],
      ['api_keys', 'project_id', 'text', 'YES', null],
      ['api_keys', 'key_kind', 'text', 'NO', "'org_service'::text"],
    ]
    for (const [t, c, type, nullable, dflt] of expected) {
      expect({ t, c, type: col(t, c)?.data_type, nullable: col(t, c)?.is_nullable, dflt: col(t, c)?.column_default ?? null }).toEqual({
        t,
        c,
        type,
        nullable,
        dflt,
      })
    }

    const cons = await pg.query<{ conname: string }>(
      `select conname from pg_constraint where conrelid in ('platform.user_ai_links'::regclass, 'compliance.api_keys'::regclass) and contype in ('c', 'u')`,
    )
    const names = cons.rows.map((r) => r.conname)
    for (const n of [
      'user_ai_links_product_check',
      'user_ai_links_authority_level_check',
      'user_ai_links_token_hash_key',
      'user_ai_links_projexa_shape',
      'user_ai_links_token_key',
      'api_keys_key_kind_check',
      'api_keys_project_ai_requires_project',
    ]) {
      expect(names).toContain(n)
    }

    const idx = await pg.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'platform' and tablename = 'user_ai_links'`)
    const indexNames = idx.rows.map((r) => r.indexname)
    expect(indexNames).toContain('user_ai_links_one_live_veridian')
    expect(indexNames).toContain('user_ai_links_one_live_per_user_project')
    expect(indexNames).toContain('user_ai_links_token_idx')
    expect(indexNames).not.toContain('user_ai_links_one_active_per_user')

    const existing = await pg.query<{ id: string; product: string; authority_level: number; hide_personal: boolean; call_count: number; token: string }>(
      `select id, product, authority_level, hide_personal, call_count, token from platform.user_ai_links order by id`,
    )
    expect(existing.rows).toEqual([
      { id: 'link_a', product: 'veridian', authority_level: 0, hide_personal: true, call_count: 0, token: TOKEN_A },
      { id: 'link_b', product: 'veridian', authority_level: 0, hide_personal: true, call_count: 0, token: TOKEN_B },
    ])
    const resolved = await pg.query(`select * from platform.rpc_resolve_ai_link_token($1)`, [TOKEN_A])
    expect(resolved.rows).toEqual([{ org_id: 'org_demo', user_id: 'user_admin' }])

    const keys = await pg.query<{ id: string; key_kind: string; project_id: string | null }>(
      `select id, key_kind, project_id from compliance.api_keys order by id`,
    )
    expect(keys.rows).toEqual([
      { id: 'key_demo', key_kind: 'org_service', project_id: null },
      { id: 'key_proxy', key_kind: 'org_service', project_id: null },
    ])
  })

  test('5. a projexa-shaped row inserts; a projexa row missing project_id, token_hash or expires_at, or holding plaintext, fails', async () => {
    await pg.exec(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at)
      VALUES ('px_1', 'org_projexa_demo', 'user_manager', 'projexa', 'project_a', '${'1'.repeat(64)}', ${FUTURE})`)

    const shape = 'user_ai_links_projexa_shape'
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, token_hash, expires_at)
        VALUES ('px_bad1', 'org_projexa_demo', 'user_manager', 'projexa', '${'2'.repeat(64)}', ${FUTURE})`),
    ).toContain(shape)
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, expires_at)
        VALUES ('px_bad2', 'org_projexa_demo', 'user_manager', 'projexa', 'project_b', ${FUTURE})`),
    ).toContain(shape)
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash)
        VALUES ('px_bad3', 'org_projexa_demo', 'user_manager', 'projexa', 'project_b', '${'3'.repeat(64)}')`),
    ).toContain(shape)
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at, token)
        VALUES ('px_bad4', 'org_projexa_demo', 'user_manager', 'projexa', 'project_b', '${'4'.repeat(64)}', ${FUTURE}, '${'P'.repeat(43)}')`),
    ).toContain(shape)
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, token) VALUES ('bad_product', 'org_demo', 'u9', 'other', '${'Q'.repeat(43)}')`),
    ).toContain('user_ai_links_product_check')
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, token, authority_level) VALUES ('bad_level', 'org_demo', 'u9', '${'R'.repeat(43)}', 2)`),
    ).toContain('user_ai_links_authority_level_check')

    // A projexa row holds no plaintext, so the VERIDIAN resolver can never
    // return it, whatever string it is given.
    const byHash = await pg.query(`select * from platform.rpc_resolve_ai_link_token($1)`, ['1'.repeat(64)])
    expect(byHash.rows).toEqual([])
  })

  test('6. two active veridian links for one (org, user) fail; one veridian plus one projexa for the same person succeed', async () => {
    // link_b is the active veridian link of (org_projexa_demo, user_manager);
    // px_1 (test 5) is that same person's active projexa link: both coexist.
    const both = await pg.query<{ product: string }>(
      `select product from platform.user_ai_links where org_id = 'org_projexa_demo' and user_id = 'user_manager' and status = 'active' order by product`,
    )
    expect(both.rows.map((r) => r.product)).toEqual(['projexa', 'veridian'])

    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, token) VALUES ('ver_dup', 'org_projexa_demo', 'user_manager', '${'S'.repeat(43)}')`),
    ).toContain('user_ai_links_one_live_veridian')

    // One live projexa link per (user, project); another project is fine.
    expect(
      await fails(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at)
        VALUES ('px_dup', 'org_projexa_demo', 'user_manager', 'projexa', 'project_a', '${'5'.repeat(64)}', ${FUTURE})`),
    ).toContain('user_ai_links_one_live_per_user_project')
    await pg.exec(`INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at)
      VALUES ('px_2', 'org_projexa_demo', 'user_manager', 'projexa', 'project_b', '${'6'.repeat(64)}', ${FUTURE})`)

    // A revoked veridian link frees the slot, as before 0613.
    await pg.exec(`UPDATE platform.user_ai_links SET status = 'revoked', revoked_at = now() WHERE id = 'link_b'`)
    await pg.exec(`INSERT INTO platform.user_ai_links (id, org_id, user_id, token) VALUES ('link_b2', 'org_projexa_demo', 'user_manager', '${'T'.repeat(43)}')`)
  })

  test('7. api_keys: key_kind is org_service or project_ai, and a project_ai key needs a project', async () => {
    await pg.exec(`INSERT INTO compliance.api_keys (id, name, key_hash, key_prefix, org_id, key_kind, project_id)
      VALUES ('key_px', 'project key', 'hash_px', 'vk_px___', 'org_projexa_demo', 'project_ai', 'project_a')`)
    expect(
      await fails(`INSERT INTO compliance.api_keys (id, name, key_hash, key_prefix, org_id, key_kind)
        VALUES ('key_bad1', 'no project', 'hash_bad1', 'vk_bad1_', 'org_demo', 'project_ai')`),
    ).toContain('api_keys_project_ai_requires_project')
    expect(
      await fails(`INSERT INTO compliance.api_keys (id, name, key_hash, key_prefix, org_id, key_kind)
        VALUES ('key_bad2', 'bad kind', 'hash_bad2', 'vk_bad2_', 'org_demo', 'user')`),
    ).toContain('api_keys_key_kind_check')
    // An org_service key may still carry no project (the PROJEXA proxy key).
    const proxy = await pg.query<{ key_kind: string; project_id: string | null }>(`select * from compliance.lookup_api_key_by_hash('hash_proxy')`)
    expect(proxy.rows.map((r) => ({ key_kind: r.key_kind, project_id: r.project_id }))).toEqual([{ key_kind: 'org_service', project_id: null }])
  })

  test('8. the Drizzle declarations in schema.ts name exactly the migrated columns, with the same nullability', async () => {
    for (const [table, schema, name] of [
      [userAiLinks, 'platform', 'user_ai_links'],
      [apiKeys, 'compliance', 'api_keys'],
    ] as const) {
      const declared = getTableConfig(table)
        .columns.map((c) => `${c.name}:${c.notNull ? 'NO' : 'YES'}`)
        .sort()
      const live = await pg.query<{ c: string }>(
        `select column_name||':'||is_nullable c from information_schema.columns where table_schema = $1 and table_name = $2 order by 1`,
        [schema, name],
      )
      expect(declared).toEqual(live.rows.map((r) => r.c).sort())
    }
  })

  test('9. the down file refuses, and changes nothing, while a non-projexa row has a NULL token', async () => {
    await pg.exec(`INSERT INTO platform.user_ai_links (id, org_id, user_id, status, revoked_at) VALUES ('ver_null', 'org_demo', 'user_old', 'revoked', now())`)
    const message = await fails(DOWN)
    await pg.exec('ROLLBACK')
    expect(message).toContain('DOWN 0613 REFUSED: 1 platform.user_ai_links row(s)')
    expect(await snapshot()).toEqual(s1)
    const projexa = await pg.query(`select id from platform.user_ai_links where product = 'projexa' order by id`)
    expect(projexa.rows).toEqual([{ id: 'px_1' }, { id: 'px_2' }])
    await pg.exec(`DELETE FROM platform.user_ai_links WHERE id = 'ver_null'`)
  })

  test('10. the down file restores the base schema exactly, drops projexa links, switches off project_ai keys, and is safe to run twice', async () => {
    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)

    const links = await pg.query<{ id: string; status: string; token: string }>(`select id, status, token from platform.user_ai_links order by id`)
    expect(links.rows).toEqual([
      { id: 'link_a', status: 'active', token: TOKEN_A },
      { id: 'link_b', status: 'revoked', token: TOKEN_B },
      { id: 'link_b2', status: 'active', token: 'T'.repeat(43) },
    ])
    const resolved = await pg.query(`select * from platform.rpc_resolve_ai_link_token($1)`, ['T'.repeat(43)])
    expect(resolved.rows).toEqual([{ org_id: 'org_projexa_demo', user_id: 'user_manager' }])

    const keys = await pg.query<{ id: string; is_active: boolean }>(`select id, is_active from compliance.api_keys order by id`)
    expect(keys.rows).toEqual([
      { id: 'key_demo', is_active: true },
      { id: 'key_proxy', is_active: true },
      { id: 'key_px', is_active: false },
    ])

    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)

    // Round trip: the forward applies again on the restored base. Postgres
    // never reuses the attribute number of a dropped column, so the re-added
    // columns get new ordinal positions (20.. instead of 9..); everything
    // else is identical.
    await pg.exec(FORWARD)
    const withoutPosition = (lines: string[]) => lines.map((l) => l.replace(/^(col:[^.]+\.[^.]+\.)\d{3}\./, '$1')).sort()
    expect(withoutPosition(await snapshot())).toEqual(withoutPosition(s1))
  })
})
