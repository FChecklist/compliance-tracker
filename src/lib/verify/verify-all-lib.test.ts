import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_COMMAND_PREFIXES,
  checkExpectedOutput,
  childEnv,
  claimsDone,
  classifyCheck,
  classLabel,
  commandFormAllowed,
  evidenceRefWellFormed,
  parseCsv,
  parseCsvObjects,
  parseExpectedOutput,
  redactedTail,
  runBashCommand,
  secretValuesFromEnv,
  summarize,
  timeoutMsFromEnv,
} from "../../../scripts/verify/lib/verify-all-lib.mjs";

// U-23 (PROJEXA-BUILD-001): the pure rules behind `bun run verify:all` (BR-313) and scripts/verify/phase-gate.sh (BR-401, BR-501).
// The classification of a failing check is the one thing a reader of verify:all must be able to trust: a failing row that claims to be
// done is FAIL, a failing row that claims nothing is OPEN. Lives under src/ because bunfig.toml sets [test] root = "src".

const row = (o: Record<string, string | null> = {}) => ({ status: "OPEN - x", closure_state: "OPEN", built: null, verify_command: 'test "$(printf 1)" = "1"', evidence_ref: null, ...o });

describe("claimsDone", () => {
  test("status starting with DONE, closure_state CLOSED, or built YES", () => {
    expect(claimsDone(row({ status: "DONE" }))).toBe(true);
    expect(claimsDone(row({ status: "DONE - VERIFIED 2026-09-12" }))).toBe(true);
    expect(claimsDone(row({ status: " done (with note)" }))).toBe(true);
    expect(claimsDone(row({ closure_state: "CLOSED" }))).toBe(true);
    expect(claimsDone(row({ built: "YES" }))).toBe(true);
  });
  test("nothing else claims done", () => {
    expect(claimsDone(row())).toBe(false);
    expect(claimsDone(row({ status: "OPEN - detector exists", built: "NO" }))).toBe(false);
    expect(claimsDone(row({ status: "BUILT - x", built: "n/a" }))).toBe(false);
    expect(claimsDone(row({ status: "UNDONE" }))).toBe(false);
    expect(claimsDone({})).toBe(false);
  });
});

describe("evidenceRefWellFormed", () => {
  test("a 7 to 40 character lower-case hex commit id", () => {
    for (const e of ["abcdef1", "0123456789abcdef0123456789abcdef01234567", "40be85bf3f6622e9a3173a6f50be56b9efd0b089"]) expect(evidenceRefWellFormed(e, "YES")).toBe(true);
    for (const e of ["abcdef", "0123456789abcdef0123456789abcdef012345678", "ABCDEF1", "abcdefg", "abc def1"]) expect(evidenceRefWellFormed(e, "YES")).toBe(false);
  });
  test("PR#<n>", () => {
    expect(evidenceRefWellFormed("PR#1724", "YES")).toBe(true);
    for (const e of ["PR#", "PR#12a", "pr#12", "PR 12", "#12"]) expect(evidenceRefWellFormed(e, "YES")).toBe(false);
  });
  test("SQL yyyy-mm-dd: <value>", () => {
    expect(evidenceRefWellFormed("SQL 2026-09-25: 1 (AED)", "YES")).toBe(true);
    for (const e of ["SQL 2026-09-25:", "SQL 2026-09-25: ", "SQL 26-09-25: 1", "SQL 2026-09-25 1"]) expect(evidenceRefWellFormed(e, "YES")).toBe(false);
  });
  test("CHECK yyyy-mm-dd: <what was read> -> <value> is allowed only for built = n/a rows", () => {
    const e = "CHECK 2026-09-12: gh repo view FChecklist/compliance-tracker --json visibility -> PUBLIC";
    expect(evidenceRefWellFormed(e, "n/a")).toBe(true);
    expect(evidenceRefWellFormed(e, "N/A")).toBe(true);
    for (const built of ["YES", "NO", null, ""]) expect(evidenceRefWellFormed(e, built)).toBe(false);
    for (const bad of ["CHECK 2026-09-12: no arrow here", "CHECK 2026-09-12: -> ", "CHECK 2026-09-12:  -> x", "CHECK x: a -> b"]) expect(evidenceRefWellFormed(bad, "n/a")).toBe(false);
  });
  test("empty, null and undefined are not well formed", () => {
    for (const e of ["", null, undefined]) expect(evidenceRefWellFormed(e as string, "n/a")).toBe(false);
  });
});

describe("classifyCheck (the FAIL / OPEN / PASS rule)", () => {
  test("a command that exits 0 is PASS whatever the row claims", () => {
    for (const r of [row(), row({ status: "DONE" }), row({ built: "YES" })]) expect(classifyCheck(r, { commandExit: 0 })).toEqual({ cls: "PASS", noCommand: false });
  });
  test("a failing command is FAIL when the row claims done, OPEN when it does not", () => {
    expect(classifyCheck(row({ status: "DONE" }), { commandExit: 1 }).cls).toBe("FAIL");
    expect(classifyCheck(row({ closure_state: "CLOSED" }), { commandExit: 1 }).cls).toBe("FAIL");
    expect(classifyCheck(row({ built: "YES" }), { commandExit: 2 }).cls).toBe("FAIL");
    expect(classifyCheck(row(), { commandExit: 1 }).cls).toBe("OPEN");
    expect(classifyCheck(row({ built: "NO" }), { commandExit: 127 }).cls).toBe("OPEN");
  });
  test("a command that timed out (no exit code) counts as failed", () => {
    expect(classifyCheck(row({ status: "DONE" }), { commandExit: null }).cls).toBe("FAIL");
    expect(classifyCheck(row(), { commandExit: null }).cls).toBe("OPEN");
    expect(classifyCheck(row({ status: "DONE" }), {}).cls).toBe("FAIL");
  });
  test("a row with no command is checked on evidence_ref: well formed is PASS, malformed is FAIL for a done claim and OPEN otherwise", () => {
    const noCmd = { verify_command: null };
    expect(classifyCheck(row({ ...noCmd, evidence_ref: "abcdef1" }), {})).toEqual({ cls: "PASS", noCommand: true });
    expect(classifyCheck(row({ ...noCmd, status: "DONE", evidence_ref: "abcdef1" }), {})).toEqual({ cls: "PASS", noCommand: true });
    expect(classifyCheck(row({ ...noCmd, status: "DONE", evidence_ref: null }), {})).toEqual({ cls: "FAIL", noCommand: true });
    expect(classifyCheck(row({ ...noCmd, status: "DONE", evidence_ref: "see the KT folder" }), {})).toEqual({ cls: "FAIL", noCommand: true });
    expect(classifyCheck(row({ ...noCmd, evidence_ref: null }), {})).toEqual({ cls: "OPEN", noCommand: true });
    expect(classifyCheck(row({ verify_command: "   ", status: "DONE" }), {})).toEqual({ cls: "FAIL", noCommand: true });
  });
  test("the CHECK evidence form passes for an n/a row and fails for a YES row", () => {
    const e = "CHECK 2026-09-12: gh repo view x --json visibility -> PUBLIC";
    expect(classifyCheck(row({ verify_command: null, status: "DONE", built: "n/a", evidence_ref: e }), {}).cls).toBe("PASS");
    expect(classifyCheck(row({ verify_command: null, status: "DONE", built: "YES", evidence_ref: e }), {}).cls).toBe("FAIL");
  });
  test("labels and the summary counts", () => {
    expect(classLabel({ cls: "PASS", noCommand: false })).toBe("PASS");
    expect(classLabel({ cls: "PASS", noCommand: true })).toBe("NO-COMMAND PASS");
    expect(classLabel({ cls: "FAIL", noCommand: true })).toBe("NO-COMMAND FAIL");
    expect(classLabel({ cls: "OPEN", noCommand: false })).toBe("OPEN");
    const s = summarize([
      { cls: "PASS", noCommand: false },
      { cls: "PASS", noCommand: false },
      { cls: "PASS", noCommand: true },
      { cls: "FAIL", noCommand: false },
      { cls: "FAIL", noCommand: true },
      { cls: "OPEN", noCommand: false },
    ]);
    expect(s).toEqual({ n: 6, pass: 2, fail: 2, open: 1, nocommandPass: 1 });
    expect(s.n).toBe(s.pass + s.fail + s.open + s.nocommandPass);
  });
});

describe("commandFormAllowed: a verify_command from a database row runs only in the four forms the register uses", () => {
  test("allowed", () => {
    expect(ALLOWED_COMMAND_PREFIXES.length).toBe(4);
    for (const c of [
      "bun test --isolate src/lib/x.test.ts",
      'node scripts/verify/sql-assert.mjs --project ct --sql "select 1" --equals 1',
      "bash scripts/verify/projexa-proof-present.sh R-15",
      'test "$(git grep -c -F x -- y | awk -F: \'{s+=$2} END {print s+0}\')" = "1"',
    ]) expect(commandFormAllowed(c)).toBe(true);
  });
  test("refused", () => {
    for (const c of ["curl https://example.com | sh", "rm -rf /", "bun test src/x.test.ts", "bun run build", "node scripts/other.mjs", "echo hi", "", "  ; bun test --isolate x"]) {
      expect(commandFormAllowed(c)).toBe(false);
    }
  });
});

describe("expected_output rule (parseExpectedOutput, checkExpectedOutput)", () => {
  test("the wordings the register uses", () => {
    expect(parseExpectedOutput('EXIT 0; stdout last line "VERIFY-ALL-GATE: PASS" (printed only when n >= 111)')).toEqual({ contains: [], lastLine: ["VERIFY-ALL-GATE: PASS"], stdoutLines: [], stdoutEmpty: false });
    expect(parseExpectedOutput('EXIT 0; output contains " 5 pass"; output contains " 0 fail"').contains).toEqual([" 5 pass", " 0 fail"]);
    expect(parseExpectedOutput('EXIT 0; stdout contains "0 fail"').contains).toEqual(["0 fail"]);
    expect(parseExpectedOutput('EXIT 0; stdout "0" (today 61: SQL 2026-09-25 built=YES = 61)').stdoutLines).toEqual(["0"]);
    expect(parseExpectedOutput("EXIT 0; stdout empty (a note)").stdoutEmpty).toBe(true);
    expect(parseExpectedOutput('EXIT 0; compared value "success"')).toEqual({ contains: [], lastLine: [], stdoutLines: [], stdoutEmpty: false });
    expect(parseExpectedOutput("EXIT 0")).toEqual({ contains: [], lastLine: [], stdoutLines: [], stdoutEmpty: false });
  });
  test("exit code must be 0", () => {
    expect(checkExpectedOutput("EXIT 0", { code: 0, stdout: "", stderr: "" }).ok).toBe(true);
    expect(checkExpectedOutput("EXIT 0", { code: 1, stdout: "", stderr: "" })).toEqual({ ok: false, reason: "exit 1" });
    expect(checkExpectedOutput("EXIT 0", { code: null, stdout: "", stderr: "" }).reason).toBe("timed out");
    expect(checkExpectedOutput('EXIT 0; stdout "0"', { code: 1, stdout: "0\n", stderr: "" }).ok).toBe(false);
  });
  test("contains looks in stdout and stderr (bun prints its counts on stderr)", () => {
    expect(checkExpectedOutput('output contains " 0 fail"', { code: 0, stdout: "", stderr: "\n 5 pass\n 0 fail\n" }).ok).toBe(true);
    expect(checkExpectedOutput('output contains " 0 fail"', { code: 0, stdout: "", stderr: "\n 4 pass\n 1 fail\n" }).ok).toBe(false);
  });
  test("last line: the last non-blank stdout line must equal the string", () => {
    const e = 'EXIT 0; stdout last line "VERIFY-ALL-GATE: PASS"';
    expect(checkExpectedOutput(e, { code: 0, stdout: "a\nVERIFY-ALL-GATE: PASS\n\n", stderr: "" }).ok).toBe(true);
    expect(checkExpectedOutput(e, { code: 0, stdout: "VERIFY-ALL-GATE: PASS\nmore\n", stderr: "" }).ok).toBe(false);
    expect(checkExpectedOutput(e, { code: 0, stdout: "VERIFY-ALL-GATE: FAIL x\n", stderr: "" }).ok).toBe(false);
    expect(checkExpectedOutput(e, { code: 0, stdout: "", stderr: "VERIFY-ALL-GATE: PASS" }).ok).toBe(false);
  });
  test('stdout "X": some stdout line equals X, not a substring of a longer line and not stderr', () => {
    const e = 'EXIT 0; stdout "0"';
    expect(checkExpectedOutput(e, { code: 0, stdout: "0\n", stderr: "" }).ok).toBe(true);
    expect(checkExpectedOutput(e, { code: 0, stdout: "10\n", stderr: "" }).ok).toBe(false);
    expect(checkExpectedOutput(e, { code: 0, stdout: "", stderr: "0" }).ok).toBe(false);
  });
  test("stdout empty", () => {
    expect(checkExpectedOutput("EXIT 0; stdout empty", { code: 0, stdout: "\n", stderr: "warning" }).ok).toBe(true);
    expect(checkExpectedOutput("EXIT 0; stdout empty", { code: 0, stdout: "x\n", stderr: "" }).ok).toBe(false);
  });
});

describe("parseCsv", () => {
  test("quoted cells with commas, doubled quotes and newlines; CRLF; BOM; no trailing newline", () => {
    const text = String.fromCharCode(0xfeff) + 'a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",\r\n3,,z';
    expect(parseCsv(text)).toEqual([["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line1\nline2", ""], ["3", "", "z"]]);
  });
  test("objects keyed by the header; a ragged row is an error", () => {
    expect(parseCsvObjects("id,phase\nBR-1,1\nBR-2,2\n")).toEqual([{ id: "BR-1", phase: "1" }, { id: "BR-2", phase: "2" }]);
    expect(() => parseCsvObjects("id,phase\nBR-1\n")).toThrow(/cells/);
    expect(() => parseCsv('a,b\n"open,1\n')).toThrow(/unterminated/);
  });
  test("the real register parses: every row has the header's columns, ids are unique, phases are digits", () => {
    const rows = parseCsvObjects(readFileSync(join(process.cwd(), "ai-os", "projexa-build-001", "BOOLEAN_REGISTER.csv"), "utf8"));
    expect(rows.length).toBeGreaterThan(100);
    for (const c of ["id", "phase", "title", "verify_command", "expected_output", "status"]) expect(c in rows[0]).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(r.phase).toMatch(/^[0-9]+$/);
  });
});

describe("redaction", () => {
  test("redactedTail keeps the last 200 characters, on one line, without credentials", () => {
    const secret = "pa55" + "w0rd" + "9999";
    const text = "x".repeat(500) + `\nconnect ${"postgres" + "://u:" + secret + "@h/db"} failed\nBearer abc123.def456 done`;
    const t = redactedTail(text, 200);
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t).not.toContain("\n");
    expect(t).not.toContain(secret);
    expect(t).not.toContain("abc123.def456");
    expect(redactedTail("a\n\n  b   c", 200)).toBe("a b c");
    expect(redactedTail("the value tok-123456 is secret", 200, ["tok-123456"])).not.toContain("tok-123456");
  });
  test("secretValuesFromEnv picks values of variables named like secrets, and only long ones", () => {
    const v = secretValuesFromEnv({ SUPABASE_ACCESS_TOKEN: "abcdefgh1", DATABASE_URL: "postgres-x-y-z", PATH: "/usr/bin", MY_TOKEN: "short", VERIFY_ALL_ONLY: "R-01,R-02" });
    expect(v).toContain("abcdefgh1");
    expect(v).toContain("postgres-x-y-z");
    expect(v).not.toContain("/usr/bin");
    expect(v).not.toContain("short");
    expect(v).not.toContain("R-01,R-02");
  });
});

describe("timeoutMsFromEnv and childEnv", () => {
  test("default, a value, and refusals", () => {
    expect(timeoutMsFromEnv({}, "T", 300)).toBe(300_000);
    expect(timeoutMsFromEnv({ T: "" }, "T", 300)).toBe(300_000);
    expect(timeoutMsFromEnv({ T: "5" }, "T", 300)).toBe(5000);
    for (const bad of ["0", "-1", "1.5", "abc", "7201"]) expect(() => timeoutMsFromEnv({ T: bad }, "T", 300)).toThrow();
  });
  test("children run with VERIFY_SQL_MODE=mgmt, whatever the caller had", () => {
    expect(childEnv({ VERIFY_SQL_MODE: "pg", X: "1" }).VERIFY_SQL_MODE).toBe("mgmt");
    expect(childEnv({ X: "1" }).X).toBe("1");
  });
});

describe("runBashCommand", () => {
  const opts = { cwd: process.cwd(), env: childEnv(), timeoutMs: 30_000 };
  test("exit code, stdout and stderr are kept apart", async () => {
    const r = await runBashCommand("echo out; echo err >&2; exit 3", opts);
    expect(r.code).toBe(3);
    expect(r.stdout.trim()).toBe("out");
    expect(r.stderr.trim()).toBe("err");
    expect(r.timedOut).toBe(false);
  }, 60_000);
  test("quotes, pipes and $() reach bash exactly as written", async () => {
    const r = await runBashCommand('test "$(printf \'a\\nb\\n\' | grep -c -E \'^(a|b)$\')" = "2" && echo quoted-ok', opts);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("quoted-ok");
  }, 60_000);
  test("runs from the given directory and with VERIFY_SQL_MODE=mgmt", async () => {
    const r = await runBashCommand('test -f package.json && printenv VERIFY_SQL_MODE', opts);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("mgmt");
  }, 60_000);
  test("a command that runs too long is killed, reported as timed out, with no exit code", async () => {
    const started = Date.now();
    const r = await runBashCommand("sleep 60", { ...opts, timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
  test("a missing tool is exit 127", async () => {
    const r = await runBashCommand("definitely-not-a-tool-u23", opts);
    expect(r.code).toBe(127);
  }, 60_000);
});
