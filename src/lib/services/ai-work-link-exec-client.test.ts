/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (register rows AW-504, AW-510; spec 9.8): the link function's client of the exec function (exec-client.ts), and the static
// rules of the exec function's source (BR-480, BR-624, BR-625 of the plan: no runner, model or Vercel route named in it, no connection string in it,
// no secret value in it, the two settings read in index.ts only).
//
// Falsifiability (each break was made, the named test failed, the file was restored byte for byte):
//   1. exec-client.ts: treat any status as an answer (drop the `!== 200` throw)                   -> "anything that is not a clean answer THROWS" fails
//   2. exec-client.ts: send the secret in the body instead of the Authorization header            -> "the secret travels only as the bearer" fails
//   3. exec-client.ts parseExecAnswer: pass `message` through                                     -> "only the known fields are taken" fails
//   4. handler.ts: read AWL_EXEC_INTERNAL_SECRET inside handleExec (a Deno global)                -> "the two settings are read in index.ts only" fails
//
// Run: bun test --isolate src/lib/services/ai-work-link-exec-client.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { EXEC_TIMEOUT_MS, makeExecClient, parseExecAnswer } from "../../../supabase/functions/ai-work-link/exec-client"

const BASE = "https://x.supabase.co/functions/v1/ai-work-link-exec"
const SECRET = "test-secret-value-of-some-length"

const answer = (status: number, body: unknown): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("exec-client: what is sent", () => {
  test("POST <base>/run with the intent id and the secret as the bearer; the secret travels only as the bearer", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const client = makeExecClient({
      baseUrl: BASE + "/",
      secret: SECRET,
      fetchFn: (async (url: string, init: RequestInit) => {
        seen.push({ url, init })
        return answer(200, { status: "done", submission_id: "s1", record: { id: "r1", route: "/x" } })
      }) as unknown as typeof fetch,
    })
    const out = await client("intent-1")
    expect(out).toEqual({ status: "done", submission_id: "s1", record: { id: "r1", route: "/x" } })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(`${BASE}/run`)
    expect(seen[0].init.method).toBe("POST")
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`)
    expect(seen[0].init.body).toBe(JSON.stringify({ intent_id: "intent-1" }))
    expect(String(seen[0].init.body)).not.toContain(SECRET)
    expect(seen[0].url).not.toContain(SECRET)
  })
})

describe("exec-client: what is answered", () => {
  const clientFor = (r: () => Response | Promise<Response>) => makeExecClient({ baseUrl: BASE, secret: SECRET, fetchFn: (async () => r()) as unknown as typeof fetch })

  test("anything that is not a clean answer THROWS (a non-200 status, a body that is not JSON, an unknown status, a network error)", async () => {
    for (const make of [
      () => answer(503, { ok: false, code: "NOT_CONFIGURED" }),
      () => answer(401, { ok: false }),
      () => answer(500, {}),
      // an error status with a body that LOOKS like an outcome is still not an answer (the status is checked, not only the shape)
      () => answer(500, { status: "done", record: { id: "r1", route: "/x" } }),
      () => answer(403, { status: "refused", code: "ROLE_CHANGED" }),
      () => answer(201, { status: "done" }),
      () => answer(200, "not json"),
      () => answer(200, { status: "weird" }),
      () => answer(200, []),
      () => answer(200, { intent_id: "x" }),
      () => {
        throw new Error("connection reset")
      },
    ]) {
      await expect(clientFor(make)("intent-1")).rejects.toBeDefined()
    }
  })

  test("a timeout aborts the request and throws", async () => {
    const client = makeExecClient({
      baseUrl: BASE,
      secret: SECRET,
      timeoutMs: 20,
      fetchFn: ((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch,
    })
    await expect(client("intent-1")).rejects.toThrow("aborted")
    expect(EXEC_TIMEOUT_MS).toBeGreaterThan(10_000)
  })

  test("only the known fields are taken: a message, a parameter or an id of anything else is dropped; a code must be a closed code", () => {
    const out = parseExecAnswer({ status: "failed", code: "RECORD_NOT_FOUND", missing: ["worker", 5, "x".repeat(200)], message: "connect ECONNREFUSED 10.0.0.1", params: { secret: 1 }, org_id: "org-a" })
    expect(out).toEqual({ status: "failed", code: "RECORD_NOT_FOUND", missing: ["worker", "x".repeat(64)] })
    expect(parseExecAnswer({ status: "refused", code: "not a code" })).toEqual({ status: "refused" })
    expect(parseExecAnswer({ status: "executing" })).toEqual({ status: "executing" })
    expect(parseExecAnswer({ status: "done", record: { id: 5, route: "/a" } })).toEqual({ status: "done", record: { id: null, route: "/a" } })
    expect(parseExecAnswer(null)).toBeNull()
    expect(parseExecAnswer({ status: "done", missing: Array.from({ length: 50 }, (_, i) => `f${i}`) })?.missing).toHaveLength(20)
  })
})

describe("static rules of the exec function's source", () => {
  const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
  const DIR = join(ROOT, "supabase/functions/ai-work-link-exec")
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
  const source = existsSync(DIR) ? files(DIR).filter((f) => !f.endsWith(".bundle.mjs")) : []
  const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")

  test("the folder has its files and the generated bundle is not among the source", () => {
    expect(source.map((f) => f.slice(DIR.length + 1).split("\\").join("/")).sort()).toEqual(["README.md", "handler.ts", "index.ts", "process-global.ts"])
  })

  test("no runner, model or Vercel route is named, and no connection string or key-shaped value is written", () => {
    for (const f of source) {
      const text = readFileSync(f, "utf8")
      for (const bad of ["runSubmission", "runLevel1", "callLLM", "resolveModelConfig", "api/mcp/"]) expect(`${f} ${text.includes(bad)}`).toBe(`${f} false`)
      expect(text).not.toMatch(/postgres(ql)?:\/\//)
      // built from parts so this file itself carries no key-shaped literal
      expect(text).not.toMatch(new RegExp(["sb_(publishable|secret)_", "ey" + "J[A-Za-z0-9_-]{10,}", "whsec" + "_"].join("|")))
    }
  })

  test("the two settings are read in index.ts only, and the handler uses no Deno global", () => {
    for (const f of source.filter((x) => x.endsWith(".ts"))) {
      const isIndex = f.endsWith("index.ts")
      const src = code(f)
      if (!isIndex) {
        expect(`${f} ${/Deno\./.test(src)}`).toBe(`${f} false`)
        // the handler is given the settings as values; it never reads the environment (its messages may NAME the two settings, never hold one)
        expect(`${f} ${/process\.env|Deno\.env|SERVICE_ROLE_KEY/.test(src) && !f.endsWith("process-global.ts")}`).toBe(`${f} false`)
      }
    }
  })

  test("the handler builds no SQL text and names no table: the intent is only ever claimed and finished through the two SQL functions", () => {
    const src = code(join(DIR, "handler.ts"))
    expect(src).not.toMatch(/\b(SELECT|INSERT INTO|DELETE FROM)\b/)
    expect(src).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/)
    expect(src).not.toMatch(/\b(compliance|platform)\.\w+/)
    const called = new Set([...readFileSync(join(DIR, "handler.ts"), "utf8").matchAll(/["'`](ai_work_link_[a-z_]+)["'`]/g)].map((m) => m[1]))
    expect([...called].sort()).toEqual(["ai_work_link_intent_claim", "ai_work_link_intent_finish"])
  })
})
