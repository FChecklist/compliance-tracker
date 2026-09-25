// PROJEXA-BUILD-001 U-41 part B: shared fixture for the tests of migrations 0632 to 0641, the ten cost001-* pg_cron jobs.
// Each migration creates compliance.cron_* functions and schedules one job. The tests run the real migration files on PGlite
// (real Postgres as WASM, no server): a stand-in for the cron schema, the roles Supabase provides, and the live shape of only the
// columns the functions read or write (read from the live catalog on 2026-09-26; enum labels and NOT NULL/default clauses as live).
// Nothing here touches a database or the network. It has no test-runner import: the test files pass `test` and `expect` in.
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const REPO_ROOT = new URL("../../../", import.meta.url)

export const MIGRATION_NAMES = {
  "0632": "0632_build001_cron_fm_ppm_occurrences",
  "0633": "0633_build001_cron_metric_alerts",
  "0634": "0634_build001_cron_the_firm_recur",
  "0635": "0635_build001_cron_audit_cadence",
  "0636": "0636_build001_cron_task_nudge_digest",
  "0637": "0637_build001_cron_report_schedules",
  "0638": "0638_build001_cron_orchestra_log_purge",
  "0639": "0639_build001_cron_ai_reduction_snapshot",
  "0640": "0640_build001_cron_pipeline_stuck_deals",
  "0641": "0641_build001_cron_crm_lead_followups",
} as const

export type MigrationNum = keyof typeof MIGRATION_NAMES

export function forwardSql(num: MigrationNum): string {
  return readFileSync(new URL(`drizzle/${MIGRATION_NAMES[num]}.sql`, REPO_ROOT), "utf8")
}

export function downSql(num: MigrationNum): string {
  return readFileSync(new URL(`drizzle/down/${MIGRATION_NAMES[num]}.down.sql`, REPO_ROOT), "utf8")
}

// The roles and schemas a Supabase project has before any migration of this repo runs.
const BASE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA compliance;
CREATE SCHEMA platform;
`

// A stand-in for pg_cron 1.6: schedule(name, schedule, command) updates the job of that name or inserts one, and refuses a
// schedule that does not have five fields; unschedule(name) raises when no such job exists (as pg_cron does), so a down file
// that unschedules without checking fails here.
const CRON_STUB_SQL = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT 'postgres',
  username text NOT NULL DEFAULT 'postgres',
  active boolean NOT NULL DEFAULT true,
  jobname text
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE plpgsql AS $s$
DECLARE v_id bigint;
BEGIN
  IF array_length(regexp_split_to_array(btrim(schedule), '[[:space:]]+'), 1) <> 5 THEN
    RAISE EXCEPTION 'invalid schedule: %', schedule;
  END IF;
  UPDATE cron.job SET schedule = $2, command = $3, active = true WHERE jobname = $1 RETURNING jobid INTO v_id;
  IF v_id IS NULL THEN
    INSERT INTO cron.job (jobname, schedule, command) VALUES ($1, $2, $3) RETURNING jobid INTO v_id;
  END IF;
  RETURN v_id;
END
$s$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS $s$
BEGIN
  DELETE FROM cron.job WHERE jobname = $1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job ''%''', $1;
  END IF;
  RETURN true;
END
$s$;
SELECT cron.schedule('projexa-exchange-rate-refresh', '30 9 * * *', 'select 1');
SELECT cron.schedule('dpdp-legal-clocks', '30 3 * * *', 'select 2');
`

const ENUMS_SQL = `
CREATE TYPE compliance.fm_ppm_frequency AS ENUM ('daily','weekly','fortnightly','monthly','quarterly','half_yearly','annually');
CREATE TYPE compliance.fm_ppm_occurrence_status AS ENUM ('due','in_progress','completed','overdue','skipped');
CREATE TYPE compliance.firm_service_line AS ENUM ('ca_services','cs_services','legal_services','grc_services','audit_services');
CREATE TYPE compliance.firm_fee_type AS ENUM ('fixed','hourly','retainer');
CREATE TYPE compliance.compliance_status AS ENUM ('pending','in_progress','completed','overdue','not_applicable','draft');
CREATE TYPE compliance.priority AS ENUM ('low','medium','high','critical');
CREATE TYPE compliance.notice_status AS ENUM ('received','in_progress','replied','closed','appealed');
CREATE TYPE compliance.risk_status AS ENUM ('open','mitigating','closed');
CREATE TYPE compliance.risk_category AS ENUM ('regulatory','operational','financial','strategic','reputational','cyber');
CREATE TYPE compliance.pms_issue_priority AS ENUM ('no_priority','urgent','high','medium','low');
CREATE TYPE compliance.incident_stage AS ENUM ('logged','triaged','investigating','contained','notified','remediated','closed');
CREATE TYPE compliance.notification_type AS ENUM ('deadline_reminder','assignment','status_change','comment','system','mention','instruction_mismatch');
CREATE TYPE compliance.user_role AS ENUM ('admin','manager','member','viewer','veridian_admin','branch_manager','senior_professional','team_member','client_viewer','external_auditor','stage_0');
`

const ID = "id text NOT NULL DEFAULT (gen_random_uuid())::text PRIMARY KEY"

// Only the columns the ten cron functions read or write, with the live type, NOT NULL and default (2026-09-26).
export const TABLE_SQL: Record<string, string> = {
  organisations: `CREATE TABLE compliance.organisations (${ID}, name text NOT NULL, monthly_cost_cap_usd numeric, cost_cap_enforcement_enabled boolean NOT NULL DEFAULT true);`,
  users: `CREATE TABLE compliance.users (${ID}, org_id text, role compliance.user_role NOT NULL DEFAULT 'member');`,
  clients: `CREATE TABLE compliance.clients (${ID}, org_id text NOT NULL);`,
  notifications: `CREATE TABLE compliance.notifications (${ID}, user_id text NOT NULL, title text NOT NULL, message text NOT NULL,
    type compliance.notification_type NOT NULL DEFAULT 'system', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now());`,
  product_branches: `CREATE TABLE platform.product_branches (${ID}, branch_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());`,
  org_product_branch_enablements: `CREATE TABLE compliance.org_product_branch_enablements (${ID}, org_id text NOT NULL, product_branch_id text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT false, UNIQUE (org_id, product_branch_id));`,
  fm_checklist_templates: `CREATE TABLE compliance.fm_checklist_templates (${ID}, frequency compliance.fm_ppm_frequency NOT NULL);`,
  fm_ppm_schedules: `CREATE TABLE compliance.fm_ppm_schedules (${ID}, org_id text NOT NULL, asset_id text NOT NULL, checklist_template_id text NOT NULL,
    is_active boolean NOT NULL DEFAULT true, next_due_date date NOT NULL, default_assignee_id text, last_generated_occurrence_id text,
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (asset_id, checklist_template_id));`,
  fm_ppm_occurrences: `CREATE TABLE compliance.fm_ppm_occurrences (${ID}, org_id text NOT NULL, schedule_id text NOT NULL, asset_id text NOT NULL,
    due_date date NOT NULL, assignee_id text, status compliance.fm_ppm_occurrence_status NOT NULL DEFAULT 'due', overdue_notified_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (schedule_id, due_date));`,
  firm_engagements: `CREATE TABLE compliance.firm_engagements (${ID}, org_id text NOT NULL, client_id text NOT NULL, service_line compliance.firm_service_line NOT NULL,
    title text NOT NULL, scope_of_work text, fee_type compliance.firm_fee_type NOT NULL DEFAULT 'fixed', fee_amount numeric,
    billing_frequency text DEFAULT 'monthly', start_date date NOT NULL, lead_partner_user_id text, budgeted_hours numeric,
    recurrence_type text NOT NULL DEFAULT 'none', created_by_id text, next_occurrence_date date, status text NOT NULL DEFAULT 'active',
    updated_at timestamptz NOT NULL DEFAULT now());`,
  activity_log: `CREATE TABLE compliance.activity_log (${ID}, org_id text NOT NULL, lifecycle_stage text NOT NULL DEFAULT 'requested',
    re_audit_requested_at timestamptz, re_audit_reason text, re_audit_requested_by text, updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now());`,
  orchestra_executions: `CREATE TABLE compliance.orchestra_executions (${ID}, org_id text NOT NULL, input jsonb NOT NULL DEFAULT '{}'::jsonb, output jsonb,
    payload_purged_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());`,
  ai_reduction_snapshots: `CREATE TABLE compliance.ai_reduction_snapshots (${ID}, snapshot_date date NOT NULL, full_software_count integer NOT NULL,
    package_available_count integer NOT NULL, novel_count integer NOT NULL, total_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`,
  task_capabilities: `CREATE TABLE platform.task_capabilities (${ID}, full_software_count integer NOT NULL DEFAULT 0, package_available_count integer NOT NULL DEFAULT 0,
    novel_count integer NOT NULL DEFAULT 0, org_id text);`,
  tasks: `CREATE TABLE compliance.tasks (${ID}, org_id text NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'pending', due_date timestamptz,
    user_id text, assigned_by_id text, priority integer NOT NULL DEFAULT 0, last_reprioritized_at timestamptz, last_reprioritization_reason text,
    updated_at timestamptz NOT NULL DEFAULT now());`,
  tickets: `CREATE TABLE compliance.tickets (${ID}, subject text NOT NULL, status text NOT NULL DEFAULT 'open', sla_deadline timestamptz,
    conversation_id text NOT NULL, assignee_id text, created_by_id text NOT NULL, sla_policy_id text, team_id text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`,
  sla_policies: `CREATE TABLE compliance.sla_policies (${ID}, resolution_hours integer NOT NULL);`,
  escalation_rules: `CREATE TABLE compliance.escalation_rules (${ID}, sla_policy_id text NOT NULL, threshold_percent integer NOT NULL, escalate_to_team_id text,
    escalate_to_user_id text, notify_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb, step_order integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now());`,
  ticket_escalation_events: `CREATE TABLE compliance.ticket_escalation_events (${ID}, ticket_id text NOT NULL, escalation_rule_id text NOT NULL);`,
  metric_alert_rules: `CREATE TABLE compliance.metric_alert_rules (${ID}, org_id text NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), source_entity text NOT NULL, filter_field text, filter_value text, operator text NOT NULL DEFAULT 'gt',
    threshold integer NOT NULL, notify_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb, last_triggered_at timestamptz);`,
  compliance_items: `CREATE TABLE compliance.compliance_items (${ID}, org_id text NOT NULL, status compliance.compliance_status NOT NULL DEFAULT 'pending',
    priority compliance.priority NOT NULL DEFAULT 'medium', department_id text NOT NULL);`,
  notices: `CREATE TABLE compliance.notices (${ID}, org_id text NOT NULL, status compliance.notice_status NOT NULL DEFAULT 'received', authority text);`,
  risks: `CREATE TABLE compliance.risks (${ID}, org_id text NOT NULL, status compliance.risk_status NOT NULL DEFAULT 'open',
    category compliance.risk_category NOT NULL DEFAULT 'operational');`,
  pms_issues: `CREATE TABLE compliance.pms_issues (${ID}, org_id text NOT NULL, priority compliance.pms_issue_priority NOT NULL DEFAULT 'no_priority', status_id text NOT NULL);`,
  incidents: `CREATE TABLE compliance.incidents (${ID}, org_id text NOT NULL, severity text NOT NULL DEFAULT 'medium', stage compliance.incident_stage NOT NULL DEFAULT 'logged');`,
  token_usage_ledger: `CREATE TABLE compliance.token_usage_ledger (${ID}, org_id text, scope text NOT NULL, estimated_cost_usd numeric, created_at timestamptz NOT NULL DEFAULT now());`,
  report_schedules: `CREATE TABLE compliance.report_schedules (${ID}, report_id text NOT NULL, cadence text NOT NULL, day_of_week integer, day_of_month integer,
    times_of_day jsonb, start_date date, end_date date, recipient_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb, is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now());`,
  crm_opportunities: `CREATE TABLE compliance.crm_opportunities (${ID}, org_id text NOT NULL, name text NOT NULL, stage text NOT NULL DEFAULT 'prospecting',
    owner_id text, created_at timestamptz NOT NULL DEFAULT now());`,
  crm_stage_history: `CREATE TABLE compliance.crm_stage_history (${ID}, entity_type text NOT NULL, entity_id text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now());`,
  crm_leads: `CREATE TABLE compliance.crm_leads (${ID}, org_id text NOT NULL, name text NOT NULL, owner_id text, next_action_date date,
    status text NOT NULL DEFAULT 'new');`,
}

export type NewDbOptions = { cron?: boolean }

/** A fresh in-memory database: roles, schemas, enums, the named tables, and (unless cron is false) the cron stand-in with two other tracks' jobs. */
export async function newDb(tables: string[], opts: NewDbOptions = {}): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(ENUMS_SQL)
  for (const t of tables) {
    const ddl = TABLE_SQL[t]
    if (!ddl) throw new Error(`no fixture DDL for table ${t}`)
    await db.exec(ddl)
  }
  if (opts.cron !== false) await db.exec(CRON_STUB_SQL)
  return db
}

export async function q<T = Record<string, unknown>>(db: PGlite, sql: string): Promise<T[]> {
  const r = await db.query<T>(sql)
  return r.rows
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string): Promise<T> {
  const rows = await q<T>(db, sql)
  return rows[0] as T
}

/** Runs `select <expr> as r` and returns r (a jsonb result arrives as a parsed object). */
export async function call(db: PGlite, expr: string): Promise<any> {
  const row = await one<{ r: unknown }>(db, `select ${expr} as r`)
  return row.r
}

export async function count(db: PGlite, table: string, where = "true"): Promise<number> {
  const row = await one<{ n: number }>(db, `select count(*)::int n from ${table} where ${where}`)
  return row.n
}

export type FnCfg = { name: string; args: string }
export type JobCfg = { num: MigrationNum; job: string; schedule: string; command: string; functions: FnCfg[] }

type TestApi = { test: (name: string, fn: () => Promise<void> | void) => void; expect: (v: unknown) => any }

const fnCount = (db: PGlite, f: FnCfg) =>
  count(db, "pg_proc p join pg_namespace n on n.oid = p.pronamespace", `n.nspname = 'compliance' and p.proname = '${f.name}'`)

const jobCount = (db: PGlite, job: string) => count(db, "cron.job", `jobname = '${job}'`)

/** Forward-file checks shared by the ten test files: idempotent apply, function attributes, grants, the job row. */
export function registerForwardChecks(t: TestApi, getDb: () => PGlite, cfg: JobCfg): void {
  const { test, expect } = t
  test("the forward file applies, and a second run leaves one job and each function once", async () => {
    const db = getDb()
    await db.exec(forwardSql(cfg.num))
    await db.exec(forwardSql(cfg.num))
    expect(await jobCount(db, cfg.job)).toBe(1)
    for (const f of cfg.functions) expect(await fnCount(db, f)).toBe(1)
  })

  test("each function is SECURITY INVOKER plpgsql returning jsonb with a pinned search_path, and only the owner can execute it", async () => {
    const db = getDb()
    for (const f of cfg.functions) {
      const sig = `compliance.${f.name}(${f.args})`
      const r = await one<Record<string, unknown>>(
        db,
        `select p.prosecdef, l.lanname, pg_get_function_result(p.oid) result, array_to_string(p.proconfig, ',') cfg, p.proacl is not null has_acl,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
                has_function_privilege('postgres', p.oid, 'EXECUTE') owner_x,
                (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) public_grants
           from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure('${sig}')`,
      )
      expect(r).toEqual({
        prosecdef: false,
        lanname: "plpgsql",
        result: "jsonb",
        cfg: "search_path=compliance, platform, public",
        has_acl: true,
        anon_x: false,
        auth_x: false,
        owner_x: true,
        public_grants: 0,
      })
    }
  })

  test("the job is active with the exact schedule and command, runs pure SQL, and leaves the other tracks' jobs alone", async () => {
    const db = getDb()
    const row = await one<{ schedule: string; command: string; active: boolean }>(db, `select schedule, command, active from cron.job where jobname = '${cfg.job}'`)
    expect(row).toEqual({ schedule: cfg.schedule, command: cfg.command, active: true })
    expect(row.command).not.toContain("/api/internal/")
    expect(row.command.toLowerCase()).not.toContain("net.http_post")
    expect(row.command.toLowerCase()).not.toContain("vault")
    const others = await q<{ jobname: string; command: string }>(db, `select jobname, command from cron.job where jobname in ('projexa-exchange-rate-refresh','dpdp-legal-clocks') order by jobname`)
    expect(others).toEqual([
      { jobname: "dpdp-legal-clocks", command: "select 2" },
      { jobname: "projexa-exchange-rate-refresh", command: "select 1" },
    ])
  })
}

/** Down-file checks: unschedules, drops every function, safe twice, leaves the other jobs, and the forward file applies again. */
export function registerDownChecks(t: TestApi, getDb: () => PGlite, cfg: JobCfg): void {
  const { test, expect } = t
  test("the down file unschedules the job and drops every function, is safe to run twice, and leaves the other tracks' jobs", async () => {
    const db = getDb()
    await db.exec(downSql(cfg.num))
    await db.exec(downSql(cfg.num))
    expect(await jobCount(db, cfg.job)).toBe(0)
    for (const f of cfg.functions) expect(await fnCount(db, f)).toBe(0)
    expect(await count(db, "cron.job", "jobname in ('projexa-exchange-rate-refresh','dpdp-legal-clocks')")).toBe(2)
  })

  test("after the down file the forward file applies again", async () => {
    const db = getDb()
    await db.exec(forwardSql(cfg.num))
    expect(await jobCount(db, cfg.job)).toBe(1)
    for (const f of cfg.functions) expect(await fnCount(db, f)).toBe(1)
  })
}

/**
 * Runs `body` while the advisory-lock call inside `fn` is answered `false`, as if another session held the lock. PGlite has one
 * connection, and a session may re-take its own advisory lock, so a real second holder cannot be made. This proves the branch that
 * a refused lock takes (a skip result, no write); it does not prove Postgres's lock semantics. The stand-ins sit in schema compliance
 * and only `fn` gets pg_catalog moved to the end of its search_path, so they win for that one function; both are removed afterwards.
 */
export async function withRefusedLock(db: PGlite, fn: FnCfg, body: () => Promise<void>): Promise<void> {
  const sig = `compliance.${fn.name}(${fn.args})`
  await db.exec(`
    CREATE FUNCTION compliance.pg_try_advisory_xact_lock(bigint) RETURNS boolean LANGUAGE sql AS $s$ select false $s$;
    CREATE FUNCTION compliance.pg_try_advisory_xact_lock(integer, integer) RETURNS boolean LANGUAGE sql AS $s$ select false $s$;
    ALTER FUNCTION ${sig} SET search_path = compliance, platform, public, pg_catalog;
  `)
  try {
    await body()
  } finally {
    await db.exec(`
      ALTER FUNCTION ${sig} SET search_path = compliance, platform, public;
      DROP FUNCTION compliance.pg_try_advisory_xact_lock(bigint);
      DROP FUNCTION compliance.pg_try_advisory_xact_lock(integer, integer);
    `)
  }
}
