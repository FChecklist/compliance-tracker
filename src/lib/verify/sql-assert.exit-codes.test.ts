import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// BR-109 (PROJEXA-BUILD-001): the SQL assertion runner's exit codes. sql-safety.test.ts covers the guard on its own; this file
// runs scripts/verify/sql-assert.mjs as a real process and checks what a register row depends on:
//   2 = usage error or refused by the read-only guard, 3 = no connection string, 4 = connection or query error (all without a
//   database), and 0 / 1 = assertion holds / fails (against a live connection; needs VERIFY_DATABASE_URL).
// The live cases are skipped when VERIFY_DATABASE_URL is unset, so the plain suite still passes in CI. Register row BR-109 requires
// " 36 pass" in the output (26 guard tests + these 10), which four skipped tests cannot reach, so the row cannot pass by skipping.
// REQUIRE_LIVE_SQL_ASSERT=1 goes further and makes a missing URL a failure in this file itself.
// Lives under src/ because bunfig.toml sets [test] root = "src": a test outside it is skipped by CI.

const RUNNER = join(process.cwd(), "scripts", "verify", "sql-assert.mjs");
const SECRET = "s3cr3t-Pa55word-do-not-print";

function run(args: string[], env: Record<string, string | undefined>): { code: number | null; out: string } {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("VERIFY_DATABASE_URL")) base[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  const p = spawnSync("node", [RUNNER, ...args], { env: base, encoding: "utf8", timeout: 60_000 });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}` };
}

describe("sql-assert.mjs exit codes that need no database", () => {
  test("exit 2: a statement that is not a SELECT is refused before any connection is made", () => {
    const r = run(["--project", "ct", "--sql", "delete from compliance.users", "--equals", "0"], { VERIFY_DATABASE_URL: `postgres://u:${SECRET}@127.0.0.1:1/x` });
    expect(r.code).toBe(2);
    expect(r.out).toContain("refused by the read-only guard");
  });

  test("exit 2: two statements are refused", () => {
    const r = run(["--project", "ct", "--sql", "select 1; select 2", "--equals", "1"], { VERIFY_DATABASE_URL: `postgres://u:${SECRET}@127.0.0.1:1/x` });
    expect(r.code).toBe(2);
    expect(r.out).toContain("more than one statement");
  });

  test("exit 2: --sql missing, no comparison given, two comparisons given, unknown project", () => {
    expect(run(["--project", "ct", "--equals", "1"], {}).code).toBe(2);
    expect(run(["--project", "ct", "--sql", "select 1"], {}).code).toBe(2);
    expect(run(["--project", "ct", "--sql", "select 1", "--equals", "1", "--gte", "1"], {}).code).toBe(2);
    expect(run(["--project", "zz", "--sql", "select 1", "--equals", "1"], {}).code).toBe(2);
  });

  test("exit 3: no VERIFY_DATABASE_URL for --project ct, no VERIFY_DATABASE_URL_PX for --project px", () => {
    const ct = run(["--project", "ct", "--sql", "select 1", "--equals", "1"], {});
    expect(ct.code).toBe(3);
    expect(ct.out).toContain("VERIFY_DATABASE_URL is not set");
    const px = run(["--project", "px", "--sql", "select 1", "--equals", "1"], { VERIFY_DATABASE_URL: `postgres://u:${SECRET}@127.0.0.1:1/x` });
    expect(px.code).toBe(3);
    expect(px.out).toContain("VERIFY_DATABASE_URL_PX is not set");
  });

  test("exit 4: an unreachable database is a query error, and the connection string is never printed", () => {
    const r = run(["--project", "ct", "--sql", "select 1", "--equals", "1"], { VERIFY_DATABASE_URL: `postgres://u:${SECRET}@127.0.0.1:1/x` });
    expect(r.code).toBe(4);
    expect(r.out).toContain("query error");
    expect(r.out).not.toContain(SECRET);
  });
});

const liveUrl = process.env.VERIFY_DATABASE_URL;
const requireLive = process.env.REQUIRE_LIVE_SQL_ASSERT === "1";

describe("sql-assert.mjs exit codes 0 and 1 against a live connection", () => {
  test("REQUIRE_LIVE_SQL_ASSERT=1 needs VERIFY_DATABASE_URL", () => {
    if (requireLive) expect(liveUrl).toBeTruthy();
  });

  const live = liveUrl ? test : test.skip;

  live("exit 0 when the value matches, and the value is printed", () => {
    const r = run(["--project", "ct", "--sql", "select 41 + 1", "--equals", "42"], { VERIFY_DATABASE_URL: liveUrl });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("42");
  });

  live("exit 1 when the value does not match", () => {
    const r = run(["--project", "ct", "--sql", "select 41 + 1", "--equals", "43"], { VERIFY_DATABASE_URL: liveUrl });
    expect(r.code).toBe(1);
  });

  live("--gte, --lt and --not-equals follow the same 0 / 1 rule", () => {
    const env = { VERIFY_DATABASE_URL: liveUrl };
    expect(run(["--project", "ct", "--sql", "select 5", "--gte", "5"], env).code).toBe(0);
    expect(run(["--project", "ct", "--sql", "select 5", "--gte", "6"], env).code).toBe(1);
    expect(run(["--project", "ct", "--sql", "select 5", "--lt", "6"], env).code).toBe(0);
    expect(run(["--project", "ct", "--sql", "select 5", "--not-equals", "5"], env).code).toBe(1);
  });

  live("exit 4 when the query returns two columns", () => {
    expect(run(["--project", "ct", "--sql", "select 1 as a, 2 as b", "--equals", "1"], { VERIFY_DATABASE_URL: liveUrl }).code).toBe(4);
  });
});
