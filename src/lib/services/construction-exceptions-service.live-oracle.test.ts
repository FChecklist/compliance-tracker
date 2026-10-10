/// <reference types="bun-types" />
// Sumeet EXC-ITEM-01..28 (2026-09-30): the 28-item exceptions report checked
// against REAL LIVE PROJECT DATA -- not fixtures. For every real project in
// the live database that has construction data, this runs the REAL
// getProjectExceptions() (the same call GET /api/v1/projexa/exceptions
// makes: real withTenantContext, real app_runtime role, real RLS, real
// drizzle queries) and compares every item's flagged record ids with an
// INDEPENDENT SQL oracle -- each detector's predicate re-written directly in
// SQL below, sharing no code with the service. Any disagreement, in either
// direction, on any item of any project, fails.
//
// Read-only: the service only SELECTs, and so does the oracle. Nothing is
// written anywhere.
//
// A SECOND test covers the 11 checks no live project can exercise today (no
// disputes, complaints, material issues, drawing-linked progress, invoice
// lines tied to BOQ lines, interim bills or double-approved revision chains
// exist live yet): it inserts a qualifying scenario into real existing
// projects of the real E2E test org through the real withTenantContext,
// runs the real aggregator in that same transaction, ROLLS IT BACK, and
// re-reads to prove no row persisted.
//
// Needs DATABASE_URL + APP_RUNTIME_DATABASE_URL (this repo's own Supabase
// project; test-guard.ts refuses anything else). Without a reachable
// database the suite SKIPS (CI's unit-test job uses a placeholder URL) --
// set EXCEPTIONS_LIVE_REQUIRE_DB=1 to make an unreachable database a failure.
//
// Run: bun --env-file=<path to .env.local> test --isolate src/lib/services/construction-exceptions-service.live-oracle.test.ts
//
// The complete-coverage, CI-run, falsifiability-proven closure test is the
// "real Postgres" block of construction-exceptions-service.test.ts; this
// file is the complementary proof that the same detectors agree with an
// independent reading of the production data as it actually is.
import { afterAll, describe, expect, test } from "bun:test"

async function probeLiveDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL || !process.env.APP_RUNTIME_DATABASE_URL) return false
  const postgres = (await import("postgres")).default
  for (let attempt = 1; attempt <= 6; attempt++) {
    const probe = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return true
    } catch {
      try { await probe.end({ timeout: 5 }) } catch {}
      if (attempt < 6) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return false
}

/** Retries ONLY a failed connect (this laptop's link to the pooler flaps); any other error is real and rethrown at once. */
async function withConnectRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      const code = (err as { code?: string }).code ?? ""
      const transient = /CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|ECONNRESET|ETIMEDOUT/.test(`${code} ${String((err as Error).message)}`)
      if (!transient || attempt >= 6) throw err
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

// Every real project with construction data (any BOQ, progress entry, diary,
// change order, snag, roster row, material issue or interim bill), as
// [org_id, project_id], snapshotted 2026-09-30 from the live project via the
// Supabase MCP -- a fixed list because this file connects as app_runtime,
// which by design cannot list rows across organisations. Every CHECK below
// still reads each project's CURRENT data at run time; a project deleted
// since the snapshot (404) is reported and skipped, never silently passed.
const LIVE_PROJECTS: Array<[string, string]> = [
  ["4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", "43b11bc8-59a9-4f0e-b91e-758de05db50a"],
  ["4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", "6d51a606-dfc5-4a04-81f2-2b5e2a1686d5"],
  ["projexa_demo_org", "alm_project_bizbay"],
  ["projexa_demo_org", "alm_project_marina"],
  ["f339187c-eaa1-4254-af37-d417b45c1427", "c13bs0hve24lv7i8bskd6ptf"],
  ["4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", "c37a232d-5535-4630-afdc-9cc78c792bd5"],
  ["4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04"],
  ["ve45lczmkodbiq1m20fy48r5", "g555imnoq4wihavpwc7t64um"],
  ["ve45lczmkodbiq1m20fy48r5", "gpfls54r7fommsvqrhsdk7qx"],
  ["4ecc472f-4152-4310-ae8d-cf8b7c52ab6d", "jrs5mqku99jnyxhvkbisb5qa"],
  ["projexa_demo_org", "kz7m3mgajs68u7t5mumud8k3"],
  ["projexa_demo_org", "msg_project_cedar"],
  ["projexa_demo_org", "msg_project_lakeview"],
  ["1850e900-6b54-4108-b01c-cc42c00f3eb9", "mt0eqpnqdj46o34tkcp0drjs"],
  ["projexa_demo_org", "nrxnmlnjijqljht9x88x2qly"],
  ["ve45lczmkodbiq1m20fy48r5", "oisgbqn1b24atltkkk7349e1"],
  ["projexa_demo_org", "onie6t1jkxr8dz7l4qkgzn85"],
  ["projexa_demo_org", "pj_project_mbc"],
  ["projexa_demo_org", "projexa_demo_project"],
  ["ve45lczmkodbiq1m20fy48r5", "upv2q7pv8qcwdayybvu74egm"],
  ["f384a4fc-7193-4296-929c-32646879173d", "uya50ufhzxv5io5931o2e7nb"],
  ["projexa_demo_org", "veqg7yo7smhgiktx4esczdji"],
  ["ve45lczmkodbiq1m20fy48r5", "vvgknxp3tnkj714ulykgnshw"],
  ["obux019rsc5nzxjx93rrpc1j", "y236tw43r152r5qjrowttxfi"],
]

const hasDb = await probeLiveDatabase()
const requireDb = process.env.EXCEPTIONS_LIVE_REQUIRE_DB === "1"

/** Items that reuse another item's detector (construction-exceptions-service.ts header). */
const SHARED: Record<number, number> = { 8: 1, 14: 13, 16: 15, 26: 20, 27: 18 }

/** The independent oracle: one row per (item, flagged id), for one org+project. */
const ORACLE_SQL = `
with recursive p as (select $1::text as org, $2::text as proj),
chain as (
  select b.id as start_id, b.parent_boq_id as anc_id, 1 as depth
    from compliance.construction_boqs b, p
   where b.org_id = p.org and b.project_id = p.proj and b.status = 'approved' and b.parent_boq_id is not null
  union all
  select c.start_id, a.parent_boq_id, c.depth + 1
    from chain c, p, compliance.construction_boqs a
   where a.id = c.anc_id and a.org_id = p.org and a.project_id = p.proj and a.status <> 'approved' and a.parent_boq_id is not null and c.depth < 100000
),
proj_lines as (
  select li.id from compliance.construction_boq_line_items li, compliance.construction_boqs b, p
   where b.id = li.boq_id and b.org_id = p.org and b.project_id = p.proj and li.org_id = p.org
),
sub_items as (
  select pii.id, pii.boq_line_item_id, pii.amount
    from compliance.erp_purchase_invoice_items pii, compliance.erp_purchase_invoices pi, p
   where pi.id = pii.invoice_id and pi.org_id = p.org and pi.status <> 'cancelled'
     and pii.boq_line_item_id in (select id from proj_lines)
),
sub_totals as (select boq_line_item_id, sum(amount) as t from sub_items group by 1),
billed_max as (
  select bl.boq_line_item_id, max(bl.cumulative_amount) as m
    from compliance.construction_interim_bill_line_items bl, compliance.construction_interim_bills ib, p
   where ib.id = bl.interim_bill_id and ib.org_id = p.org and bl.boq_line_item_id in (select id from proj_lines)
   group by 1
)
select 1 as item, d.id from compliance.construction_site_diaries d, p
 where d.org_id = p.org and d.project_id = p.proj and trim(coalesce(d.work_done, '')) <> ''
   and not exists (select 1 from compliance.construction_work_progress_entries w where w.org_id = p.org and w.project_id = p.proj and w.entry_date = d.diary_date)
union all
select 2, co.id from compliance.construction_change_orders co, p
 where co.org_id = p.org and co.project_id = p.proj and co.status = 'approved' and co.cost_impact <> 0 and co.boq_revision_id is not null
   and exists (select 1 from compliance.construction_boq_line_items li where li.boq_id = co.boq_revision_id and li.org_id = p.org)
   and not exists (
     select 1 from compliance.construction_boq_line_items li
       join compliance.construction_interim_bill_line_items bl on bl.boq_line_item_id = li.id
       join compliance.construction_interim_bills ib on ib.id = bl.interim_bill_id and ib.org_id = p.org
      where li.boq_id = co.boq_revision_id and li.org_id = p.org)
union all
select 3, w.id from compliance.construction_work_progress_entries w, p
 where w.org_id = p.org and w.project_id = p.proj and w.drawing_document_id is not null and w.drawing_confirmed_at is null
union all
select 4, w.id from compliance.construction_work_progress_entries w, compliance.documents doc, p
 where w.org_id = p.org and w.project_id = p.proj and doc.id = w.drawing_document_id and doc.org_id = p.org and not doc.is_latest_version
union all
select 5, co.id from compliance.construction_change_orders co, p
 where co.org_id = p.org and co.project_id = p.proj and co.status = 'pending_approval' and co.created_at < now() - interval '7 days'
union all
select 6, co.id from compliance.construction_change_orders co, p
 where co.org_id = p.org and co.project_id = p.proj and co.status = 'approved' and co.approved_by_id is not null and co.approved_by_id = co.requested_by_id
union all
select 7, w.id from compliance.construction_work_progress_entries w
  join p on w.org_id = p.org and w.project_id = p.proj
  join compliance.construction_boq_line_items li on li.id = w.boq_line_item_id and li.org_id = p.org
  left join compliance.construction_boqs b on b.id = li.boq_id and b.org_id = p.org
 where b.id is null
    or not (b.status = 'approved' or (b.status = 'superseded' and b.approved_at is not null))
    or (b.approved_at is not null and w.entry_date < (b.approved_at at time zone 'UTC')::date)
union all
select 9, x.line_id from (
  select distinct w.boq_line_item_id as line_id from compliance.construction_work_progress_entries w, p
   where w.org_id = p.org and w.project_id = p.proj and w.boq_line_item_id is not null and w.percent_complete > 0
) x, p
 where not exists (
   select 1 from compliance.construction_interim_bill_line_items bl
     join compliance.construction_interim_bills ib on ib.id = bl.interim_bill_id and ib.org_id = p.org
    where bl.boq_line_item_id = x.line_id)
union all
select 10, v.id from compliance.construction_vendor_disputes v, p where v.org_id = p.org and v.project_id = p.proj and v.status = 'open'
union all
select 11, c.id from compliance.construction_customer_complaints c, p where c.org_id = p.org and c.project_id = p.proj and c.status = 'open' and c.category = 'work_dispute'
union all
select 12, c.id from compliance.construction_customer_complaints c, p where c.org_id = p.org and c.project_id = p.proj and c.status = 'open'
union all
select 13, b.id from compliance.construction_boqs b, p where b.org_id = p.org and b.project_id = p.proj and b.parent_boq_id is not null
union all
select 15, b.id from compliance.construction_boqs b, p where b.org_id = p.org and b.project_id = p.proj and b.status = 'approved' and b.customer_approved_at is null
union all
select 17, co.id from compliance.construction_change_orders co, p where co.org_id = p.org and co.project_id = p.proj and co.status = 'approved' and co.boq_revision_id is null
union all
select 18, i.id from compliance.construction_material_issues i, p where i.org_id = p.org and i.project_id = p.proj and i.boq_line_item_id is null
union all
select distinct 19, z.id from (
  select i.id from compliance.construction_material_issues i, p
   where i.org_id = p.org and i.project_id = p.proj and exists (
     select 1 from compliance.construction_material_issues j
      where j.org_id = p.org and j.project_id = p.proj and j.material_id = i.material_id and j.id <> i.id
        and (j.issued_date < i.issued_date or (j.issued_date = i.issued_date and j.id collate "C" < i.id collate "C"))
        and i.issued_date - j.issued_date <= 3)
  union
  select i.id from compliance.construction_material_issues i
    join p on i.org_id = p.org and i.project_id = p.proj
    join compliance.construction_boq_line_items li on li.id = i.boq_line_item_id and li.org_id = p.org
   where li.activity_id is not null
     and i.issued_date > (select min(w.entry_date) from compliance.construction_work_progress_entries w where w.activity_id = li.activity_id and w.org_id = p.org)
) z
union all
select 20, to_char(gs::date, 'YYYY-MM-DD') from (
  select min(w.entry_date) as a, least(max(w.entry_date), current_date) as z
    from compliance.construction_work_progress_entries w, p where w.org_id = p.org and w.project_id = p.proj
) r, p, generate_series(r.a, r.z, interval '1 day') gs
 where r.a is not null
   and not exists (select 1 from compliance.construction_site_diaries d where d.org_id = p.org and d.project_id = p.proj and d.diary_date = gs::date)
union all
select 21, r.id from compliance.construction_labour_roster r, p where r.org_id = p.org and r.project_id = p.proj and r.is_active and r.employee_id is null
union all
select distinct 22, c.start_id from chain c, p, compliance.construction_boqs a
 where a.id = c.anc_id and a.org_id = p.org and a.project_id = p.proj and a.status = 'approved'
union all
select 23, s.id from sub_items s join sub_totals t using (boq_line_item_id) left join billed_max m using (boq_line_item_id)
 where t.t > coalesce(m.m, 0)
union all
select 24, s.id from compliance.construction_punch_list_items s, p
 where s.org_id = p.org and s.project_id = p.proj and s.status <> 'verified_closed' and s.due_date < current_date
union all
select 24, ib.id from compliance.construction_interim_bills ib, p
 where ib.org_id = p.org and ib.project_id = p.proj and ib.retention_amount >= 0.01 and coalesce(ib.retention_released_amount, 0) < ib.retention_amount
   and exists (select 1 from compliance.construction_punch_list_items s where s.org_id = p.org and s.project_id = p.proj)
   and not exists (select 1 from compliance.construction_punch_list_items s where s.org_id = p.org and s.project_id = p.proj and s.status <> 'verified_closed')
union all
select 25, co.id from compliance.construction_change_orders co, p
 where co.org_id = p.org and co.project_id = p.proj and co.status = 'approved'
   and not exists (select 1 from compliance.documents doc where doc.org_id = p.org and doc.linked_entity_type = 'construction_change_order' and doc.linked_entity_id = co.id)
union all
select 28, x.id from (
  select w.id, w.percent_complete as pc,
         lag(w.percent_complete) over (partition by w.activity_id order by w.entry_date, w.created_at, w.id) as prev
    from compliance.construction_work_progress_entries w, p
   where w.org_id = p.org and w.project_id = p.proj and w.entry_basis = 'SNAPSHOT'
) x where x.pc < x.prev
`

const d = hasDb ? describe : describe.skip

if (!hasDb) {
  test("live oracle: database reachable (required only when EXCEPTIONS_LIVE_REQUIRE_DB=1)", () => {
    expect(requireDb).toBe(false)
  })
}

d("live oracle: getProjectExceptions() vs an independent SQL reading of the real production data", () => {
  let sqlClient: import("postgres").Sql | null = null
  afterAll(async () => { try { await sqlClient?.end({ timeout: 5 }) } catch {} })

  test("every real project with construction data agrees with the oracle on all 28 items", async () => {
    const postgres = (await import("postgres")).default
    sqlClient = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15 })
    const { getProjectExceptions, ServiceError } = await import("./construction-exceptions-service")
    const client = sqlClient

    const summary: Array<Record<string, string | number>> = []
    const mismatches: string[] = []
    const skipped: string[] = []
    let compared = 0
    for (const [orgId, projectId] of LIVE_PROJECTS) {
      let checks: Awaited<ReturnType<typeof getProjectExceptions>>
      try {
        checks = await withConnectRetry(() => getProjectExceptions({ orgId }, projectId))
      } catch (err) {
        if (err instanceof ServiceError && err.status === 404) { skipped.push(projectId); continue }
        throw err
      }
      expect(checks).toHaveLength(28)
      // The oracle reads under the SAME tenant context withTenantContext sets
      // (app.current_org_id, transaction-local), so RLS scopes it exactly as
      // it scopes the service -- the oracle's own explicit org/project
      // filters are an additional, independent layer on top.
      const oracleRows = await withConnectRetry(() => client.begin(async (tx) => {
        await tx`select set_config('app.current_org_id', ${orgId}, true)`
        return tx.unsafe<{ item: number; id: string }[]>(ORACLE_SQL, [orgId, projectId])
      }))
      compared++
      const oracle = new Map<number, string[]>()
      for (const row of oracleRows) oracle.set(Number(row.item), [...(oracle.get(Number(row.item)) ?? []), row.id])
      const project = { id: projectId, name: projectId }
      const line: Record<string, string | number> = { project: projectId }
      for (let item = 1; item <= 28; item++) {
        const got = checks.find((c) => c.item === item)!.records.map((r) => r.id).sort()
        const want = [...(oracle.get(SHARED[item] ?? item) ?? [])].sort()
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          const missing = want.filter((x) => !got.includes(x)).slice(0, 5)
          const extra = got.filter((x) => !want.includes(x)).slice(0, 5)
          mismatches.push(`${project.id} (${project.name}) item #${item}: service ${got.length} vs oracle ${want.length}; missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}`)
        }
        if (got.length > 0) line[`#${item}`] = got.length
      }
      summary.push(line)
    }
    console.log(`LIVE ORACLE: ${compared} real projects compared (${compared * 28} item checks); skipped (deleted since snapshot): ${JSON.stringify(skipped)}`)
    for (const s of summary) console.log(JSON.stringify(s))
    expect(compared).toBeGreaterThan(0)
    expect(mismatches).toEqual([])
  }, 900_000)

  // ─────────────────────────────────────────────────────────────────────────
  // THE DETECTORS NO LIVE PROJECT CAN EXERCISE TODAY -- the live data has no
  // vendor disputes, customer complaints, material issues, drawing-linked
  // progress, purchase-invoice lines tied to BOQ lines, interim bills, or a
  // revision chain with two approved versions -- so for #3, #4, #10, #11,
  // #12, #18, #19, #22, #23, #27 and #24's retention half the oracle above
  // can only ever agree at zero. Here each one gets a real qualifying
  // scenario INSIDE REAL EXISTING PROJECTS of the real E2E test org
  // ("Meridian Construction Group (E2E Test Org)"): inserted through the
  // real withTenantContext (app_runtime, RLS enforced), the real aggregator
  // run in the same transaction, then the whole transaction ROLLED BACK --
  // and the tagged rows re-read afterwards to prove nothing persisted.
  // Positives must fire; the paired negative controls must not.
  // ─────────────────────────────────────────────────────────────────────────
  test("zero-live-data detectors fire on a real scenario inside real projects, rolled back, nothing persisted", async () => {
    const { withTenantContext } = await import("@/lib/db/tenant-scoped")
    const { getProjectExceptionsWithDb } = await import("./construction-exceptions-service")
    const { sql } = await import("drizzle-orm")
    class Rollback extends Error {}

    const ORG = "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d" // Meridian Construction Group (E2E Test Org)
    const MAIN = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04" // Meridian Heights - Residential Tower A (real, 2.7k+ progress entries)
    const RET = "jrs5mqku99jnyxhvkbisb5qa" // same org, real project with no snags and no bills yet (retention needs "every snag closed")
    const tag = `excv${Date.now()}`
    const id = (s: string) => `${tag}-${s}`
    const invNo = 900_000_000 + Math.floor(Math.random() * 90_000_000)

    type Checks = Awaited<ReturnType<typeof getProjectExceptionsWithDb>>
    let main: Checks = []
    let ret: Checks = []
    await withConnectRetry(() => withTenantContext({ orgId: ORG }, async (db) => {
      const supplierRows = await db.execute(sql`select id from compliance.erp_suppliers limit 1`) as unknown as Array<{ id: string }>
      const supplier = supplierRows[0]?.id
      expect(supplier).toBeTruthy() // the real test org has real suppliers (23 on 2026-09-30)
      const statements = [
        // #3 / #4: a superseded drawing and its current version; one entry unconfirmed on the old one, one confirmed on the new one.
        `insert into compliance.documents (id, name, file_url, org_id, is_latest_version) values ('${id("doc-old")}', 'EXCV drawing rev 1', 'https://files.test/excv-r1.pdf', '${ORG}', false), ('${id("doc-new")}', 'EXCV drawing rev 2', 'https://files.test/excv-r2.pdf', '${ORG}', true)`,
        `insert into compliance.construction_work_progress_entries (id, org_id, project_id, activity_id, entry_date, recorded_by_id, drawing_document_id, drawing_confirmed_at) values ('${id("e-unconf-old")}', '${ORG}', '${MAIN}', '${id("act-dr")}', '2026-09-15', 'excv', '${id("doc-old")}', null), ('${id("e-conf-new")}', '${ORG}', '${MAIN}', '${id("act-dr")}', '2026-09-15', 'excv', '${id("doc-new")}', '2026-09-15T08:00:00')`,
        // #10 / #11 / #12
        `insert into compliance.construction_vendor_disputes (id, org_id, project_id, description, status, raised_by_id) values ('${id("vd-open")}', '${ORG}', '${MAIN}', 'EXCV rebar quantity dispute', 'open', 'excv'), ('${id("vd-res")}', '${ORG}', '${MAIN}', 'EXCV settled dispute', 'resolved', 'excv')`,
        `insert into compliance.construction_customer_complaints (id, org_id, project_id, category, description, status, raised_by_id) values ('${id("cc-wd-open")}', '${ORG}', '${MAIN}', 'work_dispute', 'EXCV finish disputed', 'open', 'excv'), ('${id("cc-gen-open")}', '${ORG}', '${MAIN}', 'general', 'EXCV site noise', 'open', 'excv'), ('${id("cc-wd-res")}', '${ORG}', '${MAIN}', 'work_dispute', 'EXCV old dispute', 'resolved', 'excv')`,
        // #22: v1 approved -> v2 superseded -> v3 approved, plus two line items on v3 for #23 and one for #19's late issue.
        `insert into compliance.construction_boqs (id, org_id, project_id, version, parent_boq_id, title, status, created_by_id, approved_at) values ('${id("c1")}', '${ORG}', '${MAIN}', 1, null, 'EXCV chain', 'approved', 'excv', '2026-09-01T10:00:00Z'), ('${id("c2")}', '${ORG}', '${MAIN}', 2, '${id("c1")}', 'EXCV chain', 'superseded', 'excv', null), ('${id("c3")}', '${ORG}', '${MAIN}', 3, '${id("c2")}', 'EXCV chain', 'approved', 'excv', '2026-09-02T10:00:00Z')`,
        `insert into compliance.construction_boq_line_items (id, boq_id, activity_id, description, unit, org_id) values ('${id("li-a")}', '${id("c3")}', '${id("act-a")}', 'EXCV line A', 'm2', '${ORG}'), ('${id("li-b")}', '${id("c3")}', '${id("act-b")}', 'EXCV line B', 'm2', '${ORG}'), ('${id("li-late")}', '${id("c3")}', '${id("act-late")}', 'EXCV line late', 'm2', '${ORG}')`,
        // #18 / #19 / #27: i1 and i2 (2 days apart, no BOQ line); i3 on time and i4 late against act-late (progress from 09-05).
        `insert into compliance.construction_materials (id, org_id, project_id, name, unit) values ('${id("mat")}', '${ORG}', '${MAIN}', 'EXCV cement', 'bag'), ('${id("mat-2")}', '${ORG}', '${MAIN}', 'EXCV rebar', 't')`,
        `insert into compliance.construction_work_progress_entries (id, org_id, project_id, activity_id, entry_date, recorded_by_id) values ('${id("e-late-act")}', '${ORG}', '${MAIN}', '${id("act-late")}', '2026-09-05', 'excv')`,
        `insert into compliance.construction_material_issues (id, org_id, project_id, material_id, issued_date, quantity, boq_line_item_id, created_by_id) values ('${id("i1")}', '${ORG}', '${MAIN}', '${id("mat")}', '2026-09-10', 5, null, 'excv'), ('${id("i2")}', '${ORG}', '${MAIN}', '${id("mat")}', '2026-09-12', 5, null, 'excv'), ('${id("i3")}', '${ORG}', '${MAIN}', '${id("mat-2")}', '2026-08-20', 1, '${id("li-late")}', 'excv'), ('${id("i4")}', '${ORG}', '${MAIN}', '${id("mat-2")}', '2026-09-20', 1, '${id("li-late")}', 'excv')`,
        // #23: li-a certified 3000, invoiced 2000 + 2000 (over); li-b certified 5000, invoiced 4000 + a CANCELLED 9000 (not over).
        `insert into compliance.construction_interim_bills (id, org_id, project_id, boq_id, bill_number, bill_date, retention_amount, created_by_id) values ('${id("bill-main")}', '${ORG}', '${MAIN}', '${id("c3")}', ${invNo % 100000}, '2026-09-25', 0, 'excv')`,
        `insert into compliance.construction_interim_bill_line_items (id, interim_bill_id, boq_line_item_id, cumulative_amount) values ('${id("bl-a")}', '${id("bill-main")}', '${id("li-a")}', 3000), ('${id("bl-b")}', '${id("bill-main")}', '${id("li-b")}', 5000)`,
        `insert into compliance.erp_purchase_invoices (id, org_id, supplier_id, invoice_number, posting_date, status) values ('${id("pinv-a")}', '${ORG}', '${supplier}', ${invNo}, '2026-09-26', 'submitted'), ('${id("pinv-b")}', '${ORG}', '${supplier}', ${invNo + 1}, '2026-09-26', 'cancelled'), ('${id("pinv-c")}', '${ORG}', '${supplier}', ${invNo + 2}, '2026-09-27', 'paid')`,
        `insert into compliance.erp_purchase_invoice_items (id, invoice_id, description, amount, boq_line_item_id) values ('${id("x1")}', '${id("pinv-a")}', 'EXCV labour A', 2000, '${id("li-a")}'), ('${id("x2")}', '${id("pinv-c")}', 'EXCV labour A balance', 2000, '${id("li-a")}'), ('${id("x3")}', '${id("pinv-a")}', 'EXCV labour B', 4000, '${id("li-b")}'), ('${id("x4")}', '${id("pinv-b")}', 'EXCV labour B (cancelled)', 9000, '${id("li-b")}')`,
        // #24 retention half, in RET: its only snag verified closed; one bill still holding retention, one fully released.
        `insert into compliance.construction_punch_list_items (id, org_id, project_id, number, description, status, created_by_id) values ('${id("snag")}', '${ORG}', '${RET}', 1, 'EXCV final clean', 'verified_closed', 'excv')`,
        `insert into compliance.construction_interim_bills (id, org_id, project_id, boq_id, bill_number, bill_date, retention_amount, retention_released_amount, created_by_id) values ('${id("bill-held")}', '${ORG}', '${RET}', 'excv-boq', 1, '2026-09-25', 500, null, 'excv'), ('${id("bill-released")}', '${ORG}', '${RET}', 'excv-boq', 2, '2026-09-26', 300, 300, 'excv')`,
      ]
      for (const s of statements) await db.execute(sql.raw(s))
      main = await getProjectExceptionsWithDb(db, { orgId: ORG }, MAIN)
      ret = await getProjectExceptionsWithDb(db, { orgId: ORG }, RET)
      throw new Rollback()
    }).catch((err) => { if (!(err instanceof Rollback)) throw err }))

    const idsOf = (checks: Checks, item: number) => checks.find((c) => c.item === item)!.records.map((r) => r.id).filter((x) => x.startsWith(tag))
    const expectExactly = (checks: Checks, item: number, want: string[]) => expect({ item, ids: [...idsOf(checks, item)].sort() }).toEqual({ item, ids: want.map(id).sort() })
    expect(main).toHaveLength(28)
    expectExactly(main, 3, ["e-unconf-old"])
    expectExactly(main, 4, ["e-unconf-old"])
    expectExactly(main, 10, ["vd-open"])
    expectExactly(main, 11, ["cc-wd-open"])
    expectExactly(main, 12, ["cc-wd-open", "cc-gen-open"])
    expectExactly(main, 18, ["i1", "i2"])
    expectExactly(main, 27, ["i1", "i2"])
    expectExactly(main, 19, ["i2", "i4"])
    expectExactly(main, 22, ["c3"])
    expectExactly(main, 23, ["x1", "x2"])
    expectExactly(ret, 24, ["bill-held"])

    // Nothing persisted: every tagged row is gone once the transaction rolled back.
    const leftovers = await withConnectRetry(() => withTenantContext({ orgId: ORG }, async (db) => {
      const tables = ["documents", "construction_work_progress_entries", "construction_vendor_disputes", "construction_customer_complaints", "construction_boqs", "construction_boq_line_items", "construction_materials", "construction_material_issues", "construction_interim_bills", "construction_interim_bill_line_items", "erp_purchase_invoices", "erp_purchase_invoice_items", "construction_punch_list_items"]
      let n = 0
      for (const t of tables) {
        const rows = await db.execute(sql.raw(`select count(*)::int as n from compliance.${t} where id like '${tag}-%'`)) as unknown as Array<{ n: number }>
        n += Number(rows[0].n)
      }
      return n
    }))
    console.log(`LIVE ROLLED-BACK SCENARIO (${tag}): all 11 zero-live-data checks fired as expected in real projects; leftover rows after rollback = ${leftovers}`)
    expect(leftovers).toBe(0)
  }, 900_000)
})
