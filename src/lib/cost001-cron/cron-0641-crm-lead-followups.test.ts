/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0641, job cost001-crm-lead-followup-alerts (overdue lead follow-ups on pg_cron).
// Runs drizzle/0641_build001_cron_crm_lead_followups.sql and its down file on PGlite against the live shape of compliance.crm_leads,
// org_product_branch_enablements, platform.product_branches and notifications. Proves: the lifecycle (see pglite-kit.ts); only orgs with
// the sales branch enabled are scanned, only open owned leads whose next action date is today or earlier notify their owner; a dry run
// returns real counts and writes nothing; notification dedup is ON (an unread alert for the same lead is not repeated) and
// p_dedup => false repeats; one org failing does not stop the others; an unknown branch key notifies nobody; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0641-crm-lead-followups.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0641",
  job: "cost001-crm-lead-followup-alerts",
  schedule: "15 11 * * *",
  command: "select compliance.cron_crm_lead_followup_alerts();",
  functions: [{ name: "cron_crm_lead_followup_alerts", args: "boolean, boolean, timestamptz, text" }],
}
const NOW = "2026-09-28T10:00:00Z"
const RUN = (args = "") => `compliance.cron_crm_lead_followup_alerts(${args}${args ? ", " : ""}p_now => '${NOW}')`

async function seed(db: PGlite) {
  await db.exec(`
    delete from compliance.notifications; delete from compliance.crm_leads;
    delete from compliance.org_product_branch_enablements; delete from platform.product_branches;
    insert into platform.product_branches (id, branch_key) values ('pb-sales', 'sales'), ('pb-firm', 'the_firm');
    insert into compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled) values
      ('org-a', 'pb-sales', true), ('org-b', 'pb-sales', true), ('org-c', 'pb-sales', false), ('org-d', 'pb-firm', true);
    insert into compliance.crm_leads (id, org_id, name, owner_id, next_action_date, status) values
      ('l1',  'org-a', 'Lead One',   'u1', '2026-09-20', 'new'),
      ('l2',  'org-a', 'Lead Two',   'u1', '2026-09-28', 'contacted'),  -- due today counts
      ('l3',  'org-a', 'Lead Three', 'u1', '2026-10-05', 'new'),        -- future
      ('l4',  'org-a', 'Lead Four',  'u1', '2026-09-01', 'converted'),
      ('l5',  'org-a', 'Lead Five',  'u1', '2026-09-01', 'lost'),
      ('l6',  'org-a', 'Lead Six',   null, '2026-09-01', 'new'),        -- no owner
      ('l7',  'org-a', 'Lead Seven', '',   '2026-09-01', 'new'),        -- empty owner
      ('l8',  'org-a', 'Lead Eight', 'u1', null,         'new'),        -- no date
      ('l9',  'org-b', 'Lead Nine',  'u2', '2026-09-01', 'new'),
      ('l10', 'org-c', 'Lead Ten',   'u3', '2026-09-01', 'new'),        -- sales branch not enabled
      ('l11', 'org-d', 'Lead Eleven','u4', '2026-09-01', 'new');        -- another branch enabled
  `)
}

const alerts = (db: PGlite) =>
  q<{ user_id: string; title: string; message: string; type: string; metadata: Record<string, unknown> }>(
    db,
    "select user_id, title, message, type::text type, metadata from compliance.notifications order by user_id, message",
  )

describe("drizzle/0641 crm lead follow-up alerts on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(["product_branches", "org_product_branch_enablements", "crm_leads", "notifications"])
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs with no sales branch and reports that", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_crm_lead_followup_alerts: Record<string, unknown> }>(command)).rows[0].cron_crm_lead_followup_alerts
    expect(res).toMatchObject({ branchFound: false, orgsProcessed: 0, totalNotified: 0, dryRun: false })
  })

  test("a dry run returns the real counts and writes nothing", async () => {
    await seed(db)
    const res = await call(db, RUN("p_dry_run => true"))
    expect(res).toMatchObject({ branchFound: true, orgsProcessed: 2, orgsFailed: 0, totalNotified: 3, deduped: 0, dryRun: true })
    expect(await count(db, "compliance.notifications")).toBe(0)
  })

  test("a real run notifies the owner of each overdue open lead in an org with the sales branch (today counts as overdue)", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ orgsProcessed: 2, orgsFailed: 0, totalNotified: 3, deduped: 0 })
    const got = await alerts(db)
    expect(got.map((r) => [r.user_id, r.message])).toEqual([
      ["u1", 'Lead "Lead One" was due for follow-up on 2026-09-20.'],
      ["u1", 'Lead "Lead Two" was due for follow-up on 2026-09-28.'],
      ["u2", 'Lead "Lead Nine" was due for follow-up on 2026-09-01.'],
    ])
    expect(got.every((r) => r.title === "Lead follow-up overdue" && r.type === "deadline_reminder")).toBe(true)
    expect(got.map((r) => r.metadata)).toEqual([
      { kind: "crm_lead_followup_overdue", leadId: "l1" },
      { kind: "crm_lead_followup_overdue", leadId: "l2" },
      { kind: "crm_lead_followup_overdue", leadId: "l9" },
    ])
  })

  test("a second run creates no duplicate: an unread alert for the same lead is not repeated (dedup is on by default)", async () => {
    const res = await call(db, RUN())
    expect(res).toMatchObject({ totalNotified: 0, deduped: 3 })
    expect(await count(db, "compliance.notifications")).toBe(3)
  })

  test("once an alert is read the next run alerts that lead again; p_dedup => false repeats all", async () => {
    await db.exec("update compliance.notifications set is_read = true where metadata->>'leadId' = 'l1'")
    expect(await call(db, RUN())).toMatchObject({ totalNotified: 1, deduped: 2 })
    expect(await call(db, RUN("p_dedup => false"))).toMatchObject({ totalNotified: 3, deduped: 0 })
    expect(await count(db, "compliance.notifications")).toBe(7)
  })

  test("one org failing does not stop the others: the failed org's alerts roll back, the rest are written", async () => {
    await db.exec(`
      delete from compliance.notifications;
      create function compliance.reject_bad_user() returns trigger language plpgsql as $t$
      begin
        if new.user_id = 'u2' then raise exception 'synthetic failure for u2'; end if;
        return new;
      end
      $t$;
      create trigger reject_bad_user before insert on compliance.notifications for each row execute function compliance.reject_bad_user();`)
    try {
      const res = await call(db, RUN())
      expect(res).toMatchObject({ orgsProcessed: 1, orgsFailed: 1, totalNotified: 2 }) // org-a done, org-b (u2) failed
      expect((await alerts(db)).map((r) => r.user_id)).toEqual(["u1", "u1"])
    } finally {
      await db.exec("drop trigger reject_bad_user on compliance.notifications; drop function compliance.reject_bad_user();")
    }
  })

  test("a branch key with no product branch notifies nobody", async () => {
    const res = await call(db, RUN("p_branch_key => 'no_such_branch'"))
    expect(res).toMatchObject({ branchFound: false, orgsProcessed: 0, totalNotified: 0 })
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
