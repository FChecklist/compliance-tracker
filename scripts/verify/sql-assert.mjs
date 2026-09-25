#!/usr/bin/env node
// PROJEXA-BUILD-001 verify runner: run ONE read-only SQL statement and compare its single value.
//
// Usage:
//   node scripts/verify/sql-assert.mjs --project <ct|px> --sql "<one SELECT returning one value>" --equals <value>
//   node scripts/verify/sql-assert.mjs --project ct --sql "select 1" --gte 1          (also: --lte, --gt, --lt, --not-equals)
//
// Connection (never printed): VERIFY_DATABASE_URL for --project ct (verdian-ai, pcrjmlpuqsbocqfwoxod),
//                             VERIFY_DATABASE_URL_PX for --project px (projexa, evpckeuxgvahguwsaeul).
// Second read path (U-23): VERIFY_SQL_MODE=mgmt sends the statement to the Supabase Management API read-only endpoint instead
//   (scripts/verify/lib/mgmt-sql.mjs), with SUPABASE_ACCESS_TOKEN from the environment or C:\ct\ct\.env.local. That path runs as a
//   role that sees platform.sumeet_requirements rows, cron and tenant rows, which app_runtime cannot (PMD-22). Only --project ct
//   exists in that mode. The token is never printed. scripts/verify/verify-all.mjs and phase-gate.sh export VERIFY_SQL_MODE=mgmt to
//   every command they run.
// Use a role that can see the rows being asserted about. Row-level security applies to that role: a count taken
// as an RLS-restricted role can be 0 for the wrong reason, so register rows that count tenant data say which role.
//
// Exit codes: 0 = assertion holds, 1 = assertion fails, 2 = usage error or SQL refused by the guard,
//             3 = cannot run (no connection string in the environment; in mgmt mode, no access token),
//             4 = connection or query error (in mgmt mode also any non-2xx answer from the API).
// Safety: the statement must pass scripts/verify/lib/sql-safety.mjs AND runs inside a READ ONLY transaction
// with an 8 second statement timeout (mgmt mode: the endpoint is read-only on the server side).
import postgres from "postgres";
import { checkReadOnlySql } from "./lib/sql-safety.mjs";
import { mgmtReadOnlyQuery, MgmtError } from "./lib/mgmt-sql.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

function compare(actual, args) {
  const a = String(actual).trim();
  const num = (v) => Number(String(v).trim());
  if (args.equals !== undefined) return a === String(args.equals).trim();
  if (args["not-equals"] !== undefined) return a !== String(args["not-equals"]).trim();
  if (args.gte !== undefined) return num(a) >= num(args.gte);
  if (args.lte !== undefined) return num(a) <= num(args.lte);
  if (args.gt !== undefined) return num(a) > num(args.gt);
  if (args.lt !== undefined) return num(a) < num(args.lt);
  return null;
}

async function runMgmt(project, statement, args) {
  if (project !== "ct") { console.error("usage error: VERIFY_SQL_MODE=mgmt supports only --project ct"); return 2; }
  try {
    const rows = await mgmtReadOnlyQuery(statement);
    if (rows.length !== 1) { console.error("query returned " + rows.length + " rows; exactly 1 is required"); return 4; }
    const cols = Object.keys(rows[0]);
    if (cols.length !== 1) { console.error("query returned " + cols.length + " columns; exactly 1 is required"); return 4; }
    const actual = rows[0][cols[0]];
    const ok = compare(actual, args);
    console.log(String(actual));
    return ok ? 0 : 1;
  } catch (e) {
    if (e instanceof MgmtError) {
      console.error(e.message);
      return e.kind === "cannot-run" ? 3 : e.kind === "error" ? 4 : 2;
    }
    console.error("query error: " + String(e && e.message ? e.message : e).split("\n")[0]);
    return 4;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = args.project;
  if (project !== "ct" && project !== "px") { console.error("usage error: --project must be ct or px"); return 2; }
  if (typeof args.sql !== "string") { console.error("usage error: --sql is required"); return 2; }
  const cmpKeys = ["equals", "not-equals", "gte", "lte", "gt", "lt"].filter((k) => args[k] !== undefined);
  if (cmpKeys.length !== 1) { console.error("usage error: give exactly one of --equals --not-equals --gte --lte --gt --lt"); return 2; }
  const guard = checkReadOnlySql(args.sql);
  if (!guard.ok) { console.error("refused by the read-only guard: " + guard.reason); return 2; }
  const mode = process.env.VERIFY_SQL_MODE;
  if (mode && mode !== "mgmt" && mode !== "pg") { console.error("usage error: VERIFY_SQL_MODE must be mgmt or pg (or unset)"); return 2; }
  if (mode === "mgmt") return runMgmt(project, guard.sql, args);
  const url = project === "ct" ? process.env.VERIFY_DATABASE_URL : process.env.VERIFY_DATABASE_URL_PX;
  if (!url) {
    console.error("cannot run: " + (project === "ct" ? "VERIFY_DATABASE_URL" : "VERIFY_DATABASE_URL_PX") + " is not set");
    return 3;
  }
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
  try {
    const rows = await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = 8000`;
      return tx.unsafe(guard.sql);
    });
    if (rows.length !== 1) { console.error("query returned " + rows.length + " rows; exactly 1 is required"); return 4; }
    const cols = Object.keys(rows[0]);
    if (cols.length !== 1) { console.error("query returned " + cols.length + " columns; exactly 1 is required"); return 4; }
    const actual = rows[0][cols[0]];
    const ok = compare(actual, args);
    console.log(String(actual));
    return ok ? 0 : 1;
  } catch (e) {
    console.error("query error: " + String(e && e.message ? e.message : e).split("\n")[0]);
    return 4;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
