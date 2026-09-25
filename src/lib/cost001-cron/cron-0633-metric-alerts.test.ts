/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-41 part B: migration 0633, job cost001-metric-alerts (six checks and a wrapper on pg_cron).
// Runs drizzle/0633_build001_cron_metric_alerts.sql and its down file on PGlite against the live shape of the fifteen tables the six
// checks read or write. Proves: the lifecycle for all seven functions (see pglite-kit.ts); the wrapper's result for each check
// (metric alert rules, ticket SLA breaches, ticket escalations, task overdue, task reprioritisation, cost cap); a dry run returns the
// real counts and writes nothing; a real run writes the notifications and the ticket, task and rule updates; notification dedup is ON
// (a second run adds no notification, escalations are idempotent through their event rows, reprioritisation never lowers) and
// p_dedup => false repeats; a ticket on a 0-hour SLA policy is skipped without an error; the overdue check and the digest of 0636 do not
// both notify one owner of one task (the overdue check skips a recipient whose unread digest lists the task); one failing check does
// not stop the other five; a refused lock writes nothing.
// Run: bun test --isolate src/lib/cost001-cron/cron-0633-metric-alerts.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { newDb, call, count, one, q, registerForwardChecks, registerDownChecks, withRefusedLock, type JobCfg } from "./pglite-kit"

setDefaultTimeout(60_000)

const CFG: JobCfg = {
  num: "0633",
  job: "cost001-metric-alerts",
  schedule: "0 5 * * *",
  command: "select compliance.cron_metric_alerts();",
  functions: [
    { name: "cron_metric_alert_rules", args: "boolean, boolean" },
    { name: "cron_ticket_sla_breaches", args: "boolean, boolean" },
    { name: "cron_ticket_escalations", args: "boolean, boolean" },
    { name: "cron_task_overdue", args: "boolean, boolean" },
    { name: "cron_task_reprioritise", args: "boolean, timestamptz" },
    { name: "cron_cost_cap", args: "boolean, boolean" },
    { name: "cron_metric_alerts", args: "boolean, boolean" },
  ],
}
const TABLES = [
  "organisations", "users", "notifications", "tickets", "sla_policies", "escalation_rules", "ticket_escalation_events", "tasks",
  "token_usage_ledger", "metric_alert_rules", "compliance_items", "notices", "risks", "pms_issues", "incidents",
]
const WRAPPER = (args = "") => `compliance.cron_metric_alerts(${args})`

async function seed(db: PGlite) {
  await db.exec(`
    ${TABLES.map((t) => `delete from compliance.${t};`).join("\n    ")}
    insert into compliance.compliance_items (org_id, status, priority, department_id) values
      ('org-1', 'pending', 'high', 'd1'), ('org-1', 'pending', 'low', 'd1'), ('org-1', 'pending', 'low', 'd2'), ('org-1', 'completed', 'low', 'd1'),
      ('org-2', 'pending', 'low', 'd1'), ('org-2', 'pending', 'low', 'd1');
    insert into compliance.metric_alert_rules (id, org_id, name, is_active, source_entity, filter_field, filter_value, operator, threshold, notify_user_ids) values
      ('r1', 'org-1', 'Pending items',   true,  'compliance_items',    'status', 'pending', 'gt',  1, '["u-alert1","u-alert2"]'),
      ('r2', 'org-1', 'Unknown entity',  true,  'widgets',             null,     null,      'gt',  0, '["u-alert1"]'),
      ('r3', 'org-1', 'Bad filter',      true,  'risks',               'status', 'bogus',   'gt',  0, '["u-alert1"]'),
      ('r4', 'org-1', 'No BOQ rows',     true,  'construction_boqs',   null,     null,      'lt',  1, '["u-alert1"]'),
      ('r5', 'org-1', 'Switched off',    false, 'compliance_items',    null,     null,      'gt',  0, '["u-alert1"]'),
      ('r6', 'org-1', 'All items',       true,  'compliance_items',    null,     null,      'gte', 5, '["u-alert1"]');
    insert into compliance.tickets (id, subject, status, sla_deadline, conversation_id, assignee_id, created_by_id) values
      ('tk1', 'Subj 1', 'open',        now() - interval '3 days', 'cv', 'a1', 'c1'),
      ('tk2', 'Subj 2', 'resolved',    now() - interval '3 days', 'cv', 'a1', 'c1'),
      ('tk3', 'Subj 3', 'open',        now() + interval '3 days', 'cv', 'a1', 'c1'),
      ('tk4', 'Subj 4', 'in_progress', now() - interval '1 day',  'cv', 'a1', 'a1');
    insert into compliance.sla_policies (id, resolution_hours) values ('p1', 10), ('p0', 0);
    insert into compliance.tickets (id, subject, status, sla_deadline, conversation_id, assignee_id, created_by_id, sla_policy_id) values
      ('tk5', 'Subj 5', 'open', now() + interval '2 hours', 'cv', null, 'c1', 'p1'),
      ('tk6', 'Subj 6', 'open', now() + interval '1 hour',  'cv', null, 'c1', 'p0');
    insert into compliance.escalation_rules (id, sla_policy_id, threshold_percent, escalate_to_team_id, escalate_to_user_id, notify_user_ids, step_order) values
      ('e1', 'p1', 50, 'team-x', null,   '["n1"]',       1),
      ('e2', 'p1', 90, null,     'boss', '[]',           2),
      ('e3', 'p1', 75, null,     'lead', '["n1","n2"]',  3),
      ('e0', 'p0', 0,  'team-zero', null, '["n0"]',      1);
    insert into compliance.tasks (id, org_id, title, status, due_date, user_id, assigned_by_id, priority) values
      ('k1', 'org-1', 'Task 1', 'pending',   now() - interval '2 days',   'u1', 'u2', 0),
      ('k2', 'org-1', 'Task 2', 'pending',   now() + interval '10 hours', 'u1', null, 0),
      ('k3', 'org-1', 'Task 3', 'pending',   now() + interval '50 hours', 'u1', null, 0),
      ('k4', 'org-1', 'Task 4', 'pending',   now() + interval '100 hours','u1', null, 0),
      ('k5', 'org-1', 'Task 5', 'pending',   now() + interval '10 hours', 'u1', null, 3),
      ('k6', 'org-1', 'Task 6', 'completed', now() - interval '1 day',   'u1', 'u2', 0),
      ('k7', 'org-1', 'Task 7', 'cancelled', now() - interval '1 day',   'u1', 'u2', 0),
      ('k8', 'org-1', 'Task 8', 'pending',   null,                        'u1', 'u2', 0);
    insert into compliance.organisations (id, name, monthly_cost_cap_usd, cost_cap_enforcement_enabled) values
      ('o1', 'Org One',   20,   true), ('o2', 'Org Two', 20, true), ('o3', 'Org Three', 20, false), ('o4', 'Org Four', null, true), ('o5', 'Org Five', 20, true);
    insert into compliance.users (id, org_id, role) values
      ('u-admin1', 'o1', 'admin'), ('u-mgr1', 'o1', 'manager'), ('u-mem1', 'o1', 'member'), ('u-admin2', 'o2', 'admin'), ('u-admin5', 'o5', 'admin');
    insert into compliance.token_usage_ledger (org_id, scope, estimated_cost_usd, created_at) values
      ('o1', 'product_orchestra', 17.5, now()),
      ('o1', 'other',             100,  now()),
      ('o1', 'product_orchestra', 100,  now() - interval '40 days'),
      ('o2', 'product_orchestra', 25,   now()),
      ('o5', 'product_orchestra', 1,    now());
  `)
}

const kinds = async (db: PGlite) =>
  Object.fromEntries((await q<{ k: string; n: number }>(db, "select metadata->>'kind' k, count(*)::int n from compliance.notifications group by 1 order by 1")).map((r) => [r.k, r.n]))

const world = async (db: PGlite) => ({
  notifications: await count(db, "compliance.notifications"),
  events: await count(db, "compliance.ticket_escalation_events"),
  priorities: (await q<{ id: string; priority: number }>(db, "select id, priority from compliance.tasks order by id")).map((r) => `${r.id}:${r.priority}`).join(","),
  tk5: await one<{ team_id: string | null; assignee_id: string | null }>(db, "select team_id, assignee_id from compliance.tickets where id = 'tk5'"),
  tk6: await one<{ team_id: string | null; assignee_id: string | null }>(db, "select team_id, assignee_id from compliance.tickets where id = 'tk6'"),
  triggered: await count(db, "compliance.metric_alert_rules", "last_triggered_at is not null"),
})

describe("drizzle/0633 metric alerts on PGlite", () => {
  let db: PGlite
  beforeAll(async () => {
    db = await newDb(TABLES)
  })
  afterAll(async () => {
    await db.close()
  })

  registerForwardChecks({ test, expect }, () => db, CFG)

  test("the job's own command runs on empty tables and returns one result per check", async () => {
    const command = (await one<{ command: string }>(db, `select command from cron.job where jobname = '${CFG.job}'`)).command
    const res = (await db.query<{ cron_metric_alerts: Record<string, any> }>(command)).rows[0].cron_metric_alerts
    expect(Object.keys(res).sort()).toEqual(["costCeiling", "dedup", "dryRun", "metricAlerts", "ranAt", "taskOverdue", "taskReprioritization", "ticketEscalations", "ticketSla"])
    expect(res.metricAlerts.checked).toBe(0)
    expect(res.costCeiling.checked).toBe(0)
    expect(res.dedup).toBe(true)
    expect(res.dryRun).toBe(false)
  })

  test("a dry run returns the real counts for every check and writes nothing", async () => {
    await seed(db)
    const before = await world(db)
    const res = await call(db, WRAPPER("p_dry_run => true"))
    expect(res.dryRun).toBe(true)
    expect(res.metricAlerts).toMatchObject({ checked: 5, breached: 2, skippedInvalidEntity: 1, notified: 3, errors: 1, dryRun: true })
    expect(res.ticketSla).toMatchObject({ breached: 2, notified: 3, dryRun: true })
    expect(res.ticketEscalations).toMatchObject({ candidates: 2, escalated: 2, ticketsUpdated: 2, notified: 4, dryRun: true })
    expect(res.taskOverdue).toMatchObject({ overdue: 1, notified: 2, dryRun: true })
    expect(res.taskReprioritization).toMatchObject({ evaluated: 5, updated: 3, dryRun: true })
    expect(res.costCeiling).toMatchObject({ checked: 3, overLimit: 1, nearLimit: 1, notified: 3, dryRun: true })
    expect(await world(db)).toEqual(before)
    expect(before).toMatchObject({ notifications: 0, events: 0, triggered: 0, priorities: "k1:0,k2:0,k3:0,k4:0,k5:3,k6:0,k7:0,k8:0" })
  })

  test("each check called on its own runs without raising, and the wrapper's dry run carries no error key (the wrapper turns a raise into an error key)", async () => {
    // A check that raises inside the wrapper comes back as {error, sqlstate} and the wrapper itself succeeds, so the direct calls
    // and the key scan below are what show it. The metric alert rules check has one seeded rule (r3, a bad filter) that fails on purpose.
    for (const fn of ["cron_ticket_sla_breaches", "cron_ticket_escalations", "cron_task_overdue", "cron_cost_cap"]) {
      const res = await call(db, `compliance.${fn}(p_dry_run => true)`)
      expect(res.error).toBeUndefined()
      expect(res.dryRun).toBe(true)
    }
    expect((await call(db, "compliance.cron_task_reprioritise(p_dry_run => true)")).error).toBeUndefined()
    const wrapped = await call(db, WRAPPER("p_dry_run => true"))
    for (const key of ["ticketSla", "ticketEscalations", "taskOverdue", "taskReprioritization", "costCeiling"]) expect(wrapped[key].error).toBeUndefined()
    expect(wrapped.metricAlerts.errors).toBe(1) // only the seeded bad rule
  })

  test("a ticket on a 0-hour SLA policy is a candidate but is skipped: no division by zero, no error key, its threshold-0 rule never fires", async () => {
    // tk6 sits on policy p0 (resolution_hours 0) with rule e0 (threshold 0, team-zero). Without the guard the elapsed percentage divides by
    // zero, the check raises, and the wrapper hides the raise under the error key.
    const direct = await call(db, "compliance.cron_ticket_escalations(p_dry_run => true)")
    expect(direct.error).toBeUndefined()
    expect(direct).toMatchObject({ candidates: 2, escalated: 2, ticketsUpdated: 2, notified: 4, dryRun: true }) // tk5's rules only
    const wrapped = await call(db, WRAPPER("p_dry_run => true"))
    expect(wrapped.ticketEscalations.error).toBeUndefined()
    expect(wrapped.ticketEscalations).toMatchObject({ candidates: 2, escalated: 2 })
  })

  test("a real run writes the notifications and the ticket, task and rule updates", async () => {
    const res = await call(db, WRAPPER())
    expect(res.metricAlerts).toMatchObject({ checked: 5, breached: 2, notified: 3, deduped: 0, errors: 1, dryRun: false })
    expect(res.ticketSla).toMatchObject({ breached: 2, notified: 3, deduped: 0 })
    expect(res.ticketEscalations).toMatchObject({ candidates: 2, escalated: 2, ticketsUpdated: 2, notified: 4 })
    expect(res.taskOverdue).toMatchObject({ overdue: 1, notified: 2 })
    expect(res.taskReprioritization).toMatchObject({ evaluated: 5, updated: 3 })
    expect(res.taskReprioritization.updates).toEqual([
      { id: "k1", orgId: "org-1", from: 0, to: 3, reason: "overdue" },
      { id: "k2", orgId: "org-1", from: 0, to: 2, reason: "due_within_24h" },
      { id: "k3", orgId: "org-1", from: 0, to: 1, reason: "due_within_72h" },
    ])
    expect(res.costCeiling).toMatchObject({ checked: 3, overLimit: 1, nearLimit: 1, notified: 3, deduped: 0, errors: 0 })
    expect(await kinds(db)).toEqual({ metric_alert: 3, ticket_sla_breach: 3, ticket_escalation: 4, task_overdue: 2, cost_cap_breach: 3 })
    expect(await count(db, "compliance.ticket_escalation_events", "ticket_id = 'tk6'")).toBe(0)
    expect(await count(db, "compliance.notifications", "metadata->>'ticketId' = 'tk6'")).toBe(0)
    expect(await world(db)).toEqual({
      notifications: 15,
      events: 2,
      priorities: "k1:3,k2:2,k3:1,k4:0,k5:3,k6:0,k7:0,k8:0", // k5 already at 3 and never lowered; k4 too far out
      tk5: { team_id: "team-x", assignee_id: "lead" }, // rules applied in step order, the later step's assignee wins
      tk6: { team_id: null, assignee_id: null }, // 0-hour policy: skipped, its threshold-0 rule never fires
      triggered: 2, // r1 and r4 breached
    })
  })

  test("the notification text and metadata of each check", async () => {
    const one1 = async (kind: string, extra = "true") =>
      one<{ user_id: string; title: string; message: string; type: string; metadata: Record<string, unknown> }>(
        db,
        `select user_id, title, message, type::text type, metadata from compliance.notifications where metadata->>'kind' = '${kind}' and ${extra} order by user_id limit 1`,
      )
    const metric = await one1("metric_alert", "user_id = 'u-alert1' and metadata->>'metricAlertRuleId' = 'r1'")
    expect(metric.title).toBe("Metric alert: Pending items")
    expect(metric.message).toBe("compliance_items (status=pending) is 3, which is gt 1.")
    expect(metric.type).toBe("system")
    expect(metric.metadata).toEqual({ kind: "metric_alert", metricAlertRuleId: "r1", value: 3, threshold: 1, operator: "gt" })
    const sla = await one1("ticket_sla_breach", "metadata->>'ticketId' = 'tk1' and user_id = 'c1'")
    expect(sla.title).toBe("SLA breached: Subj 1")
    expect(sla.message).toMatch(/^Ticket "Subj 1" missed its SLA deadline \(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\) and is still open\.$/)
    expect(await count(db, "compliance.notifications", "metadata->>'ticketId' = 'tk4' and metadata->>'kind' = 'ticket_sla_breach'")).toBe(1) // assignee and creator are the same user
    const esc = await one1("ticket_escalation", "metadata->>'escalationRuleId' = 'e1'")
    expect(esc.message).toBe('Ticket "Subj 5" reached 50% of its SLA window and was escalated.')
    expect(esc.metadata).toEqual({ kind: "ticket_escalation", ticketId: "tk5", conversationId: "cv", escalationRuleId: "e1" })
    const overdue = await one1("task_overdue", "user_id = 'u1'")
    expect(overdue.type).toBe("deadline_reminder")
    expect(overdue.title).toBe("Task overdue: Task 1")
    expect(overdue.metadata).toEqual({ kind: "task_overdue", taskId: "k1" })
    const over = await one1("cost_cap_breach", "metadata->>'breach' = 'over'")
    expect(over.user_id).toBe("u-admin2")
    expect(over.title).toBe("AI spend cap reached: Org Two")
    expect(over.message).toBe("Org Two has reached its monthly AI spend cap of $20.00 (current spend: $25.00). Further AI usage is blocked until the cap is raised or the month resets.")
    const near = await q<{ user_id: string; title: string; message: string }>(db, "select user_id, title, message from compliance.notifications where metadata->>'breach' = 'near' order by user_id")
    expect(near.map((r) => r.user_id)).toEqual(["u-admin1", "u-mgr1"]) // admins and managers of the org, not its members
    expect(near[0].title).toBe("AI spend approaching cap: Org One")
    expect(near[0].message).toBe("Org One has used $17.50 of its $20.00 monthly AI spend cap (88%).")
  })

  test("a second run creates no duplicate: notifications are deduped, escalations already fired, priorities never change again", async () => {
    const before = await world(db)
    const res = await call(db, WRAPPER())
    expect(res.metricAlerts).toMatchObject({ breached: 2, notified: 0, deduped: 3 })
    expect(res.ticketSla).toMatchObject({ breached: 2, notified: 0, deduped: 3 })
    expect(res.ticketEscalations).toMatchObject({ candidates: 2, escalated: 0, notified: 0 })
    expect(res.taskOverdue).toMatchObject({ overdue: 1, notified: 0, deduped: 2 })
    expect(res.taskReprioritization).toMatchObject({ evaluated: 5, updated: 0 })
    expect(res.costCeiling).toMatchObject({ notified: 0, deduped: 3 })
    expect(await world(db)).toEqual(before)
  })

  test("p_dedup => false repeats the notifications (the old TypeScript behaviour), but not the escalations", async () => {
    const res = await call(db, WRAPPER("p_dedup => false"))
    expect(res.metricAlerts).toMatchObject({ notified: 3, deduped: 0 })
    expect(res.ticketSla).toMatchObject({ notified: 3 })
    expect(res.taskOverdue).toMatchObject({ notified: 2 })
    expect(res.costCeiling).toMatchObject({ notified: 3 })
    expect(res.ticketEscalations).toMatchObject({ escalated: 0, notified: 0 })
    expect(await count(db, "compliance.notifications")).toBe(26)
  })

  test("a read notification no longer suppresses: the next run alerts again, and a cost 'near' alert does not suppress a later 'over' one", async () => {
    await db.exec("update compliance.notifications set is_read = true where metadata->>'kind' = 'task_overdue'")
    expect((await call(db, WRAPPER())).taskOverdue).toMatchObject({ notified: 2, deduped: 0 })
    // org o1 crosses from near to over: the unread 'near' rows must not hide the 'over' alert
    await db.exec("insert into compliance.token_usage_ledger (org_id, scope, estimated_cost_usd) values ('o1', 'product_orchestra', 5)")
    expect((await call(db, WRAPPER())).costCeiling).toMatchObject({ overLimit: 2, nearLimit: 0, notified: 2 })
  })

  test("the overdue check skips a recipient whose unread digest already lists the task as overdue, and still notifies the assigner", async () => {
    // Task k1 is overdue: owner u1, assigner u2. The digest of migration 0636 writes {kind task_nudge_digest, overdueTaskIds [...]}.
    await seed(db)
    const digest = (overdue: string[], dueSoon: string[]) =>
      db.exec(`insert into compliance.notifications (user_id, title, message, type, metadata) values
        ('u1', 'Task nudge', 'Pending', 'deadline_reminder',
         '{"kind":"task_nudge_digest","overdueTaskIds":${JSON.stringify(overdue)},"dueSoonTaskIds":${JSON.stringify(dueSoon)}}')`)
    const overdueRecipients = async () =>
      (await q<{ user_id: string }>(db, "select user_id from compliance.notifications where metadata->>'kind' = 'task_overdue' order by user_id")).map((r) => r.user_id)

    await digest(["k1"], [])
    expect(await call(db, "compliance.cron_task_overdue(p_dry_run => true)")).toMatchObject({ overdue: 1, notified: 1, deduped: 1, dryRun: true })
    expect(await overdueRecipients()).toEqual([])
    expect(await call(db, "compliance.cron_task_overdue()")).toMatchObject({ overdue: 1, notified: 1, deduped: 1 })
    expect(await overdueRecipients()).toEqual(["u2"]) // the assigner is never a digest recipient

    // once the owner reads the digest it no longer suppresses; the assigner's own unread row still does
    await db.exec("update compliance.notifications set is_read = true where metadata->>'kind' = 'task_nudge_digest'")
    expect(await call(db, "compliance.cron_task_overdue()")).toMatchObject({ notified: 1, deduped: 1 })
    expect(await overdueRecipients()).toEqual(["u1", "u2"])

    // a digest that lists the task only as due soon does not say it is overdue, so it does not suppress
    await db.exec("delete from compliance.notifications")
    await digest([], ["k1"])
    expect(await call(db, "compliance.cron_task_overdue()")).toMatchObject({ notified: 2, deduped: 0 })

    // p_dedup => false ignores the digest, as it ignores every other dedup
    await db.exec("delete from compliance.notifications")
    await digest(["k1"], [])
    expect(await call(db, "compliance.cron_task_overdue(p_dedup => false)")).toMatchObject({ notified: 2, deduped: 0 })
    expect(await overdueRecipients()).toEqual(["u1", "u2"])
  })

  test("one failing check does not stop the other five: its error is returned under its key and its partial writes roll back", async () => {
    await seed(db)
    await db.exec(`
      create function compliance.reject_ticket_update() returns trigger language plpgsql as $t$
      begin raise exception 'synthetic ticket failure'; end
      $t$;
      create trigger reject_ticket_update before update on compliance.tickets for each row execute function compliance.reject_ticket_update();`)
    try {
      const res = await call(db, WRAPPER())
      expect(res.ticketEscalations.error).toContain("synthetic ticket failure")
      expect(res.metricAlerts).toMatchObject({ notified: 3 })
      expect(res.ticketSla).toMatchObject({ notified: 3 })
      expect(res.taskOverdue).toMatchObject({ notified: 2 })
      expect(res.taskReprioritization).toMatchObject({ updated: 3 })
      expect(res.costCeiling).toMatchObject({ notified: 3 })
      expect(await count(db, "compliance.ticket_escalation_events")).toBe(0)
      expect(await count(db, "compliance.notifications", "metadata->>'kind' = 'ticket_escalation'")).toBe(0)
      expect(await count(db, "compliance.notifications")).toBe(11) // 3 + 3 + 0 + 2 + 3
    } finally {
      await db.exec("drop trigger reject_ticket_update on compliance.tickets; drop function compliance.reject_ticket_update();")
    }
  })

  test("a refused advisory lock on the wrapper returns skipped overlap and writes nothing", async () => {
    await seed(db)
    await withRefusedLock(db, CFG.functions[6], async () => {
      expect(await call(db, WRAPPER())).toEqual({ skipped: "overlap" })
    })
    expect(await count(db, "compliance.notifications")).toBe(0)
    expect((await world(db)).priorities).toBe("k1:0,k2:0,k3:0,k4:0,k5:3,k6:0,k7:0,k8:0")
  })

  registerDownChecks({ test, expect }, () => db, CFG)
})
