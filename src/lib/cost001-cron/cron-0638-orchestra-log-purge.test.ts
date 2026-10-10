/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0638, job cost001-orchestra-log-purge (orchestra payload purge on pg_cron).
// Runs drizzle/0638_build001_cron_orchestra_log_purge.sql and its down file on PGlite against the live shape of
// compliance.orchestra_executions. Proves: the lifecycle (see pglite-kit.ts); rows older than the 90 day default lose input and output
// (input becomes the empty object because the column is NOT NULL), keep every other column, and are purged once; younger rows and rows
// already purged are untouched; a retention of 0, a negative value or null raises instead of purging; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0638-orchestra-log-purge.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0638",
  job: "cost001-orchestra-log-purge",
  schedule: "45 9 * * *",
  command: "select compliance.cron_orchestra_log_purge();",
  functions: [{ name: "cron_orchestra_log_purge", args: "integer" }],
}

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.orchestra_executions;
    insert into compliance.orchestra_executions (id, org_id, input, output, created_at, payload_purged_at) values
      ('r100',  'org-1', '{"escalation":{"level":2},"prompt":"synthetic prompt"}', '{"text":"synthetic answer"}', now() - interval '100 days', null),
      ('r91',   'org-1', '{"prompt":"synthetic"}',                                 '{"text":"synthetic"}',        now() - interval '91 days',  null),
      ('r89',   'org-2', '{"prompt":"synthetic"}',                                 '{"text":"synthetic"}',        now() - interval '89 days',  null),
      ('rnew',  'org-2', '{"prompt":"synthetic"}',                                 null,                          now(),                       null),
      ('rdone', 'org-2', '{}',                                                     null,                          now() - interval '200 days', now() - interval '10 days');
  `)
}

const snapshot = (db: PGlite) =>
  q<Record<string, unknown>>(db, "select id, org_id, input::text input, output::text output, created_at::text created, payload_purged_at::text purged from compliance.orchestra_executions order by id")

describe("drizzle/0638 orchestra log purge on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["orchestra_executions"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command purges payloads older than 90 days and nothing else", async () => {
    await seed(db)
    const before = await snapshot(db)
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_orchestra_log_purge: Record<string, unknown> }>(command)).rows[0].cron_orchestra_log_purge
    expect(res).toMatchObject({ retention_days: 90, purged_count: 2 })
    const after = await snapshot(db)
    const by = (rows: Record<string, unknown>[], id: string) => rows.find((r) => r.id === id) as Record<string, unknown>
    for (const id of ["r100", "r91"]) {
      expect(by(after, id)).toMatchObject({ org_id: by(before, id).org_id, input: "{}", output: null, created: by(before, id).created })
      expect(by(after, id).purged).not.toBeNull()
    }
    // younger rows, and the row that was already purged, are byte-for-byte as before
    for (const id of ["r89", "rnew", "rdone"]) expect(by(after, id)).toEqual(by(before, id))
  })

  test("a second run purges nothing more", async () => {
    const before = await snapshot(db)
    expect(await call(db, "compliance.cron_orchestra_log_purge()")).toMatchObject({ purged_count: 0 })
    expect(await snapshot(db)).toEqual(before)
  })

  test("a shorter retention purges younger rows too", async () => {
    await seed(db)
    expect(await call(db, "compliance.cron_orchestra_log_purge(30)")).toMatchObject({ retention_days: 30, purged_count: 3 })
    expect(await count(db, "compliance.orchestra_executions", "payload_purged_at is not null")).toBe(4) // r100, r91, r89 and rdone
    expect(await count(db, "compliance.orchestra_executions", "id = 'rnew' and payload_purged_at is null")).toBe(1)
  })

  test("a retention of 0, a negative retention and null raise and purge nothing", async () => {
    await seed(db)
    for (const arg of ["0", "-1", "null"]) {
      await expect(db.query(`select compliance.cron_orchestra_log_purge(${arg})`)).rejects.toThrow("p_retention_days must be > 0")
    }
    expect(await count(db, "compliance.orchestra_executions", "payload_purged_at is not null")).toBe(1) // only rdone
  })

  test("a refused advisory lock returns skipped and purges nothing", async () => {
    await seed(db)
    await withRefusedLock(db, CFG.functions[0], async () => {
      expect((await call(db, "compliance.cron_orchestra_log_purge()")).skipped).toBe(true)
    })
    expect(await count(db, "compliance.orchestra_executions", "payload_purged_at is not null")).toBe(1)
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
