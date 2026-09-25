/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0636, job cost001-task-nudge-digest (batched task reminders on pg_cron).
// Runs drizzle/0636_build001_cron_task_nudge_digest.sql and its down file on PGlite against the live shape of compliance.tasks and
// compliance.notifications. Proves: the lifecycle (see pglite-kit.ts); one notification per user, overdue wins over due-soon, the
// message text; a dry run returns real counts and writes nothing; notification dedup is ON by default (a user with an unread digest
// gets no second one, a read one is replaced) and p_dedup => false repeats; the window is a parameter; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0636-task-nudge-digest.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0636",
  job: "cost001-task-nudge-digest",
  schedule: "0 8 * * *",
  command: "select compliance.cron_task_nudge_digest();",
  functions: [{ name: "cron_task_nudge_digest", args: "boolean, boolean, integer, timestamptz" }],
}
const NOW = "2026-09-28T06:00:00Z"
const DASH = String.fromCharCode(8212) // the function joins "Pending" and the detail with chr(8212)
const RUN = (args = "") => `compliance.cron_task_nudge_digest(${args}${args ? ", " : ""}p_now => '${NOW}')`

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.notifications; delete from compliance.tasks;
    insert into compliance.tasks (id, org_id, title, status, due_date, user_id) values
      ('t1', 'o', 'Overdue A',  'pending',     '2026-09-27T06:00:00Z', 'u1'),
      ('t2', 'o', 'Overdue B',  'in_progress', '2026-09-26T06:00:00Z', 'u1'),
      ('t3', 'o', 'Soon C',     'pending',     '2026-09-30T06:00:00Z', 'u1'),
      ('t4', 'o', 'Soon D',     'pending',     '2026-09-29T06:00:00Z', 'u2'),
      ('t5', 'o', 'Done',       'completed',   '2026-09-01T06:00:00Z', 'u3'),
      ('t6', 'o', 'Far away',   'pending',     '2026-10-20T06:00:00Z', 'u4'),
      ('t7', 'o', 'No date',    'pending',     null,                   'u5'),
      ('t8', 'o', 'No owner',   'pending',     '2026-09-01T06:00:00Z', null),
      ('t9', 'o', 'Edge',       'pending',     '2026-10-01T06:00:00Z', 'u6'),
      ('t10','o', 'Now',        'pending',     '${NOW}',               'u7'),
      ('t11','o', 'Solo late',  'pending',     '2026-09-20T06:00:00Z', 'u8');
  `)
}

const digests = (db: PGlite) =>
  q<{ user_id: string; title: string; message: string; type: string; metadata: Record<string, unknown> }>(
    db,
    "select user_id, title, message, type::text type, metadata from compliance.notifications order by user_id, created_at, id",
  )

describe("drizzle/0636 task nudge digest on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["tasks", "notifications"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs on an empty database and notifies nobody", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_task_nudge_digest: Record<string, unknown> }>(command)).rows[0].cron_task_nudge_digest
    expect(res).toMatchObject({ usersNotified: 0, tasksCovered: 0, dryRun: false })
  })

  test("a dry run returns the real counts and writes nothing", async () => {
    await seed(db)
    const res = await call(db, RUN("p_dry_run => true"))
    expect(res).toMatchObject({ usersNotified: 5, tasksCovered: 7, deduped: 0, dryRun: true })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  test("a real run writes exactly one 'deadline_reminder' per user with active dated tasks; overdue wins over due-soon", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ usersNotified: 5, tasksCovered: 7, deduped: 0, dryRun: false })
    const rows = await digests(db)
    expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2", "u6", "u7", "u8"]) // not u3 (completed), u4 (far away), u5 (no date), null owner
    expect(rows.every((r) => r.title === "Task nudge" && r.type === "deadline_reminder" && r.metadata.kind === "task_nudge_digest")).toBe(true)
    const msg = Object.fromEntries(rows.map((r) => [r.user_id, r.message]))
    expect(msg).toEqual({
      u1: `Pending ${DASH} 2 tasks overdue`, // two overdue, one due soon: overdue wins and counts the overdue ones
      u2: `Pending ${DASH} Soon D due soon`,
      u6: `Pending ${DASH} Edge due soon`, // exactly at the end of the 3 day window
      u7: `Pending ${DASH} Now due soon`, // due exactly now
      u8: `Pending ${DASH} Solo late overdue`,
    })
    expect(rows[0].metadata).toEqual({ kind: "task_nudge_digest", overdueTaskIds: ["t2", "t1"], dueSoonTaskIds: ["t3"] })
  })

  test("a second run creates no duplicate: a user with an unread digest is skipped (dedup is on by default)", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ usersNotified: 0, deduped: 5 })
    expect(await count(db, "compliance.notifications")).toBe(5)
  })

  test("once the user reads the digest, the next run writes a fresh one for that user only", async () => {
    await db.exec("update compliance.notifications set is_read = true where user_id = 'u1'")
    const res = await call(db, RUN())
    expect(res).toMatchObject({ usersNotified: 1, deduped: 4 })
    expect(await count(db, "compliance.notifications", "user_id = 'u1'")).toBe(2)
    expect(await count(db, "compliance.notifications")).toBe(6)
  })

  test("p_dedup => false repeats every user (the old TypeScript behaviour)", async () => {
    const res = await call(db, RUN("p_dedup => false"))
    expect(res).toMatchObject({ usersNotified: 5, deduped: 0 })
    expect(await count(db, "compliance.notifications")).toBe(11)
  })

  test("the due-soon window is a parameter: 0 days keeps overdue tasks and tasks due right now", async () => {
    await db.exec("delete from compliance.notifications")
    const res = await call(db, RUN("p_due_soon_window_days => 0"))
    expect(res).toMatchObject({ usersNotified: 3, tasksCovered: 4 }) // u1 (2 overdue), u7 (due now), u8 (1 overdue)
  })

  test("a refused advisory lock returns skipped overlap and writes nothing", async () => {
    await db.exec("delete from compliance.notifications")
    await withRefusedLock(db, CFG.functions[0], async () => {
      expect(await call(db, RUN())).toEqual({ skipped: "overlap" })
    })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
