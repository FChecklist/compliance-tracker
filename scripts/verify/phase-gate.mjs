#!/usr/bin/env node
// register: BR-401, BR-501 (PROJEXA-BUILD-001, unit U-23). Called by scripts/verify/phase-gate.sh; see that file for the usage.
//
// Reads the boolean register (ai-os/projexa-build-001/BOOLEAN_REGISTER.csv, or REGISTER_FILE), selects the rows of phase N whose title
// starts with [EXIT] and whose status is not blocked_owner, and runs each row's verify_command from the repository root under Git Bash
// (bash on other systems) with VERIFY_SQL_MODE=mgmt, in file order, one at a time. A row passes when the command exits 0 and every string
// its expected_output names is present (lib/verify-all-lib.mjs checkExpectedOutput). The gate STOPS at the first failure.
//
// stdout: one line per row run, `GATE <id> PASS|FAIL <seconds>s`; under a FAIL line the reason and the last 200 characters of stderr
// (credentials removed, indented two spaces); and, as the very last line, `phase=<N> failed=<k>` with k 0 or 1.
// Exit 0 = k is 0. Exit 1 = a row failed. Exit 2 = usage error, unreadable register, or no row of that phase in the file (then there is
// no phase= line). An EXIT row whose command needs a tool that is missing fails (exit 127 from the shell); nothing is skipped silently.
// A phase with rows but no runnable EXIT row prints a GATE-NOTE line and `phase=<N> failed=0`.
//
// Environment: REGISTER_FILE (register path), GATE_ROW_TIMEOUT_SECONDS (seconds per row before it is killed and fails; default 1800:
// the phase 3 row BR-313 runs verify:all, which takes 10 to 20 minutes).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkExpectedOutput,
  childEnv,
  parseCsvObjects,
  redactedTail,
  runBashCommand,
  secretValuesFromEnv,
  timeoutMsFromEnv,
} from "./lib/verify-all-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_REGISTER = join(ROOT, "ai-os", "projexa-build-001", "BOOLEAN_REGISTER.csv");
const REQUIRED_COLUMNS = ["id", "phase", "title", "verify_command", "expected_output", "status"];

const safe = (s) => String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "?");

async function main() {
  const phaseArg = process.argv[2];
  if (process.argv.length !== 3 || !/^[0-9]+$/.test(phaseArg ?? "")) {
    console.error("usage: bash scripts/verify/phase-gate.sh <phase number>");
    return 2;
  }
  const phase = String(Number(phaseArg));
  let timeoutMs;
  try {
    timeoutMs = timeoutMsFromEnv(process.env, "GATE_ROW_TIMEOUT_SECONDS", 1800);
  } catch (e) {
    console.error("usage error: " + e.message);
    return 2;
  }
  const file = process.env.REGISTER_FILE || DEFAULT_REGISTER;
  let rows;
  try {
    rows = parseCsvObjects(readFileSync(file, "utf8"));
  } catch (e) {
    console.error("cannot read the register: " + String(e && e.message ? e.message : e).split("\n")[0]);
    return 2;
  }
  if (rows.length === 0 || REQUIRED_COLUMNS.some((c) => !(c in rows[0]))) {
    console.error("the register has no rows or lacks one of the columns: " + REQUIRED_COLUMNS.join(", "));
    return 2;
  }
  const inPhase = rows.filter((r) => String(r.phase).trim() === phase);
  if (inPhase.length === 0) {
    console.error("no row of phase " + phase + " in the register");
    return 2;
  }
  const exits = inPhase.filter((r) => r.title.trimStart().startsWith("[EXIT]") && r.status.trim() !== "blocked_owner");
  if (exits.length === 0) console.log("GATE-NOTE phase " + phase + " has no [EXIT] row that is not blocked_owner");

  const env = childEnv();
  const secrets = secretValuesFromEnv(env);
  let failed = 0;
  for (const row of exits) {
    let ok = false;
    let reason = "";
    let seconds = 0;
    let tail = "";
    if (row.verify_command.trim() === "") {
      reason = "the row has no verify_command";
    } else {
      const r = await runBashCommand(row.verify_command, { cwd: ROOT, env, timeoutMs });
      seconds = r.seconds;
      const verdict = checkExpectedOutput(row.expected_output, r);
      ok = verdict.ok;
      reason = r.timedOut ? "timed out after " + timeoutMs / 1000 + "s" : verdict.reason;
      tail = redactedTail(r.stderr, 200, secrets);
    }
    console.log("GATE " + safe(row.id) + " " + (ok ? "PASS" : "FAIL") + " " + seconds.toFixed(1) + "s");
    if (!ok) {
      console.log("  " + reason);
      if (tail !== "") console.log("  stderr: " + tail);
      failed = 1;
      break;
    }
  }
  console.log("phase=" + phase + " failed=" + failed);
  return failed;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error("phase-gate failed: " + String(e && e.message ? e.message : e).split("\n")[0]);
    process.exitCode = 2;
  },
);
