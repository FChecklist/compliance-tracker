/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-40 (PMD-39): the Edge Function projexa-scheduler-bridge, the middle hop between the pg_cron job and the app route.
// The real request handler (supabase/functions/projexa-scheduler-bridge/handler.ts) runs here with its RPC and fetch passed in, so no
// test touches a database or the network. What is proved: the bearer check refuses first and fails closed; nothing is called when the
// two Edge Function secrets are not set right; an idle tick (nothing due) makes NO request to the app; a due tick makes exactly one
// request, to the fixed app route, carrying the app secret and never the cron's bearer; a refused or unreachable app is a 502; and no
// response body ever carries either secret.
// Lives under src/ because bunfig.toml sets [test] root = "src". Run: bun test --isolate src/lib/services/projexa-scheduler-bridge.test.ts
import { describe, expect, test } from "bun:test"
import {
  APP_ROUTE_PATH,
  appRouteUrl,
  handleBridge,
  type BridgeDeps,
  type RpcResult,
} from "../../../supabase/functions/projexa-scheduler-bridge/handler"

const CRON_BEARER = "c".repeat(48)
const APP_SECRET = "a".repeat(40)
const APP_URL = "https://app.example.test"
const NOW = new Date("2026-09-26T09:30:00.000Z")

type Call = { fn: string; args?: Record<string, unknown> }
type FetchCall = { url: string; method?: string; headers?: Record<string, string>; body?: string }

function makeDeps(opts: {
  bearerOk?: boolean | "error"
  due?: unknown
  dueError?: "error" | "throw"
  config?: Partial<BridgeDeps["config"]>
  app?: { ok: boolean; status: number; body?: unknown; jsonThrows?: boolean } | "throw"
}): { deps: BridgeDeps; calls: Call[]; fetched: FetchCall[] } {
  const calls: Call[] = []
  const fetched: FetchCall[] = []
  const deps: BridgeDeps = {
    now: () => NOW,
    config: { appBaseUrl: APP_URL, internalSecret: APP_SECRET, ...opts.config },
    rpc: async (fn, args): Promise<RpcResult> => {
      calls.push({ fn, args })
      if (fn === "projexa_scheduler_bridge_check_bearer") {
        if (opts.bearerOk === "error") return { data: null, error: { message: "rpc down" } }
        return { data: opts.bearerOk !== false, error: null }
      }
      if (fn === "projexa_scheduler_bridge_due_count") {
        if (opts.dueError === "throw") throw new Error("connection reset")
        if (opts.dueError === "error") return { data: null, error: { message: "permission denied" } }
        return { data: "due" in opts ? opts.due : 0, error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    fetchImpl: async (url, init) => {
      fetched.push({ url, method: init?.method, headers: init?.headers, body: init?.body })
      if (opts.app === "throw") throw new Error("getaddrinfo ENOTFOUND app.example.test")
      const app = opts.app ?? { ok: true, status: 200, body: { claimed: 1, proposed: 1 } }
      return {
        ok: app.ok,
        status: app.status,
        json: async () => {
          if (app.jsonThrows) throw new Error("not json")
          return app.body ?? {}
        },
      }
    },
  }
  return { deps, calls, fetched }
}

function req(init: { method?: string; auth?: string | null; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (init.auth !== null) headers.Authorization = init.auth ?? `Bearer ${CRON_BEARER}`
  return new Request("https://example.test/functions/v1/projexa-scheduler-bridge", {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? JSON.stringify({ job: "scheduler_bridge" }) : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  })
}

async function readJson(res: Response): Promise<{ text: string; body: Record<string, unknown> }> {
  const text = await res.text()
  return { text, body: JSON.parse(text) as Record<string, unknown> }
}

describe("handleBridge: who may call it", () => {
  test("only POST is accepted", async () => {
    const { deps, calls } = makeDeps({})
    expect((await handleBridge(req({ method: "GET", body: "" }), deps)).status).toBe(405)
    expect(calls).toEqual([])
  })

  test("no bearer, a short bearer, a refused bearer and an RPC error all give 401 and reach neither the due count nor the app", async () => {
    for (const [auth, bearerOk] of [[null, true], ["Bearer short", true], [undefined, false], [undefined, "error"]] as const) {
      const { deps, calls, fetched } = makeDeps({ due: 3, bearerOk })
      const res = await handleBridge(req({ auth }), deps)
      expect(res.status).toBe(401)
      expect(calls.some((c) => c.fn === "projexa_scheduler_bridge_due_count")).toBe(false)
      expect(fetched).toEqual([])
    }
  })

  test("the bearer is checked through the SQL function with exactly the presented value", async () => {
    const { deps, calls } = makeDeps({ due: 0 })
    await handleBridge(req(), deps)
    expect(calls[0]).toEqual({ fn: "projexa_scheduler_bridge_check_bearer", args: { p_bearer: CRON_BEARER } })
  })

  test("a body that is not JSON, and an unknown job, give 400 before anything is counted", async () => {
    const { deps, calls } = makeDeps({ due: 3 })
    expect((await handleBridge(req({ body: "not json" }), deps)).status).toBe(400)
    const unknown = await handleBridge(req({ body: { job: "exchange_rate_refresh" } }), deps)
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { supported: string[] }).supported).toEqual(["scheduler_bridge"])
    expect(calls.some((c) => c.fn === "projexa_scheduler_bridge_due_count")).toBe(false)
  })
})

describe("handleBridge: configuration", () => {
  test("an unset, plain-http, credentialed or malformed app URL, and an unset or short secret, give 503 and call nothing", async () => {
    const cases: Array<Partial<BridgeDeps["config"]>> = [
      { appBaseUrl: null },
      { appBaseUrl: "http://app.example.test" },
      { appBaseUrl: "https://user:pass@app.example.test" },
      { appBaseUrl: "not a url" },
      { internalSecret: null },
      { internalSecret: "short" },
    ]
    for (const config of cases) {
      const { deps, calls, fetched } = makeDeps({ due: 5, config })
      const res = await handleBridge(req(), deps)
      const { body } = await readJson(res)
      expect(res.status).toBe(503)
      expect(body.error).toBe("not_configured")
      expect(calls.map((c) => c.fn)).toEqual(["projexa_scheduler_bridge_check_bearer"])
      expect(fetched).toEqual([])
    }
  })

  test("appRouteUrl keeps only the origin and adds the fixed path", () => {
    expect(appRouteUrl("https://app.example.test")).toBe(`https://app.example.test${APP_ROUTE_PATH}`)
    expect(appRouteUrl("https://app.example.test/some/path?x=1")).toBe(`https://app.example.test${APP_ROUTE_PATH}`)
    expect(appRouteUrl("https://app.example.test:8443/")).toBe(`https://app.example.test:8443${APP_ROUTE_PATH}`)
    expect(appRouteUrl("http://app.example.test")).toBeNull()
    expect(appRouteUrl("ftp://app.example.test")).toBeNull()
    expect(appRouteUrl(null)).toBeNull()
  })
})

describe("handleBridge: the cost guard", () => {
  test("nothing due: it answers without any request to the app", async () => {
    for (const due of [0, -1]) {
      const { deps, fetched } = makeDeps({ due })
      const res = await handleBridge(req(), deps)
      const { body } = await readJson(res)
      expect(res.status).toBe(200)
      expect(body).toEqual({ job: "scheduler_bridge", ranAt: NOW.toISOString(), due: 0, called: false })
      expect(fetched).toEqual([])
    }
  })

  test("a due count that cannot be read is a 500, not a silent idle tick and not a blind call to the app", async () => {
    const unreadable: Array<Parameters<typeof makeDeps>[0]> = [
      { dueError: "error" },
      { dueError: "throw" },
      { due: null },
      { due: "3" },
      { due: Number.NaN },
    ]
    for (const opts of unreadable) {
      const { deps, fetched } = makeDeps(opts)
      const res = await handleBridge(req(), deps)
      expect(res.status).toBe(500)
      expect(((await res.json()) as { error: string }).error).toBe("due_count_failed")
      expect(fetched).toEqual([])
    }
  })
})

describe("handleBridge: a due tick calls the app once", () => {
  test("one POST to the fixed route with the app secret (never the cron bearer), and the app's summary comes back", async () => {
    const { deps, fetched } = makeDeps({ due: 2, app: { ok: true, status: 200, body: { claimed: 2, proposed: 1, readsRun: 1 } } })
    const res = await handleBridge(req(), deps)
    const { body } = await readJson(res)
    expect(res.status).toBe(200)
    expect(fetched.length).toBe(1)
    expect(fetched[0].url).toBe(`${APP_URL}${APP_ROUTE_PATH}`)
    expect(fetched[0].method).toBe("POST")
    expect(fetched[0].headers?.Authorization).toBe(`Bearer ${APP_SECRET}`)
    expect(JSON.stringify(fetched[0])).not.toContain(CRON_BEARER)
    expect(body).toEqual({ job: "scheduler_bridge", ranAt: NOW.toISOString(), due: 2, called: true, appStatus: 200, app: { claimed: 2, proposed: 1, readsRun: 1 } })
  })

  test("an app answer that is not JSON still counts as called, with a null summary", async () => {
    const { deps } = makeDeps({ due: 1, app: { ok: true, status: 200, jsonThrows: true } })
    const { body } = await readJson(await handleBridge(req(), deps))
    expect(body.called).toBe(true)
    expect(body.app).toBeNull()
  })

  test("a refused app (401, 500) is a 502 that says so, and an unreachable app is a 502 too", async () => {
    for (const status of [401, 500]) {
      const { deps } = makeDeps({ due: 1, app: { ok: false, status, body: { error: "x" } } })
      const res = await handleBridge(req(), deps)
      const { body } = await readJson(res)
      expect(res.status).toBe(502)
      expect(body).toMatchObject({ called: true, error: "app_call_failed", appStatus: status })
    }
    const { deps } = makeDeps({ due: 1, app: "throw" })
    const res = await handleBridge(req(), deps)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toBe("app_unreachable")
  })

  test("no response body, whatever the outcome, carries the cron bearer or the app secret", async () => {
    const scenarios = [
      makeDeps({ due: 0 }),
      makeDeps({ due: 2 }),
      makeDeps({ due: 2, app: { ok: false, status: 500 } }),
      makeDeps({ due: 2, app: "throw" }),
      makeDeps({ dueError: "error" }),
      makeDeps({ due: 1, config: { appBaseUrl: null } }),
      makeDeps({ bearerOk: false }),
    ]
    for (const { deps } of scenarios) {
      const { text } = await readJson(await handleBridge(req(), deps))
      expect(text).not.toContain(CRON_BEARER)
      expect(text).not.toContain(APP_SECRET)
    }
  })
})
