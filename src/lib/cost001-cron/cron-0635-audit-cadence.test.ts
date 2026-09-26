/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0635, job cost001-audit-cadence (audit-cadence re-audit flagging on pg_cron).
// Runs drizzle/0635_build001_cron_audit_cadence.sql and its down file on PGlite against the live shape of compliance.activity_log.
// Proves: the job and function lifecycle (see pglite-kit.ts), the 24 hour window the PM chose (decision 5; the old TypeScript scanned
// 3 hours), that a run flags only recent failed rows once, and that a refused advisory lock skips the run without writing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0635-audit-cadence.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0635",
  job: "cost001-audit-cadence",
  schedule: "15 8 * * *",
  command: "select compliance.cron_audit_cadence();",
  functions: [{ name: "cron_audit_cadence", args: "integer" }],
}
const REASON = "L2 Continuous Monitoring: automated failure detection (audit-cadence-scan.ts)"

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.activity_log;
    insert into compliance.activity_log (id, org_id, lifecycle_stage, created_at, updated_at) values
      ('a-2h',  'org-1', 'failed',    now() - interval '2 hours',  now() - interval '5 days'),
      ('a-10h', 'org-1', 'failed',    now() - interval '10 hours', now() - interval '5 days'),
      ('a-30h', 'org-1', 'failed',    now() - interval '30 hours', now() - interval '5 days'),
      ('a-ok',  'org-1', 'completed', now() - interval '1 hour',   now() - interval '5 days');
    insert into compliance.activity_log (id, org_id, lifecycle_stage, created_at, updated_at, re_audit_requested_at, re_audit_reason, re_audit_requested_by) values
      ('a-flagged', 'org-2', 'failed', now() - interval '1 hour', now() - interval '5 days', now() - interval '30 minutes', 'manual', 'someone');
  `)
}

const flaggedIds = async (db: PGlite) =>
  (await q<{ id: string }>(db, "select id from compliance.activity_log where re_audit_requested_by = 'system:audit-cadence-scan' order by id")).map((r) => r.id)

describe("drizzle/0635 audit-cadence on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["activity_log"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command uses the 24 hour window: a failure 10 hours old is flagged, one 30 hours old and a completed row are not", async () => {
    await seed(db)
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_audit_cadence: Record<string, unknown> }>(command)).rows[0].cron_audit_cadence
    expect(res).toMatchObject({ scanned_window_hours: 24, candidates_found: 2, flagged: 2, already_flagged: 0 })
    expect(await flaggedIds(db)).toEqual(["a-10h", "a-2h"])
    // updated_at was seeded 5 days back, so a value inside the last day proves the function stamped it
    const row = await one<{ re_audit_reason: string; re_audit_requested_at: unknown; stamped: boolean }>(
      db,
      "select re_audit_reason, re_audit_requested_at, updated_at > now() - interval '1 day' as stamped from compliance.activity_log where id = 'a-10h'",
    )
    expect(row.re_audit_reason).toBe(REASON)
    expect(row.re_audit_requested_at).not.toBeNull()
    expect(row.stamped).toBe(true)
    // untouched: too old, not failed, and a row a person had already flagged
    const untouched = await q<{ id: string; re_audit_reason: string | null; re_audit_requested_by: string | null }>(
      db,
      "select id, re_audit_reason, re_audit_requested_by from compliance.activity_log where id in ('a-30h','a-ok','a-flagged') order by id",
    )
    expect(untouched).toEqual([
      { id: "a-30h", re_audit_reason: null, re_audit_requested_by: null },
      { id: "a-flagged", re_audit_reason: "manual", re_audit_requested_by: "someone" },
      { id: "a-ok", re_audit_reason: null, re_audit_requested_by: null },
    ])
    expect(await count(db, "compliance.activity_log", "id in ('a-30h','a-ok','a-flagged') and updated_at < now() - interval '1 day'")).toBe(3)
  })

  test("a second run flags nothing more (each row is flagged once)", async () => {
    const res = await call(db, "compliance.cron_audit_cadence()")
    expect(res).toMatchObject({ flagged: 0, candidates_found: 0 })
    expect(await flaggedIds(db)).toEqual(["a-10h", "a-2h"])
  })

  test("an explicit 3 hour window (the old TypeScript value) flags only the 2 hour old failure", async () => {
    await seed(db)
    const res = await call(db, "compliance.cron_audit_cadence(3)")
    expect(res).toMatchObject({ scanned_window_hours: 3, flagged: 1 })
    expect(await flaggedIds(db)).toEqual(["a-2h"])
  })

  test("a window of 0, a negative window and null are refused and write nothing", async () => {
    await seed(db)
    for (const arg of ["0", "-5", "null"]) {
      await expect(db.query(`select compliance.cron_audit_cadence(${arg})`)).rejects.toThrow("p_window_hours must be > 0")
    }
    expect(await flaggedIds(db)).toEqual([])
  })

  test("a refused advisory lock returns skipped and writes nothing", async () => {
    await seed(db)
    await withRefusedLock(db, CFG.functions[0], async () => {
      const res = await call(db, "compliance.cron_audit_cadence()")
      expect(res.skipped).toBe(true)
      expect(res.reason).toContain("advisory lock")
    })
    expect(await flaggedIds(db)).toEqual([])
    expect(await count(db, "compliance.activity_log")).toBe(5)
    // and the function is back to normal afterwards
    expect(await call(db, "compliance.cron_audit_cadence()")).toMatchObject({ flagged: 2 })
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
