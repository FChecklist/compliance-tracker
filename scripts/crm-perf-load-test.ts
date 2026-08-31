// V2-16 CRM Performance-Under-Load Load-Test Harness.
//
// Seeds 50k+ synthetic CRM rows into a throwaway `compliance` schema on a
// DISPOSABLE Postgres instance (deliberately never the shared
// supabase_db_verdian-ai/supabase_db_projexa containers, and never a
// production DATABASE_URL -- see the env-var guard below), runs the real
// query patterns this repo's service layer actually issues
// (crm-service.ts / crm-accounts-service.ts / sales-engine-service.ts /
// veri-reward-service.ts), measures them with EXPLAIN (ANALYZE, BUFFERS)
// BEFORE the composite indexes exist, then applies
// drizzle/0503_v2_16_crm_perf_indexes.sql verbatim (not a re-typed copy --
// this proves the actual migration file, not a facsimile of it) and
// re-measures AFTER.
// (Renumbered from the original 0264 during a rebase-merge onto a later
// `main` -- 0264 had since been independently claimed by an unrelated
// migration; see PROGRESS.md.)
//
// Run: bun run scripts/crm-perf-load-test.ts
//   Requires CRM_LOADTEST_DATABASE_URL (NOT DATABASE_URL -- deliberately a
//   distinct env var so this can never accidentally point at the app's real
//   database). Recommended: a disposable local container, e.g.
//     docker run --rm -d --name crm-loadtest-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
//     export CRM_LOADTEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
//   --rows=N overrides the lead count (default 50000); other tables scale
//   proportionally (see ROW_COUNTS below).
//   --keep-schema skips the final DROP SCHEMA (for manual inspection).
import postgres from "postgres";
import { writeFileSync, readFileSync, mkdirSync } from "fs";

const DB_URL = process.env.CRM_LOADTEST_DATABASE_URL;
if (!DB_URL) {
  throw new Error(
    "CRM_LOADTEST_DATABASE_URL not set. This harness refuses to run against DATABASE_URL " +
    "(the app's real database) -- point it at a disposable Postgres instance instead. See this file's header comment."
  );
}
// Refuse anything that looks like the real shared/production stack, as a
// second line of defense on top of the distinct-env-var guard above.
if (/supabase\.co|verdian-ai|projexa/i.test(DB_URL)) {
  throw new Error("CRM_LOADTEST_DATABASE_URL looks like a shared/production host -- refusing to run.");
}

const rowsArg = process.argv.find((a) => a.startsWith("--rows="));
const LEAD_COUNT = rowsArg ? Number(rowsArg.split("=")[1]) : 50_000;
const KEEP_SCHEMA = process.argv.includes("--keep-schema");

// Proportional row counts across the tables named in the original task
// scope (leads / opportunities / accounts / contacts / sales-engine /
// VERI-reward), scaled off LEAD_COUNT.
const ROW_COUNTS = {
  leads: LEAD_COUNT,
  opportunities: Math.round(LEAD_COUNT * 0.4),
  accounts: Math.round(LEAD_COUNT * 0.1),
  contacts: Math.round(LEAD_COUNT * 0.3),
  salesReferrals: Math.round(LEAD_COUNT * 0.2),
  veriRewardReferrals: Math.round(LEAD_COUNT * 0.2),
};

// One "hot" tenant (a genuinely busy CRM org, the realistic scalability
// concern this task is actually about) holding 80% of rows, plus 9 smaller
// orgs sharing the remaining 20% -- so org_id stays a real selectivity
// filter rather than the only value in the table.
const ORG_COUNT = 10;
const HOT_ORG_SHARE = 0.8;

const runId = `crm-perftest-${Date.now()}`;
mkdirSync("docs/testing", { recursive: true });
const logPath = `docs/testing/CRM_PERF_LOAD_TEST_RUN_${runId}.log`;
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  writeFileSync(logPath, line + "\n", { flag: "a" });
}

type PlanResult = { planningMs: number; executionMs: number; topNode: string; rowsRemovedByFilter: number };

async function explainAnalyze(sql: postgres.Sql, query: string): Promise<PlanResult> {
  const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
  const plan = (rows[0] as any)["QUERY PLAN"][0];
  const top = plan.Plan;
  const rowsRemoved = collectRowsRemoved(top);
  return {
    planningMs: plan["Planning Time"],
    executionMs: plan["Execution Time"],
    topNode: describeNode(top),
    rowsRemovedByFilter: rowsRemoved,
  };
}

function describeNode(node: any): string {
  return `${node["Node Type"]}${node["Index Name"] ? ` (${node["Index Name"]})` : ""}`;
}

function collectRowsRemoved(node: any): number {
  let total = node["Rows Removed by Filter"] ?? 0;
  for (const child of node.Plans ?? []) total += collectRowsRemoved(child);
  return total;
}

// Runs a query 3x and returns the median execution time -- a single
// EXPLAIN ANALYZE run is noisy (cache warmup, scheduler jitter), median-of-3
// is enough to separate a genuine index-vs-seqscan difference from noise
// without turning this into a full benchmarking suite.
async function measure(sql: postgres.Sql, label: string, query: string): Promise<{ label: string; query: string } & PlanResult> {
  const runs: PlanResult[] = [];
  for (let i = 0; i < 3; i++) runs.push(await explainAnalyze(sql, query));
  runs.sort((a, b) => a.executionMs - b.executionMs);
  const median = runs[1];
  return { label, query, ...median };
}

// The 8 representative queries, one per real call site identified in the
// service layer (see this file's header + the migration's own comment for
// which function each corresponds to).
function buildQueries(hotOrgId: string, sampleAccountId: string, sampleUserId: string) {
  return [
    {
      label: "leads: listLeadsPaged (org+status, order by created_at)",
      query: `SELECT * FROM compliance.crm_leads WHERE org_id = '${hotOrgId}' AND status = 'qualified' ORDER BY created_at DESC LIMIT 25`,
    },
    {
      label: "opportunities: listOpportunitiesPaged (org+stage, order by created_at)",
      query: `SELECT * FROM compliance.crm_opportunities WHERE org_id = '${hotOrgId}' AND stage = 'negotiation' ORDER BY created_at DESC LIMIT 25`,
    },
    {
      label: "pipeline dashboard: overdue leads count (org+next_action_date)",
      query: `SELECT count(*) FROM compliance.crm_leads WHERE org_id = '${hotOrgId}' AND next_action_date IS NOT NULL AND next_action_date <= current_date`,
    },
    {
      label: "pipeline dashboard: overdue opportunities count (org+next_action_date)",
      query: `SELECT count(*) FROM compliance.crm_opportunities WHERE org_id = '${hotOrgId}' AND next_action_date IS NOT NULL AND next_action_date <= current_date`,
    },
    {
      label: "accounts: listAccountsPaged (org+lifecycle_stage, order by created_at)",
      query: `SELECT * FROM compliance.crm_accounts WHERE org_id = '${hotOrgId}' AND lifecycle_stage = 'active_client' ORDER BY created_at DESC LIMIT 25`,
    },
    {
      label: "contacts: listContactsForAccount (org+account_id)",
      query: `SELECT * FROM compliance.crm_contacts WHERE crm_contacts.account_id = '${sampleAccountId}' AND crm_contacts.org_id = '${hotOrgId}'`,
    },
    {
      label: "sales-engine: markReferralPaidIfApplicable (org+status)",
      query: `SELECT * FROM compliance.sales_referrals WHERE org_id = '${hotOrgId}' AND status = 'org_provisioned' LIMIT 1`,
    },
    {
      label: "VERI-reward: referral history (org+referrer_user_id, order by created_at)",
      query: `SELECT * FROM compliance.veri_reward_referrals WHERE org_id = '${hotOrgId}' AND referrer_user_id = '${sampleUserId}' ORDER BY created_at DESC`,
    },
  ];
}

async function main() {
  log(`=== CRM perf load test ${runId} starting (leads=${ROW_COUNTS.leads}) ===`);
  const sql = postgres(DB_URL!, { max: 4 });

  try {
    log("Provisioning disposable schema...");
    await sql.unsafe(`DROP SCHEMA IF EXISTS compliance CASCADE`);
    await sql.unsafe(`CREATE SCHEMA compliance`);
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // Minimal column subset -- only what the 8 query patterns above and the
    // migration's own indexes touch. Real production tables carry many more
    // nullable columns (AI scoring, campaign links, etc.) that are
    // irrelevant to query-plan/index behavior and would only slow down
    // seeding for no benchmarking benefit.
    await sql.unsafe(`
      CREATE TABLE compliance.crm_leads (
        id text PRIMARY KEY, org_id text NOT NULL, status text NOT NULL,
        next_action_date date, created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance.crm_opportunities (
        id text PRIMARY KEY, org_id text NOT NULL, stage text NOT NULL,
        next_action_date date, created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance.crm_accounts (
        id text PRIMARY KEY, org_id text NOT NULL, lifecycle_stage text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance.crm_contacts (
        id text PRIMARY KEY, org_id text NOT NULL, account_id text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance.sales_referrals (
        id text PRIMARY KEY, org_id text, status text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance.veri_reward_referrals (
        id text PRIMARY KEY, org_id text NOT NULL, referrer_user_id text NOT NULL,
        status text NOT NULL DEFAULT 'clicked', created_at timestamp NOT NULL DEFAULT now()
      );
      -- Pre-existing single-column indexes only (matches migrations
      -- 0031/0087/0092/0219/0257 live today) -- this is the real BEFORE
      -- state; the composite indexes under test do not exist yet.
      CREATE INDEX idx_crm_leads_org_id ON compliance.crm_leads(org_id);
      CREATE INDEX idx_crm_leads_status ON compliance.crm_leads(status);
      CREATE INDEX idx_crm_opportunities_org_id ON compliance.crm_opportunities(org_id);
      CREATE INDEX idx_crm_accounts_org_id ON compliance.crm_accounts(org_id);
      CREATE INDEX idx_crm_accounts_lifecycle_stage ON compliance.crm_accounts(lifecycle_stage);
      CREATE INDEX idx_crm_contacts_org_id ON compliance.crm_contacts(org_id);
      CREATE INDEX idx_crm_contacts_account_id ON compliance.crm_contacts(account_id);
      CREATE INDEX idx_sales_referrals_org_id ON compliance.sales_referrals(org_id);
      CREATE INDEX idx_sales_referrals_status ON compliance.sales_referrals(status);
      CREATE INDEX idx_veri_reward_referrals_org ON compliance.veri_reward_referrals(org_id);
    `);
    log("Schema created with baseline (pre-migration) single-column indexes only.");

    const orgIds = Array.from({ length: ORG_COUNT }, (_, i) => `loadtest-org-${i}`);
    const hotOrgId = orgIds[0];

    // Set-based seeding via generate_series -- 50k+ rows in a JS loop with
    // per-row awaits would take minutes; a single INSERT...SELECT is
    // sub-second and is how a real bulk-import would populate these tables
    // anyway, so it's also a more realistic data shape than one-row-at-a-time.
    const orgPickExpr = (n: number) =>
      `CASE WHEN random() < ${HOT_ORG_SHARE} THEN '${hotOrgId}' ELSE ('loadtest-org-' || (1 + floor(random() * ${ORG_COUNT - 1}))::int) END`;

    log(`Seeding ${ROW_COUNTS.leads} leads...`);
    await sql.unsafe(`
      INSERT INTO compliance.crm_leads (id, org_id, status, next_action_date, created_at)
      SELECT 'lead-' || g, ${orgPickExpr(ROW_COUNTS.leads)},
        (ARRAY['new','contacted','qualified','converted','lost'])[1 + floor(random() * 5)],
        CASE WHEN random() < 0.3 THEN (current_date + (floor(random() * 60) - 30)::int) ELSE NULL END,
        now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.leads}) g
    `);

    log(`Seeding ${ROW_COUNTS.opportunities} opportunities...`);
    await sql.unsafe(`
      INSERT INTO compliance.crm_opportunities (id, org_id, stage, next_action_date, created_at)
      SELECT 'opp-' || g, ${orgPickExpr(ROW_COUNTS.opportunities)},
        (ARRAY['prospecting','proposal','negotiation','won','lost'])[1 + floor(random() * 5)],
        CASE WHEN random() < 0.3 THEN (current_date + (floor(random() * 60) - 30)::int) ELSE NULL END,
        now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.opportunities}) g
    `);

    log(`Seeding ${ROW_COUNTS.accounts} accounts...`);
    await sql.unsafe(`
      INSERT INTO compliance.crm_accounts (id, org_id, lifecycle_stage, created_at)
      SELECT 'acct-' || g, ${orgPickExpr(ROW_COUNTS.accounts)},
        (ARRAY['prospect','active_client','dormant','churned'])[1 + floor(random() * 4)],
        now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.accounts}) g
    `);
    const [{ id: sampleAccountId }] = await sql.unsafe(
      `SELECT id FROM compliance.crm_accounts WHERE org_id = '${hotOrgId}' LIMIT 1`
    );

    log(`Seeding ${ROW_COUNTS.contacts} contacts...`);
    await sql.unsafe(`
      INSERT INTO compliance.crm_contacts (id, org_id, account_id, created_at)
      SELECT 'contact-' || g, a.org_id, a.id, now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.contacts}) g
      JOIN LATERAL (
        SELECT id, org_id FROM compliance.crm_accounts ORDER BY random() LIMIT 1
      ) a ON true
    `);

    log(`Seeding ${ROW_COUNTS.salesReferrals} sales_referrals...`);
    await sql.unsafe(`
      INSERT INTO compliance.sales_referrals (id, org_id, status, created_at)
      SELECT 'referral-' || g, ${orgPickExpr(ROW_COUNTS.salesReferrals)},
        (ARRAY['clicked','signup_completed','org_provisioned','paid','lost'])[1 + floor(random() * 5)],
        now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.salesReferrals}) g
    `);

    log(`Seeding ${ROW_COUNTS.veriRewardReferrals} veri_reward_referrals...`);
    await sql.unsafe(`
      INSERT INTO compliance.veri_reward_referrals (id, org_id, referrer_user_id, status, created_at)
      SELECT 'vr-referral-' || g, ${orgPickExpr(ROW_COUNTS.veriRewardReferrals)},
        'loadtest-user-' || (floor(random() * 500))::int,
        (ARRAY['clicked','signup_completed','org_provisioned','paid','lost'])[1 + floor(random() * 5)],
        now() - (random() * interval '365 days')
      FROM generate_series(1, ${ROW_COUNTS.veriRewardReferrals}) g
    `);
    const [{ referrer_user_id: sampleUserId }] = await sql.unsafe(
      `SELECT referrer_user_id FROM compliance.veri_reward_referrals WHERE org_id = '${hotOrgId}' LIMIT 1`
    );

    await sql.unsafe(`ANALYZE compliance.crm_leads, compliance.crm_opportunities, compliance.crm_accounts, compliance.crm_contacts, compliance.sales_referrals, compliance.veri_reward_referrals`);
    log("Seeding complete, stats analyzed.");

    const queries = buildQueries(hotOrgId, sampleAccountId, sampleUserId);

    log("--- BEFORE (single-column indexes only) ---");
    const before: ({ label: string; query: string } & PlanResult)[] = [];
    for (const q of queries) {
      const result = await measure(sql, q.label, q.query);
      before.push(result);
      log(`  ${q.label}: ${result.executionMs.toFixed(2)}ms exec, plan=${result.topNode}, rowsRemovedByFilter=${result.rowsRemovedByFilter}`);
    }

    log("Applying drizzle/0503_v2_16_crm_perf_indexes.sql verbatim...");
    const migrationSql = readFileSync("drizzle/0503_v2_16_crm_perf_indexes.sql", "utf-8");
    await sql.unsafe(migrationSql);
    await sql.unsafe(`ANALYZE compliance.crm_leads, compliance.crm_opportunities, compliance.crm_accounts, compliance.crm_contacts, compliance.sales_referrals, compliance.veri_reward_referrals`);
    log("Composite indexes applied, stats re-analyzed.");

    log("--- AFTER (composite indexes from the migration under test) ---");
    const after: ({ label: string; query: string } & PlanResult)[] = [];
    for (const q of queries) {
      const result = await measure(sql, q.label, q.query);
      after.push(result);
      log(`  ${q.label}: ${result.executionMs.toFixed(2)}ms exec, plan=${result.topNode}, rowsRemovedByFilter=${result.rowsRemovedByFilter}`);
    }

    const comparison = queries.map((q, i) => ({
      label: q.label,
      before: { executionMs: before[i].executionMs, plan: before[i].topNode, rowsRemovedByFilter: before[i].rowsRemovedByFilter },
      after: { executionMs: after[i].executionMs, plan: after[i].topNode, rowsRemovedByFilter: after[i].rowsRemovedByFilter },
      speedup: before[i].executionMs / Math.max(after[i].executionMs, 0.001),
    }));

    writeFileSync(`docs/testing/CRM_PERF_LOAD_TEST_${runId}_SUMMARY.json`, JSON.stringify({
      runId, rowCounts: ROW_COUNTS, orgCount: ORG_COUNT, hotOrgShare: HOT_ORG_SHARE, comparison,
    }, null, 2));

    log("=== Comparison ===");
    for (const c of comparison) {
      log(`  ${c.label}: ${c.before.executionMs.toFixed(2)}ms -> ${c.after.executionMs.toFixed(2)}ms (${c.speedup.toFixed(1)}x), plan ${c.before.plan} -> ${c.after.plan}`);
    }

    if (!KEEP_SCHEMA) {
      log("Dropping disposable schema...");
      await sql.unsafe(`DROP SCHEMA IF EXISTS compliance CASCADE`);
    } else {
      log("--keep-schema set -- disposable schema left in place for inspection.");
    }

    log(`=== Run complete: ${runId} ===`);
    return comparison;
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
