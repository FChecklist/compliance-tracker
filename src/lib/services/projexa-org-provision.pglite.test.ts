/// <reference types="bun-types" />
// G-09 (AUDIT-100): PROJEXA organisation provisioning inside the database (drizzle/0729). The SQL is the REAL migration file on PGlite (real Postgres as
// WASM) over stand-in tables that carry the live columns the function writes.
//   * provisioning does what POST /api/v1/platform/provision-org + provisionOrganisation() do: organisation (free, $20 cap, country default IN, primary
//     branch projexa), a free slug on collision, base currency, the six branch enablements, fiscal year + 6 accounts, "General", ONE api key row (hash only)
//   * all-or-nothing: a failure after the organisation insert leaves nothing behind (the TypeScript route could orphan an organisation)
//   * credentials: stored once, never overwritten, only for a key that really is an active key of the named organisation, readable by service_role only
// Run: bun test --isolate src/lib/services/projexa-org-provision.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { createHash } from "node:crypto"
import type { PGlite } from "@electric-sql/pglite"
import { forwardSql, downSql, openAwlPglite } from "./__test-helpers__/awl-pglite"

setDefaultTimeout(120_000)

let db: PGlite
const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const KEY = "vk_" + "a".repeat(32)
const PX = "bbbbbbbb-0000-4000-8000-000000000001"

type Prov = { outcome: string; organisation_id: string | null }
const provision = (name: string, country: string | null = null, cur: string | null = null, key = KEY) =>
  db.query<Prov>("select * from public.projexa_provision_org($1, $2, $3, $4, $5)", [name, country, cur, sha(key), key.slice(0, 8) + "..."]).then((r) => r.rows[0])
const rows = <T = Record<string, any>>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows)

beforeAll(async () => {
  db = await openAwlPglite()
  await db.exec(`
    create schema if not exists compliance;
    create type compliance.erp_account_root_type as enum ('asset','liability','equity','income','expense');
    create table compliance.organisations (id text primary key default gen_random_uuid()::text, name text not null, slug text not null unique, plan text not null default 'free',
      is_active boolean not null default true, country text default 'IN', primary_product_branch_id text, monthly_cost_cap_usd numeric, cost_cap_enforcement_enabled boolean not null default true);
    create table compliance.api_keys (id text primary key default gen_random_uuid()::text, name text not null, key_hash text not null, key_prefix text not null, org_id text not null references compliance.organisations(id),
      scopes text not null default 'read', is_active boolean not null default true, issued_for_application_id text, key_kind text not null default 'org_service');
    create table compliance.departments (id text primary key default gen_random_uuid()::text, name text not null, org_id text not null, created_at timestamptz not null default now());
    create table compliance.erp_currencies (id text primary key default gen_random_uuid()::text, org_id text not null, code text not null, name text not null, symbol text, is_base_currency boolean not null default false);
    create table compliance.erp_fiscal_years (id text primary key default gen_random_uuid()::text, org_id text not null, year_name text not null, start_date date not null, end_date date not null, is_closed boolean not null default false);
    create table compliance.erp_accounts (id text primary key default gen_random_uuid()::text, org_id text not null, account_name text not null, account_number text, root_type compliance.erp_account_root_type not null, account_type text, is_group boolean not null default false);
    create table compliance.platform_applications (id text primary key default gen_random_uuid()::text, application_key text not null, display_name text not null, is_active boolean not null default true);
    create table platform.product_branches (id text primary key default gen_random_uuid()::text, branch_key text not null unique);
    create table compliance.org_product_branch_enablements (id text primary key default gen_random_uuid()::text, org_id text not null references compliance.organisations(id),
      product_branch_id text not null references platform.product_branches(id), is_enabled boolean not null default false, enabled_at timestamptz, unique (org_id, product_branch_id));
    insert into compliance.platform_applications (id, application_key, display_name) values ('app-px', 'projexa', 'PROJEXA'), ('app-off', 'projexa-local', 'Local');
    insert into platform.product_branches (branch_key) values ('projexa'),('veri_reward'),('veri_chat_v2'),('construction'),('erp'),('sales'),('hr'),('pms');
  `)
  await db.exec(forwardSql("0729_projexa_org_credentials_and_provision"))
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("public.projexa_provision_org", () => {
  test("creates the organisation exactly like provisionOrganisation + the projexa branches", async () => {
    const out = await provision("Acme Builders Pvt. Ltd.", "ae", "aed")
    expect(out.outcome).toBe("created")
    const org = (await rows("select * from compliance.organisations where id=$1", [out.organisation_id]))[0]
    const px = (await rows("select id from platform.product_branches where branch_key='projexa'"))[0].id
    expect(org).toMatchObject({ name: "Acme Builders Pvt. Ltd.", slug: "acme-builders-pvt-ltd", plan: "free", country: "AE", primary_product_branch_id: px, cost_cap_enforcement_enabled: true, is_active: true })
    expect(Number(org.monthly_cost_cap_usd)).toBe(20)
    expect(await rows("select code,name,symbol,is_base_currency from compliance.erp_currencies where org_id=$1", [out.organisation_id])).toEqual([{ code: "AED", name: "UAE Dirham", symbol: "AED", is_base_currency: true }])
    const branches = await rows("select b.branch_key from compliance.org_product_branch_enablements e join platform.product_branches b on b.id=e.product_branch_id where e.org_id=$1 and e.is_enabled order by 1", [out.organisation_id])
    expect(branches.map((b) => b.branch_key)).toEqual(["construction", "erp", "hr", "sales", "veri_chat_v2", "veri_reward"])
    const year = new Date().getUTCFullYear()
    const fy = (await rows("select year_name, start_date::text s, end_date::text e, is_closed from compliance.erp_fiscal_years where org_id=$1", [out.organisation_id]))[0]
    expect(fy).toEqual({ year_name: `FY${year}`, s: `${year}-01-01`, e: `${year}-12-31`, is_closed: false })
    expect(await rows("select account_number n, account_name a, root_type::text r, is_group g from compliance.erp_accounts where org_id=$1 order by 1", [out.organisation_id])).toEqual([
      { n: "1000", a: "Assets", r: "asset", g: true }, { n: "2000", a: "Liabilities", r: "liability", g: true }, { n: "3000", a: "Equity", r: "equity", g: true },
      { n: "4000", a: "Revenue", r: "income", g: false }, { n: "5000", a: "Direct Costs", r: "expense", g: false }, { n: "6000", a: "Overheads", r: "expense", g: false },
    ])
    expect((await rows("select name from compliance.departments where org_id=$1", [out.organisation_id])).map((d) => d.name)).toEqual(["General"])
    const keys = await rows("select * from compliance.api_keys where org_id=$1", [out.organisation_id])
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ name: "PROJEXA (provisioned)", key_hash: sha(KEY), key_prefix: "vk_aaaaa...", scopes: "read,write", is_active: true, issued_for_application_id: "app-px" })
    expect(JSON.stringify(keys)).not.toContain(KEY) // the function never sees the key
  })

  test("defaults: country IN, currency INR; slug collision gets -1, -2; a name with no letters is 'org'", async () => {
    const a = await provision("Same Name")
    const b = await provision("Same Name")
    const c = await provision("Same Name")
    const slugs = (await rows("select slug from compliance.organisations where id = any($1) order by slug", [[a.organisation_id, b.organisation_id, c.organisation_id]])).map((r) => r.slug)
    expect(slugs).toEqual(["same-name", "same-name-1", "same-name-2"])
    expect((await rows("select country from compliance.organisations where id=$1", [a.organisation_id]))[0].country).toBe("IN")
    expect((await rows("select code from compliance.erp_currencies where org_id=$1", [a.organisation_id]))[0].code).toBe("INR")
    const d = await provision("!!!")
    expect((await rows("select slug from compliance.organisations where id=$1", [d.organisation_id]))[0].slug).toBe("org")
  })

  test("refusals write nothing: empty name, bad hash, platform app missing or inactive", async () => {
    const before = (await rows("select count(*)::int n from compliance.organisations"))[0].n
    expect(await provision("   ")).toEqual({ outcome: "bad_input", organisation_id: null })
    expect((await db.query<Prov>("select * from public.projexa_provision_org('X', null, null, 'nothex', 'p')")).rows[0].outcome).toBe("bad_input")
    expect((await db.query<Prov>("select * from public.projexa_provision_org('X', null, null, $1, ' ')", [sha("k")])).rows[0].outcome).toBe("bad_input")
    await db.exec("update compliance.platform_applications set is_active=false where application_key='projexa'")
    expect(await provision("Off")).toEqual({ outcome: "not_configured", organisation_id: null })
    await db.exec("update compliance.platform_applications set is_active=true where application_key='projexa'")
    expect((await rows("select count(*)::int n from compliance.organisations"))[0].n).toBe(before)
  })

  test("the seeding steps are non-fatal (a missing branch does not fail the organisation), the key insert is not (all or nothing)", async () => {
    await db.exec("update platform.product_branches set branch_key='veri_reward_x' where branch_key='veri_reward'")
    const ok = await provision("No Reward Branch")
    expect(ok.outcome).toBe("created")
    await db.exec("update platform.product_branches set branch_key='veri_reward' where branch_key='veri_reward_x'")
    // a failing api_keys insert (a check the live table does not have, planted here) rolls the WHOLE call back: no organisation, no seed rows
    await db.exec("alter table compliance.api_keys add constraint boom check (name <> 'PROJEXA (provisioned)') not valid")
    const before = (await rows("select count(*)::int n from compliance.organisations"))[0].n
    await expect(provision("Doomed Org")).rejects.toThrow()
    await db.exec("alter table compliance.api_keys drop constraint boom")
    expect((await rows("select count(*)::int n from compliance.organisations"))[0].n).toBe(before)
    expect(await rows("select 1 from compliance.organisations where name='Doomed Org'")).toHaveLength(0)
    expect(await rows("select 1 from compliance.departments where org_id not in (select id from compliance.organisations)")).toHaveLength(0)
  })
})

describe("credentials (public.projexa_org_credential_*)", () => {
  const put = (px: string, vOrg: string, key: string) => db.query<{ r: string }>("select public.projexa_org_credential_put($1::uuid, $2, $3) r", [px, vOrg, key]).then((r) => r.rows[0].r)
  const get = (px: string) => rows<{ veridian_org_id: string; api_key: string }>("select * from public.projexa_org_credential_get($1::uuid)", [px])

  test("store, read back, never overwrite; a key that is not the organisation's is refused", async () => {
    const out = await provision("Creds Org", null, null, "vk_" + "c".repeat(32))
    const v = out.organisation_id as string
    expect(await put(PX, v, "vk_" + "x".repeat(32))).toBe("key_mismatch")
    expect(await get(PX)).toEqual([])
    expect(await put(PX, v, "vk_" + "c".repeat(32))).toBe("stored")
    expect(await get(PX)).toEqual([{ veridian_org_id: v, api_key: "vk_" + "c".repeat(32) }])
    expect((await rows("select public.projexa_org_veridian_id_get($1::uuid) v", [PX]))[0].v).toBe(v)
    // the repair race: a second writer is a no-op, the first key stays
    const other = await provision("Creds Org 2", null, null, "vk_" + "d".repeat(32))
    expect(await put(PX, other.organisation_id as string, "vk_" + "d".repeat(32))).toBe("exists")
    expect((await get(PX))[0].api_key).toBe("vk_" + "c".repeat(32))
    expect(await put(PX, "", "k")).toBe("bad_input")
    expect(await put(PX, v, " ")).toBe("bad_input")
  })

  test("an inactive key is not a credential", async () => {
    const out = await provision("Inactive Key Org", null, null, "vk_" + "e".repeat(32))
    await db.query("update compliance.api_keys set is_active=false where org_id=$1", [out.organisation_id])
    expect(await put("bbbbbbbb-0000-4000-8000-000000000002", out.organisation_id as string, "vk_" + "e".repeat(32))).toBe("key_mismatch")
  })

  test("only service_role may run any of the four functions or touch the table", async () => {
    for (const sig of ["public.projexa_provision_org(text,text,text,text,text)", "public.projexa_org_credential_put(uuid,text,text)", "public.projexa_org_credential_get(uuid)", "public.projexa_org_veridian_id_get(uuid)"]) {
      const r = await rows<{ role: string; ok: boolean }>(`select r.rolname role, has_function_privilege(r.rolname, '${sig}', 'execute') ok from pg_roles r where r.rolname in ('anon','authenticated','app_runtime','service_role') order by 1`)
      expect(Object.fromEntries(r.map((x) => [x.role, x.ok]))).toEqual({ anon: false, app_runtime: false, authenticated: false, service_role: true })
    }
    for (const role of ["anon", "authenticated", "app_runtime", "service_role"]) {
      const r = await rows<{ ok: boolean }>(`select has_table_privilege('${role}', 'compliance.projexa_org_credentials', 'select') ok`)
      expect(r[0].ok).toBe(false) // service_role reaches it only through the functions
    }
    const t = (await rows<{ rls: boolean; forced: boolean }>("select relrowsecurity rls, relforcerowsecurity forced from pg_class where oid='compliance.projexa_org_credentials'::regclass"))[0]
    expect(t).toEqual({ rls: true, forced: true })
  })

  test("the down migration removes the functions and the table, and the forward file applies twice", async () => {
    await db.exec(forwardSql("0729_projexa_org_credentials_and_provision")) // idempotent
    await db.exec(downSql("0729_projexa_org_credentials_and_provision"))
    expect(await rows("select 1 from pg_proc where proname like 'projexa_provision_org' or proname like 'projexa_org_%'")).toHaveLength(0)
    expect(await rows("select 1 from pg_class where relname='projexa_org_credentials'")).toHaveLength(0)
  })
})
