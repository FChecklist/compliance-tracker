/// <reference types="bun-types" />
// The relay (functions/api/_visit.ts) also copies each accepted visit beacon into the ONE central visitor database (functions/api/_visit-mirror.ts + the collector copy in functions/_analytics/).
// The site's own journey tracker keeps working exactly as before; the central database is a bun:sqlite stand-in, nothing here needs a network.
import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { relayVisit, UPSTREAM } from "../../functions/api/_visit"
import { mirrorVisit, toCentral, type MirrorEnv } from "../../functions/api/_visit-mirror"
import { resetRate } from "../../functions/_analytics/core"

const read = (f: string) => readFileSync(new URL("../../" + f, import.meta.url), "utf8")
const LEFT_OUT = new RegExp([["luci", "fer"], ["proj", "exa"]].map((p) => p.join("")).join("|"), "i") // the sites left out of the collector copy; spelled in pieces so this file does not name them
const T = Date.UTC(2026, 10, 3, 10, 0, 0), IP = "203.0.113.77", SID = "ab".repeat(8), VID = "c3".repeat(12)
const CF = { city: "Pune", country: "IN", asn: 64500, asOrganization: "Example Broadband" }
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"

type Row = Record<string, unknown>
type Bind = (string | number | null)[]
type Analytics = NonNullable<MirrorEnv["ANALYTICS"]>
interface Stmt { bind: (...v: Bind) => Stmt; run: () => Promise<{ meta: { changes: number } }>; all: () => Promise<{ results: Row[] }>; first: () => Promise<Row | null> }
const central = () => { // the central database stand-in; the collector creates its own tables
  const raw = new Database(":memory:")
  const stmt = (sql: string, vals: Bind = []): Stmt => ({
    bind: (...v: Bind) => stmt(sql, v),
    run: async () => ({ meta: { changes: raw.query(sql).run(...vals).changes } }),
    all: async () => ({ results: raw.query(sql).all(...vals) as Row[] }),
    first: async () => (raw.query(sql).get(...vals) as Row | null) ?? null,
  })
  return { raw, db: { prepare: (s: string) => stmt(s), batch: async (xs: Stmt[]) => Promise.all(xs.map((x) => x.run())) } }
}
const first = { sid: SID, vid: VID, p: "/about/", d: "mobile", l: "en-IN", r: "www.google.com", u: { s: "", m: "", c: "" }, e: [{ k: "pv", p: "/about/" }, { k: "sec", p: "/about/", n: "how-it-works", ms: 4200 }, { k: "cta", p: "/about/", n: "/pricing" }, { k: "choice", p: "/about/", n: "plan", v: "monthly" }, { k: "exit", p: "/about/", n: "pricing", ms: 30000, sc: 80 }] }
const relayReq = (o: unknown, h: Record<string, string> = {}) => new Request("https://veridian-aios.com/api/visit", { method: "POST", headers: { "content-type": "application/json", origin: "https://veridian-aios.com", "cf-connecting-ip": IP, "user-agent": UA, ...h }, body: typeof o === "string" ? o : JSON.stringify(o) })
type Sent = { url: string; init: RequestInit & { headers: Record<string, string> } }
const fake = () => { const sent: Sent[] = []; return { sent, f: async (url: string, init?: RequestInit) => { sent.push({ url, init: init as Sent["init"] }); return new Response(null, { status: 204 }) } } }
let cen: ReturnType<typeof central>
const cq = (sql: string, ...a: Bind): Row[] => { try { return cen.raw.query(sql).all(...a) as Row[] } catch { return [] } }
beforeEach(() => { cen = central(); resetRate() })
const env = () => ({ VISIT_PROXY_KEY: "secret-secret-secret", ANALYTICS: cen.db as unknown as Analytics, ANALYTICS_KEY: "k-test" })

describe("the translation to the central format", () => {
  test("a first message: visitor code to 32 hex, landing page / referrer / campaign tags only here, events mapped (cta and choice become named actions)", () => {
    const c = JSON.parse(toCentral(JSON.stringify(first))!) as { d: string; e: unknown[] }
    expect(c).toMatchObject({ s: SID, d: VID + "d9d9d9d9", dv: "mobile", l: "en-IN", lp: "/about/", r: "www.google.com", u: { s: "", m: "", c: "" } })
    expect(c.d).toMatch(/^[a-f0-9]{32}$/)
    expect(c.e).toEqual([{ k: "pv", p: "/about/" }, { k: "sec", p: "/about/", n: "how-it-works", m: 4200 }, { k: "act", p: "/about/", n: "go:/pricing" }, { k: "act", p: "/about/", n: "choice:plan", v: "monthly" }, { k: "exit", p: "/about/", n: "pricing", m: 30000, x: 80 }])
  })
  test("a later message carries no landing page, referrer or tags (so it can never overwrite where the visit came from)", () => {
    const c = JSON.parse(toCentral(JSON.stringify({ sid: SID, vid: VID, p: "/pricing/", d: "mobile", e: [{ k: "pv", p: "/pricing/" }] }))!) as Row
    expect(c.lp).toBeUndefined(); expect(c.r).toBeUndefined(); expect(c.u).toBeUndefined()
  })
  test("a privacy-signal ping becomes a counters-only message; garbage, a missing session and unknown event kinds give nothing", () => {
    expect(JSON.parse(toCentral(JSON.stringify({ off: 1, p: "/", d: "tablet" }))!)).toMatchObject({ g: 1, lp: "/", dv: "tablet", e: [{ k: "pv", p: "/" }] })
    expect(toCentral("not json")).toBeNull(); expect(toCentral("[]")).toBeNull(); expect(toCentral(JSON.stringify({ p: "/", e: [] }))).toBeNull(); expect(toCentral(JSON.stringify({ sid: "zz", e: [] }))).toBeNull()
    expect((JSON.parse(toCentral(JSON.stringify({ sid: SID, p: "/", e: [{ k: "keystroke", p: "/", n: "a" }, { k: "pv", p: "/" }] }))!) as { e: unknown[] }).e).toEqual([{ k: "pv", p: "/" }])
  })
})

describe("the relay still does exactly what it did, and also feeds the central database", () => {
  test("the upstream call is unchanged (same address, same body, same headers) and the visit lands centrally under this site, with the shortened address only", async () => {
    const { sent, f } = fake()
    const res = await relayVisit(relayReq(first), env(), CF, f)
    expect(res.status).toBe(204)
    expect(sent.length).toBe(1); expect(sent[0]!.url).toBe(UPSTREAM); expect(sent[0]!.init.body).toBe(JSON.stringify(first))
    expect(sent[0]!.init.headers).toMatchObject({ "x-dpdp-client-ip": IP, "x-dpdp-client-country": "IN", "x-dpdp-client-city": "Pune", "x-dpdp-proxy-key": "secret-secret-secret" })
    expect(cq("SELECT site, vid, ipshort, country, city, network, src, ref_host, landing, device FROM a_session")).toEqual([{ site: "dpdp", vid: VID + "d9d9d9d9", ipshort: "203.0.113.0", country: "IN", city: "Pune", network: "Example Broadband", src: "search", ref_host: "google", landing: "/about", device: "mobile" }])
    expect(cq("SELECT kind, name FROM a_event ORDER BY id").map((e) => `${String(e.kind)}:${String(e.name ?? "")}`)).toEqual(["pv:", "sec:how-it-works", "act:go:/pricing", "act:choice:plan", "exit:pricing"])
    for (const t of ["a_session", "a_event", "a_agg"]) expect(JSON.stringify(cq(`SELECT * FROM ${t}`))).not.toContain(IP)
  })
  test("without the ANALYTICS binding nothing changes and nothing is stored centrally", async () => {
    const { sent, f } = fake()
    const res = await relayVisit(relayReq(first), { VISIT_PROXY_KEY: "secret-secret-secret" }, CF, f)
    expect(res.status).toBe(204); expect(sent.length).toBe(1); expect(cq("SELECT COUNT(*) AS c FROM a_session")).toEqual([])
  })
  test("a central database that is down never changes the answer or stops the upstream call", async () => {
    const { sent, f } = fake()
    const down = { prepare() { throw new Error("D1 down") }, batch: async () => { throw new Error("D1 down") } } as unknown as Analytics
    const res = await relayVisit(relayReq(first), { ...env(), ANALYTICS: down }, CF, f)
    expect(res.status).toBe(204); expect(sent.length).toBe(1)
  })
  test("an upstream that is down still answers 204 and the central copy is still written", async () => {
    const res = await relayVisit(relayReq(first), env(), CF, async () => { throw new Error("down") })
    expect(res.status).toBe(204); expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]!.c).toBe(1)
  })
  test("a request the relay refuses (wrong origin, too big, not POST) is never copied", async () => {
    const { f } = fake()
    await relayVisit(relayReq(first, { origin: "https://evil.example" }), env(), CF, f)
    await relayVisit(relayReq(JSON.stringify({ ...first, pad: "x".repeat(7000) })), env(), CF, f)
    await relayVisit(new Request("https://veridian-aios.com/api/visit", { method: "GET" }), env(), CF, f)
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]?.c ?? 0).toBe(0)
  })
  test("the signed-in and private areas are never stored, even if a page sent them; a later message of the visit joins it and keeps where it came from", async () => {
    const { f } = fake()
    await relayVisit(relayReq({ sid: "cd".repeat(8), vid: VID, p: "/app/home/", d: "desktop", e: [{ k: "pv", p: "/app/home/" }, { k: "pv", p: "/unsubscribe/" }] }), env(), CF, f)
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]?.c ?? 0).toBe(0)
    await relayVisit(relayReq(first), env(), CF, f)
    await relayVisit(relayReq({ sid: SID, vid: VID, p: "/pricing/", d: "mobile", e: [{ k: "pv", p: "/pricing/" }] }), env(), CF, f)
    expect(cq("SELECT COUNT(*) AS c, SUM(pages) AS pages FROM a_session")).toEqual([{ c: 1, pages: 2 }])
    expect(cq("SELECT src, landing FROM a_session")).toEqual([{ src: "search", landing: "/about" }])
  })
  test("Global Privacy Control: only anonymous counters reach the central database, never a session or an address", async () => {
    const { f } = fake()
    await relayVisit(relayReq({ off: 1, p: "/", d: "mobile" }, { "sec-gpc": "1" }), env(), CF, f)
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]!.c).toBe(0)
    expect(cq("SELECT dim FROM a_agg WHERE dim LIKE 'gpc_%'").length).toBeGreaterThan(0)
  })
  test("mirrorVisit alone: no binding is a quiet no-op, and an unusable body gives nothing", async () => {
    await mirrorVisit(relayReq(first), {}, CF, JSON.stringify(first), T)
    await mirrorVisit(relayReq(first), env(), CF, "garbage", T)
    expect(cq("SELECT COUNT(*) AS c FROM a_session")[0]?.c ?? 0).toBe(0)
  })
})

describe("the collector copy", () => {
  test("the sidecar equals the file; the copy names no private-brand site; the central database is bound with its real id", () => {
    const side = JSON.parse(read("functions/_analytics/SOURCE.json")), sha = createHash("sha256").update(read("functions/_analytics/core.ts").split("\r").join("")).digest("hex")
    expect(side.files).toEqual({ "functions/_analytics/core.ts": sha }); expect(side.privateSitesLeftOut).toBe(true)
    expect(read("functions/_analytics/core.ts")).not.toMatch(LEFT_OUT); expect(read("functions/_analytics/core.ts")).toMatch(/key: "dpdp"[^\n]*veridian-aios\.com/)
    const toml = read("wrangler.toml"); expect(toml).toMatch(/^binding = "ANALYTICS"\r?\ndatabase_name = "site-analytics"\r?\ndatabase_id = "056cf051-6cf9-4e9e-b8f8-bc5fdfd3c817"\r?$/m); expect(toml).toMatch(/^binding = "DB"\r?$/m)
  })
})

describe("the privacy notice", () => {
  test("carries the agreed storage and Global Privacy Control sentences and says what the visit counter keeps", () => {
    const p = read("public/privacy/index.html")
    expect(p).toContain("No advertising cookies and no third-party trackers are used.")
    expect(p).toContain("Navigation data is collected to improve this site. A Global Privacy Control signal from the browser is respected: no navigation data is collected.")
    expect(p).toMatch(/visit counter keeps the pages looked at[^<;]*for up to one year[^<;]*never a name, a mobile number or an e-mail address/)
    expect(p).not.toMatch(LEFT_OUT)
  })
})
