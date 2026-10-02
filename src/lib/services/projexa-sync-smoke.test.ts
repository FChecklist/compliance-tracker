// Pure parts of scripts/verify/projexa-sync-smoke.mjs with a fake fetch (package lf-b4-runbook). No network.
import { describe, expect, test } from "bun:test"
// @ts-expect-error plain ESM script without types
import { runSmoke, scrub, table, validateBase } from "../../../scripts/verify/projexa-sync-smoke.mjs"

const BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync"
const TOKEN = "tok_SECRET_0123456789"
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function server(over: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: string | null }> = []
  const routes: Record<string, () => Response> = {
    manifest: () => json(200, { user: { id: "u" }, projects: [{ id: "p1" }], kinds: [{ kind: "tasks" }, { kind: "project" }], release: { current: null, min_compatible: null, protocol: 2 } }),
    pull: () => json(200, { items: [], has_more: false }),
    changes: () => json(200, { changes: [], head_seq: 41 }),
    ids: () => json(200, { ids: [], has_more: false }),
    attest: () => json(200, { token: "x", public_keys: [{ kid: "k" }], channel: "c" }),
    "release/current": () => json(200, { registered: true, current: {}, min_compatible: null, protocol: 2 }),
    ...over,
  }
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), auth: new Headers(init.headers).get("authorization"), body: (init.body as string) ?? null })
    const route = url.slice(BASE.length + 1)
    return (routes[route] ?? (() => json(404, {})))()
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}
let t = 0
const nowMs = () => (t += 7)

describe("validateBase", () => {
  test("accepts the real function URL (trailing slash ok)", () => {
    expect(validateBase(BASE)).toBe(BASE)
    expect(validateBase(`${BASE}/`)).toBe(BASE)
  })
  test.each([
    ["http://x.supabase.co/functions/v1/projexa-sync", "not https"],
    ["https://projexa-ai.com/functions/v1/projexa-sync", "not supabase.co"],
    ["https://supabase.co.evil.com/functions/v1/projexa-sync", "suffix trick"],
    ["https://evil.com/x.supabase.co/functions/v1/projexa-sync", "host in path"],
    ["https://evilsupabase.co/functions/v1/projexa-sync", "no dot before supabase.co"],
    ["https://supabase.co/functions/v1/projexa-sync", "apex host"],
    ["https://x.supabase.co/functions/v1/other", "wrong function"],
    ["https://u:p@x.supabase.co/functions/v1/projexa-sync", "credentials"],
    ["https://x.supabase.co:8443/functions/v1/projexa-sync", "port"],
    ["https://x.supabase.co/functions/v1/projexa-sync?a=1", "query"],
    ["", "empty"],
    ["not a url", "garbage"],
  ])("refuses %s (%s)", (url) => {
    expect(() => validateBase(url)).toThrow()
  })
})

describe("runSmoke", () => {
  test("all routes pass; the project calls use the manifest's first project and the 'project' kind; the token is sent only as the bearer", async () => {
    const s = server()
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: s.fetchImpl, nowMs })
    expect(rows.map((r: { name: string; status: string }) => `${r.name}:${r.status}`)).toEqual(["manifest:PASS", "pull:PASS", "changes:PASS", "ids:PASS", "attest:PASS", "release/current:PASS"])
    expect(s.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true)
    expect(JSON.parse(s.calls[1].body!)).toEqual({ project_id: "p1", kind: "project", after: null, limit: 1 })
    expect(JSON.parse(s.calls[2].body!)).toEqual({ project_id: "p1", after_seq: null, limit: 1 })
    expect(rows[1].ms).toBe(7)
  })
  test("a non-200 is a FAIL with the coded reason, and the table says SMOKE FAIL", async () => {
    const s = server({ attest: () => json(503, { error: "x" }), pull: () => json(426, { code: "UPDATE_REQUIRED" }) })
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: s.fetchImpl, nowMs })
    expect(rows.find((r: { name: string }) => r.name === "attest")).toMatchObject({ status: "FAIL", http: 503 })
    expect(rows.find((r: { name: string }) => r.name === "pull")?.detail).toBe("HTTP 426 UPDATE_REQUIRED")
    expect(table(rows)).toContain("SMOKE FAIL (2 failed)")
  })
  test("a 200 with the wrong shape is a FAIL", async () => {
    const s = server({ changes: () => json(200, { changes: [] }) })
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: s.fetchImpl, nowMs })
    expect(rows.find((r: { name: string }) => r.name === "changes")?.status).toBe("FAIL")
  })
  test("a person with no project gets SKIP rows and the run still passes", async () => {
    const s = server({ manifest: () => json(200, { projects: [], kinds: [], release: {} }) })
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: s.fetchImpl, nowMs })
    expect(rows.filter((r: { status: string }) => r.status === "SKIP").map((r: { name: string }) => r.name)).toEqual(["pull", "changes", "ids"])
    expect(table(rows)).toContain("SMOKE PASS")
  })
  test("a failed manifest makes the dependent calls FAIL, not skip", async () => {
    const s = server({ manifest: () => json(401, { error: "Sign in again" }) })
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: s.fetchImpl, nowMs })
    expect(rows.slice(0, 4).map((r: { status: string }) => r.status)).toEqual(["FAIL", "FAIL", "FAIL", "FAIL"])
  })
  test("a network error is a FAIL row, never a throw, and the token never appears in any output", async () => {
    const boom = (async () => { throw new TypeError(`connect failed for ${TOKEN}`) }) as unknown as typeof fetch
    const rows = await runSmoke({ base: BASE, token: TOKEN, fetchImpl: boom, nowMs })
    expect(rows.every((r: { status: string }) => r.status === "FAIL")).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(TOKEN)
    expect(table(rows)).not.toContain(TOKEN)
  })
  test("scrub removes the token from free text", () => {
    expect(scrub(`bad ${TOKEN} here`, TOKEN)).toBe("bad [token] here")
  })
})
