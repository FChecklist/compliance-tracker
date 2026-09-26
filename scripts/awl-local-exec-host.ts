// PROJEXA-BUILD-002 WP-09b (register rows AW-505, AW-510; plan D-E): the LOCAL EXECUTION HOST. It serves, on 127.0.0.1, the same exec handler the
// ai-work-link-exec Edge function serves (supabase/functions/ai-work-link-exec/handler.ts) over the same pipeline (src/lib/pipeline/link-exec-entry.ts),
// and ALSO the link function itself (supabase/functions/ai-work-link/handler.ts) pointed at it, so an AI client can be given a local link and the whole
// write path can be proven before the owner switches anything on: record, claim, run, finish, read the row back.
//
//   bun run scripts/awl-local-exec-host.ts --dry                     an in-process database: the intent SQL (drizzle/0621 to 0630) on PGlite and the
//                                                                      business side as the in-memory fake tenant database; nothing leaves the machine
//   bun run scripts/awl-local-exec-host.ts --dry --seed persona[-empty] the persona world (BUILD-002 WP-14, scripts/verify/persona/persona-world.ts): the ZOOMIES
//                                                                      project created the way one creates it, three people, decoy projects, session
//                                                                      routes and the signed-in app routes (mint, links, revoke, confirm) wired to a local
//                                                                      session check; still nothing leaves the machine. "persona-empty" leaves the
//                                                                      ZOOMIES project out (way three: the AI fills a shell project)
//   bun run scripts/awl-local-exec-host.ts --live --port 8787        the developer's real database (see below); needs the flag --live on purpose
//
// SETTINGS (never printed, never written to a file by this script)
//   AWL_EXEC_INTERNAL_SECRET   any local string: the bearer the two local handlers use between them and that /dry/* routes demand
//   --live reads .env.local (or --env-file) for APP_RUNTIME_DATABASE_URL (the business writes run through it, as app_runtime, exactly like the Edge
//   function), and NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY (the service-role rpc of claim and finish). Only the NAMES of what was found
//   are printed.
//
// ROUTES on http://127.0.0.1:<port>
//   /functions/v1/ai-work-link/...        the link function (a link token in the address, like production)
//   /functions/v1/ai-work-link-exec/...   the exec function (POST /run, GET /health), bearer AWL_EXEC_INTERNAL_SECRET
//   --dry only, bearer AWL_EXEC_INTERNAL_SECRET:
//     POST /dry/mint       {"role": "manager"|"member"|"viewer"}  a level-1 link for the demo person on the demo project -> {link_url}
//     POST /dry/writes     {"on": true|false}                     the master switch (platform.ai_work_link_settings.writes_enabled) of the dry database
//     POST /dry/record     {"link_url", "function", "params"}     records ONE action intent without running it -> {intent_id} (for the kill-switch drill)
//     GET  /dry/state      the demo business tables and the intent rows, to read a write back
//   --dry --seed persona adds (same bearer): POST /dry/session {"who"} a local session bearer for a person; POST /dry/role {"who","role"};
//     POST /dry/advance {"ms"} moves the clock of the signed-in routes (the per-person brakes) forward; GET /dry/ids, GET /dry/links (the links table, no token or hash), GET /dry/roles, and POST /dry/writes as above.
//
// WHAT THIS IS NOT: the deployed function. It proves the code; only the live run after the owner's steps proves app_runtime under row-level security.
import { mock } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const port = Number(opt("--port") ?? 8787)
const dry = flag("--dry")
const live = flag("--live")
const secret = process.env.AWL_EXEC_INTERNAL_SECRET ?? ""

function usage(msg: string): never {
  console.error(msg)
  console.error("usage: bun run scripts/awl-local-exec-host.ts (--dry | --live) [--port 8787] [--env-file .env.local]")
  console.error("       AWL_EXEC_INTERNAL_SECRET must be set to any local string")
  process.exit(2)
}
if (dry === live) usage("choose exactly one of --dry and --live")
if (!secret) usage("AWL_EXEC_INTERNAL_SECRET is not set")

/** Reads KEY=VALUE lines into process.env for the names below, unless already set. Values are never printed. */
function loadEnvFile(file: string, names: string[]): string[] {
  const found: string[] = []
  if (!existsSync(file)) return found
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || !names.includes(m[1])) continue
    const value = m[2].replace(/^["']|["']$/g, "")
    if (value === "") continue
    if (!process.env[m[1]]) process.env[m[1]] = value
    found.push(m[1])
  }
  return found
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>

async function main() {
  let rpc: Rpc
  let dryState: null | {
    db: import("@electric-sql/pglite").PGlite
    store: () => import("@/lib/pipeline/fake-tenant-db").FakeStore
    mint: (role: string) => Promise<string>
    setWrites: (on: boolean) => Promise<void>
    record: (token: string, fn: string, params: unknown) => Promise<string>
  } = null
  let persona: null | Awaited<ReturnType<typeof import("./verify/persona/persona-world").buildWorld>> = null

  if (dry && (opt("--seed") === "persona" || opt("--seed") === "persona-empty")) {
    const { buildWorld } = await import("./verify/persona/persona-world")
    persona = await buildWorld({ createZoomies: opt("--seed") === "persona" })
    rpc = persona.rpc as Rpc
    console.log(`awl-local-exec-host: dry: persona world ready (the ZOOMIES project created through the reader, the contract and createProject/createBoq; writes switch ON in this process only)`)
  } else if (dry) {
    // business side: the in-memory fake tenant database, in place of withTenantContext
    const fake = await import("@/lib/pipeline/fake-tenant-db")
    const fixture = await import("@/lib/services/__test-helpers__/awl-exec-fixture")
    const write = await import("@/lib/services/__test-helpers__/awl-write-fixture")
    let store = fake.createFakeStore(fixture.execTables())
    const realTenantScoped = await import("@/lib/db/tenant-scoped")
    mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fake.makeFakeWithTenantContext(() => store) }))
    // the memory write is a database call of its own (RLS policies, an actor check): out of scope for the in-memory business side
    const realMemory = await import("@/lib/services/memory-service")
    mock.module("@/lib/services/memory-service", () => ({ ...realMemory, createMemoryRecord: async () => ({ id: "dry-memory" }) }))
    // intent side: the real SQL on PGlite
    const db = await write.openWriteDb()
    await fixture.seedExecPeople(db)
    await write.setWrites(db, true)
    rpc = write.rpcFor(db) as Rpc
    dryState = {
      db,
      store: () => store,
      mint: async (role: string) => {
        await db.exec(`update compliance.users set role = '${role === "member" || role === "viewer" ? role : "manager"}' where id = '${fixture.FAKE_USER}'`)
        const link = await write.mintLink(db, fixture.FAKE_USER, fixture.FAKE_PROJECT_A, { level: 1 })
        return String(link.token)
      },
      setWrites: async (on: boolean) => {
        await write.setWrites(db, on)
      },
      record: async (token: string, fn: string, params: unknown) => String((await write.recordIntent(db, token, "action", fn, params, `dry-${Date.now()}-${Math.random().toString(36).slice(2)}`)).intent_id),
    }
    console.log("awl-local-exec-host: dry: PGlite intent database ready, business side in memory, writes switch ON (in this process only)")
    void store
  } else {
    const file = resolve(process.cwd(), opt("--env-file") ?? ".env.local")
    const found = loadEnvFile(file, ["APP_RUNTIME_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    console.log(`awl-local-exec-host: live: found ${found.join(", ") || "nothing"} in ${opt("--env-file") ?? ".env.local"}; APP_RUNTIME_DATABASE_URL ${process.env.APP_RUNTIME_DATABASE_URL ? "set" : "MISSING"}; service-role rpc ${url && key ? "configured" : "MISSING"}`)
    if (!process.env.APP_RUNTIME_DATABASE_URL || !url || !key) usage("live mode needs APP_RUNTIME_DATABASE_URL, a Supabase URL and SUPABASE_SERVICE_ROLE_KEY")
    const { createClient } = await import("@supabase/supabase-js")
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    rpc = async (fn, a) => {
      const { data, error } = await client.rpc(fn, a)
      return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
    }
  }

  // the pipeline and the two handlers are loaded AFTER the mocks above
  const { runLinkIntent, linkExecHealth } = await import("@/lib/pipeline/link-exec-entry")
  const { handleExec } = await import("../supabase/functions/ai-work-link-exec/handler")
  const { handleAwl } = await import("../supabase/functions/ai-work-link/handler")
  const { configFromEnv } = await import("../supabase/functions/ai-work-link/config")
  const { makeExecClient } = await import("../supabase/functions/ai-work-link/exec-client")

  const origin = `http://127.0.0.1:${port}`
  const execDeps = {
    rpc,
    secret,
    dbConfigured: dry ? true : Boolean(process.env.APP_RUNTIME_DATABASE_URL),
    run: persona
      ? async (c: Parameters<typeof runLinkIntent>[0]) => {
          await persona!.pull() // a shell project the link side made is known to the business side before the change runs
          const out = await runLinkIntent(c)
          await persona!.mirror() // the link side reads what the business side now holds
          return out
        }
      : runLinkIntent,
    health: dry ? async () => ({ db_role: "dry-run (no database role)" }) : linkExecHealth,
  }
  const awlConfig = { ...configFromEnv(() => undefined), functionBase: `${origin}/functions/v1/ai-work-link`, confirmHost: "localhost", execPresent: true }
  const exec = makeExecClient({ baseUrl: `${origin}/functions/v1/ai-work-link-exec`, secret })
  const authorised = (req: Request) => (req.headers.get("authorization") ?? "") === `Bearer ${secret}`

  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path.startsWith("/functions/v1/ai-work-link-exec")) return handleExec(req, execDeps)
      if (path.startsWith("/functions/v1/ai-work-link")) return handleAwl(req, { config: awlConfig, rpc, exec, ...(persona ? { session: persona.verify, now: persona.clock.now } : {}) })
      if (persona && path.startsWith("/dry/")) {
        if (!authorised(req)) return new Response("unauthorised", { status: 401 })
        const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {}
        if (path === "/dry/session" && req.method === "POST") return Response.json({ session: persona.sessionFor(body.who) })
        if (path === "/dry/role" && req.method === "POST") {
          await persona.setRole(body.who, String(body.role))
          return Response.json({ who: body.who, role: await persona.roleOf(body.who) })
        }
        if (path === "/dry/writes" && req.method === "POST") {
          await persona.setWrites(body.on === true)
          return Response.json({ writes_enabled: body.on === true })
        }
        if (path === "/dry/advance" && req.method === "POST") {
          persona.clock.advance(Number(body.ms) || 0)
          return Response.json({ now: persona.clock.now() })
        }
        if (path === "/dry/ids" && req.method === "GET") return Response.json(persona.ids)
        if (path === "/dry/roles" && req.method === "GET") {
          return Response.json(Object.fromEntries(await Promise.all((["sumeet", "maya", "vic", "other"] as const).map(async (k) => [k, await persona!.roleOf(k)]))))
        }
        if (path === "/dry/links" && req.method === "GET") {
          const r = await persona.db.query("select id, user_id, project_id, revoked_at, expires_at from platform.user_ai_links order by created_at")
          return Response.json({ links: r.rows })
        }
        if (path === "/dry/state" && req.method === "GET") {
          const intents = await persona.db.query("select id, kind, function_id, status, submission_id, result, failure from platform.ai_work_link_intent order by created_at")
          return Response.json({ intents: intents.rows, tables: persona.store().tables })
        }
        return new Response("not found", { status: 404 })
      }
      if (dryState && path.startsWith("/dry/")) {
        if (!authorised(req)) return new Response("unauthorised", { status: 401 })
        if (path === "/dry/mint" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as { role?: string }
          const token = await dryState.mint(body.role ?? "manager")
          return Response.json({ link_url: `${awlConfig.functionBase}/${token}` })
        }
        if (path === "/dry/writes" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as { on?: boolean }
          await dryState.setWrites(body.on === true)
          return Response.json({ writes_enabled: body.on === true })
        }
        if (path === "/dry/record" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as { link_url?: string; function?: string; params?: unknown }
          const token = /\/(pxa_[0-9a-f]{64})\/?$/.exec(String(body.link_url ?? ""))?.[1]
          if (!token || typeof body.function !== "string") return new Response("bad request", { status: 400 })
          return Response.json({ intent_id: await dryState.record(token, body.function, body.params ?? {}) })
        }
        if (path === "/dry/state" && req.method === "GET") {
          const intents = await dryState.db.query("select id, kind, function_id, status, submission_id, result, failure from platform.ai_work_link_intent order by created_at")
          return Response.json({ intents: intents.rows, tables: dryState.store().tables, writes: dryState.store().writes })
        }
      }
      return new Response("not found", { status: 404 })
    },
  })
  console.log(`awl-local-exec-host: serving ${origin}/functions/v1/ai-work-link and .../ai-work-link-exec (${dry ? "dry" : "LIVE database"})`)
}

await main()
