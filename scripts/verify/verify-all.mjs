#!/usr/bin/env node
// register: BR-313 (PROJEXA-BUILD-001, unit U-23)
//
// One command that re-verifies the whole Sumeet requirement register against live Supabase:
//   bun run verify:all          (package.json: "verify:all": "bun scripts/verify/verify-all.mjs")
//
// It reads every row of platform.sumeet_requirements (id, status, closure_state, built, verify_command, evidence_ref) through the
// Supabase Management API read-only endpoint (scripts/verify/lib/mgmt-sql.mjs; needs SUPABASE_ACCESS_TOKEN in the environment or in
// C:\ct\ct\.env.local), then runs ONE check per row, one row at a time. The commands come from the database on every run, never from a
// committed copy, so a changed register row is picked up at once. Each command runs from the repository root under Git Bash (bash on
// other systems) with VERIFY_SQL_MODE=mgmt, so a sql-assert.mjs call inside a command reads as a role that sees the rows.
//
// Result per row:
//   PASS         the command exited 0
//   FAIL         the command failed and the row claims to be done (status starts with DONE, closure_state CLOSED, or built YES)
//   OPEN         the command failed and the row makes no such claim
//   NO-COMMAND   the row has no verify_command: the check is that evidence_ref is well formed (BR-311 rule: a 7 to 40 hex commit
//                id, PR#<n>, or SQL yyyy-mm-dd: <value>; only for built = 'n/a' rows also CHECK yyyy-mm-dd: <what was read> -> <value>).
//                A well formed one is printed as NO-COMMAND PASS; a malformed one as NO-COMMAND FAIL (row claims done) or NO-COMMAND OPEN.
//
// stdout, one line per check, then the summary (the last line):
//   CHECK <id> <class> <seconds>s            <class> is PASS, FAIL, OPEN, NO-COMMAND PASS, NO-COMMAND FAIL or NO-COMMAND OPEN
//     exit=<code> <last 200 characters of stderr, credentials removed>        (only under a FAIL or OPEN line, indented two spaces;
//                                                                              stdout's last 200 characters when stderr is empty)
//   verify:all n=<checks> pass=<> fail=<> open=<> nocommand_pass=<>            (n = pass + fail + open + nocommand_pass)
// The commands' full output is never printed.
//
// Exit codes: 0 = fail is 0, 1 = at least one FAIL, 2 = usage error, 3 = cannot run (no access token), 4 = the register could not be read.
// Environment:
//   VERIFY_ROW_TIMEOUT_SECONDS  seconds one command may run before it is killed and counted as failed (default 300)
//   VERIFY_ALL_ONLY             comma separated ids: run only those rows (for developing checks). The summary then ends with
//                               " only=<k>" and scripts/verify/verify-all-local.sh refuses to print VERIFY-ALL-GATE: PASS.
// A command is run only when it starts with one of the four forms the register uses (lib/verify-all-lib.mjs ALLOWED_COMMAND_PREFIXES),
// because a verify_command is code that arrives from data; any other text is not run and counts as a failed check.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mgmtReadOnlyQuery, MgmtError, resolveAccessToken } from "./lib/mgmt-sql.mjs";
import {
  childEnv,
  classLabel,
  classifyCheck,
  commandFormAllowed,
  hasCommand,
  redactedTail,
  runBashCommand,
  secretValuesFromEnv,
  summarize,
  timeoutMsFromEnv,
} from "./lib/verify-all-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTER_SQL = "select id, status, closure_state, built, verify_command, evidence_ref from platform.sumeet_requirements order by id";

const safeId = (id) => String(id ?? "").replace(/[^A-Za-z0-9._-]/g, "?");

/** Run the row's command (when it has an allowed one) and return the exit code, the seconds it took and the line printed under a failure. */
async function runRow(row, { env, timeoutMs, secrets }) {
  if (!hasCommand(row)) return { result: { commandExit: null }, seconds: 0, note: "exit=none no verify_command, and evidence_ref is not well formed" };
  if (!commandFormAllowed(row.verify_command)) {
    return { result: { commandExit: null }, seconds: 0, note: "exit=not run: the command does not start with an allowed form" };
  }
  const r = await runBashCommand(row.verify_command, { cwd: ROOT, env, timeoutMs });
  const shown = r.stderr.trim() !== "" ? r.stderr : r.stdout;
  const exit = r.timedOut ? "timeout after " + timeoutMs / 1000 + "s" : r.code;
  return { result: { commandExit: r.code }, seconds: r.seconds, note: "exit=" + exit + " " + redactedTail(shown, 200, secrets) };
}

async function main() {
  let timeoutMs;
  try {
    timeoutMs = timeoutMsFromEnv(process.env, "VERIFY_ROW_TIMEOUT_SECONDS", 300);
  } catch (e) {
    console.error("usage error: " + e.message);
    return 2;
  }
  const onlyRaw = (process.env.VERIFY_ALL_ONLY ?? "").trim();
  const only = onlyRaw === "" ? null : new Set(onlyRaw.split(",").map((s) => s.trim()).filter(Boolean));

  let rows;
  let token = "";
  try {
    token = resolveAccessToken();
    rows = await mgmtReadOnlyQuery(REGISTER_SQL);
  } catch (e) {
    if (e instanceof MgmtError) {
      console.error(e.message);
      return e.kind === "cannot-run" ? 3 : e.kind === "error" ? 4 : 2;
    }
    console.error("query error: " + String(e && e.message ? e.message : e).split("\n")[0]);
    return 4;
  }
  if (rows.length === 0) {
    console.error("query error: platform.sumeet_requirements returned no rows");
    return 4;
  }
  if (only) {
    const known = new Set(rows.map((r) => String(r.id)));
    const unknown = [...only].filter((id) => !known.has(id));
    if (unknown.length) {
      console.error("usage error: VERIFY_ALL_ONLY names ids that are not in the register: " + unknown.map(safeId).join(", "));
      return 2;
    }
    rows = rows.filter((r) => only.has(String(r.id)));
  }

  const env = childEnv();
  const ctx = { env, timeoutMs, secrets: [...secretValuesFromEnv(env), token] };
  const checks = [];
  for (const row of rows) {
    const { result, seconds, note } = await runRow(row, ctx);
    const c = classifyCheck(row, result);
    checks.push(c);
    console.log("CHECK " + safeId(row.id) + " " + classLabel(c) + " " + seconds.toFixed(1) + "s");
    if (c.cls !== "PASS") console.log("  " + note.trimEnd());
  }

  const s = summarize(checks);
  console.log("verify:all n=" + s.n + " pass=" + s.pass + " fail=" + s.fail + " open=" + s.open + " nocommand_pass=" + s.nocommandPass + (only ? " only=" + only.size : ""));
  return s.fail > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error("verify-all failed: " + String(e && e.message ? e.message : e).split("\n")[0]);
    process.exitCode = 2;
  },
);
