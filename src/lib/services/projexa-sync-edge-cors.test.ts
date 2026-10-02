// projexa-sync Edge handler, CORS as a REAL browser sees it (review finding D1 BLOCKER requirements-coverage:F1 = tests-quality:F01 = edge-handler:F-04,
// plus requirements-coverage:F3). Handler-only: injected fakes, no database.
//
// A laptop's browser preflights every call because Authorization and X-Px-Client are not CORS-safelisted. The preflight answer must list EVERY header the
// laptop requests, or the browser never sends the call (manifest, pull, push ... all dead from a browser while every node test passes). Every error answer
// must also carry Access-Control-Allow-Origin, or the browser hides it (a 426 UPDATE_REQUIRED or 429 a laptop cannot read is useless), and Retry-After
// must be exposed. The preflight is cached for 2 h because an OPTIONS is one more billed invocation.
import { describe, expect, test } from "bun:test"
import { ALLOWED_ORIGINS, CORS_MAX_AGE_SECONDS, handleSync, RateLimiter, type Rpc, type SyncDeps } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

const BASE = "https://x.supabase.co/functions/v1/projexa-sync"
// exactly what sync-client.ts sends (fetch lower-cases and sorts the names in Access-Control-Request-Headers)
const BROWSER_REQUEST_HEADERS = "authorization,content-type,x-px-client"

const session: SessionVerifier = async (token) =>
  token === "down" ? { ok: false, reason: "unavailable" } : token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" }

const rpc: Rpc = async (fn) => {
  if (fn === "projexa_sync_manifest") return { data: { status: "ok", user: { id: "u1", org_id: "org-a" }, projects: [], kinds: [] }, error: null }
  if (fn === "projexa_release_current") return { data: { registered: true, current: { release_version: "2026.10.02-002" }, min_compatible: "2026.10.02-002" }, error: null }
  return { data: null, error: { message: "boom", code: "XX000" } }
}

const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({ rpc, session, now: () => new Date("2026-10-02T00:00:00Z"), ...over })
const allowList = (r: Response) => (r.headers.get("access-control-allow-headers") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)

function preflight(origin: string, requestHeaders = BROWSER_REQUEST_HEADERS, route = "pull") {
  return handleSync(new Request(`${BASE}/${route}`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": requestHeaders } }), deps())
}

describe("CORS preflight, exactly as a browser sends it", () => {
  test("every allowed origin: 204, origin echoed, EVERY requested header allowed (authorization, content-type, x-px-client), no credentials", async () => {
    for (const origin of ALLOWED_ORIGINS) {
      for (const route of ["manifest", "pull", "push", "attest", "changes", "ids", "release/current", "install", "jobs/claim"]) {
        const r = await preflight(origin, BROWSER_REQUEST_HEADERS, route)
        expect(r.status).toBe(204)
        expect(r.headers.get("access-control-allow-origin")).toBe(origin)
        const allowed = allowList(r)
        for (const h of BROWSER_REQUEST_HEADERS.split(",")) expect(allowed).toContain(h)
        expect(r.headers.get("access-control-allow-credentials")).toBeNull()
        expect(r.headers.get("access-control-allow-methods")).toContain("POST")
      }
    }
  })

  test("an unknown request header is not allowed; a disallowed origin gets no allow-origin", async () => {
    const r = await preflight("http://localhost:3100", "authorization,x-evil-header")
    expect(allowList(r)).not.toContain("x-evil-header")
    expect(allowList(r)).not.toContain("*")
    const evil = await preflight("https://evil.example")
    expect(evil.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("the preflight is cached for 2 h (Chromium's ceiling) so a laptop does not pay an extra invocation per call", async () => {
    const r = await preflight("https://projexa-ai.com")
    expect(CORS_MAX_AGE_SECONDS).toBe(7200)
    expect(r.headers.get("access-control-max-age")).toBe("7200")
  })

  test("Retry-After is exposed to browser JS", async () => {
    const r = await preflight("https://projexa-ai.com")
    expect((r.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("retry-after")
  })
})

describe("every error answer is readable cross-origin (allow-origin echoed)", () => {
  const origin = "https://projexa-ai.com"
  const call = (route: string, token: string | null, d: SyncDeps, extra: Record<string, string> = {}, method = "GET", body?: string) =>
    handleSync(new Request(`${BASE}/${route}`, { method, body, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra } }), d)

  test("401 (no token, bad token)", async () => {
    for (const t of [null, "bad"]) {
      const r = await call("manifest", t, deps())
      expect(r.status).toBe(401)
      expect(r.headers.get("access-control-allow-origin")).toBe(origin)
    }
  })

  test("404 (unknown route) and 405", async () => {
    const r = await call("nope", "tok:u1", deps())
    expect(r.status).toBe(404)
    expect(r.headers.get("access-control-allow-origin")).toBe(origin)
    const m = await call("pull", "tok:u1", deps())
    expect(m.status).toBe(405)
    expect(m.headers.get("access-control-allow-origin")).toBe(origin)
  })

  test("426 UPDATE_REQUIRED for a client below the floor carries allow-origin and a readable body", async () => {
    const r = await call("manifest", "tok:u1", deps(), { "x-px-client": "2026.10.01-001; protocol=2; schema=3" })
    expect(r.status).toBe(426)
    expect(r.headers.get("access-control-allow-origin")).toBe(origin)
    expect(((await r.json()) as { code: string }).code).toBe("UPDATE_REQUIRED")
  })

  test("429 carries allow-origin, Retry-After and exposes it", async () => {
    const d = deps({ limiter: new RateLimiter(1) })
    expect((await call("manifest", "tok:u1", d)).status).toBe(200)
    const r = await call("manifest", "tok:u1", d)
    expect(r.status).toBe(429)
    expect(r.headers.get("access-control-allow-origin")).toBe(origin)
    expect(r.headers.get("retry-after")).toBe("60")
    expect((r.headers.get("access-control-expose-headers") ?? "").toLowerCase()).toContain("retry-after")
  })

  test("503 (session service down) carries allow-origin", async () => {
    const r = await call("manifest", "down", deps())
    expect(r.status).toBe(503)
    expect(r.headers.get("access-control-allow-origin")).toBe(origin)
  })

  test("413 (body too large) carries allow-origin", async () => {
    const r = await call("ids", "tok:u1", deps(), { "content-type": "application/json" }, "POST", JSON.stringify({ pad: "x".repeat(20_000) }))
    expect(r.status).toBe(413)
    expect(r.headers.get("access-control-allow-origin")).toBe(origin)
  })
})
