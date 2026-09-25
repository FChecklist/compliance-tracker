import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emptyEnvFile, FAKE_TOKEN, runAsync, startFakeMgmt, type FakeMgmt, type RunResult } from "./fake-mgmt-server";

// U-23 (PROJEXA-BUILD-001): the real scripts run end to end against a fake Management API on a loopback port and a fake register:
//   scripts/verify/verify-all.mjs        (`bun run verify:all`, BR-313)
//   scripts/verify/verify-all-local.sh   (BR-313: the VERIFY-ALL-GATE line)
//   scripts/verify/verify-all-deployed.sh (BR-314: a skeleton that must never claim a pass)
//   scripts/verify/phase-gate.sh         (BR-401, BR-501)
// No real database, token or Vercel is touched. Lives under src/ because bunfig.toml sets [test] root = "src".

const ROOT = process.cwd();
const VERIFY_ALL = join(ROOT, "scripts", "verify", "verify-all.mjs");
const LOCAL_SH = "scripts/verify/verify-all-local.sh";
const DEPLOYED_SH = "scripts/verify/verify-all-deployed.sh";
const GATE_SH = "scripts/verify/phase-gate.sh";
const BASH = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

type Row = { id: string; status: string; closure_state: string; built: string | null; verify_command: string | null; evidence_ref: string | null };
const PASS_CMD = 'test "$(printf 1)" = "1"';
const FAIL_CMD = 'test "$(printf 1)" = "2"';
const R = (id: string, o: Partial<Row> = {}): Row => ({ id, status: "OPEN - x", closure_state: "OPEN", built: null, verify_command: PASS_CMD, evidence_ref: null, ...o });

let fake: FakeMgmt | null = null;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  while (cleanups.length) cleanups.pop()!();
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "verify-run-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A fake API: the register query returns `rows`; any other SELECT (a sql-assert inside a command) returns [{v: 1}]. */
async function serve(rows: Row[] | (() => Row[])): Promise<FakeMgmt> {
  fake = await startFakeMgmt((query) => {
    if (query.includes("from platform.sumeet_requirements")) return { status: 201, body: typeof rows === "function" ? rows() : rows };
    return { status: 201, body: [{ v: 1 }] };
  });
  return fake;
}

const env = (f: FakeMgmt, extra: Record<string, string | undefined> = {}) => ({ VERIFY_SQL_MGMT_BASE_URL: f.baseUrl, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN, ...extra });
const runVerifyAll = (f: FakeMgmt, extra: Record<string, string | undefined> = {}): Promise<RunResult> => runAsync("node", [VERIFY_ALL], env(f, extra));
const checkLines = (r: RunResult) => r.stdout.split(/\r?\n/).filter((l) => l.startsWith("CHECK "));
const classOf = (r: RunResult, id: string): string => {
  const l = checkLines(r).find((x) => x.split(" ")[1] === id);
  if (!l) throw new Error("no CHECK line for " + id + " in: " + r.out);
  return l.split(" ").slice(2, -1).join(" ");
};
const lastLine = (r: RunResult) => r.stdout.trim().split(/\r?\n/).pop() ?? "";

describe("verify-all.mjs: the class of each row", () => {
  test("PASS, FAIL, OPEN and the three NO-COMMAND results, one line each, then the summary; exit 1 because a claimed-done row failed", async () => {
    const rows: Row[] = [
      R("A-pass", { status: "DONE" }),
      R("B-fail-done", { status: "DONE - VERIFIED", verify_command: FAIL_CMD }),
      R("C-fail-closed", { closure_state: "CLOSED", verify_command: FAIL_CMD }),
      R("D-fail-built", { built: "YES", verify_command: FAIL_CMD }),
      R("E-open", { verify_command: FAIL_CMD }),
      R("F-nocmd-pass", { status: "DONE", verify_command: null, evidence_ref: "40be85bf3f6622e9a3173a6f50be56b9efd0b089" }),
      R("G-nocmd-fail", { status: "DONE", verify_command: null, evidence_ref: "see the KT folder" }),
      R("H-nocmd-open", { verify_command: null, evidence_ref: null }),
      R("I-check-na", { status: "DONE", built: "n/a", verify_command: null, evidence_ref: "CHECK 2026-09-12: gh repo view x --json visibility -> PUBLIC" }),
      R("J-check-yes", { status: "DONE", built: "YES", verify_command: null, evidence_ref: "CHECK 2026-09-12: gh repo view x --json visibility -> PUBLIC" }),
    ];
    const f = await serve(rows);
    const r = await runVerifyAll(f);
    expect(classOf(r, "A-pass")).toBe("PASS");
    expect(classOf(r, "B-fail-done")).toBe("FAIL");
    expect(classOf(r, "C-fail-closed")).toBe("FAIL");
    expect(classOf(r, "D-fail-built")).toBe("FAIL");
    expect(classOf(r, "E-open")).toBe("OPEN");
    expect(classOf(r, "F-nocmd-pass")).toBe("NO-COMMAND PASS");
    expect(classOf(r, "G-nocmd-fail")).toBe("NO-COMMAND FAIL");
    expect(classOf(r, "H-nocmd-open")).toBe("NO-COMMAND OPEN");
    expect(classOf(r, "I-check-na")).toBe("NO-COMMAND PASS");
    expect(classOf(r, "J-check-yes")).toBe("NO-COMMAND FAIL");
    expect(checkLines(r).length).toBe(10);
    expect(lastLine(r)).toBe("verify:all n=10 pass=1 fail=5 open=2 nocommand_pass=2");
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(FAKE_TOKEN);
  }, 120_000);

  test("exit 0 when nothing fails (OPEN rows do not fail the run)", async () => {
    const f = await serve([R("A", { status: "DONE" }), R("B", { verify_command: FAIL_CMD }), R("C", { verify_command: null, evidence_ref: "PR#12" })]);
    const r = await runVerifyAll(f);
    expect(lastLine(r)).toBe("verify:all n=3 pass=1 fail=0 open=1 nocommand_pass=1");
    expect(r.code).toBe(0);
  }, 120_000);

  test("every CHECK line ends with <seconds>s and the id is the second word", async () => {
    const f = await serve([R("R-01")]);
    const r = await runVerifyAll(f);
    expect(checkLines(r)[0]).toMatch(/^CHECK R-01 PASS [0-9]+\.[0-9]s$/);
  }, 120_000);

  test("the commands come from the database on every run: a changed row changes the result", async () => {
    let current: Row[] = [R("A", { status: "DONE", verify_command: PASS_CMD })];
    const f = await serve(() => current);
    const first = await runVerifyAll(f);
    current = [R("A", { status: "DONE", verify_command: FAIL_CMD })];
    const second = await runVerifyAll(f);
    expect(classOf(first, "A")).toBe("PASS");
    expect(classOf(second, "A")).toBe("FAIL");
    expect(second.code).toBe(1);
  }, 120_000);
});

describe("verify-all.mjs: how a command runs", () => {
  test("VERIFY_SQL_MODE=mgmt is exported, so a sql-assert.mjs inside a command reads through the API (and its answer decides the row)", async () => {
    const f = await serve([
      R("MODE", { status: "DONE", verify_command: 'test "$(printenv VERIFY_SQL_MODE)" = "mgmt"' }),
      R("SQL-OK", { status: "DONE", verify_command: 'node scripts/verify/sql-assert.mjs --project ct --sql "select 1" --equals 1' }),
      R("SQL-BAD", { status: "DONE", verify_command: 'node scripts/verify/sql-assert.mjs --project ct --sql "select 1" --equals 2' }),
    ]);
    const r = await runVerifyAll(f);
    expect(classOf(r, "MODE")).toBe("PASS");
    expect(classOf(r, "SQL-OK")).toBe("PASS");
    expect(classOf(r, "SQL-BAD")).toBe("FAIL");
    // the register read, plus the two sql-assert calls, all reached the fake API with the Bearer header
    expect(f.requests.length).toBe(3);
    for (const q of f.requests) expect(q.authorization).toBe("Bearer " + FAKE_TOKEN);
  }, 120_000);

  test("a command that is not one of the four allowed forms is not run, and counts as a failed check", async () => {
    const dir = tmpDir();
    const marker = join(dir, "marker.txt").replace(/\\/g, "/");
    const f = await serve([R("EVIL", { status: "DONE", verify_command: `touch "${marker}"` }), R("EVIL2", { verify_command: `bun run build` })]);
    const r = await runVerifyAll(f);
    expect(existsSync(marker)).toBe(false);
    expect(classOf(r, "EVIL")).toBe("FAIL");
    expect(classOf(r, "EVIL2")).toBe("OPEN");
    expect(r.out).toContain("not run");
  }, 120_000);

  test("a command that runs longer than VERIFY_ROW_TIMEOUT_SECONDS is killed and counts as failed", async () => {
    const f = await serve([R("SLOW", { status: "DONE", verify_command: 'test "$(sleep 60; echo 1)" = "1"' }), R("FAST", { status: "DONE" })]);
    const started = Date.now();
    const r = await runVerifyAll(f, { VERIFY_ROW_TIMEOUT_SECONDS: "2" });
    expect(classOf(r, "SLOW")).toBe("FAIL");
    expect(classOf(r, "FAST")).toBe("PASS");
    expect(r.out).toContain("timeout after 2s");
    expect(Date.now() - started).toBeLessThan(45_000);
  }, 120_000);

  test("a failing command shows only the last 200 characters of its stderr, with credentials and the token removed", async () => {
    const secretUrl = "postgres" + "://user:" + "pa55w0rd" + "xyz@db.example.com/postgres";
    const noisy = `test "$(printf 'x%.0s' $(seq 1 400) >&2; echo ${secretUrl} >&2; printenv SUPABASE_ACCESS_TOKEN >&2; echo end-marker >&2; echo 1)" = "2"`;
    const f = await serve([R("NOISY", { status: "DONE", verify_command: noisy })]);
    const r = await runVerifyAll(f);
    expect(classOf(r, "NOISY")).toBe("FAIL");
    const detail = r.stdout.split(/\r?\n/).find((l) => l.startsWith("  exit=")) ?? "";
    expect(detail).toContain("end-marker");
    expect(detail.length).toBeLessThan(260);
    expect(r.out).not.toContain("pa55w0rdxyz");
    expect(r.out).not.toContain(FAKE_TOKEN);
    expect(r.out).not.toContain("x".repeat(250));
  }, 120_000);
});

describe("verify-all.mjs: VERIFY_ALL_ONLY and read failures", () => {
  test("VERIFY_ALL_ONLY runs only the named rows and marks the summary", async () => {
    const f = await serve([R("A"), R("B"), R("C")]);
    const r = await runVerifyAll(f, { VERIFY_ALL_ONLY: "A, C" });
    expect(checkLines(r).map((l) => l.split(" ")[1])).toEqual(["A", "C"]);
    expect(lastLine(r)).toBe("verify:all n=2 pass=2 fail=0 open=0 nocommand_pass=0 only=2");
  }, 120_000);

  test("exit 2 when VERIFY_ALL_ONLY names an id that is not in the register", async () => {
    const f = await serve([R("A")]);
    const r = await runVerifyAll(f, { VERIFY_ALL_ONLY: "A,NOPE" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("NOPE");
    expect(checkLines(r).length).toBe(0);
  }, 120_000);

  test("exit 3 with no token, exit 4 when the register read fails or returns no rows, exit 2 for a bad timeout", async () => {
    const f = await serve([R("A")]);
    const empty = emptyEnvFile();
    cleanups.push(empty.cleanup);
    expect((await runVerifyAll(f, { SUPABASE_ACCESS_TOKEN: undefined, VERIFY_ENV_FILE: empty.file })).code).toBe(3);
    expect((await runVerifyAll(f, { VERIFY_ROW_TIMEOUT_SECONDS: "0" })).code).toBe(2);
    await f.close();
    fake = await startFakeMgmt(() => ({ status: 500, body: "boom" }));
    expect((await runVerifyAll(fake)).code).toBe(4);
    await fake.close();
    fake = await startFakeMgmt(() => ({ status: 201, body: [] }));
    const none = await runVerifyAll(fake);
    expect(none.code).toBe(4);
    expect(none.out).toContain("no rows");
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ verify-all-local.sh

function manyRows(n: number, mutate?: (r: Row, i: number) => Row): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const base = R(`ROW-${String(i).padStart(3, "0")}`, { status: "DONE", verify_command: null, evidence_ref: "abcdef1" });
    return mutate ? mutate(base, i) : base;
  });
}

const bunDir = dirname(process.execPath);
const runLocal = (f: FakeMgmt, extra: Record<string, string | undefined> = {}) =>
  runAsync(BASH, [LOCAL_SH], env(f, { PATH: `${bunDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`, ...extra }), { timeoutMs: 170_000 });

describe("verify-all-local.sh: VERIFY-ALL-GATE", () => {
  test("PASS is the very last line, only with n >= 111 checks and fail = 0, and the exit code is 0", async () => {
    const f = await serve(manyRows(111));
    const r = await runLocal(f);
    expect(lastLine(r)).toBe("VERIFY-ALL-GATE: PASS");
    expect(r.stdout).toContain("verify:all n=111 pass=0 fail=0 open=0 nocommand_pass=111");
    expect(r.code).toBe(0);
  }, 180_000);

  test("FAIL with exit 1 when a check fails, even with 111 checks", async () => {
    const f = await serve(manyRows(111, (row, i) => (i === 5 ? { ...row, verify_command: null, evidence_ref: null } : row)));
    const r = await runLocal(f);
    expect(lastLine(r)).toMatch(/^VERIFY-ALL-GATE: FAIL /);
    expect(r.stdout).not.toContain("VERIFY-ALL-GATE: PASS");
    expect(r.code).toBe(1);
  }, 180_000);

  test("FAIL with exit 1 when fewer than 111 checks ran (110 rows, all passing)", async () => {
    const f = await serve(manyRows(110));
    const r = await runLocal(f);
    expect(lastLine(r)).toMatch(/^VERIFY-ALL-GATE: FAIL n=110 is below 111/);
    expect(r.code).toBe(1);
  }, 180_000);

  test("a partial run (VERIFY_ALL_ONLY) never prints PASS, even with every selected check passing", async () => {
    const f = await serve(manyRows(111));
    const r = await runLocal(f, { VERIFY_ALL_ONLY: "ROW-000,ROW-001" });
    expect(lastLine(r)).toMatch(/^VERIFY-ALL-GATE: FAIL partial run/);
    expect(r.stdout).not.toContain("VERIFY-ALL-GATE: PASS");
    expect(r.code).toBe(1);
  }, 180_000);

  test("exit 2 and a FAIL last line when it cannot run (no token; the register cannot be read)", async () => {
    const f = await serve(manyRows(111));
    const empty = emptyEnvFile();
    cleanups.push(empty.cleanup);
    const noToken = await runLocal(f, { SUPABASE_ACCESS_TOKEN: undefined, VERIFY_ENV_FILE: empty.file });
    expect(noToken.code).toBe(2);
    expect(lastLine(noToken)).toMatch(/^VERIFY-ALL-GATE: FAIL cannot run/);
    await f.close();
    fake = await startFakeMgmt(() => ({ status: 500, body: "boom" }));
    const down = await runLocal(fake);
    expect(down.code).toBe(2);
    expect(lastLine(down)).toMatch(/^VERIFY-ALL-GATE: FAIL cannot run/);
  }, 180_000);
});

describe("verify-all-deployed.sh (BR-314) is a skeleton that never claims a pass", () => {
  const runDeployed = (e: Record<string, string | undefined>) => runAsync(BASH, [DEPLOYED_SH], e);
  test("exit 3 without DEPLOY_URL, with a URL that is not https, and with an https URL (not implemented)", async () => {
    const none = await runDeployed({});
    expect(none.code).toBe(3);
    expect(none.out).toContain("DEPLOY_URL is not set");
    const http = await runDeployed({ DEPLOY_URL: "http://example.com" });
    expect(http.code).toBe(3);
    expect(http.out).toContain("https");
    const https = await runDeployed({ DEPLOY_URL: "https://example.com" });
    expect(https.code).toBe(3);
    expect(https.out).toContain("not implemented");
    for (const r of [none, http, https]) {
      expect(r.out).not.toContain("VERIFY-ALL-DEPLOYED-GATE: PASS");
      expect(lastLine(r)).toMatch(/^VERIFY-ALL-DEPLOYED-GATE: FAIL /);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------- phase-gate.sh

const CSV_HEADER = "id,phase,title,source,verify_command,expected_output,status,evidence_ref,owner_blocked";
const q = (s: string) => '"' + s.replace(/"/g, '""') + '"';
/** One register line in the real file's shape: quoted cells, a title that holds a newline, a command with quotes and a pipe. */
function regRow(o: { id: string; phase: string; title: string; cmd: string; expected?: string; status?: string }): string {
  return [o.id, o.phase, q(o.title), "U-23", q(o.cmd), q(o.expected ?? "EXIT 0"), o.status ?? "pending", "", "no"].join(",");
}
function writeRegister(lines: string[]): string {
  const file = join(tmpDir(), "register.csv");
  writeFileSync(file, [CSV_HEADER, ...lines].join("\n") + "\n", "utf8");
  return file;
}
const runGate = (file: string | undefined, args: string[], extra: Record<string, string | undefined> = {}) =>
  runAsync(BASH, [GATE_SH, ...args], { REGISTER_FILE: file, ...extra }, { timeoutMs: 120_000 });

describe("phase-gate.sh", () => {
  test("runs the [EXIT] rows of the phase in file order, prints GATE <id> PASS <s>s, and ends with phase=<N> failed=0 (exit 0)", async () => {
    const file = writeRegister([
      regRow({ id: "BR-901", phase: "9", title: "[EXIT] first,\nwith a newline", cmd: 'test "$(printf 2 | grep -c 2)" = "1"' }),
      regRow({ id: "BR-902", phase: "9", title: "[EXIT] second", cmd: "echo SUMMARY FAILS=0", expected: 'EXIT 0; stdout last line "SUMMARY FAILS=0"' }),
      regRow({ id: "BR-903", phase: "9", title: "[EXIT] third", cmd: "echo 7; echo 1 >&2", expected: 'EXIT 0; stdout "7"; output contains "1"' }),
      regRow({ id: "BR-904", phase: "9", title: "not an exit row", cmd: "exit 1" }),
      regRow({ id: "BR-905", phase: "8", title: "[EXIT] other phase", cmd: "exit 1" }),
    ]);
    const r = await runGate(file, ["9"]);
    const gate = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("GATE "));
    expect(gate.map((l) => l.split(" ").slice(0, 3).join(" "))).toEqual(["GATE BR-901 PASS", "GATE BR-902 PASS", "GATE BR-903 PASS"]);
    for (const l of gate) expect(l).toMatch(/ [0-9]+\.[0-9]s$/);
    expect(lastLine(r)).toBe("phase=9 failed=0");
    expect(r.code).toBe(0);
  }, 130_000);

  test("stops at the first failure: the later row is never run; last line phase=<N> failed=1; exit 1", async () => {
    const dir = tmpDir();
    const marker = join(dir, "later-ran.txt").replace(/\\/g, "/");
    const file = writeRegister([
      regRow({ id: "BR-911", phase: "9", title: "[EXIT] ok", cmd: "true" }),
      regRow({ id: "BR-912", phase: "9", title: "[EXIT] fails", cmd: "echo boom >&2; exit 4" }),
      regRow({ id: "BR-913", phase: "9", title: "[EXIT] later", cmd: `touch "${marker}"` }),
    ]);
    const r = await runGate(file, ["9"]);
    expect(r.stdout).toContain("GATE BR-911 PASS");
    expect(r.stdout).toContain("GATE BR-912 FAIL");
    expect(r.stdout).not.toContain("BR-913");
    expect(existsSync(marker)).toBe(false);
    expect(r.stdout).toContain("exit 4");
    expect(r.stdout).toContain("boom");
    expect(lastLine(r)).toBe("phase=9 failed=1");
    expect(r.code).toBe(1);
  }, 130_000);

  test("a row whose command exits 0 but whose expected_output is not met fails", async () => {
    const cases: Array<[string, string]> = [
      ["echo 8", 'EXIT 0; stdout "7"'],
      ["echo 17", 'EXIT 0; stdout "7"'],
      ["echo a; echo b", 'EXIT 0; stdout last line "a"'],
      ["echo x", 'EXIT 0; stdout contains "y"'],
      ["echo x", "EXIT 0; stdout empty"],
    ];
    for (const [cmd, expected] of cases) {
      const file = writeRegister([regRow({ id: "BR-921", phase: "9", title: "[EXIT] x", cmd, expected })]);
      const r = await runGate(file, ["9"]);
      expect(lastLine(r)).toBe("phase=9 failed=1");
      expect(r.code).toBe(1);
    }
  }, 130_000);

  test("a missing tool and an empty verify_command fail; nothing is skipped silently", async () => {
    const missing = await runGate(writeRegister([regRow({ id: "BR-931", phase: "9", title: "[EXIT] tool", cmd: "definitely-not-a-tool-u23 --flag" })]), ["9"]);
    expect(missing.stdout).toContain("GATE BR-931 FAIL");
    expect(missing.stdout).toContain("exit 127");
    expect(lastLine(missing)).toBe("phase=9 failed=1");
    const empty = await runGate(writeRegister([regRow({ id: "BR-932", phase: "9", title: "[EXIT] none", cmd: "" })]), ["9"]);
    expect(empty.stdout).toContain("GATE BR-932 FAIL");
    expect(lastLine(empty)).toBe("phase=9 failed=1");
  }, 130_000);

  test("a blocked_owner [EXIT] row is not run", async () => {
    const dir = tmpDir();
    const marker = join(dir, "blocked-ran.txt").replace(/\\/g, "/");
    const file = writeRegister([
      regRow({ id: "BR-941", phase: "9", title: "[EXIT] blocked", cmd: `touch "${marker}"; exit 1`, status: "blocked_owner" }),
      regRow({ id: "BR-942", phase: "9", title: "[EXIT] runs", cmd: "true" }),
    ]);
    const r = await runGate(file, ["9"]);
    expect(existsSync(marker)).toBe(false);
    expect(r.stdout).not.toContain("BR-941");
    expect(lastLine(r)).toBe("phase=9 failed=0");
  }, 130_000);

  test("commands run with VERIFY_SQL_MODE=mgmt exported", async () => {
    const file = writeRegister([regRow({ id: "BR-951", phase: "9", title: "[EXIT] mode", cmd: "printenv VERIFY_SQL_MODE", expected: 'EXIT 0; stdout "mgmt"' })]);
    const r = await runGate(file, ["9"], { VERIFY_SQL_MODE: "pg" });
    expect(lastLine(r)).toBe("phase=9 failed=0");
  }, 130_000);

  test("a command that runs longer than GATE_ROW_TIMEOUT_SECONDS is killed and fails the gate", async () => {
    const file = writeRegister([regRow({ id: "BR-961", phase: "9", title: "[EXIT] slow", cmd: "sleep 60" })]);
    const r = await runGate(file, ["9"], { GATE_ROW_TIMEOUT_SECONDS: "2" });
    expect(r.stdout).toContain("timed out after 2s");
    expect(lastLine(r)).toBe("phase=9 failed=1");
    expect(r.code).toBe(1);
  }, 130_000);

  test("a phase with rows but no runnable [EXIT] row prints a note and phase=<N> failed=0; a phase with no rows is exit 2", async () => {
    const file = writeRegister([regRow({ id: "BR-971", phase: "7", title: "plain row", cmd: "exit 1" })]);
    const some = await runGate(file, ["7"]);
    expect(some.stdout).toContain("GATE-NOTE");
    expect(lastLine(some)).toBe("phase=7 failed=0");
    expect(some.code).toBe(0);
    const none = await runGate(file, ["6"]);
    expect(none.code).toBe(2);
    expect(none.stdout).not.toContain("phase=");
  }, 130_000);

  test("exit 2 for a missing argument, a non-number, a missing register file, and a register without the needed columns", async () => {
    const file = writeRegister([regRow({ id: "BR-981", phase: "9", title: "[EXIT] x", cmd: "true" })]);
    expect((await runGate(file, [])).code).toBe(2);
    expect((await runGate(file, ["three"])).code).toBe(2);
    expect((await runGate(file, ["9", "extra"])).code).toBe(2);
    expect((await runGate(join(tmpDir(), "nope.csv"), ["9"])).code).toBe(2);
    const badFile = join(tmpDir(), "bad.csv");
    writeFileSync(badFile, "id,title\nBR-1,[EXIT] x\n", "utf8");
    expect((await runGate(badFile, ["9"])).code).toBe(2);
  }, 130_000);

  test("credentials in a failing row's stderr are removed from what is printed", async () => {
    const url = "postgres" + "://user:" + "pa55w0rd" + "xyz@db.example.com/postgres";
    const file = writeRegister([regRow({ id: "BR-991", phase: "9", title: "[EXIT] leak", cmd: `echo ${url} >&2; exit 1` })]);
    const r = await runGate(file, ["9"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain("pa55w0rdxyz");
  }, 130_000);
});
