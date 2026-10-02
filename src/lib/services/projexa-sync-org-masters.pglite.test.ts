/// <reference types="bun-types" />
// PROJEXA SYNC: drizzle/0684_projexa_sync_org_masters.sql on PGlite (real Postgres as WASM, built the way the live database is). The sync gains 9 ORGANISATION kinds
// (vendors, customers, companies, boq_categories, currencies, exchange_rates, departments, org_people, cost_visibility), not project-scoped.
//   * the list:      the organisation list is separate from the 28 project kinds, which do not change; the manifest adds `org_kinds` (only what the role may read)
//   * isolation:     every organisation kind returns exactly the person's organisation's rows; organisation B's person never sees organisation A's
//   * role gate:     a viewer / client_viewer gets the one 404 for every master but cost_visibility; a member gets rows
//   * columns:       an explicit allow-list: tax ids, a bank-account column and a SECRET internal-notes column never leave; a person's email is masked
//                    for everyone but the person; credit_limit (money) is NULL below the role that may see money
//   * versions:      insert / update / delete of an organisation row is a version / a version / a tombstone in the organisation's feed ('__org__'); a login is not a version
//   * ids + exact:   the id inventory and the exact-ids mode use the same organisation scope
//   * reversible:    the down file removes everything (triggers first) and restores the 0678 manifest; the forward file applies twice
// The SQL functions are called directly through the same rpc shape the Edge function uses (pgRpc).
// Run: bun test --isolate src/lib/services/projexa-sync-org-masters.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import type { Rpc } from "../../../supabase/functions/projexa-sync/handler"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(240_000)

const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-adm": "33333333-3333-4333-8333-333333333333",
  "u-b": "44444444-4444-4444-8444-444444444444",
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-cv": "77777777-7777-4777-8777-777777777777",
}
const ORG_KINDS = ["vendors", "customers", "companies", "boq_categories", "currencies", "exchange_rates", "departments", "org_people", "cost_visibility"] as const
const RANK2 = ORG_KINDS.filter((k) => k !== "cost_visibility")

let db: PGlite
let rpc: Rpc

/** The master tables as schema.ts declares them (the PGlite base snapshot does not carry them), each with two extra columns a real table could
 *  have and that must NEVER leave: a bank account and a SECRET internal note. Created BEFORE 0684 so its triggers attach, exactly as live. */
const MASTER_TABLES = `
create table if not exists compliance.erp_suppliers (id text primary key, org_id text not null, supplier_name text not null, supplier_type text, gstin text, pan_number text,
  default_payment_terms_days integer, vendor_risk_profile_id text, tax_withholding_category_id text, is_active boolean not null default true, created_at timestamp not null default now(),
  qualification_status text not null default 'not_started', sanction_screening_status text not null default 'not_checked', sanction_screened_at timestamp, credit_limit numeric, trade text, project_id text);
create table if not exists compliance.erp_customers (id text primary key, org_id text not null, customer_name text not null, client_id text, gstin text, pan_number text,
  default_payment_terms_days integer, credit_limit numeric, is_active boolean not null default true, created_at timestamp not null default now());
create table if not exists compliance.erp_companies (id text primary key, org_id text not null, company_name text not null, abbr text, parent_company_id text, is_group boolean not null default false,
  default_currency_id text, country text, date_of_incorporation date, is_active boolean not null default true, created_at timestamp not null default now());
create table if not exists compliance.construction_boq_categories (id text primary key, org_id text not null, name text not null, sort_order integer not null default 0,
  is_active boolean not null default true, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists compliance.erp_currencies (id text primary key, org_id text not null, code text not null, name text not null, symbol text, is_base_currency boolean not null default false,
  created_at timestamp not null default now());
create table if not exists compliance.erp_exchange_rates (id text primary key, org_id text not null, from_currency_id text not null, to_currency_id text not null, rate numeric not null,
  rate_date date not null, source text not null default 'manual', created_at timestamp not null default now());
create table if not exists compliance.departments (id text primary key, name text not null, description text, org_id text not null, head_id text unique,
  created_at timestamp not null default now(), updated_at timestamp not null default now());
alter table compliance.erp_suppliers add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.erp_customers add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.erp_companies add column if not exists bank_account_number text, add column if not exists internal_notes text;
alter table compliance.departments add column if not exists internal_notes text;
`

const SECRET = { bank_account_number: "SECRET-ACCT-0001", internal_notes: "SECRET internal note" }
const FIXTURE = [
  `insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
     ('u-cv', 'Cleo Client', 'cleo@a.example.test', 'SECRET-hash', 'client_viewer', true, 'org-a', '77777777-7777-4777-8777-777777777777');`,
  `update compliance.users set passcode_hash = 'SECRET-passcode' where id = 'u-mem';`,
  `insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values ('cv-b', 'org-b', 'manager', true, 'u-b');`,
  insert("erp_suppliers", [
    { id: "ven-1", org_id: "org-a", supplier_name: "Ace Cement", supplier_type: "material", gstin: "SECRET-GSTIN", pan_number: "SECRET-PAN", credit_limit: 500000, trade: "civil", default_payment_terms_days: 30, ...SECRET, sanction_screening_status: "flagged" },
    { id: "ven-2", org_id: "org-a", supplier_name: "Bright Paints", supplier_type: "material", credit_limit: 100000, ...SECRET },
    { id: "SECRET-ven-b", org_id: "org-b", supplier_name: "SECRET org b vendor", credit_limit: 1 },
  ]),
  insert("erp_customers", [
    { id: "cus-1", org_id: "org-a", customer_name: "Villa Owner", gstin: "SECRET-GSTIN", pan_number: "SECRET-PAN", credit_limit: 250000, ...SECRET },
    { id: "SECRET-cus-b", org_id: "org-b", customer_name: "SECRET org b customer" },
  ]),
  insert("erp_companies", [
    { id: "co-1", org_id: "org-a", company_name: "A Builders HO", abbr: "HO", country: "IN", ...SECRET },
    { id: "co-2", org_id: "org-a", company_name: "A Builders Site Office", abbr: "SO", parent_company_id: "co-1" },
    { id: "SECRET-co-b", org_id: "org-b", company_name: "SECRET org b company" },
  ]),
  insert("construction_boq_categories", [
    { id: "cat-1", org_id: "org-a", name: "Civil", sort_order: 1 },
    { id: "cat-2", org_id: "org-a", name: "Finishes", sort_order: 2 },
    { id: "SECRET-cat-b", org_id: "org-b", name: "SECRET" },
  ]),
  insert("erp_currencies", [
    { id: "cur-inr", org_id: "org-a", code: "INR", name: "Indian Rupee", symbol: "₹", is_base_currency: true },
    { id: "cur-aed", org_id: "org-a", code: "AED", name: "UAE Dirham" },
    { id: "SECRET-cur-b", org_id: "org-b", code: "USD", name: "SECRET" },
  ]),
  insert("erp_exchange_rates", [
    { id: "fx-1", org_id: "org-a", from_currency_id: "cur-aed", to_currency_id: "cur-inr", rate: 22.7, rate_date: "2026-10-01" },
    { id: "SECRET-fx-b", org_id: "org-b", from_currency_id: "SECRET-cur-b", to_currency_id: "SECRET-cur-b", rate: 1, rate_date: "2026-10-01" },
  ]),
  insert("departments", [
    { id: "dep-1", org_id: "org-a", name: "Site Execution", description: "Runs the sites", head_id: "u-mgr", internal_notes: SECRET.internal_notes },
    { id: "SECRET-dep-b", org_id: "org-b", name: "SECRET" },
  ]),
].join("\n")

/** What organisation A's member must receive per kind (sorted ids). */
const OWN_A: Record<(typeof ORG_KINDS)[number], string[]> = {
  vendors: ["ven-1", "ven-2"],
  customers: ["cus-1"],
  companies: ["co-1", "co-2"],
  boq_categories: ["cat-1", "cat-2"],
  currencies: ["cur-aed", "cur-inr"],
  exchange_rates: ["fx-1"],
  departments: ["dep-1"],
  org_people: ["u-adm", "u-cv", "u-mem", "u-mgr", "u-off", "u-sen", "u-view"],
  cost_visibility: ["cv1", "cv3"],
}

type R = { data: J | null; code: string | null }
async function call(fn: string, args: Record<string, unknown>): Promise<R> {
  const r = await rpc(fn, args)
  return { data: (r.data as J) ?? null, code: r.error?.code ?? (r.error ? "ERR:" + r.error.message : null) }
}
const who = (u: string) => ({ p_sub: SUBS[u], p_email: null })
const pull = (u: string, kind: string, after: { ts: string; id: string } | null = null, limit = 200) =>
  call("projexa_sync_org_pull", { ...who(u), p_kind: kind, p_after_ts: after?.ts ?? null, p_after_id: after?.id ?? null, p_limit: limit })
const items = async (u: string, kind: string) => ((await pull(u, kind)).data?.items ?? []) as J[]
const idsOf = async (u: string, kind: string) => (await items(u, kind)).map((i) => i.id as string).sort()
const inventory = (u: string, kind: string, after: string | null = null, limit = 5000) => call("projexa_sync_org_ids", { ...who(u), p_kind: kind, p_after_id: after, p_limit: limit })
const feed = (u: string, after: number | null) => call("projexa_sync_org_changes", { ...who(u), p_after_seq: after, p_limit: 1000 })

async function build(): Promise<PGlite> {
  const d = await createUserLinkDb()
  for (const m of ["0618_build001_projexa_gateway", "0677_projexa_sync_read", "0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0683_projexa_sync_more_kinds"]) await d.exec(forwardSql(m))
  await d.exec(MASTER_TABLES)
  await d.exec(forwardSql("0684_projexa_sync_org_masters"))
  await d.exec(FIXTURE)
  return d
}

beforeAll(async () => {
  db = await build()
  rpc = pgRpc(db)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the list and the manifest", () => {
  test("the organisation list is the 9 kinds, apart from the 28 project kinds, which do not change", async () => {
    expect((await db.query<J>(`select unnest(public.projexa_sync__org_kinds()) k`)).rows.map((r) => r.k)).toEqual([...ORG_KINDS])
    expect((await db.query<J>(`select cardinality(public.projexa_sync__kinds()) n`)).rows[0].n).toBe(28)
    expect((await db.query<J>(`select count(*)::int n from unnest(public.projexa_sync__kinds()) k where k = any(public.projexa_sync__org_kinds())`)).rows[0].n).toBe(0)
  })

  test("a member's manifest lists all 9 organisation kinds (project_scoped false); a viewer's only cost_visibility; the project kinds are unchanged", async () => {
    const m = (await call("projexa_sync_manifest", who("u-mem"))).data!
    expect((m.org_kinds as J[]).map((k) => k.kind)).toEqual([...ORG_KINDS])
    for (const k of m.org_kinds as J[]) expect(k).toMatchObject({ project_scoped: false, deletes_supported: true })
    expect((m.org_kinds as J[]).find((k) => k.kind === "org_people")!.peer_shareable).toBe(false)
    expect((m.org_kinds as J[]).find((k) => k.kind === "vendors")!.peer_shareable).toBe(true)
    expect((m.kinds as J[]).length).toBe(28)
    for (const k of m.kinds as J[]) expect(k.project_scoped).toBe(true)
    for (const u of ["u-view", "u-cv"]) {
      const v = (await call("projexa_sync_manifest", who(u))).data!
      expect([u, (v.org_kinds as J[]).map((k) => k.kind)]).toEqual([u, ["cost_visibility"]])
    }
  })

  test("org_view_class: a member and a viewer differ (the role gate), the same role twice is one class; the project view_class is still 0678's", async () => {
    const mem = (await call("projexa_sync_manifest", who("u-mem"))).data!
    const view = (await call("projexa_sync_manifest", who("u-view"))).data!
    const mem2 = (await call("projexa_sync_manifest", who("u-mem"))).data!
    expect(mem.org_view_class).toMatch(/^[0-9a-f]{16}$/)
    expect(mem.org_view_class).not.toBe(view.org_view_class)
    expect(mem2.org_view_class).toBe(mem.org_view_class)
    // the project view class is not touched: member and viewer still share it (both see no cost), as the work-job tests of 0682 rely on
    expect(mem.view_class).toBe(view.view_class)
  })
})

describe("isolation: the person's organisation, never another", () => {
  for (const kind of ORG_KINDS) {
    test(`${kind}: organisation A's member gets exactly A's rows; organisation B's person never gets one of them`, async () => {
      expect(await idsOf("u-mem", kind)).toEqual(OWN_A[kind])
      const r = await pull("u-mem", kind)
      expect(JSON.stringify(r.data)).not.toContain("SECRET")
      const b = await idsOf("u-b", kind)
      for (const id of OWN_A[kind]) expect(b).not.toContain(id)
    })
  }

  test("organisation B's person gets B's own rows (the scope is the person's organisation, not a constant)", async () => {
    expect(await idsOf("u-b", "vendors")).toEqual(["SECRET-ven-b"])
    expect(await idsOf("u-b", "org_people")).toEqual(["u-b"])
    expect(await idsOf("u-b", "cost_visibility")).toEqual(["cv-b"])
  })
})

describe("role gate", () => {
  for (const u of ["u-view", "u-cv"]) {
    test(`${u}: the one 404 for every master but cost_visibility (pull, ids, exact ids); cost_visibility arrives`, async () => {
      for (const kind of RANK2) {
        expect([kind, (await pull(u, kind)).code]).toEqual([kind, "AW404"])
        expect([kind, (await inventory(u, kind)).code]).toEqual([kind, "AW404"])
        expect([kind, (await call("projexa_sync_org_pull_ids", { ...who(u), p_kind: kind, p_ids: [OWN_A[kind][0]] })).code]).toEqual([kind, "AW404"])
      }
      expect(await idsOf(u, "cost_visibility")).toEqual(OWN_A.cost_visibility)
    })
  }

  test("a member gets rows of every master; an unknown kind is the same 404 as a gated one", async () => {
    for (const kind of RANK2) expect([kind, (await pull("u-mem", kind)).code, (await idsOf("u-mem", kind)).length > 0]).toEqual([kind, null, true])
    expect((await pull("u-mem", "bank_accounts")).code).toBe("AW404")
    expect((await pull("u-mem", "tasks")).code).toBe("AW404") // a project kind is not an organisation kind
  })

  test("a person who does not resolve gets a status and no data", async () => {
    const r = await call("projexa_sync_org_pull", { p_sub: "99999999-9999-4999-8999-999999999999", p_email: null, p_kind: "vendors", p_after_ts: null, p_after_id: null, p_limit: 10 })
    expect(r.data!.status).not.toBe("ok")
    expect(r.data!.items).toBeUndefined()
  })
})

describe("column allow-list", () => {
  const ALLOWED: Record<string, string[]> = {
    vendors: ["id", "supplier_name", "supplier_type", "trade", "project_id", "default_payment_terms_days", "credit_limit", "qualification_status", "is_active", "created_at"],
    customers: ["id", "customer_name", "client_id", "default_payment_terms_days", "credit_limit", "is_active", "created_at"],
    companies: ["id", "company_name", "abbr", "parent_company_id", "is_group", "default_currency_id", "country", "date_of_incorporation", "is_active", "created_at"],
    boq_categories: ["id", "name", "sort_order", "is_active", "created_at", "updated_at"],
    currencies: ["id", "code", "name", "symbol", "is_base_currency", "created_at"],
    exchange_rates: ["id", "from_currency_id", "to_currency_id", "rate", "rate_date", "source", "created_at"],
    departments: ["id", "name", "description", "head_id", "created_at", "updated_at"],
    org_people: ["id", "name", "role", "is_active", "email"],
    cost_visibility: ["id", "role", "can_see_cost", "changed_at", "created_at"],
  }
  for (const kind of ORG_KINDS) {
    test(`${kind}: every row carries exactly the allow-listed columns that exist`, async () => {
      for (const it of await items("u-mgr", kind)) expect([kind, Object.keys(it.data).sort()]).toEqual([kind, [...ALLOWED[kind]].sort()])
    })
  }

  test("tax ids, the bank-account column and the SECRET note never leave, for any role", async () => {
    for (const u of ["u-mem", "u-mgr", "u-adm"]) for (const kind of ORG_KINDS) {
      const text = JSON.stringify((await pull(u, kind)).data)
      for (const bad of ["SECRET", "GSTIN", "gstin", "pan_number", "bank_account", "internal_notes", "password", "passcode", "auth_user_id", "sanction"]) expect([u, kind, bad, text.includes(bad)]).toEqual([u, kind, bad, false])
    }
  })

  test("org_people: every email is masked except the person's own", async () => {
    const rows = await items("u-mem", "org_people")
    const by = Object.fromEntries(rows.map((r) => [r.id, r.data]))
    expect(by["u-mem"].email).toBe("mo@a.example.test")
    expect(by["u-mgr"].email).toBe("m***@a.example.test")
    expect(by["u-view"].email).toBe("v***@a.example.test")
    expect(by["u-mgr"]).toMatchObject({ name: "Mira Manager", role: "manager", is_active: true })
    expect(by["u-off"].is_active).toBe(false)
    const mgrView = Object.fromEntries((await items("u-mgr", "org_people")).map((r) => [r.id, r.data]))
    expect(mgrView["u-mgr"].email).toBe("mira@a.example.test")
    expect(mgrView["u-mem"].email).toBe("m***@a.example.test")
  })

  test("credit_limit (money) is NULL for a member and filled for a manager who may see cost; the page says which fields are hidden", async () => {
    const mem = await pull("u-mem", "vendors")
    const mgr = await pull("u-mgr", "vendors")
    expect((mem.data!.items as J[]).find((i) => i.id === "ven-1")!.data.credit_limit).toBeNull()
    expect(Number((mgr.data!.items as J[]).find((i) => i.id === "ven-1")!.data.credit_limit)).toBe(500000)
    expect(mem.data!.hidden_fields).toEqual(["credit_limit"])
    expect(mem.data!.redacted).toBe(true)
    expect(mgr.data!.hidden_fields).toEqual([])
    expect(Number((await items("u-mgr", "customers")).find((i) => i.id === "cus-1")!.data.credit_limit)).toBe(250000)
    expect((await items("u-mem", "customers")).find((i) => i.id === "cus-1")!.data.credit_limit).toBeNull()
  })
})

describe("keyset pull", () => {
  test("pages of one walk every row once, in (cursor field, id) order, and a bad cursor is AW400", async () => {
    const seen: string[] = []
    let after: { ts: string; id: string } | null = null
    for (let i = 0; i < 10; i++) {
      const r = await pull("u-mem", "org_people", after, 2)
      for (const it of r.data!.items as J[]) seen.push(it.id)
      if (!r.data!.has_more) break
      after = { ts: r.data!.next_ts, id: r.data!.next_id }
    }
    expect(seen.sort()).toEqual(OWN_A.org_people)
    expect((await pull("u-mem", "vendors", { ts: "yesterday", id: "x" })).code).toBe("AW400")
    expect((await pull("u-mem", "vendors", null, 0)).code).toBe("AW400")
  })
})

describe("versions and tombstones of an organisation kind", () => {
  const head = async (kind: string, id: string) => (await db.query<J>(`select version, project_id, deleted from platform.projexa_record_head where kind = '${kind}' and record_id = '${id}'`)).rows[0]

  test("every master row written after 0684 has version 1 under the sentinel '__org__', and the pull reports it", async () => {
    for (const [kind, id] of [["vendors", "ven-1"], ["customers", "cus-1"], ["companies", "co-1"], ["boq_categories", "cat-1"], ["currencies", "cur-inr"], ["exchange_rates", "fx-1"], ["departments", "dep-1"], ["org_people", "u-cv"], ["cost_visibility", "cv-b"]]) {
      const h = await head(kind, id)
      expect([kind, Number(h?.version), h?.project_id]).toEqual([kind, 1, "__org__"])
    }
    expect((await items("u-mem", "vendors")).find((i) => i.id === "ven-1")!.version).toBe(1)
  })

  test("insert, update and delete are version 1, 2 and a tombstone in the organisation's feed; B's feed and a viewer's feed never carry them", async () => {
    const before = (await feed("u-mem", null)).data!.head_seq as number
    await db.exec(`insert into compliance.erp_suppliers (id, org_id, supplier_name) values ('ven-new', 'org-a', 'New Steel')`)
    await db.exec(`update compliance.erp_suppliers set supplier_name = 'New Steel Ltd' where id = 'ven-new'`)
    await db.exec(`delete from compliance.erp_suppliers where id = 'ven-new'`)
    await db.exec(`update compliance.construction_boq_categories set name = 'Civil works' where id = 'cat-1'`)
    const r = await feed("u-mem", before)
    expect((r.data!.changes as J[]).map((c) => [c.kind, c.id, Number(c.version), c.op])).toEqual([
      ["vendors", "ven-new", 1, "I"], ["vendors", "ven-new", 2, "U"], ["vendors", "ven-new", 3, "D"], ["boq_categories", "cat-1", 2, "U"],
    ])
    expect((await head("vendors", "ven-new")).deleted).toBe(true)
    const b = await feed("u-b", 0)
    expect(JSON.stringify(b.data)).not.toContain("ven-new")
    expect(JSON.stringify(b.data)).not.toContain("cat-1")
    const v = await feed("u-view", before)
    expect((v.data!.changes as J[]).map((c) => c.kind)).toEqual([]) // a viewer's feed has only cost_visibility
    // the project feed is not the organisation feed: '__org__' is not a project anyone may bind
    expect((await call("projexa_sync_changes", { ...who("u-mem"), p_project_id: "__org__", p_after_seq: 0, p_limit: 10 })).code).toBe("AW404")
  })

  test("a viewer's feed carries cost_visibility changes", async () => {
    const before = (await feed("u-view", null)).data!.head_seq as number
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = true where id = 'cv3'`)
    const r = await feed("u-view", before)
    expect((r.data!.changes as J[]).map((c) => [c.kind, c.id, c.op])).toEqual([["cost_visibility", "cv3", "U"]])
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = false where id = 'cv3'`)
  })

  test("a login, a password or passcode change is NOT a new version of a person; a change of name is", async () => {
    const v0 = Number((await head("org_people", "u-cv")).version)
    await db.exec(`update compliance.users set last_login_at = now(), password_hash = 'SECRET-other', passcode_hash = 'SECRET-p2', updated_at = now() where id = 'u-cv'`)
    expect(Number((await head("org_people", "u-cv")).version)).toBe(v0)
    await db.exec(`update compliance.users set name = 'Cleo Client-Smith' where id = 'u-cv'`)
    expect(Number((await head("org_people", "u-cv")).version)).toBe(v0 + 1)
  })

  test("a project-kind row still files under its project (0683's behaviour is kept)", async () => {
    await db.exec(`insert into compliance.construction_labour_roster (id, org_id, project_id, name, trade) values ('ro-x', 'org-a', 'proj-a', 'Ravi', 'mason')`)
    expect((await head("roster", "ro-x")).project_id).toBe("proj-a")
    // a vendor that names a project is still an organisation master, never filed under the project
    await db.exec(`insert into compliance.erp_suppliers (id, org_id, supplier_name, project_id) values ('ven-proj', 'org-a', 'Site vendor', 'proj-a')`)
    expect((await head("vendors", "ven-proj")).project_id).toBe("__org__")
    await db.exec(`delete from compliance.erp_suppliers where id = 'ven-proj'`)
  })
})

describe("id inventory and exact ids", () => {
  test("the inventory lists exactly the organisation's ids, pages by id, and B's person never gets A's", async () => {
    for (const kind of ORG_KINDS) {
      const r = await inventory("u-mem", kind)
      expect([kind, r.code, r.data!.ids]).toEqual([kind, null, OWN_A[kind]])
    }
    const p1 = await inventory("u-mem", "org_people", null, 3)
    expect(p1.data!.ids).toEqual(OWN_A.org_people.slice(0, 3))
    expect(p1.data!.has_more).toBe(true)
    const p2 = await inventory("u-mem", "org_people", p1.data!.next_id, 5000)
    expect(p2.data!.ids).toEqual(OWN_A.org_people.slice(3))
    expect((await inventory("u-b", "vendors")).data!.ids).toEqual(["SECRET-ven-b"])
  })

  test("exact ids: an id of another organisation is simply absent; rows have the same allow-list and redaction", async () => {
    const r = await call("projexa_sync_org_pull_ids", { ...who("u-mem"), p_kind: "vendors", p_ids: ["ven-1", "SECRET-ven-b", "nope"] })
    expect((r.data!.items as J[]).map((i) => i.id)).toEqual(["ven-1"])
    expect((r.data!.items as J[])[0].data.credit_limit).toBeNull()
    expect(JSON.stringify(r.data)).not.toContain("SECRET")
    expect((await call("projexa_sync_org_pull_ids", { ...who("u-b"), p_kind: "departments", p_ids: ["dep-1"] })).data!.items).toEqual([])
  })
})

describe("grants", () => {
  test("the entry points are executable by service_role only; the helpers by nobody", async () => {
    const can = async (role: string, fn: string) => (await db.query<J>(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).rows[0].ok
    for (const fn of ["public.projexa_sync_org_pull(text,text,text,text,text,integer)", "public.projexa_sync_org_ids(text,text,text,text,integer)", "public.projexa_sync_org_pull_ids(text,text,text,text[])", "public.projexa_sync_org_changes(text,text,bigint,integer)"]) {
      expect([fn, await can("service_role", fn), await can("anon", fn), await can("authenticated", fn), await can("app_runtime", fn)]).toEqual([fn, true, false, false, false])
    }
    for (const fn of ["public.projexa_sync__org_src(text)", "public.projexa_sync__org_items(text,text,text,text[],jsonb)", "public.projexa_sync__org_row_sql(text,text[])"]) {
      expect([fn, await can("service_role", fn), await can("anon", fn)]).toEqual([fn, false, false])
    }
  })
})

describe("reversible", () => {
  test("the down file removes the triggers and functions and restores the 0678 manifest; the forward file applies twice", async () => {
    await db.exec(downSql("0684_projexa_sync_org_masters"))
    const trig = async () => Number((await db.query<J>(`select count(*) n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where t.tgname = 'projexa_track_change' and n.nspname = 'compliance' and c.relname in ('erp_suppliers','erp_customers','erp_companies','construction_boq_categories','erp_currencies','erp_exchange_rates','departments','users','cost_visibility_config')`)).rows[0].n)
    expect(await trig()).toBe(0)
    expect((await db.query<J>(`select to_regprocedure('public.projexa_sync_org_pull(text,text,text,text,text,integer)') p`)).rows[0].p).toBeNull()
    const m = (await call("projexa_sync_manifest", who("u-mem"))).data!
    expect(m.org_kinds).toBeUndefined()
    expect((m.kinds as J[]).length).toBe(28)
    // a project kind still tracks after the rollback (0683's function is back)
    await db.exec(`update compliance.construction_labour_roster set trade = 'tiler' where id = 'ro-x'`)
    expect(Number((await db.query<J>(`select version from platform.projexa_record_head where kind = 'roster' and record_id = 'ro-x'`)).rows[0].version)).toBe(2)

    await db.exec(forwardSql("0684_projexa_sync_org_masters"))
    await db.exec(forwardSql("0684_projexa_sync_org_masters"))
    expect(await trig()).toBe(9)
    expect(await idsOf("u-mem", "vendors")).toEqual(OWN_A.vendors)
    expect(((await call("projexa_sync_manifest", who("u-mem"))).data!.org_kinds as J[]).length).toBe(9)
  })
})
