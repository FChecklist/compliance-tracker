/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-18 stage B: offline proof of
// drizzle/0614_build001_link_resolve_by_hash.sql and its down file
// drizzle/down/0614_build001_link_resolve_by_hash.down.sql, on PGlite (real
// Postgres compiled to WASM). No live database is touched.
//
// BASE: scripts/verify/fixtures/0614_build001_link_resolve_by_hash.base.sql,
// the committed read-only snapshot of platform.user_ai_links (with 0613
// applied), compliance.current_org_id and platform.rpc_resolve_ai_link_token as
// they were live on 2026-09-25 -- the same file the BR-207 replay starts from.
// Added here only what a snapshot leaves out: the roles, and USAGE on the two
// schemas for app_runtime (live has it; the SET ROLE checks below need it).
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. the always-aborted rehearsal reports PASS_ROLLED_BACK and leaves the
//      base unchanged;
//   2. the forward file applies, and a second run changes nothing;
//   3. the old function is byte-for-byte unchanged, and the new one is
//      SECURITY DEFINER, pinned, and executable by app_runtime only;
//   4. an active projexa link resolves by the sha256 of its token (the hash
//      Node computes is the hash the function computes), returning its scope
//      and never its token or hash, and touching last_used_at;
//   5. an expired projexa link, a revoked one, a prefix of a token, the stored
//      hash passed as if it were a token, and a veridian row carrying a hash do
//      not resolve;
//   6. a veridian plaintext link resolves exactly as through 0584;
//   7. app_runtime with no org context resolves through the function while RLS
//      hides the row from a direct SELECT; anon cannot call it;
//   8. the down file restores the base exactly, is safe to run twice, keeps
//      the rows, and the forward applies again afterwards.
//
// Run: bun test --isolate src/lib/ai-links/user-ai-links-resolve-by-hash.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const REPO_ROOT = new URL('../../../', import.meta.url)
const FORWARD = readFileSync(new URL('drizzle/0614_build001_link_resolve_by_hash.sql', REPO_ROOT), 'utf8')
const DOWN = readFileSync(new URL('drizzle/down/0614_build001_link_resolve_by_hash.down.sql', REPO_ROOT), 'utf8')
const SNAPSHOT = readFileSync(new URL('scripts/verify/fixtures/0614_build001_link_resolve_by_hash.base.sql', REPO_ROOT), 'utf8')

const ROLES_SQL = `
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE app_runtime NOSUPERUSER NOBYPASSRLS;
`
const SCHEMA_USAGE_SQL = `
GRANT USAGE ON SCHEMA platform, compliance TO app_runtime, anon;
`

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

// Token shapes: veridian is base64url (user-links.ts generateToken), projexa is
// pxa_ + 64 hex (spec section 3.1). Synthetic values.
const VER_TOKEN = 'V'.repeat(43)
const PXA_ACTIVE = `pxa_${'a1'.repeat(32)}`
const PXA_EXPIRED = `pxa_${'b2'.repeat(32)}`
const PXA_REVOKED = `pxa_${'c3'.repeat(32)}`
const VER_WITH_HASH_TOKEN = 'W'.repeat(43)
const STRAY_PLAINTEXT = `pxa_${'d4'.repeat(32)}`

const SEED_SQL = `
INSERT INTO platform.user_ai_links (id, org_id, user_id, token, status)
VALUES ('ver_1', 'org_a', 'user_1', '${VER_TOKEN}', 'active');
INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at, authority_level, allowed_functions, hide_personal, label)
VALUES ('px_active', 'org_a', 'user_1', 'projexa', 'project_a', '${sha256Hex(PXA_ACTIVE)}', now() + interval '7 days', 1, '{record_work_progress,get_construction_project_dashboard}', false, 'site AI'),
       ('px_expired', 'org_a', 'user_1', 'projexa', 'project_b', '${sha256Hex(PXA_EXPIRED)}', now() - interval '1 minute', 0, '{}', true, null);
INSERT INTO platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at, status, revoked_at)
VALUES ('px_revoked', 'org_a', 'user_2', 'projexa', 'project_a', '${sha256Hex(PXA_REVOKED)}', now() + interval '7 days', 'revoked', now());
-- CHECK user_ai_links_projexa_shape lets a veridian row carry a hash; the
-- product binding in the function must still never match it by hash.
INSERT INTO platform.user_ai_links (id, org_id, user_id, token, token_hash, status)
VALUES ('ver_hashed', 'org_b', 'user_3', '${VER_WITH_HASH_TOKEN}', '${sha256Hex(STRAY_PLAINTEXT)}', 'active');
`

// The LIVE_FACTS section (b) schema hash, restricted to the two schemas of the
// snapshot, with table grants, routine grants and triggers added.
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
  select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef::text||':'||coalesce(p.proacl::text, 'default') s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('compliance', 'platform') and p.prokind in ('f', 'p')
), rls as (
  select 'rls:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('compliance', 'platform')
), grants as (
  select 'grant:'||table_schema||'.'||table_name||':'||grantee||':'||privilege_type s
  from information_schema.role_table_grants where table_schema in ('compliance', 'platform')
), rgrants as (
  select 'rgrant:'||routine_schema||'.'||routine_name||':'||grantee||':'||privilege_type s
  from information_schema.role_routine_grants where routine_schema in ('compliance', 'platform')
), trg as (
  select 'trg:'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('compliance', 'platform')
), allr as (
  select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from fn union all select * from rls union all select * from grants union all select * from rgrants
  union all select * from trg
)`
const HASH_SQL = `${SNAPSHOT_CTE} select md5(string_agg(s, E'\\n' order by s)) from allr`

type Resolved = {
  id: string
  org_id: string
  user_id: string
  product: string
  project_id: string | null
  authority_level: number
  allowed_functions: string[]
  hide_personal: boolean
  expires_at: Date | string | null
}

let pg: PGlite

async function snapshot(): Promise<string[]> {
  const r = await pg.query<{ s: string }>(`${SNAPSHOT_CTE} select s from allr order by s`)
  return r.rows.map((x) => x.s)
}

async function fails(sqlText: string): Promise<string> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error(`expected this statement to fail: ${sqlText}`)
}

async function resolveScoped(token: string): Promise<Resolved[]> {
  return (await pg.query<Resolved>('select * from platform.rpc_resolve_ai_link_scoped($1)', [token])).rows
}

async function lastUsed(id: string): Promise<unknown> {
  return (await pg.query<{ last_used_at: unknown }>('select last_used_at from platform.user_ai_links where id = $1', [id])).rows[0]?.last_used_at ?? null
}

// The file body between BEGIN; and COMMIT;, for the rehearsal block.
function body(file: string): string {
  return file
    .split('\n')
    .filter((l) => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;')
    .join('\n')
}

let s0: string[] = []
let s1: string[] = []
let oldFnDef = ''

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(ROLES_SQL)
  await pg.exec(SNAPSHOT)
  await pg.exec(SCHEMA_USAGE_SQL)
  await pg.exec(SEED_SQL)
  s0 = await snapshot()
  oldFnDef = (await pg.query<{ d: string }>(`select pg_get_functiondef('platform.rpc_resolve_ai_link_token(text)'::regprocedure) d`)).rows[0].d
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe('drizzle/0614_build001_link_resolve_by_hash on the 2026-09-25 live snapshot (PGlite)', () => {
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

  test('2. the forward file applies, adds exactly one function, and a second run changes nothing', async () => {
    await pg.exec(FORWARD)
    s1 = await snapshot()
    const added = s1.filter((line) => !s0.includes(line))
    const removed = s0.filter((line) => !s1.includes(line))
    expect(removed).toEqual([])
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((line) => line.includes('rpc_resolve_ai_link_scoped'))).toBe(true)
    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
  })

  test('3. the 0584 function is unchanged; the new one is SECURITY DEFINER, pinned, and executable by app_runtime only', async () => {
    const after = (await pg.query<{ d: string }>(`select pg_get_functiondef('platform.rpc_resolve_ai_link_token(text)'::regprocedure) d`)).rows[0].d
    expect(after).toBe(oldFnDef)

    const meta = await pg.query<{ secdef: boolean; config: string[]; owner: string }>(
      `select p.prosecdef secdef, p.proconfig config, pg_get_userbyid(p.proowner) owner
       from pg_proc p where p.oid = 'platform.rpc_resolve_ai_link_scoped(text)'::regprocedure`,
    )
    expect(meta.rows[0].secdef).toBe(true)
    expect(meta.rows[0].config).toEqual(['search_path=platform, compliance, pg_catalog, pg_temp'])
    expect(meta.rows[0].owner).toBe('postgres')

    const priv = await pg.query<{ role: string; can: boolean }>(
      `select r role, has_function_privilege(r, 'platform.rpc_resolve_ai_link_scoped(text)', 'EXECUTE') can
       from unnest(array['app_runtime', 'anon', 'authenticated']) r order by r`,
    )
    expect(priv.rows).toEqual([
      { role: 'anon', can: false },
      { role: 'app_runtime', can: true },
      { role: 'authenticated', can: false },
    ])
    // PUBLIC holds nothing on it (every EXECUTE is an explicit grant).
    const publicGrant = await pg.query(
      `select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'platform.rpc_resolve_ai_link_scoped(text)'::regprocedure and a.grantee = 0`,
    )
    expect(publicGrant.rows).toEqual([])
  })

  test('4. an active projexa link resolves by the sha256 of its token, with its scope, never its token or hash', async () => {
    expect(await lastUsed('px_active')).toBeNull()

    const rows = await resolveScoped(PXA_ACTIVE)

    expect(rows).toHaveLength(1)
    const { expires_at, ...rest } = rows[0]
    expect(rest).toEqual({
      id: 'px_active',
      org_id: 'org_a',
      user_id: 'user_1',
      product: 'projexa',
      project_id: 'project_a',
      authority_level: 1,
      allowed_functions: ['record_work_progress', 'get_construction_project_dashboard'],
      hide_personal: false,
    })
    expect(new Date(expires_at as string).getTime()).toBeGreaterThan(Date.now())
    // Exactly the nine scope columns: no token, no token_hash.
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['allowed_functions', 'authority_level', 'expires_at', 'hide_personal', 'id', 'org_id', 'product', 'project_id', 'user_id'].sort(),
    )
    // The lookup and the touch are one statement.
    expect(await lastUsed('px_active')).not.toBeNull()
  })

  test('5. expired, revoked, prefix, hash-as-token and a veridian row carrying a hash never resolve', async () => {
    expect(await resolveScoped(PXA_EXPIRED)).toEqual([])
    expect(await lastUsed('px_expired')).toBeNull()
    expect(await resolveScoped(PXA_REVOKED)).toEqual([])
    expect(await lastUsed('px_revoked')).toBeNull()

    // Exact equality only: a prefix of a live token matches nothing.
    expect(await resolveScoped(PXA_ACTIVE.slice(0, -1))).toEqual([])
    // The stored hash is not a token: passed as p_token it is hashed again.
    expect(await resolveScoped(sha256Hex(PXA_ACTIVE))).toEqual([])
    // A projexa row has no plaintext, so neither function matches it by token.
    expect((await pg.query('select * from platform.rpc_resolve_ai_link_token($1)', [PXA_ACTIVE])).rows).toEqual([])
    // The hash arm is bound to product = 'projexa'.
    expect(await resolveScoped(STRAY_PLAINTEXT)).toEqual([])
    expect(await lastUsed('ver_hashed')).toBeNull()
    // Garbage and NULL.
    expect(await resolveScoped('')).toEqual([])
    expect((await pg.query('select * from platform.rpc_resolve_ai_link_scoped(null)')).rows).toEqual([])
  })

  test('6. a veridian plaintext link resolves exactly as it does through 0584', async () => {
    const scoped = await resolveScoped(VER_TOKEN)
    expect(scoped).toEqual([
      {
        id: 'ver_1',
        org_id: 'org_a',
        user_id: 'user_1',
        product: 'veridian',
        project_id: null,
        authority_level: 0,
        allowed_functions: [],
        hide_personal: true,
        expires_at: null,
      },
    ])
    const old = await pg.query('select * from platform.rpc_resolve_ai_link_token($1)', [VER_TOKEN])
    expect(old.rows).toEqual([{ org_id: scoped[0].org_id, user_id: scoped[0].user_id }])
    // The veridian token hashed is not a key for anything.
    expect(await resolveScoped(sha256Hex(VER_TOKEN))).toEqual([])
    // A second veridian row still resolves by its own plaintext.
    expect((await resolveScoped(VER_WITH_HASH_TOKEN)).map((r) => r.id)).toEqual(['ver_hashed'])
  })

  test('7. app_runtime with no org context resolves through the function while RLS hides the row; anon cannot call it', async () => {
    await pg.exec('SET ROLE app_runtime')
    try {
      const direct = await pg.query('select id from platform.user_ai_links')
      expect(direct.rows).toEqual([])
      expect((await resolveScoped(PXA_ACTIVE)).map((r) => r.id)).toEqual(['px_active'])
    } finally {
      await pg.exec('RESET ROLE')
    }
    await pg.exec('SET ROLE anon')
    try {
      const message = await fails(`select * from platform.rpc_resolve_ai_link_scoped('${PXA_ACTIVE}')`)
      expect(message).toContain('permission denied for function rpc_resolve_ai_link_scoped')
    } finally {
      await pg.exec('RESET ROLE')
    }
  })

  test('8. the down file restores the base exactly, keeps every row, is safe to run twice, and the forward applies again', async () => {
    const rowsBefore = (await pg.query('select id, status, token, token_hash, product from platform.user_ai_links order by id')).rows

    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)
    expect((await pg.query('select id, status, token, token_hash, product from platform.user_ai_links order by id')).rows).toEqual(rowsBefore)
    // VERIDIAN links resolve through 0584 again; the projexa link has no resolver.
    expect((await pg.query('select * from platform.rpc_resolve_ai_link_token($1)', [VER_TOKEN])).rows).toEqual([{ org_id: 'org_a', user_id: 'user_1' }])
    expect(await fails(`select * from platform.rpc_resolve_ai_link_scoped('${PXA_ACTIVE}')`)).toContain('does not exist')

    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)

    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
    expect((await resolveScoped(PXA_ACTIVE)).map((r) => r.id)).toEqual(['px_active'])
  })
})
