// V2-17 (HR performance/error-handling + payroll rate audit, redispatch
// 2026-07-26) load-test harness: "load-test harnesses for
// payroll/recruitment/attendance/vendor scorecards" (CSV rows #52-#58).
//
// Deliberately service-layer + DB timing only -- NO LLM calls, unlike
// scripts/veridian-full-load-test.ts's orchestra-layer harness. That
// script exists to load-test the AI orchestra call path (task/chat/FM/doc
// modes through real model providers); this one exists to load-test plain
// CRUD/read-query throughput for 4 HR/ERP modules, which needs zero tokens
// and zero provider budget -- following the SAME "reuse the existing demo
// org + its 100 synthetic personas" convention (Boss's 2026-07-10
// instruction) for consistency, not because an LLM is involved.
//
// Scope note on payroll specifically: this harness load-tests READ paths
// (listPayrollRuns/listPayslips) rather than synthesizing a full
// processPayrollRun() write run. Running payroll for real requires salary
// structures + erp_statutory_rules/erp_income_tax_slabs to already be
// configured for the org -- and per this same wave's own rate-seed audit
// (ai-os/PAYROLL_RATE_SEED_AUDIT_2026-07-26.md), those rates are
// deliberately NEVER hardcoded/seeded in code (admin-editable master data
// only). Fabricating synthetic statutory rates here to exercise the write
// path would contradict that discipline -- so the write-path load test
// stays a documented, honest gap (see this script's own SUMMARY output and
// the results doc), not silently faked.
//
// Run: bun run scripts/hr-payroll-load-test.ts [--dry-run=N]
// Requires DATABASE_URL for a real Postgres/Supabase connection -- this
// script was authored and reviewed but NOT executed in the sandbox this
// task was written in (no bun runtime, no DATABASE_URL, no node_modules --
// confirmed via `which bun`/`ls node_modules` returning nothing). See
// docs/testing/HR_PAYROLL_LOAD_TEST_RESULTS.md for that honest limitation
// recorded plainly, and the exact command to run this for real.
import { db, organisations, users, hrAttendanceRecords } from "../src/lib/db";
import { eq } from "drizzle-orm";
import { listAttendance, getMonthlySummaries } from "../src/lib/services/hr-attendance-service";
import { listApplications, listJobOpenings, listCandidates, createCandidate, createApplication, createJobOpening } from "../src/lib/services/recruitment-service";
import { listPayrollRuns, listPayslips } from "../src/lib/services/erp-payroll-service";
import { listSupplierScorecards } from "../src/lib/services/erp-buying-service";
import { getHrDashboardKpis, invalidateHrDashboardCache } from "../src/lib/services/hr-dashboard-service";
import { writeFileSync, mkdirSync } from "fs";

const DEMO_ORG_ID = "obux019rsc5nzxjx93rrpc1j"; // same demo org as veridian-full-load-test.ts / projexa-load-test.ts

const dryRunArg = process.argv.find((a) => a.startsWith("--dry-run="));
const SEED_COUNT = dryRunArg ? Number(dryRunArg.split("=")[1]) : 500; // synthetic attendance/application rows to seed per module
const READ_ITERATIONS = dryRunArg ? 5 : 50; // repeated read calls timed for p50/p95

const runId = `hrload-${Date.now()}`;
mkdirSync("docs/testing", { recursive: true });

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

interface LoadTestResult {
  label: string;
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
}

async function timeCalls<T>(label: string, iterations: number, fn: () => Promise<T>): Promise<LoadTestResult> {
  const durations: number[] = [];
  let errors = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
      durations.push(performance.now() - start);
    } catch (err) {
      errors++;
      console.error(`[${label}] iteration ${i} failed:`, err instanceof Error ? err.message : err);
    }
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return { label, iterations, p50Ms: Math.round(percentile(sorted, 50)), p95Ms: Math.round(percentile(sorted, 95)), maxMs: Math.round(sorted[sorted.length - 1] ?? 0), errors };
}

async function main() {
  console.log(`=== HR/Payroll/Recruitment/Attendance/Vendor-Scorecard Load Test ${runId} starting (seedCount=${SEED_COUNT}, readIterations=${READ_ITERATIONS}) ===`);

  const [org] = await db.select().from(organisations).where(eq(organisations.id, DEMO_ORG_ID));
  if (!org) throw new Error(`Demo org ${DEMO_ORG_ID} not found -- run this against an environment that has the shared load-test demo org seeded (see veridian-full-load-test.ts).`);

  const orgUsers = await db.select().from(users).where(eq(users.orgId, DEMO_ORG_ID));
  if (orgUsers.length === 0) throw new Error(`No users found for org ${DEMO_ORG_ID}`);
  console.log(`Reusing demo org ${org.id} (${org.name}), ${orgUsers.length} existing users`);

  // ── Seed: attendance (Attendance module) ──────────────────────────────
  // Idempotent-ish: onConflictDoUpdate keyed on (org,user,date) inside the
  // real service isn't used here (bulk raw insert for speed) -- this
  // seeds one row per user for each of the last SEED_COUNT/orgUsers.length
  // days, spread across users, skipping conflicts rather than upserting
  // (a load test doesn't need every row to land, just realistic volume).
  const today = new Date();
  let attendanceSeeded = 0;
  for (let i = 0; i < SEED_COUNT; i++) {
    const u = orgUsers[i % orgUsers.length];
    const date = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    try {
      await db.insert(hrAttendanceRecords).values({
        orgId: DEMO_ORG_ID, userId: u.id, date, status: "present", markedById: u.id, source: "self",
      }).onConflictDoNothing();
      attendanceSeeded++;
    } catch (err) {
      console.error(`Attendance seed row ${i} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Seeded ${attendanceSeeded}/${SEED_COUNT} attendance rows`);

  // ── Seed: recruitment (candidates + applications) ─────────────────────
  const openings = await listJobOpenings({ orgId: DEMO_ORG_ID });
  let opening = openings[0];
  if (!opening) {
    opening = await createJobOpening({ orgId: DEMO_ORG_ID, userId: orgUsers[0].id }, { title: "Load Test Opening" });
  }
  let applicationsSeeded = 0;
  for (let i = 0; i < SEED_COUNT; i++) {
    try {
      const candidate = await createCandidate({ orgId: DEMO_ORG_ID, userId: orgUsers[0].id }, { name: `Load Test Candidate ${i}`, email: `loadtest-candidate-${runId}-${i}@example.invalid` });
      await createApplication({ orgId: DEMO_ORG_ID, userId: orgUsers[0].id }, { jobOpeningId: opening.id, candidateId: candidate.id });
      applicationsSeeded++;
    } catch (err) {
      console.error(`Application seed row ${i} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Seeded ${applicationsSeeded}/${SEED_COUNT} candidate+application pairs`);

  // ── Timed reads ─────────────────────────────────────────────────────
  const results: LoadTestResult[] = [];
  results.push(await timeCalls("attendance:listAttendance", READ_ITERATIONS, () => listAttendance({ orgId: DEMO_ORG_ID })));
  results.push(await timeCalls("attendance:getMonthlySummaries", READ_ITERATIONS, () => getMonthlySummaries({ orgId: DEMO_ORG_ID }, { month: today.getMonth() + 1, year: today.getFullYear() })));
  results.push(await timeCalls("recruitment:listApplications", READ_ITERATIONS, () => listApplications({ orgId: DEMO_ORG_ID })));
  results.push(await timeCalls("recruitment:listCandidates", READ_ITERATIONS, () => listCandidates({ orgId: DEMO_ORG_ID })));
  results.push(await timeCalls("payroll:listPayrollRuns", READ_ITERATIONS, () => listPayrollRuns({ orgId: DEMO_ORG_ID })));
  const runs = await listPayrollRuns({ orgId: DEMO_ORG_ID });
  if (runs[0]) results.push(await timeCalls("payroll:listPayslips", READ_ITERATIONS, () => listPayslips({ orgId: DEMO_ORG_ID }, runs[0].id)));
  else console.log("payroll:listPayslips skipped -- no payroll run exists for this org (see this script's header note on why one isn't synthesized)");
  // timeCalls() never throws (each iteration's error is caught and counted
  // internally) -- if ERP isn't enabled for this org, requireErpEnabled()
  // will reject on every iteration and this shows up as errors=N/N in the
  // results output below, not as an exception here.
  results.push(await timeCalls("vendor:listSupplierScorecards", READ_ITERATIONS, () => listSupplierScorecards({ orgId: DEMO_ORG_ID })));
  // HR dashboard KPI cache: first call is a cold compute, rest should hit
  // the in-process cache (hr-dashboard-service.ts, 60s TTL) -- explicitly
  // invalidated first so this run always measures a real cold start.
  invalidateHrDashboardCache(DEMO_ORG_ID);
  results.push(await timeCalls("dashboard:getHrDashboardKpis (cold+cached mix)", READ_ITERATIONS, () => getHrDashboardKpis(DEMO_ORG_ID)));

  console.log("=== Results ===");
  for (const r of results) console.log(`${r.label}: p50=${r.p50Ms}ms p95=${r.p95Ms}ms max=${r.maxMs}ms errors=${r.errors}/${r.iterations}`);

  const summary = { runId, orgId: DEMO_ORG_ID, seedCount: SEED_COUNT, attendanceSeeded, applicationsSeeded, readIterations: READ_ITERATIONS, results };
  writeFileSync(`docs/testing/HR_PAYROLL_LOAD_TEST_${runId}_SUMMARY.json`, JSON.stringify(summary, null, 2));
  console.log(`=== Run complete, summary written to docs/testing/HR_PAYROLL_LOAD_TEST_${runId}_SUMMARY.json ===`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
