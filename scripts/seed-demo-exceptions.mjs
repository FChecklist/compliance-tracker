#!/usr/bin/env node
// seed-demo-exceptions.mjs -- plants minimal demo data so EVERY one of Sumeet's
// 28 exception detectors (EXC-ITEM-01..28, src/lib/services/construction-
// exceptions-service.ts) shows FLAGGED records on one showcase project.
//
// README
//   * Scope: ONE project, "DEMO - Exceptions showcase" (fixed id
//     demoexc-project), in ONE org only: the E2E test org "Meridian Construction
//     Group (E2E Test Org)" (4ecc472f-4152-4310-ae8d-cf8b7c52ab6d). It never
//     touches any other project or org, and never deletes or updates anything.
//   * Labelled: every text field carries "DEMO-SEED"; every id starts "demoexc-".
//   * Idempotent: every INSERT is ON CONFLICT DO NOTHING on a fixed id, all in
//     one transaction. Running it twice adds nothing the second time.
//   * Secrets: the connection string comes from the environment only
//     (APP_RUNTIME_DATABASE_URL, else DATABASE_URL). Nothing is hard-coded.
//   * Item 24 is flagged through its overdue-snag half; the retention half needs
//     every snag closed, which cannot coexist with an overdue snag in one
//     project (the live-oracle test exercises that half in a second project).
//   * Run:   bun --env-file=.env.local scripts/seed-demo-exceptions.mjs
//     Check: bun --env-file=.env.local scripts/seed-demo-exceptions.mjs --check
//            (read-only: counts the seeded rows per table, changes nothing)
import postgres from "postgres"

const ORG = "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d" // Meridian Construction Group (E2E Test Org)
const TEMPLATE_PROJECT = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04" // same org; only used to copy product_id
const P = "demoexc-project"
const L = "DEMO-SEED"
const id = (s) => `demoexc-${s}`
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const url = process.env.APP_RUNTIME_DATABASE_URL || process.env.DATABASE_URL
if (!url && !process.argv.includes("--print-sql")) { console.error("Set APP_RUNTIME_DATABASE_URL or DATABASE_URL (e.g. node --env-file=.env.local ...)"); process.exit(1) }

const T = (t) => `compliance.${t}`
const statements = [
  // The project (product_id copied from the org's own existing project).
  `insert into ${T("projects")} (id, product_id, org_id, name, description)
     select ${q(P)}, product_id, ${q(ORG)}, 'DEMO - Exceptions showcase', '${L}: one planted example for each of the 28 exception detectors'
     from ${T("projects")} where id = ${q(TEMPLATE_PROJECT)} and org_id = ${q(ORG)}
     on conflict do nothing`,

  // #3 / #4: superseded drawing + current one; entry on old one is unconfirmed AND old.
  `insert into ${T("documents")} (id, name, file_url, org_id, is_latest_version) values
     (${q(id("doc-old"))}, '${L} drawing rev 1', 'https://files.test/demoexc-r1.pdf', ${q(ORG)}, false),
     (${q(id("doc-new"))}, '${L} drawing rev 2', 'https://files.test/demoexc-r2.pdf', ${q(ORG)}, true)
     on conflict do nothing`,

  // BOQs. chain: c1 approved -> c2 superseded -> c3 approved (#22 ambiguous; c3 has a parent = #13/#14;
  // approved + no customer approval = #15/#16). d1 = never-approved draft (#7). rev = CO's BOQ revision (#2).
  `insert into ${T("construction_boqs")} (id, org_id, project_id, version, parent_boq_id, title, status, created_by_id, approved_at) values
     (${q(id("c1"))}, ${q(ORG)}, ${q(P)}, 1, null, '${L} chain', 'approved', 'demoexc', '2026-09-01T10:00:00Z'),
     (${q(id("c2"))}, ${q(ORG)}, ${q(P)}, 2, ${q(id("c1"))}, '${L} chain', 'superseded', 'demoexc', null),
     (${q(id("c3"))}, ${q(ORG)}, ${q(P)}, 3, ${q(id("c2"))}, '${L} chain', 'approved', 'demoexc', '2026-09-02T10:00:00Z'),
     (${q(id("d1"))}, ${q(ORG)}, ${q(P)}, 1, null, '${L} never approved', 'draft', 'demoexc', null),
     (${q(id("rev"))}, ${q(ORG)}, ${q(P)}, 1, null, '${L} change-order revision', 'draft', 'demoexc', null)
     on conflict do nothing`,
  `insert into ${T("construction_boq_line_items")} (id, boq_id, activity_id, description, unit, org_id) values
     (${q(id("li-a"))}, ${q(id("c3"))}, ${q(id("act-a"))}, '${L} line A', 'm2', ${q(ORG)}),
     (${q(id("li-b"))}, ${q(id("c3"))}, ${q(id("act-b"))}, '${L} line B', 'm2', ${q(ORG)}),
     (${q(id("li-late"))}, ${q(id("c3"))}, ${q(id("act-late"))}, '${L} line late', 'm2', ${q(ORG)}),
     (${q(id("li-prog"))}, ${q(id("c3"))}, ${q(id("act-prog"))}, '${L} line progress never billed', 'm2', ${q(ORG)}),
     (${q(id("li-d"))}, ${q(id("d1"))}, ${q(id("act-d"))}, '${L} line on unapproved BOQ', 'm2', ${q(ORG)}),
     (${q(id("li-co"))}, ${q(id("rev"))}, ${q(id("act-co"))}, '${L} line extra work', 'm2', ${q(ORG)})
     on conflict do nothing`,

  // Progress entries.
  // e-unconf-old (#3,#4); e-conf-new (negative control); e-late-act (#19 anchor, 09-05);
  // e-pre-approval on li-a dated before c3 approval (#7b);
  // e-unapproved on d1 line (#7a, #9); e-prog on li-prog (#9);
  // e-reg-1/e-reg-2 SNAPSHOT 50% then 40% on one activity (#28).
  `insert into ${T("construction_work_progress_entries")} (id, org_id, project_id, activity_id, entry_date, recorded_by_id, remarks, boq_line_item_id, percent_complete, entry_basis, drawing_document_id, drawing_confirmed_at) values
     (${q(id("e-unconf-old"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-dr"))}, '2026-09-15', 'demoexc', '${L}', null, 0, 'DELTA', ${q(id("doc-old"))}, null),
     (${q(id("e-conf-new"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-dr"))}, '2026-09-15', 'demoexc', '${L}', null, 0, 'DELTA', ${q(id("doc-new"))}, '2026-09-15T08:00:00'),
     (${q(id("e-late-act"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-late"))}, '2026-09-05', 'demoexc', '${L}', null, 0, 'DELTA', null, null),
     (${q(id("e-pre-approval"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-a"))}, '2026-08-20', 'demoexc', '${L}', ${q(id("li-a"))}, 10, 'DELTA', null, null),
     (${q(id("e-unapproved"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-d"))}, '2026-09-08', 'demoexc', '${L}', ${q(id("li-d"))}, 20, 'DELTA', null, null),
     (${q(id("e-prog"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-prog"))}, '2026-09-09', 'demoexc', '${L}', ${q(id("li-prog"))}, 30, 'DELTA', null, null),
     (${q(id("e-reg-1"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-reg"))}, '2026-09-10', 'demoexc', '${L}', null, 50, 'SNAPSHOT', null, null),
     (${q(id("e-reg-2"))}, ${q(ORG)}, ${q(P)}, ${q(id("act-reg"))}, '2026-09-12', 'demoexc', '${L}', null, 40, 'SNAPSHOT', null, null)
     on conflict do nothing`,

  // #1 / #8: a diary with work done on a date that has NO progress entry. Only this one diary exists, so every other day
  // between 2026-08-20 and 2026-09-15 is a missing daily report (#20 / #26).
  `insert into ${T("construction_site_diaries")} (id, org_id, project_id, diary_date, work_done, remarks, recorded_by_id) values
     (${q(id("diary"))}, ${q(ORG)}, ${q(P)}, '2026-09-03', '${L}: extra shuttering done on site, not captured as progress', '${L}', 'demoexc')
     on conflict do nothing`,

  // Change orders. co-1 approved, priced into rev, never billed (#2) and no evidence (#25);
  // co-2 approved with no BOQ revision (#17); co-3 self-approved (#6); co-4 pending for over 7 days (#5).
  `insert into ${T("construction_change_orders")} (id, org_id, project_id, number, title, description, cost_impact, status, requested_by_id, approved_by_id, approved_at, created_at, boq_revision_id) values
     (${q(id("co-1"))}, ${q(ORG)}, ${q(P)}, 9001, '${L} approved, linked, never billed', '${L}', 50000, 'approved', 'demoexc-req', 'demoexc-appr', '2026-09-03T10:00:00Z', '2026-09-02T10:00:00Z', ${q(id("rev"))}),
     (${q(id("co-2"))}, ${q(ORG)}, ${q(P)}, 9002, '${L} approved, no BOQ revision', '${L}', 20000, 'approved', 'demoexc-req', 'demoexc-appr', '2026-09-03T10:00:00Z', '2026-09-02T10:00:00Z', null),
     (${q(id("co-3"))}, ${q(ORG)}, ${q(P)}, 9003, '${L} self-approved', '${L}', 10000, 'approved', 'demoexc-same', 'demoexc-same', '2026-09-03T10:00:00Z', '2026-09-02T10:00:00Z', null),
     (${q(id("co-4"))}, ${q(ORG)}, ${q(P)}, 9004, '${L} stuck pending approval', '${L}', 15000, 'pending_approval', 'demoexc-req', null, null, '2026-09-01T10:00:00Z', null)
     on conflict do nothing`,

  // #10 / #11 / #12
  `insert into ${T("construction_vendor_disputes")} (id, org_id, project_id, description, amount_disputed, status, raised_by_id) values
     (${q(id("vd-open"))}, ${q(ORG)}, ${q(P)}, '${L}: rebar quantity dispute', 12000, 'open', 'demoexc')
     on conflict do nothing`,
  `insert into ${T("construction_customer_complaints")} (id, org_id, project_id, category, description, status, raised_by_id) values
     (${q(id("cc-wd"))}, ${q(ORG)}, ${q(P)}, 'work_dispute', '${L}: customer disputes the finish quality', 'open', 'demoexc'),
     (${q(id("cc-gen"))}, ${q(ORG)}, ${q(P)}, 'general', '${L}: customer complains about site noise', 'open', 'demoexc')
     on conflict do nothing`,

  // #18 / #27 / #19: i1 + i2 no BOQ line, same material 2 days apart (duplicate); i3 on time, i4 late vs act-late (progress from 09-05).
  `insert into ${T("construction_materials")} (id, org_id, project_id, name, unit) values
     (${q(id("mat"))}, ${q(ORG)}, ${q(P)}, '${L} cement', 'bag'),
     (${q(id("mat-2"))}, ${q(ORG)}, ${q(P)}, '${L} rebar', 't')
     on conflict do nothing`,
  `insert into ${T("construction_material_issues")} (id, org_id, project_id, material_id, issued_date, quantity, boq_line_item_id, note, created_by_id) values
     (${q(id("i1"))}, ${q(ORG)}, ${q(P)}, ${q(id("mat"))}, '2026-09-10', 5, null, '${L}', 'demoexc'),
     (${q(id("i2"))}, ${q(ORG)}, ${q(P)}, ${q(id("mat"))}, '2026-09-12', 5, null, '${L}', 'demoexc'),
     (${q(id("i3"))}, ${q(ORG)}, ${q(P)}, ${q(id("mat-2"))}, '2026-08-20', 1, ${q(id("li-late"))}, '${L}', 'demoexc'),
     (${q(id("i4"))}, ${q(ORG)}, ${q(P)}, ${q(id("mat-2"))}, '2026-09-20', 1, ${q(id("li-late"))}, '${L}', 'demoexc')
     on conflict do nothing`,

  // #21: active labour roster entry with no linked employee.
  `insert into ${T("construction_labour_roster")} (id, org_id, project_id, name, trade, is_active, employee_id) values
     (${q(id("roster"))}, ${q(ORG)}, ${q(P)}, '${L} Ramesh (no employee profile)', 'mason', true, null)
     on conflict do nothing`,

  // #23: li-a certified 3000, invoiced 2000 + 2000 (over). Needs a real supplier of the same org.
  `insert into ${T("construction_interim_bills")} (id, org_id, project_id, boq_id, bill_number, bill_date, retention_amount, created_by_id) values
     (${q(id("bill"))}, ${q(ORG)}, ${q(P)}, ${q(id("c3"))}, 1, '2026-09-25', 0, 'demoexc')
     on conflict do nothing`,
  `insert into ${T("construction_interim_bill_line_items")} (id, interim_bill_id, boq_line_item_id, cumulative_amount) values
     (${q(id("bl-a"))}, ${q(id("bill"))}, ${q(id("li-a"))}, 3000)
     on conflict do nothing`,
  `insert into ${T("erp_purchase_invoices")} (id, org_id, supplier_id, invoice_number, posting_date, status) values
     (${q(id("pinv-a"))}, ${q(ORG)}, (select id from ${T("erp_suppliers")} where org_id = ${q(ORG)} order by id limit 1), 990000001, '2026-09-26', 'submitted'),
     (${q(id("pinv-c"))}, ${q(ORG)}, (select id from ${T("erp_suppliers")} where org_id = ${q(ORG)} order by id limit 1), 990000002, '2026-09-26', 'paid')
     on conflict do nothing`,
  `insert into ${T("erp_purchase_invoice_items")} (id, invoice_id, description, amount, boq_line_item_id) values
     (${q(id("x1"))}, ${q(id("pinv-a"))}, '${L} labour A', 2000, ${q(id("li-a"))}),
     (${q(id("x2"))}, ${q(id("pinv-c"))}, '${L} labour A balance', 2000, ${q(id("li-a"))})
     on conflict do nothing`,

  // #24 (overdue half): a snag due long ago and not verified closed.
  `insert into ${T("construction_punch_list_items")} (id, org_id, project_id, number, description, status, due_date, created_by_id) values
     (${q(id("snag"))}, ${q(ORG)}, ${q(P)}, 1, '${L}: final clean overdue', 'open', '2026-09-01', 'demoexc')
     on conflict do nothing`,
]

if (process.argv.includes("--print-sql")) { console.log(statements.join(";\n") + ";"); process.exit(0) }
const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
try {
  if (process.argv.includes("--check")) {
    const tables = ["construction_boqs", "construction_work_progress_entries", "construction_change_orders", "construction_material_issues", "construction_site_diaries", "construction_vendor_disputes", "construction_customer_complaints", "construction_labour_roster", "construction_punch_list_items", "construction_interim_bills"]
    const rows = await sql.unsafe(`select 'projects' t, count(*)::int n from ${T("projects")} where id = ${q(P)} ${tables.map((t) => `union all select '${t}', count(*)::int from ${T(t)} where project_id = ${q(P)}`).join(" ")}`)
    console.table(rows)
  } else {
    const inserted = await sql.begin(async (tx) => {
      await tx`select set_config('app.current_org_id', ${ORG}, true)`
      let n = 0
      for (const s of statements) { const r = await tx.unsafe(s); n += r.count ?? 0 }
      return n
    })
    console.log(`seed-demo-exceptions: ${inserted} new row(s) inserted (0 means already seeded).`)
  }
} finally {
  await sql.end()
}
