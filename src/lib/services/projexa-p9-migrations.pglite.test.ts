/// <reference types="bun-types" />
// PM package P9 migrations on PGlite (real Postgres as WASM):
//   * drizzle/0738_projexa_org_storage_used.sql  public.projexa_org_storage_used(org): bytes stored under '<org>/' in the bucket projexa-files, service_role only
//   * drizzle/0739_projexa_sync_manifest_internal_ai.sql  the manifest gains the top-level boolean internal_ai; every other field is unchanged
// Run: bun test --isolate src/lib/services/projexa-p9-migrations.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { forwardSql, downSql, openAwlPglite } from "./__test-helpers__/awl-pglite"
import { build, SUBS } from "./__test-helpers__/projexa-org-fixture"

setDefaultTimeout(240_000)

const ORG_A = "9a1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff"
const ORG_B = "1b2c3d4e-bbbb-4ccc-8ddd-eeeeffff0000"

describe("0738 projexa_org_storage_used", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await openAwlPglite()
    await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text, metadata jsonb);`)
    await db.exec(forwardSql("0738_projexa_org_storage_used"))
    await db.exec(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
      ('projexa-files', '${ORG_A}/drawing/u1/a.pdf', '{"size": 1000}'),
      ('projexa-files', '${ORG_A}/permit/u2/b.pdf', '{"size": 2500}'),
      ('projexa-files', '${ORG_B}/drawing/u3/c.pdf', '{"size": 7}'),
      ('other-bucket', '${ORG_A}/x/y/z.pdf', '{"size": 999999}')`)
  })
  afterAll(async () => {
    await db.close()
  })
  const used = async (org: string) => Number((await db.query<{ n: string }>(`select public.projexa_org_storage_used('${org}') n`)).rows[0].n)

  test("sums only this organisation's objects in the projexa-files bucket", async () => {
    expect(await used(ORG_A)).toBe(3500)
    expect(await used(ORG_B)).toBe(7)
    expect(await used("00000000-0000-4000-8000-000000000000")).toBe(0)
  })
  test("a freed file frees its space at once", async () => {
    await db.exec(`DELETE FROM storage.objects WHERE name = '${ORG_A}/permit/u2/b.pdf'`)
    expect(await used(ORG_A)).toBe(1000)
  })
  test("a value that is not a uuid (a wildcard, an empty string) raises instead of matching other organisations", async () => {
    for (const bad of ["%", "", "9a1c2d3e%", "not-a-uuid"]) {
      await expect(db.query(`select public.projexa_org_storage_used('${bad}')`)).rejects.toThrow()
    }
    await expect(db.query(`select public.projexa_org_storage_used(NULL)`)).rejects.toThrow()
  })
  test("service_role only", async () => {
    const r = await db.query<{ role: string; ok: boolean }>(
      `select r as role, has_function_privilege(r, 'public.projexa_org_storage_used(text)', 'EXECUTE') ok from unnest(array['anon','authenticated','app_runtime','service_role']) r`,
    )
    expect(Object.fromEntries(r.rows.map((x) => [x.role, x.ok]))).toEqual({ anon: false, authenticated: false, app_runtime: false, service_role: true })
  })
  test("the down file drops it", async () => {
    await db.exec(downSql("0738_projexa_org_storage_used"))
    expect((await db.query(`select 1 from pg_proc where proname = 'projexa_org_storage_used'`)).rows).toHaveLength(0)
    await db.exec(forwardSql("0738_projexa_org_storage_used"))
    expect(await used(ORG_A)).toBe(1000)
  })
})

describe("0739 projexa_sync_manifest emits internal_ai", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await build()
    await db.exec(`CREATE SCHEMA IF NOT EXISTS compliance;
      CREATE TABLE IF NOT EXISTS platform.product_branches (id text PRIMARY KEY, branch_key text UNIQUE);
      CREATE TABLE IF NOT EXISTS compliance.org_product_branch_enablements (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id text, product_branch_id text, is_enabled boolean);`)
  }, 300_000)
  afterAll(async () => {
    await db.close()
  })
  const manifest = async (u: string) => {
    const r = await db.query<{ m: Record<string, unknown> }>(`select public.projexa_sync_manifest($1, null) m`, [SUBS[u]])
    return r.rows[0].m
  }
  const orgOf = async (u: string) => (((await manifest(u)).user as Record<string, unknown>).org_id as string)

  test("every existing field is unchanged, the only difference is the new internal_ai (false when nothing is set)", async () => {
    const before = await manifest("u-mem")
    expect(before.internal_ai).toBeUndefined()
    await db.exec(forwardSql("0739_projexa_sync_manifest_internal_ai"))
    const after = await manifest("u-mem")
    const { internal_ai, ...rest } = after
    expect(internal_ai).toBe(false)
    expect(rest).toEqual(before)
  })
  test("true only with an enabled row for this organisation and the internal_ai branch; a disabled row or another branch is false", async () => {
    const org = await orgOf("u-mem")
    await db.exec(`INSERT INTO platform.product_branches (id, branch_key) VALUES ('b-ai', 'internal_ai'), ('b-other', 'erp')`)
    await db.exec(`INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled) VALUES ('${org}', 'b-other', true)`)
    expect((await manifest("u-mem")).internal_ai).toBe(false)
    await db.exec(`INSERT INTO compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled) VALUES ('${org}', 'b-ai', false)`)
    expect((await manifest("u-mem")).internal_ai).toBe(false)
    await db.exec(`UPDATE compliance.org_product_branch_enablements SET is_enabled = true WHERE product_branch_id = 'b-ai'`)
    expect((await manifest("u-mem")).internal_ai).toBe(true)
  })
  test("a row of another organisation does not turn it on", async () => {
    await db.exec(`UPDATE compliance.org_product_branch_enablements SET org_id = 'some-other-org' WHERE product_branch_id = 'b-ai'`)
    expect((await manifest("u-mem")).internal_ai).toBe(false)
  })
  test("grants, SECURITY DEFINER and search_path are as before; the down file restores the old body", async () => {
    const meta = async () =>
      (await db.query<{ secdef: boolean; cfg: string[]; svc: boolean; anon: boolean; auth: boolean }>(
        `select prosecdef secdef, proconfig cfg, has_function_privilege('service_role', oid, 'EXECUTE') svc, has_function_privilege('anon', oid, 'EXECUTE') anon, has_function_privilege('authenticated', oid, 'EXECUTE') auth
           from pg_proc where proname = 'projexa_sync_manifest'`,
      )).rows[0]
    const m = await meta()
    expect(m.secdef).toBe(true)
    expect(m.cfg).toEqual(["search_path=pg_catalog, pg_temp", "TimeZone=UTC"])
    expect([m.svc, m.anon, m.auth]).toEqual([true, false, false])
    await db.exec(downSql("0739_projexa_sync_manifest_internal_ai"))
    expect((await manifest("u-mem")).internal_ai).toBeUndefined()
    expect(await meta()).toEqual(m)
  })
})
