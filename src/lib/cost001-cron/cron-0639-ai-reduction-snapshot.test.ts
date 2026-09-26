/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0639, job cost001-ai-reduction-snapshot (monthly AI reduction snapshot on pg_cron).
// Runs drizzle/0639_build001_cron_ai_reduction_snapshot.sql and its down file on PGlite against the live shape of
// platform.task_capabilities and compliance.ai_reduction_snapshots. Proves: the lifecycle (see pglite-kit.ts); one snapshot row holds the
// sums of the three counters over all rows (the default, the design of drizzle/0233) or over org_id IS NULL rows only; an empty source
// writes a row of zeros; the date is the UTC date unless given; a run always adds a row (duplicates on one date are by design); a
// refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0639-ai-reduction-snapshot.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0639",
  job: "cost001-ai-reduction-snapshot",
  schedule: "0 2 1 * *",
  command: "select compliance.cron_ai_reduction_snapshot();",
  functions: [{ name: "cron_ai_reduction_snapshot", args: "boolean, date" }],
}

const snapshots = () => "select snapshot_date::text d, full_software_count f, package_available_count p, novel_count n, total_count t from compliance.ai_reduction_snapshots order by created_at, id"

describe("drizzle/0639 ai reduction snapshot on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["ai_reduction_snapshots", "task_capabilities"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("an empty source writes one row of zeros dated today (UTC), through the job's own command", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_ai_reduction_snapshot: Record<string, unknown> }>(command)).rows[0].cron_ai_reduction_snapshot
    expect(res).toMatchObject({ platform_only: false, source_rows: 0, snapshot: { full_software_count: 0, package_available_count: 0, novel_count: 0, total_count: 0 } })
    const today = (await one<{ d: string }>(db, "select (now() at time zone 'utc')::date::text d")).d
    expect(await q(db, snapshots())).toEqual([{ d: today, f: 0, p: 0, n: 0, t: 0 }])
  })

  test("by default the sums cover every row, platform and org-scoped, and total is the three added", async () => {
    await db.exec(`
      delete from compliance.ai_reduction_snapshots;
      insert into platform.task_capabilities (id, full_software_count, package_available_count, novel_count, org_id) values
        ('c1', 3, 1, 0, null), ('c2', 2, 0, 5, 'org-x');`)
    const res = await call(db, "compliance.cron_ai_reduction_snapshot(p_snapshot_date => '2026-10-01')")
    expect(res).toMatchObject({ source_rows: 2, snapshot: { snapshot_date: "2026-10-01", full_software_count: 5, package_available_count: 1, novel_count: 5, total_count: 11 } })
    expect(await q(db, snapshots())).toEqual([{ d: "2026-10-01", f: 5, p: 1, n: 5, t: 11 }])
  })

  test("p_platform_only pins the org_id IS NULL reading", async () => {
    await db.exec("delete from compliance.ai_reduction_snapshots")
    const res = await call(db, "compliance.cron_ai_reduction_snapshot(true, '2026-10-01')")
    expect(res).toMatchObject({ platform_only: true, source_rows: 1, snapshot: { full_software_count: 3, package_available_count: 1, novel_count: 0, total_count: 4 } })
    expect(await q(db, snapshots())).toEqual([{ d: "2026-10-01", f: 3, p: 1, n: 0, t: 4 }])
  })

  test("a second run on the same date adds another row (harmless by design) and never changes an earlier one", async () => {
    await call(db, "compliance.cron_ai_reduction_snapshot(true, '2026-10-01')")
    expect(await count(db, "compliance.ai_reduction_snapshots", "snapshot_date = '2026-10-01'")).toBe(2)
    expect((await q(db, snapshots())).every((r) => (r as { t: number }).t === 4)).toBe(true)
  })

  test("a refused advisory lock returns skipped and writes no row", async () => {
    const before = await count(db, "compliance.ai_reduction_snapshots")
    await withRefusedLock(db, CFG.functions[0], async () => {
      expect((await call(db, "compliance.cron_ai_reduction_snapshot()")).skipped).toBe(true)
    })
    expect(await count(db, "compliance.ai_reduction_snapshots")).toBe(before)
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
