/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0640, job cost001-pipeline-stuck-deal-digest (stuck CRM deals digest on pg_cron).
// Runs drizzle/0640_build001_cron_pipeline_stuck_deals.sql and its down file on PGlite against the live shape of
// compliance.crm_opportunities, crm_stage_history and notifications. Proves: the lifecycle (see pglite-kit.ts); open owned deals whose
// last stage change (or creation) is 30 or more days back are grouped into one notification per owner, with the single-deal and
// several-deal messages; won, lost and ownerless deals and a recent stage change keep a deal out; a dry run writes nothing; notification
// dedup is ON (an owner with an unread digest gets no second one); the threshold is a parameter; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0640-pipeline-stuck-deals.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0640",
  job: "cost001-pipeline-stuck-deal-digest",
  schedule: "50 9 * * *",
  command: "select compliance.cron_pipeline_stuck_deal_digest();",
  functions: [{ name: "cron_pipeline_stuck_deal_digest", args: "boolean, boolean, integer, timestamptz" }],
}
const NOW = "2026-09-28T00:00:00Z"
const RUN = (args = "") => `compliance.cron_pipeline_stuck_deal_digest(${args}${args ? ", " : ""}p_now => '${NOW}')`

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.notifications; delete from compliance.crm_stage_history; delete from compliance.crm_opportunities;
    insert into compliance.crm_opportunities (id, org_id, name, stage, owner_id, created_at) values
      ('o1', 'org-1', 'Deal One',   'negotiation', 'u1', '2026-08-19T00:00:00Z'), -- 40 days
      ('o2', 'org-1', 'Deal Two',   'negotiation', 'u1', '2026-08-09T00:00:00Z'), -- created 50 days ago, moved 5 days ago
      ('o3', 'org-1', 'Deal Three', 'proposal',    'u2', '2026-07-30T00:00:00Z'), -- 60 days
      ('o4', 'org-1', 'Deal Four',  'won',         'u1', '2026-01-01T00:00:00Z'),
      ('o5', 'org-1', 'Deal Five',  'proposal',    null, '2026-01-01T00:00:00Z'),
      ('o6', 'org-2', 'Deal Six',   'qualified',   'u2', '2026-08-14T00:00:00Z'), -- 45 days
      ('o7', 'org-2', 'Deal Seven', 'lost',        'u3', '2026-01-01T00:00:00Z');
    insert into compliance.crm_stage_history (entity_type, entity_id, changed_at) values
      ('opportunity', 'o2', '2026-09-23T00:00:00Z'),
      ('lead',        'o1', '2026-09-27T00:00:00Z'); -- another entity type: must not count for o1
  `)
}

const rows = (db: PGlite) =>
  q<{ user_id: string; title: string; message: string; type: string; metadata: Record<string, unknown> }>(
    db,
    "select user_id, title, message, type::text type, metadata from compliance.notifications order by user_id, created_at, id",
  )

describe("drizzle/0640 pipeline stuck deals on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["crm_opportunities", "crm_stage_history", "notifications"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs on an empty database and notifies nobody", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_pipeline_stuck_deal_digest: Record<string, unknown> }>(command)).rows[0].cron_pipeline_stuck_deal_digest
    expect(res).toMatchObject({ ownersNotified: 0, dealsCovered: 0, dryRun: false })
  })

  test("a dry run returns the real counts and writes nothing", async () => {
    await seed(db)
    const res = await call(db, RUN("p_dry_run => true"))
    expect(res).toMatchObject({ ownersNotified: 2, dealsCovered: 3, deduped: 0, dryRun: true })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  test("a real run writes one notification per owner: the single-deal message and the several-deal message", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ ownersNotified: 2, dealsCovered: 3, deduped: 0 })
    const got = await rows(db)
    expect(got.map((r) => r.user_id)).toEqual(["u1", "u2"]) // not u3 (lost) and not the ownerless deal
    expect(got.every((r) => r.title === "Deals stuck in pipeline" && r.type === "deadline_reminder" && r.metadata.kind === "pipeline_stuck_deal_digest")).toBe(true)
    expect(got[0].message).toBe('"Deal One" has been in negotiation for 40 days with no stage change.')
    expect(got[0].metadata.opportunityIds).toEqual(["o1"]) // o2 moved 5 days ago, o4 is won
    expect(got[1].message).toBe("2 deals have been stuck in their current stage for 30+ days (longest: 60 days).")
    expect(got[1].metadata.opportunityIds).toEqual(["o3", "o6"]) // oldest first
  })

  test("a second run creates no duplicate: an owner with an unread digest is skipped (dedup is on by default)", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ ownersNotified: 0, deduped: 2 })
    expect(await count(db, "compliance.notifications")).toBe(2)
  })

  test("an owner who has read the digest gets a new one; p_dedup => false repeats every owner", async () => {
    await db.exec("update compliance.notifications set is_read = true where user_id = 'u2'")
    expect(await call(db, RUN())).toMatchObject({ ownersNotified: 1, deduped: 1 })
    expect(await count(db, "compliance.notifications", "user_id = 'u2'")).toBe(2)
    expect(await call(db, RUN("p_dedup => false"))).toMatchObject({ ownersNotified: 2, deduped: 0 })
    expect(await count(db, "compliance.notifications")).toBe(5)
  })

  test("the threshold is a parameter and appears in the message", async () => {
    await db.exec("delete from compliance.notifications")
    const res = await call(db, RUN("p_stuck_threshold_days => 55"))
    expect(res).toMatchObject({ ownersNotified: 1, dealsCovered: 1 }) // only Deal Three (60 days)
    expect((await rows(db))[0].message).toBe('"Deal Three" has been in proposal for 60 days with no stage change.')
    await db.exec("delete from compliance.notifications")
    await call(db, RUN("p_stuck_threshold_days => 45"))
    expect((await rows(db)).map((r) => r.message)).toEqual(["2 deals have been stuck in their current stage for 45+ days (longest: 60 days)."])
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
