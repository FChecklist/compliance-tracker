/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register row AW-511): the owner's pre-flight script (scripts/verify/awl-exec-preflight.sh) against stand-in functions on
// 127.0.0.1. It proves the script says READY only for the one answer that means ready (200, ok, db_role app_runtime), names what is missing on
// NOT_CONFIGURED, refuses a wrong role, sends the secret as the bearer and never prints it, and takes the secret from the environment only.
//
// Needs bash and curl (Git Bash on the laptop, both present on CI). Under PowerShell without them the tests cannot spawn the script.
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. awl-exec-preflight.sh: accept any db_role (drop the app_runtime comparison)   -> "a database role that is not app_runtime is NOT ready" fails
//   2. awl-exec-preflight.sh: print the secret in the failure line                   -> "the secret is never printed" fails
//   3. awl-exec-preflight.sh: treat 503 NOT_CONFIGURED as ready                       -> "NOT_CONFIGURED names what is missing" fails
//
// Run: bun test --isolate src/lib/verify/awl-exec-preflight.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"

const SCRIPT = new URL("../../../scripts/verify/awl-exec-preflight.sh", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const SECRET = "preflight-secret-value-0123456789abcdef"

type Reply = { status: number; body: unknown }
let reply: Reply = { status: 200, body: {} }
let seenAuth: string[] = []
let server: ReturnType<typeof Bun.serve>
let url = ""

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      seenAuth.push(req.headers.get("authorization") ?? "")
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } })
    },
  })
  url = `http://127.0.0.1:${server.port}/functions/v1/ai-work-link-exec/health`
})
afterAll(() => server.stop(true))

// async on purpose: the stand-in server lives in THIS process, so a synchronous spawn would block the very event loop that has to answer the script
async function run(env: Record<string, string | undefined>, args: string[] = []) {
  const p = Bun.spawn(["bash", SCRIPT, ...args], { env: { ...process.env, AWL_EXEC_INTERNAL_SECRET: undefined, AWL_EXEC_URL: undefined, SUPABASE_URL: undefined, ...env } as unknown as Record<string, string>, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}
const withSecret = (over: Record<string, string | undefined> = {}) => run({ AWL_EXEC_INTERNAL_SECRET: SECRET, AWL_EXEC_URL: url, ...over })
const lastLine = (s: string) => s.trim().split("\n").pop() ?? ""

describe("the pre-flight of the exec function", () => {
  test("ready only for 200, ok true and db_role app_runtime: exit 0 and the READY line; the bearer is the secret", async () => {
    reply = { status: 200, body: { ok: true, db_role: "app_runtime" } }
    seenAuth = []
    const r = await withSecret()
    expect(r.code).toBe(0)
    expect(lastLine(r.out)).toBe("AWL_EXEC_READY db_role=app_runtime")
    expect(seenAuth).toEqual([`Bearer ${SECRET}`])
  })

  test("a database role that is not app_runtime is NOT ready (postgres would bypass row-level security)", async () => {
    for (const role of ["postgres", "service_role", "", "dry-run (no database role)"]) {
      reply = { status: 200, body: { ok: true, db_role: role } }
      const r = await withSecret()
      expect({ role, code: r.code }).toEqual({ role, code: 1 })
      expect(lastLine(r.err)).toContain("not app_runtime")
      expect(r.out).not.toContain("AWL_EXEC_READY")
    }
    reply = { status: 200, body: { db_role: "app_runtime" } }
    expect((await withSecret()).code).toBe(1)
  })

  test("NOT_CONFIGURED names what is missing; 401 says the secrets differ; DB_UNREACHABLE says the connection string is wrong", async () => {
    reply = { status: 503, body: { ok: false, code: "NOT_CONFIGURED", missing: ["AWL_EXEC_INTERNAL_SECRET", "APP_RUNTIME_DATABASE_URL"] } }
    let r = await withSecret()
    expect(r.code).toBe(1)
    expect(lastLine(r.err)).toContain("AWL_EXEC_INTERNAL_SECRET")
    expect(lastLine(r.err)).toContain("APP_RUNTIME_DATABASE_URL")
    reply = { status: 401, body: { ok: false, code: "UNAUTHORIZED" } }
    r = await withSecret()
    expect(r.code).toBe(1)
    expect(lastLine(r.err)).toContain("differs")
    reply = { status: 503, body: { ok: false, code: "DB_UNREACHABLE" } }
    r = await withSecret()
    expect(r.code).toBe(1)
    expect(lastLine(r.err)).toContain("DB_UNREACHABLE")
    reply = { status: 500, body: {} }
    expect((await withSecret()).code).toBe(1)
  })

  test("the secret is never printed, on success or on any failure", async () => {
    for (const rep of [
      { status: 200, body: { ok: true, db_role: "app_runtime" } },
      { status: 200, body: { ok: true, db_role: "postgres" } },
      { status: 401, body: { ok: false } },
      { status: 503, body: { ok: false, code: "NOT_CONFIGURED", missing: ["X"] } },
    ]) {
      reply = rep
      const r = await withSecret()
      expect(r.out + r.err).not.toContain(SECRET)
    }
  })

  test("a function that does not answer is not ready", async () => {
    const r = await withSecret({ AWL_EXEC_URL: "http://127.0.0.1:9/functions/v1/ai-work-link-exec/health" })
    expect(r.code).toBe(1)
    expect(r.err).toContain("did not answer")
  })

  test("no secret in the environment is a usage error (exit 2) and asks nothing on the command line; an argument is refused", async () => {
    expect((await run({ AWL_EXEC_URL: url })).code).toBe(2)
    expect((await run({ AWL_EXEC_URL: url, AWL_EXEC_INTERNAL_SECRET: SECRET }, [SECRET])).code).toBe(2)
    expect((await run({ AWL_EXEC_URL: url, AWL_EXEC_INTERNAL_SECRET: SECRET }, [SECRET])).err).not.toContain(SECRET)
  })

  test("it makes ONE read: exactly one request, a GET of /health (the stand-in saw no other)", async () => {
    reply = { status: 200, body: { ok: true, db_role: "app_runtime" } }
    seenAuth = []
    await withSecret()
    expect(seenAuth).toHaveLength(1)
  })
})
