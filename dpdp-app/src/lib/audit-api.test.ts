import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AuditLogPanel } from "../components/AuditLogPanel"
import type { DpdpClient } from "./client"
import { deviceId, downloadAuditLog, forgetLoginReport, getAuditOrgs, reportFailedLogin, reportLogin, verifyAuditChain } from "./audit-api"

// The browser's side of the audit trail: what it reports, what it never sends, how a refusal is told to the person, and that nothing here can show a full value.
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } }
const clientWith = (token: string | null) => ({ accessToken: async () => token }) as unknown as DpdpClient
type Seen = { url: string; init?: RequestInit }
const recorder = (res: () => Response | Promise<Response>) => { const seen: Seen[] = []; return { seen, fn: async (url: string, init?: RequestInit) => { seen.push({ url, init }); return res() } } }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

describe("device id: random, kept in this browser only", () => {
  test("created once, then stable; a tampered value is replaced; no storage gives null", () => {
    const s = mem()
    const a = deviceId(s)!
    expect(a).toMatch(/^[a-f0-9]{24}$/); expect(deviceId(s)).toBe(a)
    s.m.set("dpdp_device_id", "<script>")
    expect(deviceId(s)).toMatch(/^[a-f0-9]{24}$/)
    expect(deviceId(null)).toBeNull()
  })
})

describe("what the browser reports", () => {
  test("login: once per tab per sign-in, with the bearer, the browser's own time and time zone and a device id; never an address (the server adds that)", async () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = mem() // bun has no browser storage; the real one is what the page uses
    const s = mem(); const r = recorder(() => json({ ok: true }))
    await reportLogin(clientWith("tok"), r.fn, s)
    await reportLogin(clientWith("tok"), r.fn, s)
    expect(r.seen).toHaveLength(1)
    const h = r.seen[0].init!.headers as Record<string, string>
    expect(h.Authorization).toBe("Bearer tok")
    const body = JSON.parse(String(r.seen[0].init!.body))
    expect(body.type).toBe("login"); expect(body.device_id).toBeTruthy(); expect(Date.parse(body.client_time)).toBeGreaterThan(0)
    for (const k of ["ip", "address", "email", "password"]) expect(body).not.toHaveProperty(k)
    forgetLoginReport(s); await reportLogin(clientWith("tok"), r.fn, s); expect(r.seen).toHaveLength(2)
  })
  test("no token, or any failure, is silent and never in the way of signing in", async () => {
    const r = recorder(() => json({}))
    await reportLogin(clientWith(null), r.fn, mem()); expect(r.seen).toHaveLength(0)
    await reportLogin(clientWith("tok"), async () => { throw new Error("offline") }, mem())
    await reportFailedLogin("a@b.in", "otp", async () => { throw new Error("offline") })
  })
  test("failed login: anonymous (no Authorization), carries the address that was typed and the method, nothing else personal", async () => {
    const r = recorder(() => json({ ok: true }, 202))
    await reportFailedLogin("priya@acme.in", "otp", r.fn)
    const h = r.seen[0].init!.headers as Record<string, string>
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization")
    expect(JSON.parse(String(r.seen[0].init!.body))).toMatchObject({ type: "failed_login", email: "priya@acme.in", method: "otp" })
    expect(r.seen[0].url.endsWith("/functions/v1/dpdp-audit/event")).toBe(true)
  })
})

describe("downloading", () => {
  test("own and organisation scopes call /my and /org with the organisation; the file text, a safe name and the hash come back untouched", async () => {
    const r = recorder(() => new Response("{\"rows\":[]}", { status: 200, headers: { "content-disposition": 'attachment; filename="dpdp audit/../x.json"', "x-verification-hash": "abc123" } }))
    const own = await downloadAuditLog(clientWith("tok"), "own", "o 1", r.fn)
    expect(own).toEqual({ ok: true, filename: "dpdp_audit_.._x.json", text: "{\"rows\":[]}", verificationHash: "abc123" })
    await downloadAuditLog(clientWith("tok"), "organisation", "o1", r.fn)
    expect(r.seen.map((x) => x.url.replace(/^.*dpdp-audit/, ""))).toEqual(["/my?org_id=o%201", "/org?org_id=o1"])
    expect((r.seen[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer tok")
  })
  test("every refusal is told plainly and distinctly: fresh code, rate limit, not allowed, signed out, network", async () => {
    const mk = (status: number, body: unknown) => downloadAuditLog(clientWith("t"), "own", "o1", async () => json(body, status))
    expect(await mk(403, { error: "Confirm a fresh code first", code: "FRESH_CODE_REQUIRED" })).toMatchObject({ ok: false, code: "FRESH_CODE_REQUIRED" })
    expect(await mk(429, { error: "5 an hour", code: "RATE_LIMITED" })).toMatchObject({ ok: false, code: "RATE_LIMITED", message: "5 an hour" })
    expect(await mk(403, { error: "Only the owner" })).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(await mk(500, {})).toMatchObject({ ok: false, code: "ERROR" })
    expect(await downloadAuditLog(clientWith(null), "own", "o1", async () => json({}))).toMatchObject({ ok: false, code: "SIGNED_OUT" })
    expect(await downloadAuditLog(clientWith("t"), "own", "o1", async () => { throw new Error("x") })).toMatchObject({ ok: false, code: "ERROR" })
  })
  test("orgs and verify talk to /orgs and /verify and report failures without throwing", async () => {
    expect(await getAuditOrgs(clientWith("t"), async () => json({ orgs: [{ orgId: "o1" }], codeFresh: true, codeMaxAgeSeconds: 600 }))).toMatchObject({ codeFresh: true })
    expect(await getAuditOrgs(clientWith("t"), async () => json({}, 401))).toBeNull()
    expect(await verifyAuditChain(clientWith("t"), "o1", async () => json({ ok: true, rows: 9 }))).toEqual({ ok: true, rows: 9 })
    expect(await verifyAuditChain(clientWith("t"), "o1", async () => json({ ok: false, reason: "link", detail: "x" }))).toMatchObject({ ok: false, reason: "link" })
    expect(await verifyAuditChain(clientWith("t"), "o1", async () => json({ error: "Only the owner" }, 403))).toEqual({ ok: false, error: "Only the owner" })
  })
})

describe("the panel says what is logged, why, and that the log is never e-mailed", () => {
  test("the disclosure text is on the screen", () => {
    const html = renderToStaticMarkup(createElement(AuditLogPanel, { client: clientWith("t"), orgId: "o1", email: "a@b.in" }))
    expect(html).toContain("365 days"); expect(html).toContain("DPDP Rules 6 and 8(3)"); expect(html).toContain("never sent by e-mail"); expect(html).toContain('id="audit-log"')
  })
})
