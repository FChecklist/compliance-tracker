/// <reference types="bun-types" />
// PROJEXA SYNC: drizzle/0683_projexa_sync_more_kinds.sql on PGlite (real Postgres as WASM, built the way the live database is) and the REAL Edge handler. The sync widens from 13 to 28 project kinds.
//   * the list:      the SQL list (projexa_sync__kinds) and the Edge list (SYNC_KINDS) are the SAME 28, in the same order, and the manifest lists them all
//   * isolation:     for every new kind, a person of the project gets exactly the project's rows: another project of the same organisation, another organisation and a row of another
//                    organisation that names this project are never returned; another organisation's person gets the one 404
//   * role:          money, wage and rate columns arrive NULL for a member and filled for a manager (the AI link's own redaction, byte for byte)
//   * versions:      every new kind's rows get a version and history from the first write; a time entry is filed under its issue's project; a MoM only when it is about a project
//   * reversible:    the down file returns to the 13 kinds and removes the 15 triggers; the forward file applies twice
// Run: bun test --isolate src/lib/services/projexa-sync-more-kinds.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, SYNC_KINDS, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { A2, B, BW, S, insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(240_000)

const SUBS: Record<string, string> = { "u-mgr": "11111111-1111-4111-8111-111111111111", "u-mem": "22222222-2222-4222-8222-222222222222", "u-b": "44444444-4444-4444-8444-444444444444" }
const NOW = new Date("2026-10-02T00:00:00Z")
const NEW_KINDS = ["roster", "attendance", "timesheets", "meetings", "meeting_minutes", "site_diaries", "site_instructions", "progress_claims", "interim_bills", "material_receipts", "material_issues", "expenses", "schedule_baselines", "ffe_items", "wiki_pages"] as const

let db: PGlite
let rpc: Rpc
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function hit(user: string, path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${SUBS[user]}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW })
  return { status: res.status, json: (await res.json()) as J }
}
const pull = (user: string, kind: string, project = "proj-a") => hit(user, "pull", { project_id: project, kind, after: null, limit: 200 })
const idsOf = async (user: string, kind: string, project = "proj-a") => ((await pull(user, kind, project)).json.items as J[]).map((i) => i.id as string).sort()

/** The rows of the project, and the decoys: another project of the same organisation (A2), another organisation (B) and a row of another organisation that names this project (BW). */
const FIXTURE = [
  insert("pms_issues", [
    { id: "iss-own", ...S(), type_id: "ty", status_id: "st", number: 1, title: "Own issue" },
    { id: "iss-a2", ...A2(), type_id: "ty", status_id: "st", number: 2, title: "Other project issue" },
  ]),
  insert("construction_labour_roster", [
    { id: "ro-1", ...S(), name: "Ram Singh", trade: "mason", skill_level: "skilled", employee_code: "E1", is_active: true, daily_rate: 900 },
    { id: "ro-2", ...S(), name: "Sita Devi", trade: "painter", skill_level: "helper", employee_code: "E2", is_active: true, daily_rate: 650 },
    { id: "SECRET-ro-a2", ...A2(), name: "SECRET", trade: "x", daily_rate: 1 },
    { id: "SECRET-ro-b", ...B(), name: "SECRET b", trade: "x", daily_rate: 1 },
    { id: "SECRET-ro-wo", ...BW(), name: "SECRET wrong org", trade: "x", daily_rate: 1 },
  ]),
  insert("construction_attendance", [
    { id: "at-1", ...S(), roster_id: "ro-1", attendance_date: "2026-09-01", status: "present", hours_worked: 8, daily_cost: 900 },
    { id: "at-2", ...S(), roster_id: "ro-2", attendance_date: "2026-09-01", status: "present", hours_worked: 8, daily_cost: 650 },
    { id: "SECRET-at-a2", ...A2(), roster_id: "SECRET-ro-a2", attendance_date: "2026-09-01", status: "present", daily_cost: 1 },
    { id: "SECRET-at-b", ...B(), roster_id: "SECRET-ro-b", attendance_date: "2026-09-01", status: "present", daily_cost: 1 },
    { id: "SECRET-at-wo", ...BW(), roster_id: "SECRET-ro-wo", attendance_date: "2026-09-01", status: "present", daily_cost: 1 },
  ]),
  insert("pms_time_entries", [
    { id: "te-1", org_id: "org-a", issue_id: "iss-own", user_id: "u-mem", hours: 2, spent_on: "2026-09-01", activity_type: "dev", billable: true, approval_status: "draft", hourly_rate_snapshot: 50 },
    { id: "SECRET-te-a2", org_id: "org-a", issue_id: "iss-a2", user_id: "u-mem", hours: 1, spent_on: "2026-09-01", activity_type: "dev", billable: true, approval_status: "draft", hourly_rate_snapshot: 50 },
  ]),
  insert("pms_meetings", [
    { id: "pmt-1", ...S(), title: "Weekly site", scheduled_at: "2026-09-10T09:00:00Z", duration_minutes: 60 },
    { id: "SECRET-pmt-a2", ...A2(), title: "SECRET", scheduled_at: "2026-09-10T09:00:00Z", duration_minutes: 30 },
    { id: "SECRET-pmt-b", ...B(), title: "SECRET b", scheduled_at: "2026-09-10T09:00:00Z", duration_minutes: 30 },
  ]),
  insert("veri_meetings", [
    { id: "vm-1", org_id: "org-a", context_entity_type: "project", context_entity_id: "proj-a", title: "Site coordination", meeting_type: "coordination", scheduled_at: "2026-09-10T09:00:00Z", attendees: JSON.stringify([{ name: "A", email: "a@x.example.test" }]), agenda: JSON.stringify(["Slab"]), minutes: "Pour on Friday", status: "published" },
    { id: "SECRET-vm-a2", org_id: "org-a", context_entity_type: "project", context_entity_id: "proj-a2", title: "SECRET", meeting_type: "x", scheduled_at: "2026-09-10T09:00:00Z", attendees: "[]", agenda: "[]", status: "draft" },
    { id: "SECRET-vm-kind", org_id: "org-a", context_entity_type: "compliance_item", context_entity_id: "proj-a", title: "SECRET other kind", meeting_type: "x", scheduled_at: "2026-09-10T09:00:00Z", attendees: "[]", agenda: "[]", status: "draft" },
    { id: "SECRET-vm-b", org_id: "org-b", context_entity_type: "project", context_entity_id: "proj-a", title: "SECRET org b", meeting_type: "x", scheduled_at: "2026-09-10T09:00:00Z", attendees: "[]", agenda: "[]", status: "draft" },
  ]),
  insert("construction_site_diaries", [
    { id: "sd-1", ...S(), diary_date: "2026-09-01", weather: "clear", work_done: "Excavation", recorded_by_id: "u-mem", labour_count: 12 },
    { id: "SECRET-sd-a2", ...A2(), diary_date: "2026-09-01", work_done: "SECRET", recorded_by_id: "u-mem" },
    { id: "SECRET-sd-wo", ...BW(), diary_date: "2026-09-09", work_done: "SECRET", recorded_by_id: "u-b" },
  ]),
  insert("construction_site_instructions", [
    { id: "si-1", ...S(), si_number: 1, issue_date: "2026-09-03", issued_by: "Architect", to_contractor: "Main contractor", description: "Change the skirting", cost_impact: true, time_impact: false },
    { id: "SECRET-si-a2", ...A2(), si_number: 1, issue_date: "2026-09-03", issued_by: "x", to_contractor: "x", description: "SECRET", cost_impact: false, time_impact: false },
    { id: "SECRET-si-wo", ...BW(), si_number: 9, issue_date: "2026-09-03", issued_by: "x", to_contractor: "x", description: "SECRET", cost_impact: false, time_impact: false },
  ]),
  insert("construction_boqs", [{ id: "boq-a1", org_id: "org-a", project_id: "proj-a", version: 1, title: "A original", created_by_id: "u-mgr" }]),
  insert("construction_interim_bills", [
    { id: "ib-1", ...S(), boq_id: "boq-a1", bill_number: 1, bill_date: "2026-09-05", retention_percent: 5, gross_amount: 100000, retention_amount: 5000, net_payable: 95000, sales_invoice_id: "inv-1", created_by_id: "u-mgr", retention_released_amount: 0 },
    { id: "SECRET-ib-a2", ...A2(), boq_id: "boq-a1", bill_number: 1, bill_date: "2026-09-05", gross_amount: 1, created_by_id: "u-mgr" },
    { id: "SECRET-ib-wo", ...BW(), boq_id: "boq-a1", bill_number: 9, bill_date: "2026-09-05", gross_amount: 1, created_by_id: "u-b" },
  ]),
  insert("construction_progress_claims", [
    { id: "pc-1", ...S(), boq_id: "boq-a1", customer_id: "cust-1", milestone_description: "Plinth done", scheduled_date: "2026-09-10", retention_percent: 5, status: "drafted", created_by_id: "u-mgr", interim_bill_id: "ib-1" },
    { id: "SECRET-pc-a2", ...A2(), boq_id: "boq-a1", customer_id: "c", milestone_description: "SECRET", scheduled_date: "2026-09-10", created_by_id: "u-mgr" },
    { id: "SECRET-pc-wo", ...BW(), boq_id: "boq-a1", customer_id: "c", milestone_description: "SECRET", scheduled_date: "2026-09-10", created_by_id: "u-b" },
  ]),
  insert("construction_materials", [
    { id: "mat-1", ...S(), name: "Cement", spec: "OPC 53", unit: "bag", unit_cost: 380, reorder_level: 50, is_active: true },
    { id: "SECRET-mat-a2", ...A2(), name: "SECRET material", unit: "kg", unit_cost: 1 },
  ]),
  insert("construction_material_receipts", [
    { id: "mr-1", ...S(), material_id: "mat-1", received_date: "2026-09-01", quantity: 100, unit_cost: 380, vendor_id: "v-9", reference: "GRN-1", created_by_id: "u-mem" },
    { id: "SECRET-mr-a2", ...A2(), material_id: "SECRET-mat-a2", received_date: "2026-09-01", quantity: 1, created_by_id: "u-mem" },
    { id: "SECRET-mr-wo", ...BW(), material_id: "SECRET-mat-a2", received_date: "2026-09-01", quantity: 1, created_by_id: "u-b" },
  ]),
  insert("construction_material_issues", [
    { id: "mi-1", ...S(), material_id: "mat-1", issued_date: "2026-09-03", quantity: 20, issued_to: "Mason gang", created_by_id: "u-mem" },
    { id: "SECRET-mi-a2", ...A2(), material_id: "SECRET-mat-a2", issued_date: "2026-09-03", quantity: 1, created_by_id: "u-mem" },
    { id: "SECRET-mi-wo", ...BW(), material_id: "SECRET-mat-a2", issued_date: "2026-09-03", quantity: 1, created_by_id: "u-b" },
  ]),
  insert("construction_expense_entries", [
    { id: "ex-1", ...S(), expense_head: "material", description: "Cement from V9, paid 38000", amount: 38000, expense_date: "2026-09-01", recorded_by_id: "u-mgr", is_rework: false },
    { id: "SECRET-ex-a2", ...A2(), expense_head: "material", amount: 1, expense_date: "2026-09-01", recorded_by_id: "u-mgr" },
    { id: "SECRET-ex-wo", ...BW(), expense_head: "material", amount: 1, expense_date: "2026-09-01", recorded_by_id: "u-b" },
  ]),
  insert("pms_schedule_baselines", [
    { id: "sb-1", ...S(), name: "Baseline 1", captured_by_id: "u-mgr" },
    { id: "SECRET-sb-a2", ...A2(), name: "SECRET baseline" },
    { id: "SECRET-sb-wo", ...BW(), name: "SECRET wrong org" },
  ]),
  insert("interior_ffe_items", [
    { id: "ff-1", ...S(), item_name: "Sofa", room_or_area: "Living", category: "furniture", unit_cost: 20000, unit_price: 26000, vendor_id: "v-3", sku: "SOF-1", quantity: 1, status: "specified", created_by_id: "u-mgr" },
    { id: "SECRET-ff-a2", ...A2(), item_name: "SECRET item", category: "fixture", unit_cost: 1, unit_price: 1, created_by_id: "u-mgr" },
    { id: "SECRET-ff-wo", ...BW(), item_name: "SECRET wrong org", category: "fixture", unit_cost: 1, unit_price: 1, created_by_id: "u-b" },
  ]),
  insert("pms_wiki_pages", [
    { id: "wk-1", ...S(), slug: "site-rules", title: "Site rules", content: "Helmets on", is_archived: false },
    { id: "SECRET-wk-arch", ...S(), slug: "old", title: "SECRET archived page", content: "SECRET", is_archived: true },
    { id: "SECRET-wk-a2", ...A2(), slug: "site-rules", title: "SECRET wiki other project", content: "SECRET", is_archived: false },
    { id: "SECRET-wk-wo", ...BW(), slug: "other", title: "SECRET wrong org", content: "SECRET", is_archived: false },
  ]),
].join("\n")

/** What the project's person must receive for each new kind (sorted ids). */
const OWN: Record<(typeof NEW_KINDS)[number], string[]> = {
  roster: ["ro-1", "ro-2"],
  attendance: ["at-1", "at-2"],
  timesheets: ["te-1"],
  meetings: ["pmt-1"],
  meeting_minutes: ["vm-1"],
  site_diaries: ["sd-1"],
  site_instructions: ["si-1"],
  progress_claims: ["pc-1"],
  interim_bills: ["ib-1"],
  material_receipts: ["mr-1"],
  material_issues: ["mi-1"],
  expenses: ["ex-1"],
  schedule_baselines: ["sb-1"],
  ffe_items: ["ff-1"],
  wiki_pages: ["wk-1"],
}

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0679_projexa_record_versions"))
  await db.exec(forwardSql("0683_projexa_sync_more_kinds"))
  rpc = pgRpc(db)
  await db.exec(FIXTURE)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the list", () => {
  test("the SQL list and the Edge list are the same 28 kinds in the same order, and the manifest lists them all", async () => {
    const sql = (await db.query<J>(`select unnest(public.projexa_sync__kinds()) k`)).rows.map((r) => r.k)
    expect(sql).toEqual([...SYNC_KINDS])
    expect(SYNC_KINDS).toHaveLength(28)
    const m = await hit("u-mgr", "manifest")
    expect((m.json.kinds as J[]).map((k) => k.kind)).toEqual([...SYNC_KINDS])
    for (const k of m.json.kinds as J[]) expect(k).toMatchObject({ project_scoped: true, deletes_supported: true })
  })

  test("every kind of the list has a source (none answers 404 for a person of the project)", async () => {
    for (const kind of SYNC_KINDS) {
      const r = await pull("u-mgr", kind)
      expect([kind, r.status]).toEqual([kind, 200])
    }
  })
})

describe("isolation and role, for every new kind", () => {
  for (const kind of NEW_KINDS) {
    test(`${kind}: exactly the project's rows; no other project, no other organisation, no row of another organisation naming this project`, async () => {
      expect(await idsOf("u-mgr", kind)).toEqual(OWN[kind])
      const r = await pull("u-mgr", kind)
      expect(JSON.stringify(r.json)).not.toContain("SECRET")
      expect(await pull("u-b", kind)).toEqual({ status: 404, json: { error: "Not found" } })
      expect(await idsOf("u-mem", kind)).toEqual(OWN[kind]) // a member sees the rows (money is what differs, below)
    })
  }

  test("the exact-ids mode answers the same scope for a new kind (a decoy id is simply absent)", async () => {
    const r = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "roster", ids: ["ro-1", "SECRET-ro-a2", "SECRET-ro-wo"] })
    expect((r.json.items as J[]).map((i) => i.id)).toEqual(["ro-1"])
  })
})

describe("role redaction: money, wages and rates arrive empty below the role that may see them", () => {
  const MONEY: Array<[string, string, string]> = [
    ["roster", "ro-1", "daily_rate"],
    ["attendance", "at-1", "daily_cost"],
    ["expenses", "ex-1", "amount"],
    ["interim_bills", "ib-1", "net_payable"],
    ["material_receipts", "mr-1", "unit_cost"],
    ["ffe_items", "ff-1", "unit_cost"],
  ]
  for (const [kind, id, col] of MONEY) {
    test(`${kind}.${col}: null for a member, filled for a manager`, async () => {
      const mem = ((await pull("u-mem", kind)).json.items as J[]).find((i) => i.id === id)!
      const mgr = ((await pull("u-mgr", kind)).json.items as J[]).find((i) => i.id === id)!
      expect(mem.data[col]).toBeNull()
      expect(mgr.data[col]).not.toBeNull()
    })
  }
})

describe("versions and history for the new kinds", () => {
  const head = async (kind: string, id: string) => (await db.query<J>(`select version, project_id from platform.projexa_record_head where kind = '${kind}' and record_id = '${id}'`)).rows[0]

  test("every new kind's own rows have a version from the first write, under the right project", async () => {
    for (const kind of NEW_KINDS) for (const id of OWN[kind]) {
      const h = await head(kind, id)
      expect([kind, id, Number(h?.version), h?.project_id]).toEqual([kind, id, 1, "proj-a"])
    }
  })

  test("a time entry is filed under its issue's project, and the other project's under that one", async () => {
    expect((await head("timesheets", "te-1")).project_id).toBe("proj-a")
    expect((await head("timesheets", "SECRET-te-a2")).project_id).toBe("proj-a2")
  })

  test("a MoM that is not about a project is not tracked at all", async () => {
    expect(await head("meeting_minutes", "SECRET-vm-kind")).toBeUndefined()
    expect(Number((await head("meeting_minutes", "vm-1")).version)).toBe(1)
  })

  test("a change to a new kind is a new version and a change the project's person can read; a delete is a tombstone", async () => {
    const before = ((await hit("u-mgr", "changes", { project_id: "proj-a", after_seq: null })).json.head_seq as number)
    await db.exec(`update compliance.construction_attendance set status = 'absent' where id = 'at-1'`)
    await db.exec(`delete from compliance.construction_site_diaries where id = 'sd-1'`)
    const r = await hit("u-mgr", "changes", { project_id: "proj-a", after_seq: before })
    expect((r.json.changes as J[]).map((c) => [c.kind, c.id, c.version, c.op])).toEqual([["attendance", "at-1", 2, "U"], ["site_diaries", "sd-1", 2, "D"]])
    // org B never learns of it
    expect(await hit("u-b", "changes", { project_id: "proj-a", after_seq: before })).toEqual({ status: 404, json: { error: "Not found" } })
  })

  test("the id inventory (deletes) lists exactly the project's rows for EVERY new kind: it uses the candidate scope directly, with no second pass of the AI link's reader", async () => {
    // (the sync-down at the start of this describe deleted sd-1 and changed at-1; the inventory is the live list)
    const expected: Record<string, string[]> = { ...OWN, site_diaries: [] }
    for (const kind of NEW_KINDS) {
      const r = await hit("u-mgr", "ids", { project_id: "proj-a", kind })
      expect([kind, r.status, r.json.ids]).toEqual([kind, 200, expected[kind]])
      expect(await hit("u-b", "ids", { project_id: "proj-a", kind })).toEqual({ status: 404, json: { error: "Not found" } })
    }
  })
})

describe("reversible", () => {
  test("the down file returns to the 13 kinds and removes the 15 triggers; the forward file applies twice", async () => {
    await db.exec(downSql("0683_projexa_sync_more_kinds"))
    expect((await db.query<J>(`select cardinality(public.projexa_sync__kinds()) n`)).rows[0].n).toBe(13)
    expect((await pull("u-mgr", "roster")).status).toBe(404) // not a kind any more
    const left = (await db.query<J>(`select count(*) n from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'projexa_track_change' and c.relname = 'construction_labour_roster'`)).rows[0].n
    expect(Number(left)).toBe(0)
    await db.exec(forwardSql("0683_projexa_sync_more_kinds"))
    await db.exec(forwardSql("0683_projexa_sync_more_kinds"))
    expect((await db.query<J>(`select cardinality(public.projexa_sync__kinds()) n`)).rows[0].n).toBe(28)
    expect((await pull("u-mgr", "roster")).status).toBe(200)
  })
})
