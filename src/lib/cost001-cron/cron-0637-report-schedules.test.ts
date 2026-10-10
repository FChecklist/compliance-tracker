/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0637, job cost001-report-schedules (due report schedules on pg_cron, hourly at minute 5).
// Runs drizzle/0637_build001_cron_report_schedules.sql and its down file on PGlite against the live shape of compliance.report_schedules
// and notifications. Proves: the lifecycle (see pglite-kit.ts) with the hourly schedule the PM chose (decision 6); every cadence branch
// on the UTC wall clock, including biweekly, a day of month clamped to a short month, year_to_date and custom_range; times_of_day
// decides the hour, and an empty one fires at the default hour 8 (cadence hourly fires every hour); a dry run writes nothing; the
// once-per-slot guard stops a re-run inside one hour; notification dedup is ON; one schedule failing does not stop the others; a
// refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0637-report-schedules.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0637",
  job: "cost001-report-schedules",
  schedule: "5 * * * *",
  command: "select compliance.cron_report_schedules();",
  functions: [{ name: "cron_report_schedules", args: "boolean, boolean, timestamptz, integer, boolean" }],
}
// Monday 14 September 2026 08:10 UTC and neighbours. Notifications get created_at = the run's clock (stamp) because the function
// stamps rows with the real now(), and the once-per-slot guard compares created_at with the top of p_now's hour.
const MON_0810 = "2026-09-14T08:10:00Z"
const MON_0820 = "2026-09-14T08:20:00Z"
const MON_0910 = "2026-09-14T09:10:00Z"
const RUN = (now: string, args = "") => `compliance.cron_report_schedules(${args}${args ? ", " : ""}p_now => '${now}')`

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.notifications; delete from compliance.report_schedules;
    insert into compliance.report_schedules (id, report_id, cadence, day_of_week, day_of_month, times_of_day, start_date, end_date, recipient_user_ids, is_active) values
      ('sA', 'rep-a', 'daily',        null, null, null,                     null,         null,         '["u1","u2"]', true),
      ('sB', 'rep-b', 'daily',        null, null, '["17:00"]',              null,         null,         '["u1"]',      true),
      ('sC', 'rep-c', 'hourly',       null, null, '[]',                     null,         null,         '["u1"]',      true),
      ('sD', 'rep-d', 'weekly',       1,    null, '[]',                     null,         null,         '["u2"]',      true),
      ('sE', 'rep-e', 'weekly',       2,    null, '[]',                     null,         null,         '["u2"]',      true),
      ('sF', 'rep-f', 'monthly',      null, 31,   '[]',                     null,         null,         '["u2"]',      true),
      ('sG', 'rep-g', 'immediate',    null, null, '[]',                     null,         null,         '["u1"]',      true),
      ('sH', 'rep-h', 'on_demand',    null, null, '[]',                     null,         null,         '["u1"]',      true),
      ('sI', 'rep-i', 'custom_range', null, null, '[]',                     '2026-09-01', '2026-09-14', '["u3"]',      true),
      ('sJ', 'rep-j', 'daily',        null, null, '[]',                     null,         null,         '["u1"]',      false),
      ('sK', 'rep-k', 'biweekly',     1,    null, '[]',                     null,         null,         '["u2"]',      true),
      ('sL', 'rep-l', 'year_to_date', null, null, '[]',                     null,         null,         '["u1"]',      true),
      ('sM', 'rep-m', 'daily',        null, null, '["08:30","12:00"]',      null,         null,         '["u1"]',      true);
  `)
}

const stamp = (db: PGlite, at: string) => db.exec(`update compliance.notifications set created_at = '${at}'`)

const dryRun = async (db: PGlite, now: string) =>
  (await call(db, RUN(now, "p_dry_run => true"))) as { checked: number; due: number; delivered: number; deduped: number; slotSkipped: number; errors: number; utcHour: string; dryRun: boolean }

// The ids of the schedules that deliver at `now`: a real run on an empty notifications table, read back, then cleared.
const dueSet = async (db: PGlite, now: string, args = "") => {
  await db.exec("delete from compliance.notifications")
  await call(db, RUN(now, args))
  const ids = (await q<{ sid: string }>(db, "select distinct metadata->>'reportScheduleId' sid from compliance.notifications order by 1")).map((r) => r.sid)
  await db.exec("delete from compliance.notifications")
  return ids
}

describe("drizzle/0637 report schedules on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["report_schedules", "notifications"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs on an empty database and reports zeros", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_report_schedules: Record<string, unknown> }>(command)).rows[0].cron_report_schedules
    expect(res).toMatchObject({ checked: 0, due: 0, delivered: 0, errors: 0, dryRun: false })
  })

  test("a dry run on Monday 08:10 counts the six schedules due and 7 deliveries, and writes nothing", async () => {
    await seed(db)
    const res = await dryRun(db, MON_0810)
    // due: sA daily, sC hourly, sD weekly Monday, sI custom_range ending today, sK biweekly Monday, sM daily with an 08:30 slot
    expect(res).toMatchObject({ checked: 12, due: 6, delivered: 7, deduped: 0, slotSkipped: 0, errors: 0, utcHour: "08", dryRun: true })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  test("a real run writes one 'system' notification per recipient of each due schedule, body-less, with the dedup key in the metadata", async () => {
    const res = await call(db, RUN(MON_0810))
    expect(res).toMatchObject({ due: 6, delivered: 7, dryRun: false })
    await stamp(db, MON_0810)
    const perSchedule = await q<{ sid: string; n: number }>(db, "select metadata->>'reportScheduleId' sid, count(*)::int n from compliance.notifications group by 1 order by 1")
    expect(perSchedule).toEqual([
      { sid: "sA", n: 2 },
      { sid: "sC", n: 1 },
      { sid: "sD", n: 1 },
      { sid: "sI", n: 1 },
      { sid: "sK", n: 1 },
      { sid: "sM", n: 1 },
    ])
    const a = await one<{ user_id: string; title: string; message: string; type: string; metadata: Record<string, unknown> }>(
      db,
      "select user_id, title, message, type::text type, metadata from compliance.notifications where metadata->>'reportScheduleId' = 'sA' and user_id = 'u2'",
    )
    expect(a.title).toBe("Scheduled report ready: rep-a")
    expect(a.message).toBe('Your daily "rep-a" report is due. Open Reports to view it (no auto-generator is wired for this report id yet, so no content is attached here).')
    expect(a.type).toBe("system")
    expect(a.metadata).toEqual({ kind: "report_schedule", reportScheduleId: "sA", reportId: "rep-a", cadence: "daily", report: null })
  })

  test("a re-run inside the same hour delivers nothing (once per slot), and with that guard off the dedup still stops it", async () => {
    expect(await call(db, RUN(MON_0820))).toMatchObject({ delivered: 0, slotSkipped: 7 })
    expect(await call(db, RUN(MON_0820, "p_once_per_slot => false"))).toMatchObject({ delivered: 0, deduped: 7, slotSkipped: 0 })
    expect(await count(db, "compliance.notifications")).toBe(7)
  })

  test("with both guards off a re-run repeats every delivery (proving what the two guards stop)", async () => {
    expect(await call(db, RUN(MON_0820, "p_once_per_slot => false, p_dedup => false"))).toMatchObject({ delivered: 7 })
    expect(await count(db, "compliance.notifications")).toBe(14)
  })

  test("an hour later only the hourly schedule is due; an unread notification suppresses it and a read one does not", async () => {
    await db.exec("delete from compliance.notifications")
    await call(db, RUN(MON_0810))
    await stamp(db, MON_0810)
    expect(await call(db, RUN(MON_0910))).toMatchObject({ due: 1, delivered: 0, deduped: 1, slotSkipped: 0, utcHour: "09" })
    await db.exec("update compliance.notifications set is_read = true where metadata->>'reportScheduleId' = 'sC'")
    expect(await call(db, RUN(MON_0910))).toMatchObject({ due: 1, delivered: 1, deduped: 0 })
  })

  test("times_of_day picks the hour: 17:05 fires the 17:00 schedule and the hourly one", async () => {
    expect(await dueSet(db, "2026-09-14T17:05:00Z")).toEqual(["sB", "sC"])
  })

  test("an empty times_of_day fires at the default hour, which is a parameter", async () => {
    // default hour 9 at 09:10: sA, sC, sD, sI, sK (sM lists 08:30 and 12:00, sB lists 17:00)
    expect(await dueSet(db, MON_0910, "p_default_hour => 9")).toEqual(["sA", "sC", "sD", "sI", "sK"])
    expect(await dueSet(db, MON_0910)).toEqual(["sC"]) // default hour 8: only the hourly one
  })

  test("weekly schedules fire on their weekday, and a monthly one on day 31 fires on the last day of a 30 day month", async () => {
    expect(await dueSet(db, "2026-09-29T08:10:00Z")).toEqual(["sA", "sC", "sE", "sM"]) // Tuesday: sE is weekly on day 2
    expect(await dueSet(db, "2026-09-30T08:10:00Z")).toEqual(["sA", "sC", "sF", "sM"]) // Wednesday 30th: sF (31 clamps to 30)
  })

  test("biweekly fires on its weekday and three days later; year_to_date only on 1 January; custom_range on its end date", async () => {
    expect(await dueSet(db, "2026-09-17T08:10:00Z")).toEqual(["sA", "sC", "sK", "sM"]) // Thursday: Monday plus 3
    expect(await dueSet(db, "2027-01-01T08:10:00Z")).toEqual(["sA", "sC", "sL", "sM"]) // Friday 1 January
    expect(await dueSet(db, MON_0810)).toEqual(["sA", "sC", "sD", "sI", "sK", "sM"]) // sI ends 14 September
    expect(await dueSet(db, "2026-09-15T08:10:00Z")).toEqual(["sA", "sC", "sE", "sM"]) // day after: sI is over
  })

  test("one schedule whose delivery fails is counted as an error and the others still deliver", async () => {
    await db.exec(`
      delete from compliance.notifications;
      insert into compliance.report_schedules (id, report_id, cadence, recipient_user_ids) values ('sZ', 'rep-z', 'daily', '["u-bad"]');
      create function compliance.reject_bad_user() returns trigger language plpgsql as $t$
      begin
        if new.user_id = 'u-bad' then raise exception 'synthetic failure'; end if;
        return new;
      end
      $t$;
      create trigger reject_bad_user before insert on compliance.notifications for each row execute function compliance.reject_bad_user();`)
    try {
      const res = await call(db, RUN(MON_0810))
      expect(res).toMatchObject({ due: 7, delivered: 7, errors: 1 })
      expect(await count(db, "compliance.notifications", "user_id = 'u-bad'")).toBe(0)
    } finally {
      await db.exec("drop trigger reject_bad_user on compliance.notifications; drop function compliance.reject_bad_user(); delete from compliance.report_schedules where id = 'sZ'")
    }
  })

  test("a refused advisory lock returns skipped overlap and writes nothing", async () => {
    await db.exec("delete from compliance.notifications")
    await withRefusedLock(db, CFG.functions[0], async () => {
      expect(await call(db, RUN(MON_0810))).toEqual({ skipped: "overlap" })
    })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
