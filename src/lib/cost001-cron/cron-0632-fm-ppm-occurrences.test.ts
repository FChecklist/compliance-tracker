/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0632, job cost001-fm-ppm-generate-occurrences (PPM occurrence generation on pg_cron).
// Runs drizzle/0632_build001_cron_fm_ppm_occurrences.sql and its down file on PGlite against the live shape of the three fm tables.
// Proves: the lifecycle (see pglite-kit.ts); one occurrence per due schedule per run, the schedule advanced by its frequency (month
// arithmetic clamps at month-end), orphaned, inactive, out-of-window and already-generated schedules left alone; overdue marking once;
// a second run creates no duplicate; an enum label the function does not know is skipped and counted; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0632-fm-ppm-occurrences.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0632",
  job: "cost001-fm-ppm-generate-occurrences",
  schedule: "0 2 * * *",
  command: "select compliance.cron_fm_ppm_generate_occurrences();",
  functions: [{ name: "cron_fm_ppm_generate_occurrences", args: "integer, date" }],
}
const TODAY = "2026-09-26"
const RUN = `compliance.cron_fm_ppm_generate_occurrences(14, '${TODAY}')`

async function seedMixed(db: PGlite) {
  await db.exec(`
    delete from compliance.fm_ppm_occurrences; delete from compliance.fm_ppm_schedules; delete from compliance.fm_checklist_templates;
    insert into compliance.fm_checklist_templates (id, frequency) values ('tpl-m', 'monthly'), ('tpl-d', 'daily'), ('tpl-w', 'weekly');
    insert into compliance.fm_ppm_schedules (id, org_id, asset_id, checklist_template_id, is_active, next_due_date, default_assignee_id) values
      ('s1', 'org-1', 'a1', 'tpl-m',       true,  '2026-10-05', 'u-tech'),
      ('s2', 'org-1', 'a2', 'tpl-d',       true,  '2026-09-20', null),
      ('s3', 'org-1', 'a3', 'tpl-missing', true,  '2026-10-01', null),
      ('s4', 'org-1', 'a4', 'tpl-w',       false, '2026-09-01', null),
      ('s5', 'org-1', 'a5', 'tpl-w',       true,  '2026-12-01', null),
      ('s6', 'org-2', 'a6', 'tpl-m',       true,  '2026-01-31', null),
      ('s7', 'org-2', 'a7', 'tpl-w',       true,  '2026-10-06', null);
    insert into compliance.fm_ppm_occurrences (id, org_id, schedule_id, asset_id, due_date) values ('o-pre', 'org-2', 's7', 'a7', '2026-10-06');
  `)
}

const nextDue = async (db: PGlite) =>
  Object.fromEntries((await q<{ id: string; d: string }>(db, "select id, next_due_date::text d from compliance.fm_ppm_schedules order by id")).map((r) => [r.id, r.d]))

describe("drizzle/0632 fm-ppm occurrences on PGlite", () => {
  let db: PGlite
  let firstOverdue: Array<{ id: string; at: string }> = []
  beforeAll(async () => {
    db = await newDb(["fm_checklist_templates", "fm_ppm_schedules", "fm_ppm_occurrences"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs on an empty database and reports zeros", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_fm_ppm_generate_occurrences: Record<string, unknown> }>(command)).rows[0].cron_fm_ppm_generate_occurrences
    expect(res).toMatchObject({ lookahead_days: 14, due_schedules_in_window: 0, generated: 0, marked_overdue: 0 })
  })

  test("one run: due schedules get one occurrence and advance, skipped ones stay, past-due occurrences turn overdue once", async () => {
    await seedMixed(db)
    const res = await call(db, RUN)
    expect(res).toMatchObject({
      today_utc: TODAY,
      cutoff: "2026-10-10",
      due_schedules_in_window: 5, // s1, s2, s3 (orphan), s6, s7
      generated: 3, // s1, s2, s6
      marked_overdue: 2, // s2 (2026-09-20) and s6 (2026-01-31)
      skipped_existing_occurrence: 1, // s7 already has its occurrence
      skipped_orphan_schedule: 1, // s3
      skipped_unknown_frequency: 0,
    })
    expect(await nextDue(db)).toEqual({
      s1: "2026-11-05", // monthly
      s2: "2026-09-21", // daily, one interval per run
      s3: "2026-10-01", // orphaned: untouched
      s4: "2026-09-01", // inactive: untouched
      s5: "2026-12-01", // outside the window: untouched
      s6: "2026-02-28", // monthly from 31 Jan clamps to 28 Feb
      s7: "2026-10-06", // already generated: not advanced
    })
    const occ = await q<Record<string, unknown>>(
      db,
      "select schedule_id, org_id, asset_id, due_date::text due, assignee_id, status::text status, overdue_notified_at is not null notified from compliance.fm_ppm_occurrences order by schedule_id",
    )
    expect(occ).toEqual([
      { schedule_id: "s1", org_id: "org-1", asset_id: "a1", due: "2026-10-05", assignee_id: "u-tech", status: "due", notified: false },
      { schedule_id: "s2", org_id: "org-1", asset_id: "a2", due: "2026-09-20", assignee_id: null, status: "overdue", notified: true },
      { schedule_id: "s6", org_id: "org-2", asset_id: "a6", due: "2026-01-31", assignee_id: null, status: "overdue", notified: true },
      { schedule_id: "s7", org_id: "org-2", asset_id: "a7", due: "2026-10-06", assignee_id: null, status: "due", notified: false },
    ])
    firstOverdue = (await q<{ id: string; at: string }>(db, "select id, overdue_notified_at::text at from compliance.fm_ppm_occurrences where status = 'overdue'")).sort((a, b) => a.id.localeCompare(b.id))
    const pointer = await one<{ ok: boolean }>(
      db,
      "select (s.last_generated_occurrence_id = o.id) ok from compliance.fm_ppm_schedules s join compliance.fm_ppm_occurrences o on o.schedule_id = s.id and o.due_date = '2026-10-05' where s.id = 's1'",
    )
    expect(pointer.ok).toBe(true)
  })

  test("a second run creates no duplicate: an already generated schedule is skipped, a behind schedule advances one more interval, nothing is marked overdue twice", async () => {
    const res = await call(db, RUN)
    expect(res).toMatchObject({ due_schedules_in_window: 4, generated: 2, marked_overdue: 2, skipped_existing_occurrence: 1 })
    const dup = await count(db, "(select schedule_id, due_date from compliance.fm_ppm_occurrences group by 1, 2 having count(*) > 1) d")
    expect(dup).toBe(0)
    expect(await count(db, "compliance.fm_ppm_occurrences", "schedule_id = 's1'")).toBe(1)
    expect(await count(db, "compliance.fm_ppm_occurrences")).toBe(6)
    expect(await nextDue(db)).toMatchObject({ s1: "2026-11-05", s2: "2026-09-22", s6: "2026-03-28", s7: "2026-10-06" })
    // an occurrence marked overdue by the first run keeps its first notification time
    const after = await q<{ id: string; at: string }>(db, `select id, overdue_notified_at::text at from compliance.fm_ppm_occurrences where id in (${firstOverdue.map((r) => `'${r.id}'`).join(",")})`)
    expect(firstOverdue.length).toBe(2)
    expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(firstOverdue)
  })

  test("re-running on a schedule that is on time changes nothing the second time", async () => {
    await db.exec(`
      delete from compliance.fm_ppm_occurrences; delete from compliance.fm_ppm_schedules; delete from compliance.fm_checklist_templates;
      insert into compliance.fm_checklist_templates (id, frequency) values ('tpl-m', 'monthly');
      insert into compliance.fm_ppm_schedules (id, org_id, asset_id, checklist_template_id, next_due_date) values ('s1', 'org-1', 'a1', 'tpl-m', '2026-10-05');`)
    expect(await call(db, RUN)).toMatchObject({ generated: 1, marked_overdue: 0 })
    expect(await call(db, RUN)).toMatchObject({ generated: 0, marked_overdue: 0, due_schedules_in_window: 0 })
    expect(await count(db, "compliance.fm_ppm_occurrences")).toBe(1)
    expect((await nextDue(db)).s1).toBe("2026-11-05")
  })

  test("every frequency advances by its own interval, and month arithmetic clamps at month-end", async () => {
    await db.exec(`
      delete from compliance.fm_ppm_occurrences; delete from compliance.fm_ppm_schedules; delete from compliance.fm_checklist_templates;
      insert into compliance.fm_checklist_templates (id, frequency) values
        ('t-daily','daily'), ('t-weekly','weekly'), ('t-fort','fortnightly'), ('t-month','monthly'), ('t-quart','quarterly'), ('t-half','half_yearly'), ('t-year','annually');
      insert into compliance.fm_ppm_schedules (id, org_id, asset_id, checklist_template_id, next_due_date) values
        ('daily','o','a1','t-daily','2026-09-26'), ('weekly','o','a2','t-weekly','2026-09-26'), ('fort','o','a3','t-fort','2026-09-26'),
        ('month','o','a4','t-month','2026-09-26'), ('quart','o','a5','t-quart','2026-09-26'), ('half','o','a6','t-half','2026-08-31'),
        ('year','o','a7','t-year','2028-02-29');`)
    await call(db, `compliance.cron_fm_ppm_generate_occurrences(800, '${TODAY}')`)
    expect(await nextDue(db)).toEqual({
      daily: "2026-09-27",
      weekly: "2026-10-03",
      fort: "2026-10-10",
      month: "2026-10-26",
      quart: "2026-12-26",
      half: "2027-02-28",
      year: "2029-02-28",
    })
  })

  test("a look-ahead below 0 or null is refused, and 0 only takes schedules due today or earlier", async () => {
    await seedMixed(db)
    for (const arg of ["-1", "null"]) {
      await expect(db.query(`select compliance.cron_fm_ppm_generate_occurrences(${arg}, '${TODAY}')`)).rejects.toThrow("p_lookahead_days must be >= 0")
    }
    const res = await call(db, `compliance.cron_fm_ppm_generate_occurrences(0, '${TODAY}')`)
    expect(res).toMatchObject({ cutoff: TODAY, generated: 2 }) // s2 and s6 only; s1 is due 5 Oct
    expect((await nextDue(db)).s1).toBe("2026-10-05")
  })

  test("a frequency label the function does not know is skipped and counted, never inserted or advanced", async () => {
    await db.exec(`
      alter type compliance.fm_ppm_frequency add value 'biweekly';
    `)
    await db.exec(`
      delete from compliance.fm_ppm_occurrences; delete from compliance.fm_ppm_schedules; delete from compliance.fm_checklist_templates;
      insert into compliance.fm_checklist_templates (id, frequency) values ('t-new', 'biweekly');
      insert into compliance.fm_ppm_schedules (id, org_id, asset_id, checklist_template_id, next_due_date) values ('sx', 'o', 'a1', 't-new', '2026-10-01');`)
    const res = await call(db, RUN)
    expect(res).toMatchObject({ due_schedules_in_window: 1, generated: 0, skipped_unknown_frequency: 1 })
    expect(await count(db, "compliance.fm_ppm_occurrences")).toBe(0)
    expect((await nextDue(db)).sx).toBe("2026-10-01")
  })

  test("a refused advisory lock returns skipped and writes nothing", async () => {
    await seedMixed(db)
    await withRefusedLock(db, CFG.functions[0], async () => {
      const res = await call(db, RUN)
      expect(res.skipped).toBe(true)
    })
    expect(await count(db, "compliance.fm_ppm_occurrences")).toBe(1) // only the seeded o-pre
    expect((await nextDue(db)).s1).toBe("2026-10-05")
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
