/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46b1 (register rows BR-480, BR-482, AWL-S02, AWL-S15): the wiring of the ai-work-link Edge Function and the rules
// about which code may be in it. Three proofs, none touching a database or the network:
//   1. WIRING: the REAL index.ts is imported with a fake Deno global and a fake supabase-js (bun cannot resolve `npm:`), and the handler it
//      passes to Deno.serve is called. The service-role client is built once from the environment; a database error keeps its SQLSTATE
//      code on the way to the handler; the service-role key never appears in an answer.
//   2. SETTINGS: configFromEnv holds every default (the fixed project host, a confirm host that never resolves, the shared throttle bucket,
//      no executor) and refuses a settings value that is not what it should be.
//   3. STATIC RULES: the files of the function name none of runSubmission, runLevel1, callLLM, resolveModelConfig or the Vercel route of
//      the old link (BR-480), import nothing from the DPDP function, build no SQL text, take no table by name, read the service-role key in
//      index.ts only, and use no Deno global outside index.ts.
// Run: bun test --isolate src/lib/services/ai-work-link-index.test.ts
import { describe, test, expect, mock } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_APP_BASE, DEFAULT_CONFIRM_HOST, DEFAULT_SUPABASE_URL, FUNCTION_PATH, configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { ACCEPTED_ALGORITHMS, PROJEXA_AUDIENCE, PROJEXA_ISSUER, PROJEXA_JWKS_URL, VERIFY_JWT } from "../../../supabase/functions/ai-work-link/jwt"
import { F, TOKENS, makeFake, manifestOf } from "./__test-helpers__/awl-edge-fake"

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const FN_DIR = join(ROOT, "supabase/functions/ai-work-link")
const SHARED_DIR = join(ROOT, "supabase/functions/_shared/ai-link")
const EXEC_DIR = join(ROOT, "supabase/functions/ai-work-link-exec")

function filesOf(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesOf(p) : [p]
  })
}
const read = (p: string) => readFileSync(p, "utf8")
const tsFiles = () => [...filesOf(FN_DIR), ...filesOf(SHARED_DIR)].filter((f) => f.endsWith(".ts"))
/** Code with the // comment lines removed, so a comment that names a thing does not count as using it. */
const code = (p: string) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")

let boots = 0

describe("index.ts wiring", () => {
  const SERVICE_KEY = "service-role-key-for-the-test-0123456789"

  async function boot(env: Record<string, string>, fake = makeFake()) {
    const created: Array<{ url: string; key: string; opts: unknown }> = []
    const rpcSeen: Array<{ name: string; args: unknown }> = []
    let boom: null | { name: string; error: { message: string; code: string } | "throw" } = null
    mock.module("npm:@supabase/supabase-js@2", () => ({
      createClient: (url: string, key: string, opts: unknown) => {
        created.push({ url, key, opts })
        return {
          rpc: async (name: string, args: Record<string, unknown>) => {
            rpcSeen.push({ name, args })
            if (boom && boom.name === name) {
              if (boom.error === "throw") throw new Error("connection reset")
              return { data: null, error: boom.error }
            }
            const { data, error } = await fake.rpc(name, args)
            return { data, error: error ? { message: error.message, code: error.code } : null }
          },
        }
      },
    }))
    let handler: ((req: Request) => Promise<Response>) | null = null
    const g = globalThis as unknown as { Deno?: unknown }
    const before = g.Deno
    g.Deno = { env: { get: (n: string) => env[n] }, serve: (h: (req: Request) => Promise<Response>) => { handler = h } }
    try {
      await import(`../../../supabase/functions/ai-work-link/index?boot=${++boots}`)
    } finally {
      g.Deno = before
    }
    return { created, rpcSeen, fake, handler: handler as unknown as (req: Request) => Promise<Response>, fail: (b: typeof boom) => { boom = b } }
  }

  test("Deno.serve gets a handler; the service-role client is built once from the environment; the manual is served from the fixed base", async () => {
    const env = { SUPABASE_URL: DEFAULT_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, AWL_CONFIRM_HOST: "inbox-test.pages.dev" }
    const w = await boot(env)
    expect(typeof w.handler).toBe("function")
    expect(w.created).toHaveLength(1)
    expect(w.created[0].url).toBe(DEFAULT_SUPABASE_URL)
    expect(w.created[0].key).toBe(SERVICE_KEY)
    expect(w.created[0].opts).toMatchObject({ auth: { persistSession: false, autoRefreshToken: false } })
    const r = await w.handler(new Request(`https://evil.example/functions/v1/ai-work-link/${TOKENS.manager}`, { headers: { host: "evil.example" } }))
    expect(r.status).toBe(200)
    const md = await r.text()
    const m = manifestOf(md)
    expect(m.base).toBe(`${F}/${TOKENS.manager}`)
    expect(m.urls.inbox.startsWith("https://inbox-test.pages.dev/ai-inbox.html#t=")).toBe(true)
    expect(md).not.toContain("evil.example")
    // the manual reached SQL only through the service-role client's rpc, by name
    expect(w.rpcSeen.map((c) => c.name)).toEqual(["ai_work_link_log_call", "ai_work_link__resolve", "ai_work_link_log_call_result"])
  })

  test("the service-role key is in no answer, header or error, whatever the database does", async () => {
    const w = await boot({ SUPABASE_URL: DEFAULT_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })
    const paths = [`/${TOKENS.manager}`, `/${TOKENS.manager}/context`, `/${TOKENS.revoked}`, `/${TOKENS.manager}/nosuch`, "/not-a-token", `/${TOKENS.manager}/records/boq_lines?amount_gt=`]
    const check = async (r: Response) => {
      expect(await r.text()).not.toContain(SERVICE_KEY)
      for (const v of r.headers.values()) expect(v).not.toContain(SERVICE_KEY)
    }
    for (const p of paths) await check(await w.handler(new Request(`${F}${p}`)))
    w.fail({ name: "ai_work_link__resolve", error: { message: `permission denied for ${SERVICE_KEY}`, code: "42501" } })
    const r = await w.handler(new Request(`${F}/${TOKENS.manager}/context`))
    expect(r.status).toBe(500)
    await check(r)
    w.fail({ name: "ai_work_link__resolve", error: "throw" })
    const t = await w.handler(new Request(`${F}/${TOKENS.manager}/context`))
    expect(t.status).toBe(503)
    await check(t)
  })

  test("a database error keeps its SQLSTATE code through the client wrapper, so AW410 is a 410 and a failing call log is a 503", async () => {
    const w = await boot({ SUPABASE_URL: DEFAULT_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })
    w.fail({ name: "ai_work_link__resolve", error: { message: "This link has expired or was revoked", code: "AW410" } })
    const gone = await w.handler(new Request(`${F}/${TOKENS.manager}/context`))
    expect(gone.status).toBe(410)
    w.fail({ name: "ai_work_link_log_call", error: { message: "too many connections", code: "53300" } })
    const down = await w.handler(new Request(`${F}/${TOKENS.manager}/context`))
    expect(down.status).toBe(503)
    expect(w.rpcSeen.at(-1)?.name).toBe("ai_work_link_log_call")
    w.fail(null)
    expect((await w.handler(new Request(`${F}/${TOKENS.manager}/context`, { method: "OPTIONS" }))).status).toBe(204)
  })
})

describe("configFromEnv", () => {
  const cfg = (env: Record<string, string>) => configFromEnv((n) => env[n])

  test("with nothing set: the fixed project host, a confirm host that never resolves, the app origin, one shared throttle bucket, no executor", () => {
    expect(cfg({})).toEqual({
      functionBase: `${DEFAULT_SUPABASE_URL}${FUNCTION_PATH}`,
      confirmHost: DEFAULT_CONFIRM_HOST,
      appBase: DEFAULT_APP_BASE,
      addressPosition: null,
      executorEnabled: false,
    })
    expect(DEFAULT_CONFIRM_HOST.endsWith(".invalid")).toBe(true)
    expect(DEFAULT_SUPABASE_URL).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co")
  })

  test("SUPABASE_URL is used only when it is an https .supabase.co host; anything else falls back to the fixed one", () => {
    expect(cfg({ SUPABASE_URL: "https://abcdefgh.supabase.co/" }).functionBase).toBe(`https://abcdefgh.supabase.co${FUNCTION_PATH}`)
    for (const bad of ["http://abcdefgh.supabase.co", "https://evil.example", "https://abcdefgh.supabase.co.evil.example", "https://abcdefgh.supabase.co/rest/v1", "not a url", ""]) {
      expect(cfg({ SUPABASE_URL: bad }).functionBase).toBe(`${DEFAULT_SUPABASE_URL}${FUNCTION_PATH}`)
    }
  })

  test("AWL_CONFIRM_HOST, AWL_APP_BASE and AWL_CLIENT_ADDR_POSITION are taken only when well-formed", () => {
    expect(cfg({ AWL_CONFIRM_HOST: "inbox.pages.dev" }).confirmHost).toBe("inbox.pages.dev")
    for (const bad of ["https://inbox.pages.dev", "inbox.pages.dev/x", "in box", "-x.dev"]) expect(cfg({ AWL_CONFIRM_HOST: bad }).confirmHost).toBe(DEFAULT_CONFIRM_HOST)
    expect(cfg({ AWL_APP_BASE: "https://app.example/" }).appBase).toBe("https://app.example")
    for (const bad of ["http://app.example", "https://app.example/path", "app.example"]) expect(cfg({ AWL_APP_BASE: bad }).appBase).toBe(DEFAULT_APP_BASE)
    expect(cfg({ AWL_CLIENT_ADDR_POSITION: "1" }).addressPosition).toBe(1)
    expect(cfg({ AWL_CLIENT_ADDR_POSITION: "3" }).addressPosition).toBe(3)
    for (const bad of ["0", "-1", "abc", "9", "1.5", "10", ""]) expect(cfg({ AWL_CLIENT_ADDR_POSITION: bad }).addressPosition).toBeNull()
    // no setting can switch the executor on in this unit
    expect(cfg({ AWL_EXECUTOR_ENABLED: "true", EXECUTOR_ENABLED: "1" }).executorEnabled).toBe(false)
  })

  test("jwt.ts: verify_jwt is false and the PROJEXA settings match projexa-read's", () => {
    expect(VERIFY_JWT).toBe(false)
    expect([...ACCEPTED_ALGORITHMS]).toEqual(["ES256"])
    expect(PROJEXA_AUDIENCE).toBe("authenticated")
    expect(PROJEXA_ISSUER).toBe("https://evpckeuxgvahguwsaeul.supabase.co/auth/v1")
    expect(PROJEXA_JWKS_URL).toBe(`${PROJEXA_ISSUER}/.well-known/jwks.json`)
  })
})

describe("static rules for the link's Edge code", () => {
  const FORBIDDEN = ["runSubmission", "runLevel1", "callLLM", "resolveModelConfig", "api/mcp/"]

  test("BR-480: at least 3 files in supabase/functions/ai-work-link, and no forbidden name anywhere in the link's Edge code, comments included", () => {
    expect(FN_DIR.endsWith("/functions/ai-work-link") || FN_DIR.endsWith("\\functions\\ai-work-link")).toBe(true)
    const own = filesOf(FN_DIR)
    expect(own.length).toBeGreaterThanOrEqual(3)
    const scanned = [...own, ...filesOf(SHARED_DIR), ...filesOf(EXEC_DIR)]
    expect(scanned.length).toBeGreaterThan(10)
    for (const f of scanned) for (const bad of FORBIDDEN) expect(`${f} ${read(f).includes(bad)}`).toBe(`${f} false`)
  })

  test("the link's Edge code imports nothing from the DPDP function or the PROJEXA gateway, and calls no model or fetch", () => {
    for (const f of tsFiles()) {
      const src = code(f)
      expect(src).not.toMatch(/dpdp-ai-link|projexa-read|projexa-timer|dpdp-monday/)
      expect(src).not.toMatch(/(await|return|=)\s+fetch\(/)
      expect(src).not.toMatch(/openrouter|anthropic|groq|cerebras|api\.openai/i)
    }
  })

  test("the handler never builds SQL text and names no table: every read is a call to a public.ai_work_link_* function", () => {
    for (const f of tsFiles()) {
      const src = code(f)
      expect(src).not.toMatch(/\b(SELECT|INSERT INTO|DELETE FROM)\b/)
      expect(src).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/)
      expect(src).not.toMatch(/\b(client|db|supabase)\.from\(/)
      expect(src).not.toMatch(/\b(compliance|platform)\.\w+/)
    }
    const called = new Set<string>()
    for (const f of tsFiles()) for (const m of read(f).matchAll(/["'`](ai_work_link_[a-z_]+|ai_work_link__[a-z_]+)["'`]/g)) called.add(m[1])
    // every name the Edge code calls is one drizzle/0624 to 0626 defines
    const sql = ["0624_build001_awl_link_functions.sql", "0625_build001_awl_read_functions.sql", "0626_build001_awl_intent_functions.sql"].map((n) => read(join(ROOT, "drizzle", n))).join("\n")
    for (const name of called) expect(`${name} ${sql.includes(`public.${name}(`)}`).toBe(`${name} true`)
    expect([...called].sort()).toEqual(["ai_work_link__resolve", "ai_work_link_context", "ai_work_link_history", "ai_work_link_intent_status", "ai_work_link_log_call", "ai_work_link_log_call_result", "ai_work_link_record", "ai_work_link_records"])
  })

  test("the service-role key is read in index.ts only, and no Deno global is used outside it", () => {
    for (const f of tsFiles()) {
      const src = code(f)
      const isIndex = f.endsWith("index.ts") && f.includes("ai-work-link")
      expect(`${f} ${/SERVICE_ROLE/.test(src)}`).toBe(`${f} ${isIndex}`)
      expect(`${f} ${/\bDeno\./.test(src)}`).toBe(`${f} ${isIndex}`)
    }
  })

  test("the shared core.ts exports the three helpers the DPDP router also exports, with the same names", () => {
    const core = read(join(SHARED_DIR, "core.ts"))
    for (const name of ["negotiateFormat", "paginate<T>", "errorBody"]) expect(core).toContain(`export function ${name}(`)
    const matches = core.match(/^export function (negotiateFormat|paginate(<T>)?|errorBody)\(/gm) ?? []
    expect(matches).toHaveLength(3)
  })
})
