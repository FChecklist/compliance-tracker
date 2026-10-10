/// <reference types="bun-types" />
// PROJEXA SYNC: drizzle/0691_projexa_sync_erp_hr_kinds.sql on PGlite (real Postgres as WASM, built the way the live database is: 0684 first, then the 18 tables, then 0691).
// 18 more ORGANISATION kinds (inventory, finance, procurement, sales, interior, knowledge base, employees), 27 in all. Proven here:
//   * the list:        the Edge ORG_KINDS equals the SQL list, in order, and is disjoint from the 28 project kinds; the 9 kinds of 0684 are untouched
//   * role gate:       a viewer gets the one 404 for every new kind; a member for every kind but `budgets` (rank 3); a manager / senior get budgets
//   * redaction:       money is NULL for a member, NULL for a senior who the organisation does not let see cost (the STRICT kinds), filled for a manager who may;
//                      0684's older rule (vendors.credit_limit visible to that senior) is unchanged
//   * isolation:       organisation A's person gets exactly A's rows, organisation B's person only B's, for every new kind
//   * private project: a row of a PRIVATE project never leaves, for any role (pull, exact ids, id inventory); a row with no project does
//   * columns:         explicit allow-list; creator ids, irn, date of birth, emergency contact, tax slab never leave
//   * versions:        a write is a version in the organisation's feed ('__org__'), never in another organisation's
//   * reversible:      the down file restores the 9-kind list and 0684's rule; the forward file applies twice
// Run: bun test --isolate src/lib/services/projexa-sync-erp-hr-kinds.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { ORG_KINDS as EDGE_ORG_KINDS, SYNC_KINDS, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import type { J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"
import { build, ORG_KINDS as OLD_KINDS, SUBS } from "./__test-helpers__/projexa-org-fixture"

setDefaultTimeout(240_000)

type Spec = { kind: string; table: string; allowed: string[]; money: string[]; strict: boolean; project: boolean; minRank: number }
const col = (s: string) => s.split(" ")
const NEW: Spec[] = [
  { kind: "warehouses", table: "erp_warehouses", allowed: col("id warehouse_name parent_warehouse_id is_group address created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "item_groups", table: "erp_item_groups", allowed: col("id group_name parent_group_id created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "stock_items", table: "erp_items", allowed: col("id item_code item_name item_group_id uom is_stock_item is_sales_item is_purchase_item standard_selling_rate standard_buying_rate is_active has_batch_no has_serial_no hsn_sac_code created_at updated_at"), money: col("standard_selling_rate standard_buying_rate"), strict: true, project: false, minRank: 2 },
  { kind: "stock_entries", table: "erp_stock_ledger_entries", allowed: col("id item_id warehouse_id posting_date voucher_type voucher_id quantity_change valuation_rate balance_qty balance_value transaction_uom transaction_qty batch_id serial_id project_id created_at"), money: col("valuation_rate balance_value"), strict: true, project: true, minRank: 2 },
  { kind: "accounts", table: "erp_accounts", allowed: col("id account_name account_number parent_account_id root_type account_type is_group currency_id is_frozen created_at updated_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "fiscal_years", table: "erp_fiscal_years", allowed: col("id year_name start_date end_date is_closed created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "budgets", table: "erp_budgets", allowed: col("id fiscal_year_id company_id cost_center_id name action_if_exceeded status submitted_at created_at updated_at"), money: [], strict: false, project: false, minRank: 3 },
  { kind: "purchase_orders", table: "erp_purchase_orders", allowed: col("id supplier_id po_number order_date expected_delivery_date status grand_total currency_id exchange_rate company_id project_id created_at updated_at"), money: ["grand_total"], strict: true, project: true, minRank: 2 },
  { kind: "goods_receipts", table: "erp_purchase_receipts", allowed: col("id supplier_id purchase_order_id receipt_number posting_date status putaway_status created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "requisitions", table: "erp_purchase_requisitions", allowed: col("id requisition_number department_id purpose posting_date status created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "rfqs", table: "erp_rfqs", allowed: col("id rfq_number requisition_id posting_date status created_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "quotations", table: "erp_quotations", allowed: col("id customer_id quotation_number quotation_date valid_till status grand_total version revision_of project_id currency_id exchange_rate company_id created_at"), money: ["grand_total"], strict: true, project: true, minRank: 2 },
  { kind: "sales_orders", table: "erp_sales_orders", allowed: col("id customer_id opportunity_id quotation_id so_number order_date delivery_date status grand_total project_id currency_id exchange_rate company_id created_at updated_at"), money: ["grand_total"], strict: true, project: true, minRank: 2 },
  { kind: "invoices", table: "erp_sales_invoices", allowed: col("id client_id customer_id invoice_number posting_date due_date currency_id subtotal tax_amount grand_total outstanding_amount status sales_order_id exchange_rate company_id project_id e_invoice_status created_at updated_at"), money: col("subtotal tax_amount grand_total outstanding_amount"), strict: true, project: true, minRank: 2 },
  { kind: "floor_plans", table: "interior_floor_plans", allowed: col("id project_id name floor_level status created_at"), money: [], strict: false, project: true, minRank: 2 },
  { kind: "mood_boards", table: "interior_mood_boards", allowed: col("id project_id room_or_area title description status created_at"), money: [], strict: false, project: true, minRank: 2 },
  { kind: "knowledge_base", table: "knowledge_base_pages", allowed: col("id parent_page_id slug title content version is_archived is_published created_at updated_at"), money: [], strict: false, project: false, minRank: 2 },
  { kind: "employees", table: "employee_profiles", allowed: col("id user_id employee_code job_title employment_type date_of_joining employment_status company_id created_at updated_at"), money: [], strict: false, project: false, minRank: 2 },
]
const ALL_KINDS = [...OLD_KINDS, ...NEW.map((s) => s.kind)]
const RANK2_NEW = NEW.filter((s) => s.minRank === 2)

// the 18 tables as schema.ts declares them (columns the allow-list names plus the ones that must NEVER leave); every column but id / org_id is nullable so a row names only what it needs
const TABLES = `
create table if not exists compliance.erp_warehouses (id text primary key, org_id text not null, warehouse_name text, parent_warehouse_id text, is_group boolean not null default false, address text, created_at timestamp not null default now());
create table if not exists compliance.erp_item_groups (id text primary key, org_id text not null, group_name text, parent_group_id text, created_at timestamp not null default now());
create table if not exists compliance.erp_items (id text primary key, org_id text not null, item_code text, item_name text, item_group_id text, uom text, is_stock_item boolean not null default true, is_sales_item boolean not null default true, is_purchase_item boolean not null default true, standard_selling_rate numeric, standard_buying_rate numeric, is_active boolean not null default true, created_at timestamp not null default now(), updated_at timestamp not null default now(), has_batch_no boolean not null default false, has_serial_no boolean not null default false, hsn_sac_code text);
create table if not exists compliance.erp_stock_ledger_entries (id text primary key, org_id text not null, item_id text, warehouse_id text, posting_date date, voucher_type text, voucher_id text, quantity_change numeric, valuation_rate numeric, balance_qty numeric, balance_value numeric, created_at timestamp not null default now(), transaction_uom text, transaction_qty numeric, batch_id text, serial_id text, project_id text);
create table if not exists compliance.erp_accounts (id text primary key, org_id text not null, account_name text, account_number text, parent_account_id text, root_type text, account_type text, is_group boolean not null default false, currency_id text, is_frozen boolean not null default false, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists compliance.erp_fiscal_years (id text primary key, org_id text not null, year_name text, start_date date, end_date date, is_closed boolean not null default false, created_at timestamp not null default now());
create table if not exists compliance.erp_budgets (id text primary key, org_id text not null, fiscal_year_id text, company_id text, cost_center_id text, name text, action_if_exceeded text, status text, created_by_id text, submitted_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists compliance.erp_purchase_orders (id text primary key, org_id text not null, supplier_id text, po_number integer, order_date date, expected_delivery_date date, status text, grand_total numeric, created_by_id text, created_at timestamp not null default now(), updated_at timestamp not null default now(), currency_id text, exchange_rate numeric, company_id text, project_id text);
create table if not exists compliance.erp_purchase_receipts (id text primary key, org_id text not null, supplier_id text, purchase_order_id text, receipt_number integer, posting_date date, status text, created_by_id text, created_at timestamp not null default now(), putaway_status text);
create table if not exists compliance.erp_purchase_requisitions (id text primary key, org_id text not null, requisition_number integer, requested_by_id text, department_id text, purpose text, posting_date date, status text, created_at timestamp not null default now());
create table if not exists compliance.erp_rfqs (id text primary key, org_id text not null, rfq_number integer, requisition_id text, posting_date date, status text, created_by_id text, created_at timestamp not null default now());
create table if not exists compliance.erp_quotations (id text primary key, org_id text not null, customer_id text, lead_id text, quotation_number integer, quotation_date date, valid_till date, status text, grand_total numeric, created_by_id text, created_at timestamp not null default now(), version integer not null default 1, revision_of text, project_id text, currency_id text, exchange_rate numeric, company_id text);
create table if not exists compliance.erp_sales_orders (id text primary key, org_id text not null, customer_id text, opportunity_id text, quotation_id text, so_number integer, order_date date, delivery_date date, status text, grand_total numeric, created_by_id text, created_at timestamp not null default now(), updated_at timestamp not null default now(), project_id text, currency_id text, exchange_rate numeric, company_id text);
create table if not exists compliance.erp_sales_invoices (id text primary key, org_id text not null, client_id text, customer_id text, invoice_number integer, posting_date date, due_date date, currency_id text, subtotal numeric, tax_amount numeric, grand_total numeric, outstanding_amount numeric, status text, journal_entry_id text, sales_order_id text, created_by_id text, created_at timestamp not null default now(), updated_at timestamp not null default now(), exchange_rate numeric, company_id text, irn text, e_invoice_status text, project_id text, dunning_level integer not null default 0);
create table if not exists compliance.interior_floor_plans (id text primary key, org_id text not null, project_id text, name text, floor_level text, status text, created_by_id text, created_at timestamp not null default now());
create table if not exists compliance.interior_mood_boards (id text primary key, org_id text not null, project_id text, room_or_area text, title text, description text, status text, created_by_id text, created_at timestamp not null default now());
create table if not exists compliance.knowledge_base_pages (id text primary key, org_id text not null, parent_page_id text, slug text, title text, content text, version integer not null default 1, updated_by_id text, is_archived boolean not null default false, is_published boolean not null default true, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists compliance.employee_profiles (id text primary key, user_id text, org_id text not null, employee_code text, job_title text, employment_type text, date_of_joining date, date_of_birth date, created_at timestamp not null default now(), updated_at timestamp not null default now(), income_tax_slab_id text, employment_status text, emergency_contact_name text, emergency_contact_phone text, company_id text);
`
// what must never leave, per column name, for any role
const SECRETS: Record<string, string> = {
  created_by_id: "SECRET-creator", updated_by_id: "SECRET-updater", requested_by_id: "SECRET-requester", lead_id: "SECRET-lead", journal_entry_id: "SECRET-je", irn: "SECRET-irn",
  date_of_birth: "1990-01-01", emergency_contact_name: "SECRET-emergency", emergency_contact_phone: "SECRET-phone", income_tax_slab_id: "SECRET-slab",
}
const OWN: Record<string, string[]> = {} // organisation A's expected ids per new kind (sorted)
const rowsSql: string[] = []
for (const s of NEW) {
  const secrets = Object.fromEntries(Object.entries(SECRETS).filter(([c]) => TABLES.split("\n").find((l) => l.includes(`compliance.${s.table} `))!.includes(` ${c} `)))
  const money = Object.fromEntries(s.money.map((m, i) => [m, 100 + i]))
  const a = (n: number, over: Record<string, string | number | boolean | null> = {}) => ({ id: `${s.kind}-${n}`, org_id: "org-a", ...money, ...secrets, ...over })
  const rows: Array<Record<string, string | number | boolean | null>> = [a(1), a(2), a(3)]
  if (s.project) {
    rows[0].project_id = null // no project: always visible
    rows[1].project_id = "proj-priv" // PRIVATE project: never leaves
    rows[2].project_id = "proj-a" // public project
    OWN[s.kind] = [`${s.kind}-1`, `${s.kind}-3`]
  } else OWN[s.kind] = [`${s.kind}-1`, `${s.kind}-2`, `${s.kind}-3`]
  if (s.kind === "knowledge_base") {
    rows[0].is_published = true
    rows[1].is_archived = true // archived: never leaves
    rows[2].is_published = false // draft: never leaves
    OWN[s.kind] = ["knowledge_base-1"]
  }
  rows.push({ id: `SECRET-${s.kind}-b`, org_id: "org-b", ...money, ...(s.project ? { project_id: "proj-b" } : {}) })
  rowsSql.push(insert(s.table, rows as never))
}

let db: PGlite
let rpc: Rpc
type R = { data: J | null; code: string | null }
async function call(fn: string, args: Record<string, unknown>): Promise<R> {
  const r = await rpc(fn, args)
  return { data: (r.data as J) ?? null, code: r.error?.code ?? (r.error ? "ERR:" + r.error.message : null) }
}
const SUB_OF: Record<string, string> = { ...SUBS, "u-sen": "55555555-5555-4555-8555-555555555555" } // the senior is not in the shared fixture's list
const who = (u: string) => ({ p_sub: SUB_OF[u], p_email: null })
const pull = (u: string, kind: string, limit = 200) => call("projexa_sync_org_pull", { ...who(u), p_kind: kind, p_after_ts: null, p_after_id: null, p_limit: limit })
const items = async (u: string, kind: string) => ((await pull(u, kind)).data?.items ?? []) as J[]
const idsOf = async (u: string, kind: string) => (await items(u, kind)).map((i) => i.id as string).sort()
const inventory = (u: string, kind: string) => call("projexa_sync_org_ids", { ...who(u), p_kind: kind, p_after_id: null, p_limit: 5000 })
const feed = (u: string, after: number | null) => call("projexa_sync_org_changes", { ...who(u), p_after_seq: after, p_limit: 1000 })

beforeAll(async () => {
  db = await build() // 0618, 0677 .. 0679, 0683, the 9 master tables, 0684, their rows
  await db.exec(TABLES)
  await db.exec(forwardSql("0691_projexa_sync_erp_hr_kinds"))
  await db.exec(rowsSql.join("\n"))
  rpc = pgRpc(db)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the list and the manifest", () => {
  test("27 organisation kinds: the 9 of 0684 first and unchanged, then the 18; the Edge list is the SQL list; disjoint from the 28 project kinds", async () => {
    const sql = (await db.query<J>(`select unnest(public.projexa_sync__org_kinds()) k`)).rows.map((r) => r.k)
    expect(sql).toEqual(ALL_KINDS)
    expect(sql.length).toBe(27)
    expect([...EDGE_ORG_KINDS]).toEqual(sql)
    for (const k of EDGE_ORG_KINDS) expect((SYNC_KINDS as readonly string[]).includes(k)).toBe(false)
    expect((await db.query<J>(`select cardinality(public.projexa_sync__kinds()) n`)).rows[0].n).toBe(28)
  })

  test("manifest: a member lists 26 (not budgets), a senior all 27, a viewer only cost_visibility", async () => {
    const kinds = async (u: string) => (((await call("projexa_sync_manifest", who(u))).data!.org_kinds as J[]) ?? []).map((k) => k.kind)
    expect(await kinds("u-mem")).toEqual(ALL_KINDS.filter((k) => k !== "budgets"))
    expect(await kinds("u-sen")).toEqual(ALL_KINDS)
    expect(await kinds("u-view")).toEqual(["cost_visibility"])
    expect(await kinds("u-cv")).toEqual(["cost_visibility"])
  })

  test("org_view_class differs between a senior without cost visibility and a manager with it (money visibility is part of the class)", async () => {
    const c = async (u: string) => (await call("projexa_sync_manifest", who(u))).data!.org_view_class
    expect(await c("u-sen")).not.toBe(await c("u-mgr"))
    expect(await c("u-mem")).not.toBe(await c("u-sen"))
  })
})

describe("role gate", () => {
  test("a viewer / client_viewer gets the one 404 for every new kind (pull, ids, exact ids)", async () => {
    for (const u of ["u-view", "u-cv"]) for (const s of NEW) {
      expect([u, s.kind, (await pull(u, s.kind)).code]).toEqual([u, s.kind, "AW404"])
      expect([u, s.kind, (await inventory(u, s.kind)).code]).toEqual([u, s.kind, "AW404"])
      expect([u, s.kind, (await call("projexa_sync_org_pull_ids", { ...who(u), p_kind: s.kind, p_ids: [`${s.kind}-1`] })).code]).toEqual([u, s.kind, "AW404"])
    }
  })

  test("a member gets every new kind but budgets (the 404); a senior and a manager get budgets", async () => {
    for (const s of RANK2_NEW) expect([s.kind, (await pull("u-mem", s.kind)).code]).toEqual([s.kind, null])
    expect((await pull("u-mem", "budgets")).code).toBe("AW404")
    expect((await inventory("u-mem", "budgets")).code).toBe("AW404")
    for (const u of ["u-sen", "u-mgr", "u-adm"]) expect([u, await idsOf(u, "budgets")]).toEqual([u, OWN.budgets])
  })

  test("an unresolved person gets a status and no data", async () => {
    const r = await call("projexa_sync_org_pull", { p_sub: "99999999-9999-4999-8999-999999999999", p_email: null, p_kind: "invoices", p_after_ts: null, p_after_id: null, p_limit: 10 })
    expect(r.data!.status).not.toBe("ok")
    expect(r.data!.items).toBeUndefined()
  })
})

describe("isolation and private projects", () => {
  for (const s of NEW) {
    test(`${s.kind}: A's person gets exactly A's visible rows; B's person only B's; no SECRET value leaves`, async () => {
      const who2 = s.minRank === 2 ? "u-mem" : "u-sen"
      expect(await idsOf(who2, s.kind)).toEqual(OWN[s.kind])
      expect(JSON.stringify((await pull(who2, s.kind)).data)).not.toContain("SECRET")
      const b = await idsOf("u-b", s.kind)
      expect(b).toEqual([`SECRET-${s.kind}-b`])
      for (const id of OWN[s.kind]) expect(b).not.toContain(id)
    })
  }

  test("a row of a PRIVATE project never leaves, for any role, by any entry point; admin and the project's lead included", async () => {
    for (const s of NEW.filter((x) => x.project)) {
      const priv = `${s.kind}-2`
      for (const u of ["u-mem", "u-sen", "u-mgr", "u-adm"]) {
        expect([u, s.kind, await idsOf(u, s.kind)]).toEqual([u, s.kind, OWN[s.kind]])
        expect([u, s.kind, (await inventory(u, s.kind)).data!.ids]).toEqual([u, s.kind, OWN[s.kind]])
        const ex = await call("projexa_sync_org_pull_ids", { ...who(u), p_kind: s.kind, p_ids: [priv, OWN[s.kind][0]] })
        expect([u, s.kind, (ex.data!.items as J[]).map((i) => i.id)]).toEqual([u, s.kind, [OWN[s.kind][0]]])
      }
    }
  })

  test("archived and draft knowledge-base pages never leave", async () => {
    expect(await idsOf("u-mem", "knowledge_base")).toEqual(["knowledge_base-1"])
    expect(JSON.stringify((await pull("u-adm", "knowledge_base")).data)).not.toContain("knowledge_base-2")
  })
})

describe("column allow-list", () => {
  for (const s of NEW) {
    test(`${s.kind}: every row carries exactly the allow-listed columns`, async () => {
      const rows = await items(s.minRank === 2 ? "u-mgr" : "u-sen", s.kind)
      expect(rows.length).toBeGreaterThan(0)
      for (const it of rows) expect([s.kind, Object.keys(it.data).sort()]).toEqual([s.kind, [...s.allowed].sort()])
    })
  }

  test("creator ids, irn, journal entry, date of birth, emergency contact and tax slab never leave, for any role", async () => {
    for (const u of ["u-mem", "u-sen", "u-mgr", "u-adm"]) for (const s of NEW) {
      if (s.minRank === 3 && u === "u-mem") continue
      const text = JSON.stringify((await pull(u, s.kind)).data)
      for (const bad of [...Object.values(SECRETS), "created_by_id", "date_of_birth", "emergency", "income_tax", "irn", "journal_entry_id", "requested_by_id", "lead_id"]) expect([u, s.kind, bad, text.includes(bad)]).toEqual([u, s.kind, bad, false])
    }
  })
})

describe("money by role", () => {
  const MONEY = NEW.filter((s) => s.money.length > 0)
  test("a member gets every money column NULL and the page says which", async () => {
    for (const s of MONEY) {
      const r = await pull("u-mem", s.kind)
      expect([s.kind, r.data!.hidden_fields]).toEqual([s.kind, s.money])
      expect(r.data!.redacted).toBe(true)
      for (const it of r.data!.items as J[]) for (const m of s.money) expect([s.kind, m, it.data[m]]).toEqual([s.kind, m, null])
    }
  })

  test("STRICT: a senior (rank 3) whom the organisation does not let see cost gets money NULL; a manager who may gets the values", async () => {
    for (const s of MONEY) {
      const sen = await pull("u-sen", s.kind)
      const mgr = await pull("u-mgr", s.kind)
      expect([s.kind, "senior", sen.data!.hidden_fields]).toEqual([s.kind, "senior", s.money])
      expect([s.kind, "manager", mgr.data!.hidden_fields]).toEqual([s.kind, "manager", []])
      for (const it of sen.data!.items as J[]) for (const m of s.money) expect([s.kind, m, it.data[m]]).toEqual([s.kind, m, null])
      for (const it of mgr.data!.items as J[]) s.money.forEach((m, i) => expect([s.kind, m, Number(it.data[m])]).toEqual([s.kind, m, 100 + i]))
    }
  })

  test("the exact-ids mode redacts the same way, and flipping the organisation's cost setting changes what a senior gets", async () => {
    const ex = async (u: string) => (await call("projexa_sync_org_pull_ids", { ...who(u), p_kind: "invoices", p_ids: ["invoices-1"] })).data!.items as J[]
    expect((await ex("u-sen"))[0].data.grand_total).toBeNull()
    expect((await ex("u-mem"))[0].data.outstanding_amount).toBeNull()
    expect(Number((await ex("u-mgr"))[0].data.grand_total)).toBe(102)
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = true where id = 'cv3'`)
    expect(Number((await ex("u-sen"))[0].data.grand_total)).toBe(102)
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = false where id = 'cv3'`)
    expect((await ex("u-sen"))[0].data.grand_total).toBeNull()
  })

  test("0684's rule for the old kinds is unchanged: the same senior still sees vendors.credit_limit (it is not a strict kind)", async () => {
    const r = await pull("u-sen", "vendors")
    expect(r.data!.hidden_fields).toEqual([])
    expect(Number((r.data!.items as J[]).find((i) => i.id === "ven-1")!.data.credit_limit)).toBe(500000)
    expect((await pull("u-mem", "vendors")).data!.hidden_fields).toEqual(["credit_limit"])
  })
})

describe("versions of the new kinds", () => {
  const head = async (kind: string, id: string) => (await db.query<J>(`select version, project_id, deleted from platform.projexa_record_head where kind = '${kind}' and record_id = '${id}'`)).rows[0]
  test("rows written after 0691 are version 1 under the organisation sentinel; an update is version 2, a delete a tombstone; B's feed never carries them", async () => {
    for (const s of NEW) {
      const h = await head(s.kind, `${s.kind}-1`)
      expect([s.kind, Number(h?.version), h?.project_id]).toEqual([s.kind, 1, "__org__"])
    }
    const before = (await feed("u-mem", null)).data!.head_seq as number
    await db.exec(`update compliance.erp_warehouses set warehouse_name = 'Main store' where id = 'warehouses-1'`)
    await db.exec(`delete from compliance.erp_rfqs where id = 'rfqs-2'`)
    const r = await feed("u-mem", before)
    expect((r.data!.changes as J[]).map((c) => [c.kind, c.id, Number(c.version), c.op]).sort()).toEqual([["rfqs", "rfqs-2", 2, "D"], ["warehouses", "warehouses-1", 2, "U"]].sort())
    expect(JSON.stringify((await feed("u-b", 0)).data)).not.toContain("warehouses-1")
    expect((await feed("u-view", before)).data!.changes).toEqual([]) // a viewer's feed has only cost_visibility
  })

  test("an employee's date-of-birth change is not a visible change of the allow-list but a name/title change is a new version", async () => {
    const v0 = Number((await head("employees", "employees-1")).version)
    await db.exec(`update compliance.employee_profiles set date_of_birth = '1991-02-02', emergency_contact_name = 'SECRET-x2' where id = 'employees-1'`)
    expect(Number((await head("employees", "employees-1")).version)).toBe(v0)
    await db.exec(`update compliance.employee_profiles set job_title = 'Site Engineer' where id = 'employees-1'`)
    expect(Number((await head("employees", "employees-1")).version)).toBe(v0 + 1)
  })
})

describe("grants", () => {
  test("the new helper and the replaced ones are executable by nobody", async () => {
    const can = async (role: string, fn: string) => (await db.query<J>(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).rows[0].ok
    for (const fn of ["public.projexa_sync__org_strict_money(text)", "public.projexa_sync__org_src(text)", "public.projexa_sync__org_kinds()", "public.projexa_sync__org_hidden_cols(text,text,text)"]) {
      expect([fn, await can("service_role", fn), await can("anon", fn), await can("authenticated", fn), await can("app_runtime", fn)]).toEqual([fn, false, false, false, false])
    }
  })
})

describe("reversible", () => {
  test("the down file removes the 18 triggers and restores the 9-kind list and 0684's rule; the forward file applies twice", async () => {
    const tables = NEW.map((s) => `'${s.table}'`).join(",")
    const trig = async () => Number((await db.query<J>(`select count(*) n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where t.tgname in ('projexa_track_i', 'projexa_track_u', 'projexa_track_d') and n.nspname = 'compliance' and c.relname in (${tables})`)).rows[0].n)
    expect(await trig()).toBe(54)
    await db.exec(downSql("0691_projexa_sync_erp_hr_kinds"))
    expect(await trig()).toBe(0)
    expect((await db.query<J>(`select unnest(public.projexa_sync__org_kinds()) k`)).rows.map((r) => r.k)).toEqual([...OLD_KINDS])
    expect((await db.query<J>(`select to_regprocedure('public.projexa_sync__org_strict_money(text)') p`)).rows[0].p).toBeNull()
    expect((await pull("u-mem", "invoices")).code).toBe("AW404")
    expect((await pull("u-sen", "vendors")).data!.hidden_fields).toEqual([])
    await db.exec(forwardSql("0691_projexa_sync_erp_hr_kinds"))
    await db.exec(forwardSql("0691_projexa_sync_erp_hr_kinds"))
    expect(await trig()).toBe(54)
    expect(await idsOf("u-mem", "invoices")).toEqual(OWN.invoices)
  })
})
