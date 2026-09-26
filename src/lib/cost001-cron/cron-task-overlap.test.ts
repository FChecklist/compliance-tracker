/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B, decision 3 (PMD-44): the overdue check inside cost001-metric-alerts (migration 0633, 05:00) and the
// digest cost001-task-nudge-digest (migration 0636, 08:00) both tell the owner of a task that it is overdue, and both are kept.
// A per-kind dedup alone does not stop the double notice, because the two write different metadata kinds. This test applies both
// migrations to one PGlite database and runs the two jobs' own commands, read back from cron.job, in schedule order over two days.
// It proves that no owner has two unread notices about one overdue task at any point: the digest leaves out a task whose task_overdue
// notice is unread, the overdue check skips a recipient whose unread digest lists the task, and the assigner still gets the task_overdue
// notice.
// Run: bun test --isolate src/lib/cost001-cron/cron-task-overlap.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, forwardSql, one, q, count } from "./pglite-kit"

setDefaultTimeout(60_000)

// the fifteen tables the seven functions of 0633 use; the digest of 0636 uses only tasks and notifications, which are among them
const TABLES = [
  "organisations", "users", "notifications", "tickets", "sla_policies", "escalation_rules", "ticket_escalation_events", "tasks",
  "token_usage_ledger", "metric_alert_rules", "compliance_items", "notices", "risks", "pms_issues", "incidents",
]
const METRIC_JOB = "cost001-metric-alerts"
const DIGEST_JOB = "cost001-task-nudge-digest"

describe("task overdue check and task nudge digest, run through their own job commands", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(TABLES)
    await db.exec(forwardSql("0633"))
    await db.exec(forwardSql("0636"))
    await db.exec(`
      insert into compliance.tasks (id, org_id, title, status, due_date, user_id, assigned_by_id) values
        ('k1', 'o', 'Both told',     'pending',     now() - interval '2 days', 'u1', 'u2'),
        ('k2', 'o', 'Soon',          'pending',     now() + interval '1 day',  'u1', null),
        ('k3', 'o', 'Solo late',     'in_progress', now() - interval '1 day',  'u3', null),
        ('k4', 'o', 'Assigned late', 'pending',     now() - interval '3 days', 'u4', 'u5');`)
  })
  afterAll(async () => {
    await db.close()
  })

  /** Runs the job's command exactly as pg_cron would and returns the jsonb it returns. */
  async function runJob(job: string): Promise<Record<string, any>> {
    const { command } = await one<{ command: string }>(db, `select command from cron.job where jobname = '${job}'`)
    const row = (await db.query<Record<string, unknown>>(command)).rows[0]
    return Object.values(row)[0] as Record<string, any>
  }

  // A user with two unread notices about one overdue task: a task_overdue row and a digest that lists the task as overdue, or two of either.
  const toldTwice = () =>
    q(
      db,
      `select user_id, task, count(*)::int n from (
         select user_id, metadata->>'taskId' task from compliance.notifications where metadata->>'kind' = 'task_overdue' and not is_read
         union all
         select nt.user_id, x.task from compliance.notifications nt, jsonb_array_elements_text(nt.metadata->'overdueTaskIds') as x(task)
          where nt.metadata->>'kind' = 'task_nudge_digest' and not nt.is_read
       ) s group by user_id, task having count(*) > 1`,
    )
  const errorKeys = (res: Record<string, any>) => Object.entries(res).filter(([, v]) => v && typeof v === "object" && "error" in v).map(([k]) => k)
  const overdueRows = async () =>
    (await q<{ user_id: string; task: string }>(db, "select user_id, metadata->>'taskId' task from compliance.notifications where metadata->>'kind' = 'task_overdue' order by user_id, task")).map(
      (r) => `${r.user_id}:${r.task}`,
    )

  test("day 1, 05:00: the overdue check notifies every owner and assigner of an overdue task, once", async () => {
    const res = await runJob(METRIC_JOB)
    expect(errorKeys(res)).toEqual([])
    expect(res.taskOverdue).toMatchObject({ overdue: 3, notified: 5, deduped: 0 })
    expect(await overdueRows()).toEqual(["u1:k1", "u2:k1", "u3:k3", "u4:k4", "u5:k4"])
    expect(await toldTwice()).toEqual([])
  })

  test("day 1, 08:00: the digest leaves out every task the overdue check already reported, unless the owner has read that notice", async () => {
    await db.exec("update compliance.notifications set is_read = true where user_id = 'u1' and metadata->>'taskId' = 'k1'") // u1 reads its notice
    const res = await runJob(DIGEST_JOB)
    // u3 and u4 have only tasks that are already reported: nothing is written for them. u1 read its notice, so k1 is listed again with k2.
    expect(res).toMatchObject({ usersNotified: 1, tasksCovered: 2, deduped: 2, dryRun: false })
    const digests = await q<{ user_id: string; message: string; metadata: Record<string, unknown> }>(
      db,
      "select user_id, message, metadata from compliance.notifications where metadata->>'kind' = 'task_nudge_digest'",
    )
    expect(digests.map((d) => d.user_id)).toEqual(["u1"])
    expect(digests[0].metadata).toEqual({ kind: "task_nudge_digest", overdueTaskIds: ["k1"], dueSoonTaskIds: ["k2"] })
    expect(await count(db, "compliance.notifications")).toBe(6)
    expect(await toldTwice()).toEqual([])
  })

  test("day 2, 05:00: the overdue check skips u1 because the unread digest lists k1, and adds nothing for anyone else", async () => {
    const res = await runJob(METRIC_JOB)
    expect(errorKeys(res)).toEqual([])
    expect(res.taskOverdue).toMatchObject({ overdue: 3, notified: 0, deduped: 5 }) // u1:k1 by the digest, the other four by their own unread notice
    expect(await count(db, "compliance.notifications")).toBe(6)
    expect(await toldTwice()).toEqual([])
  })

  test("day 2, 08:00: the digest writes nothing new", async () => {
    const res = await runJob(DIGEST_JOB)
    expect(res).toMatchObject({ usersNotified: 0, deduped: 3 }) // u1 has an unread digest; u3 and u4 have only reported tasks
    expect(await count(db, "compliance.notifications")).toBe(6)
    expect(await toldTwice()).toEqual([])
  })
})
