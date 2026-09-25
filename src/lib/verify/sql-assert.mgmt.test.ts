import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mgmtReadOnlyQuery, MgmtError, parseEnvValue, READ_ONLY_PATH, scrub } from "../../../scripts/verify/lib/mgmt-sql.mjs";
import { emptyEnvFile, FAKE_TOKEN, runAsync, startFakeMgmt, type FakeHandler, type FakeMgmt } from "./fake-mgmt-server";

// U-23 (PROJEXA-BUILD-001): sql-assert.mjs with VERIFY_SQL_MODE=mgmt sends its statement to the Supabase Management API read-only
// endpoint. This file runs the real script against a fake API on a loopback port (no network, no real token) and checks what a
// register row depends on: the Bearer header, that a write statement never reaches the network, that the token is never printed, that
// an HTTP 400 answer is exit 4, and the exit codes 0 / 1 / 2 / 3 / 4. Lives under src/ because bunfig.toml sets [test] root = "src".

const RUNNER = join(process.cwd(), "scripts", "verify", "sql-assert.mjs");
const EXPECTED_PATH = "/v1/projects/pcrjmlpuqsbocqfwoxod/database/query/read-only";

let fake: FakeMgmt | null = null;
const cleanups: Array<() => void> = [];

afterEach(async () => {
  if (fake) await fake.close();
  fake = null;
  while (cleanups.length) cleanups.pop()!();
});

async function start(handler: FakeHandler): Promise<FakeMgmt> {
  fake = await startFakeMgmt(handler);
  return fake;
}

const oneValue: FakeHandler = () => ({ status: 201, body: [{ count: 3 }] });

function mgmtEnv(f: FakeMgmt, extra: Record<string, string | undefined> = {}) {
  return { VERIFY_SQL_MODE: "mgmt", VERIFY_SQL_MGMT_BASE_URL: f.baseUrl, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN, ...extra };
}

function sqlAssert(args: string[], env: Record<string, string | undefined>) {
  return runAsync("node", [RUNNER, ...args], env);
}

describe("sql-assert.mjs in mgmt mode: the request", () => {
  test("posts the statement to the read-only endpoint with the Bearer header and prints the value (exit 0)", async () => {
    const f = await start(oneValue);
    const r = await sqlAssert(["--project", "ct", "--sql", "select count(*) from platform.sumeet_requirements", "--equals", "3"], mgmtEnv(f));
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("3");
    expect(f.requests.length).toBe(1);
    const q = f.requests[0];
    expect(q.method).toBe("POST");
    expect(q.url).toBe(EXPECTED_PATH);
    expect(q.authorization).toBe("Bearer " + FAKE_TOKEN);
    expect(JSON.parse(q.body)).toEqual({ query: "select count(*) from platform.sumeet_requirements" });
  }, 60_000);

  test("the token never appears in the output, on success or failure", async () => {
    const f = await start(oneValue);
    const ok = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f));
    const bad = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "4"], mgmtEnv(f));
    expect(ok.out).not.toContain(FAKE_TOKEN);
    expect(bad.out).not.toContain(FAKE_TOKEN);
  }, 60_000);

  test("a trailing semicolon is removed before the statement is sent", async () => {
    const f = await start(oneValue);
    const r = await sqlAssert(["--project", "ct", "--sql", "select 1;", "--equals", "3"], mgmtEnv(f));
    expect(r.code).toBe(0);
    expect(JSON.parse(f.requests[0].body).query).toBe("select 1");
  }, 60_000);
});

describe("sql-assert.mjs in mgmt mode: a write statement never reaches the network (exit 2)", () => {
  const writes: Array<[string, string]> = [
    ["delete", "delete from compliance.users"],
    ["insert", "insert into platform.sumeet_requirements(id) values ('x')"],
    ["two statements", "select 1; delete from compliance.users"],
    ["update hidden in a CTE", "with x as (update compliance.users set role = 'a' returning 1) select * from x"],
    ["select into", "select 1 into compliance.tmp"],
    ["set_config", "select set_config('app.current_org_id', 'x', false)"],
    ["comment hiding a second statement", "select 1 -- ; drop table x"],
  ];
  for (const [name, sql] of writes) {
    test(name, async () => {
      const f = await start(oneValue);
      const r = await sqlAssert(["--project", "ct", "--sql", sql, "--equals", "1"], mgmtEnv(f));
      expect(r.code).toBe(2);
      expect(r.out).toContain("refused by the read-only guard");
      expect(f.requests.length).toBe(0);
    }, 60_000);
  }

  test("the module refuses on its own too: mgmtReadOnlyQuery rejects a write and sends nothing", async () => {
    const f = await start(oneValue);
    const env = { VERIFY_SQL_MGMT_BASE_URL: f.baseUrl, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN };
    for (const sql of ["delete from compliance.users", "select 1; select 2", "with x as (delete from a returning 1) select 1"]) {
      let err: unknown = null;
      try {
        await mgmtReadOnlyQuery(sql, { env });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(MgmtError);
      expect((err as MgmtError).kind).toBe("refused");
    }
    expect(f.requests.length).toBe(0);
    // and a plain SELECT does go through, so the refusal above is not a module that refuses everything
    expect(await mgmtReadOnlyQuery("select 1", { env })).toEqual([{ count: 3 }]);
    expect(f.requests.length).toBe(1);
    expect(f.requests[0].url).toBe(READ_ONLY_PATH);
  }, 60_000);
});

describe("sql-assert.mjs in mgmt mode: exit codes", () => {
  test("exit 1 when the value differs; --gte and --not-equals follow the same rule", async () => {
    const f = await start(oneValue);
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "4"], mgmtEnv(f))).code).toBe(1);
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--gte", "3"], mgmtEnv(f))).code).toBe(0);
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--gte", "4"], mgmtEnv(f))).code).toBe(1);
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--not-equals", "3"], mgmtEnv(f))).code).toBe(1);
  }, 60_000);

  test("exit 4 on HTTP 400, and the answer's text is shown without the token even if the API echoes it", async () => {
    const f = await start(() => ({ status: 400, body: { message: "syntax error near 'x' for token " + FAKE_TOKEN } }));
    const r = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "1"], mgmtEnv(f));
    expect(r.code).toBe(4);
    expect(r.out).toContain("HTTP 400");
    expect(r.out).toContain("syntax error");
    expect(r.out).not.toContain(FAKE_TOKEN);
  }, 60_000);

  test("exit 4 on HTTP 401, 500 and on a body that is not a list of rows", async () => {
    for (const [status, body] of [[401, { message: "Unauthorized" }], [500, "boom"], [201, { not: "a list" }], [201, "not json"]] as Array<[number, unknown]>) {
      const f = await startFakeMgmt(() => ({ status, body }));
      const r = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "1"], mgmtEnv(f));
      await f.close();
      expect(r.code).toBe(4);
      expect(r.out).not.toContain(FAKE_TOKEN);
    }
  }, 60_000);

  test("exit 4 when the query returns two rows or two columns", async () => {
    const two = await start(() => ({ status: 201, body: [{ count: 1 }, { count: 2 }] }));
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "1"], mgmtEnv(two))).code).toBe(4);
    await two.close();
    fake = await startFakeMgmt(() => ({ status: 201, body: [{ a: 1, b: 2 }] }));
    expect((await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "1"], mgmtEnv(fake))).code).toBe(4);
  }, 60_000);

  test("exit 4 when the API cannot be reached, and the token is not printed", async () => {
    const f = await startFakeMgmt(oneValue);
    const env = mgmtEnv(f);
    await f.close();
    const r = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "1"], env);
    expect(r.code).toBe(4);
    expect(r.out).toContain("query error");
    expect(r.out).not.toContain(FAKE_TOKEN);
  }, 60_000);

  test("exit 3 when no token is in the environment or in the env file", async () => {
    const f = await start(oneValue);
    const empty = emptyEnvFile();
    cleanups.push(empty.cleanup);
    const r = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f, { SUPABASE_ACCESS_TOKEN: undefined, VERIFY_ENV_FILE: empty.file }));
    expect(r.code).toBe(3);
    expect(r.out).toContain("SUPABASE_ACCESS_TOKEN is not set");
    expect(f.requests.length).toBe(0);
  }, 60_000);

  test("exit 2 for --project px in mgmt mode, for an unknown VERIFY_SQL_MODE, and for a base URL that is not loopback http", async () => {
    const f = await start(oneValue);
    const px = await sqlAssert(["--project", "px", "--sql", "select 1", "--equals", "3"], mgmtEnv(f));
    expect(px.code).toBe(2);
    expect(px.out).toContain("supports only --project ct");
    const typo = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f, { VERIFY_SQL_MODE: "mgnt" }));
    expect(typo.code).toBe(2);
    for (const url of ["https://127.0.0.1:1", "http://example.com", "http://192.168.0.1:80", "not a url"]) {
      const r = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f, { VERIFY_SQL_MGMT_BASE_URL: url }));
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/loopback|not a URL/);
    }
    expect(f.requests.length).toBe(0);
  }, 60_000);
});

describe("sql-assert.mjs in mgmt mode: where the token comes from", () => {
  test("the environment variable wins; otherwise the SUPABASE_ACCESS_TOKEN line of the env file is used (quotes and CRLF removed)", async () => {
    const f = await start(oneValue);
    const dir = emptyEnvFile();
    cleanups.push(dir.cleanup);
    const file = join(dir.file, "..", "with-token.env");
    writeFileSync(file, `# comment\r\nOTHER=1\r\nSUPABASE_ACCESS_TOKEN="${FAKE_TOKEN}-file"\r\n`, "utf8");
    const fromFile = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f, { SUPABASE_ACCESS_TOKEN: undefined, VERIFY_ENV_FILE: file }));
    expect(fromFile.code).toBe(0);
    expect(f.requests[0].authorization).toBe("Bearer " + FAKE_TOKEN + "-file");
    const fromEnv = await sqlAssert(["--project", "ct", "--sql", "select 1", "--equals", "3"], mgmtEnv(f, { VERIFY_ENV_FILE: file }));
    expect(fromEnv.code).toBe(0);
    expect(f.requests[1].authorization).toBe("Bearer " + FAKE_TOKEN);
    expect(fromFile.out + fromEnv.out).not.toContain(FAKE_TOKEN);
  }, 60_000);

  test("parseEnvValue reads NAME=value, export NAME=value and quoted values, and ignores comments and other names", () => {
    expect(parseEnvValue("A=1\nSUPABASE_ACCESS_TOKEN=abc\n", "SUPABASE_ACCESS_TOKEN")).toBe("abc");
    expect(parseEnvValue("export SUPABASE_ACCESS_TOKEN='abc'\n", "SUPABASE_ACCESS_TOKEN")).toBe("abc");
    expect(parseEnvValue("# SUPABASE_ACCESS_TOKEN=nope\nX=1\n", "SUPABASE_ACCESS_TOKEN")).toBe("");
    expect(parseEnvValue("NOT_SUPABASE_ACCESS_TOKEN=nope\n", "SUPABASE_ACCESS_TOKEN")).toBe("");
  });
});

describe("scrub removes credential-shaped text", () => {
  test("URLs with credentials, Bearer tokens, sbp_ tokens, JWTs and the given secrets", () => {
    const pw = "hunter2" + "hunter2";
    const url = "postgres" + "://user:" + pw + "@db.example.com:5432/postgres";
    const out = scrub(`connect ${url} failed; Authorization: Bearer abc.def-ghi; ${"sbp_" + "a".repeat(30)}; secretvalue123`, ["secretvalue123"]);
    expect(out).not.toContain(pw);
    expect(out).not.toContain("abc.def-ghi");
    expect(out).not.toContain("sbp_" + "a".repeat(30));
    expect(out).not.toContain("secretvalue123");
    expect(out).toContain("[redacted");
  });
});
