/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0634, job cost001-the-firm-recur-engagements (recurring engagements on pg_cron).
// Runs drizzle/0634_build001_cron_the_firm_recur.sql and its down file on PGlite against the live shape of compliance.firm_engagements,
// clients, org_product_branch_enablements and platform.product_branches.
// Proves: the lifecycle (see pglite-kit.ts); month-end dates CLAMP by default (the PM's decision 4: 31 Jan plus one month is 28 Feb,
// where the old JavaScript overflowed to 3 Mar) and 'overflow' still reproduces the old dates; only engagements of orgs with the_firm
// enabled, not terminated, with a client in the org, and a known recurrence are cloned; the clone is a one-off copy; an on-schedule
// row is not cloned twice; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0634-the-firm-recur.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0634",
  job: "cost001-the-firm-recur-engagements",
  schedule: "30 7 * * *",
  command: "select compliance.cron_the_firm_recur_engagements();",
  functions: [{ name: "cron_the_firm_recur_engagements", args: "text, date" }],
}
const TODAY = "2026-12-01"

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.firm_engagements; delete from compliance.clients;
    delete from compliance.org_product_branch_enablements; delete from platform.product_branches;
    insert into platform.product_branches (id, branch_key) values ('pb-firm', 'the_firm'), ('pb-sales', 'sales');
    insert into compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled) values
      ('org-a', 'pb-firm', true), ('org-e', 'pb-firm', true), ('org-b', 'pb-firm', false), ('org-c', 'pb-sales', true);
    insert into compliance.clients (id, org_id) values ('c-a1', 'org-a'), ('c-b1', 'org-b'), ('c-c1', 'org-c'), ('c-e1', 'org-e');
    insert into compliance.firm_engagements
      (id, org_id, client_id, service_line, title, scope_of_work, fee_type, fee_amount, billing_frequency, start_date, lead_partner_user_id,
       budgeted_hours, recurrence_type, created_by_id, next_occurrence_date, status) values
      ('x1',  'org-a', 'c-a1', 'ca_services',    'Audit e1', 'scope one', 'retainer', 1000.50, 'quarterly', '2025-01-01', 'u-lead', 40, 'monthly',     'u-cr', '2026-01-31', 'active'),
      ('x2',  'org-a', 'c-a1', 'cs_services',    'Audit e2', null,        'fixed',    2000,    'monthly',   '2025-01-01', null,     null, 'quarterly',  null,   '2026-11-30', 'active'),
      ('x3',  'org-a', 'c-a1', 'legal_services', 'Audit e3', null,        'hourly',   null,    null,        '2025-01-01', null,     null, 'half_yearly', null,  '2026-08-31', 'active'),
      ('x4',  'org-a', 'c-a1', 'grc_services',   'Audit e4', null,        'fixed',    10,      'monthly',   '2024-01-01', null,     null, 'annually',   null,   '2024-02-29', 'active'),
      ('x5',  'org-a', 'c-a1', 'ca_services',    'No recurrence',   null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'none',      null, '2026-11-01', 'active'),
      ('x6',  'org-a', 'c-a1', 'ca_services',    'Terminated',      null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2026-11-01', 'terminated'),
      ('x7',  'org-a', 'c-a1', 'ca_services',    'Unknown cadence', null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'weekly',    null, '2026-11-01', 'active'),
      ('x8',  'org-b', 'c-b1', 'ca_services',    'Org not enabled', null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2026-11-01', 'active'),
      ('x9',  'org-a', 'c-gone', 'ca_services',  'Client missing',  null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2026-11-01', 'active'),
      ('x10', 'org-a', 'c-a1', 'ca_services',    'Not due yet',     null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2027-01-15', 'active'),
      ('x11', 'org-e', 'c-e1', 'ca_services',    'On schedule',     null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2026-12-01', 'active'),
      ('x12', 'org-c', 'c-c1', 'ca_services',    'Other branch',    null, 'fixed', 1, 'monthly', '2025-01-01', null, null, 'monthly',   null, '2026-11-01', 'active');
  `)
}

const sources = async (db: PGlite) =>
  Object.fromEntries((await q<{ id: string; d: string | null }>(db, "select id, next_occurrence_date::text d from compliance.firm_engagements where id like 'x%' order by id")).map((r) => [r.id, r.d]))

describe("drizzle/0634 the-firm recurring engagements on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["product_branches", "org_product_branch_enablements", "clients", "firm_engagements"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command clamps month-end dates: 31 Jan plus one month is 28 Feb", async () => {
    await seed(db)
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    expect(command).not.toContain("overflow")
    const res = await call(db, `compliance.cron_the_firm_recur_engagements('clamp', '${TODAY}')`)
    expect(res).toMatchObject({ month_end: "clamp", orgs_scanned: 2, engagements_generated: 5, skipped_unknown_recurrence: 1 })
    expect(await sources(db)).toMatchObject({
      x1: "2026-02-28", // monthly from 31 Jan
      x2: "2027-02-28", // quarterly from 30 Nov
      x3: "2027-02-28", // half-yearly from 31 Aug
      x4: "2025-02-28", // annually from 29 Feb 2024
      x11: "2027-01-01",
    })
  })

  test("the default argument is 'clamp'", async () => {
    await seed(db)
    const res = await call(db, `compliance.cron_the_firm_recur_engagements(p_today => '${TODAY}')`)
    expect(res).toMatchObject({ month_end: "clamp" })
    expect((await sources(db)).x1).toBe("2026-02-28")
  })

  test("skipped rows stay as they were: no recurrence, terminated, unknown recurrence, org without the_firm, missing client, not due, other branch", async () => {
    // the state after the previous test's run
    expect(await sources(db)).toMatchObject({ x5: "2026-11-01", x6: "2026-11-01", x7: "2026-11-01", x8: "2026-11-01", x9: "2026-11-01", x10: "2027-01-15", x12: "2026-11-01" })
    const ids = (await q<{ id: string }>(db, "select id from compliance.firm_engagements order by id")).map((r) => r.id)
    expect(ids.filter((i) => i.startsWith("x")).length).toBe(12)
    expect(ids.length).toBe(17) // 12 seeded plus 5 clones
  })

  test("a clone is a one-off copy: today as start date, no recurrence, no next date, active, and the source fields copied", async () => {
    const clone = await one<Record<string, unknown>>(
      db,
      `select org_id, client_id, service_line::text service_line, title, scope_of_work, fee_type::text fee_type, fee_amount::text fee_amount, billing_frequency,
              start_date::text start_date, lead_partner_user_id, budgeted_hours::text budgeted_hours, recurrence_type, created_by_id, next_occurrence_date::text next_date, status
         from compliance.firm_engagements where id not like 'x%' and title = 'Audit e1'`,
    )
    expect(clone).toEqual({
      org_id: "org-a",
      client_id: "c-a1",
      service_line: "ca_services",
      title: "Audit e1",
      scope_of_work: "scope one",
      fee_type: "retainer",
      fee_amount: "1000.50",
      billing_frequency: "quarterly",
      start_date: TODAY,
      lead_partner_user_id: "u-lead",
      budgeted_hours: "40",
      recurrence_type: "none",
      created_by_id: "u-cr",
      next_date: null,
      status: "active",
    })
    // a clone never recurs, so a later run cannot clone it
    expect(await count(db, "compliance.firm_engagements", "id not like 'x%' and recurrence_type <> 'none'")).toBe(0)
  })

  test("'overflow' reproduces the old JavaScript dates: 31 Jan plus one month is 3 Mar", async () => {
    await seed(db)
    const res = await call(db, `compliance.cron_the_firm_recur_engagements('overflow', '${TODAY}')`)
    expect(res).toMatchObject({ month_end: "overflow", engagements_generated: 5 })
    expect(await sources(db)).toMatchObject({ x1: "2026-03-03", x2: "2027-03-02", x3: "2027-03-03", x4: "2025-03-01", x11: "2027-01-01" })
  })

  test("a row that is on schedule is cloned once: a second run on the same day changes nothing", async () => {
    await seed(db)
    await db.exec("delete from compliance.firm_engagements where id <> 'x11'")
    expect(await call(db, `compliance.cron_the_firm_recur_engagements('clamp', '${TODAY}')`)).toMatchObject({ engagements_generated: 1 })
    expect(await call(db, `compliance.cron_the_firm_recur_engagements('clamp', '${TODAY}')`)).toMatchObject({ engagements_generated: 0 })
    expect(await count(db, "compliance.firm_engagements")).toBe(2)
    expect((await sources(db)).x11).toBe("2027-01-01")
  })

  test("a p_month_end other than clamp or overflow, and null, are refused and write nothing", async () => {
    await seed(db)
    for (const arg of ["'weird'", "null"]) {
      await expect(db.query(`select compliance.cron_the_firm_recur_engagements(${arg}, '${TODAY}')`)).rejects.toThrow("p_month_end must be")
    }
    expect(await count(db, "compliance.firm_engagements")).toBe(12)
  })

  test("a refused advisory lock returns skipped and writes nothing", async () => {
    await seed(db)
    await withRefusedLock(db, CFG.functions[0], async () => {
      expect((await call(db, `compliance.cron_the_firm_recur_engagements('clamp', '${TODAY}')`)).skipped).toBe(true)
    })
    expect(await count(db, "compliance.firm_engagements")).toBe(12)
    expect((await sources(db)).x1).toBe("2026-01-31")
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
