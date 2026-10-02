/// <reference types="bun-types" />
// 2026-10-02: the first-party monitoring endpoint (functions/api/_telemetry.ts) and its browser script
// (public/rum.js). The privacy promises are the point, so each is pinned by a test that would fail if it
// broke: no query string or fragment is ever stored, a private path is never stored, no IP-shaped column
// exists, a foreign origin is ignored, the report needs the key, the daily budget holds. The D1 database
// is a real SQL engine here (bun:sqlite behind a D1-shaped adapter), so the SQL itself is exercised.
import { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ALLOWED_ORIGIN_RE,
  DAILY_ROW_CAP,
  MAX_EVENTS,
  PRIVATE_PREFIXES,
  cleanPath,
  handleTelemetry,
  report,
  resetSchemaCache,
  safeEqual,
  scrub,
  toRow,
  type D1Like,
  type D1Statement,
} from "../../functions/api/_telemetry"
import { PRIVATE_PAGES } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const NOW = Date.UTC(2026, 9, 2, 10, 0, 0)

function fakeD1(): D1Like & { sql: Database } {
  const sql = new Database(":memory:")
  const make = (text: string, args: unknown[] = []): D1Statement => ({
    bind: (...v: unknown[]) => make(text, v),
    first: async <T,>() => (sql.query(text).get(...(args as never[])) as T | null) ?? null,
    all: async <T,>() => ({ results: sql.query(text).all(...(args as never[])) as T[] }),
    run: async () => sql.query(text).run(...(args as never[])),
  })
  return { sql, prepare: (t: string) => make(t), batch: async (stmts: D1Statement[]) => { for (const s of stmts) await s.run() } }
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://veridian-aios.com/api/telemetry", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })
const rows = (d: ReturnType<typeof fakeD1>) => {
  const has = d.sql.query("SELECT name FROM sqlite_master WHERE name = 'telemetry'").get()
  return has ? (d.sql.query("SELECT * FROM telemetry").all() as Array<Record<string, unknown>>) : []
}

let db: ReturnType<typeof fakeD1>
beforeEach(() => {
  db = fakeD1()
  resetSchemaCache()
})

describe("what is never recorded", () => {
  test("the private prefixes here are exactly the site's private prefixes (public-surface.mjs), plus nothing else", () => {
    expect([...PRIVATE_PREFIXES].map(String).sort()).toEqual(PRIVATE_PAGES.map((p: { prefix: string }) => p.prefix).sort())
  })

  test("a page view of any private prefix is dropped, even with a path under it", () => {
    for (const prefix of PRIVATE_PREFIXES) {
      expect(cleanPath(prefix), prefix).toBeNull()
      expect(cleanPath(`${prefix}anything`), prefix).toBeNull()
      expect(cleanPath(prefix.slice(0, -1)), prefix).toBeNull()
      expect(toRow({ k: "pv", p: `${prefix}x`, d: "|desktop" }), prefix).toBeNull()
    }
    // ...but a public page that merely starts with the same letters is kept.
    expect(cleanPath("/partner/")).toBe("/partner/")
    expect(cleanPath("/ai-assistant/")).toBe("/ai-assistant/")
    expect(cleanPath("/api-docs/")).toBe("/api-docs/")
  })

  test("a query string or fragment never survives, in the path or in any text field", () => {
    expect(cleanPath("/dpdp-firm/?ref=ABCD1234")).toBe("/dpdp-firm/")
    expect(cleanPath("/about/#token=secret")).toBe("/about/")
    expect(scrub("Boom @/assets/x.js?ref=SECRETCODE:3 more", 200)).not.toContain("SECRETCODE")
    expect(scrub("see /p/?token=abc#frag", 200)).toBe("see /p/")
    const row = toRow({ k: "err", p: "/about/?ref=ZZZZ1111", n: "js?x=1", d: "Uncaught @/assets/a.js?ref=ZZZZ1111:9" })!
    expect(JSON.stringify(row)).not.toContain("ZZZZ1111")
    expect(JSON.stringify(row)).not.toContain("?")
  })

  test("a token-looking run (a link token, an id) is replaced rather than stored", () => {
    const token = "a".repeat(64)
    expect(scrub(`opened /ai/${token}/jobs`, 200)).not.toContain(token)
    expect(cleanPath(`/x/${token}/`)).not.toContain(token)
  })

  test("the table has no column that could hold an IP address, a user agent or a query string", async () => {
    await handleTelemetry(post({ e: [{ k: "pv", p: "/", d: "|desktop" }] }), { DB: db }, NOW, "IN")
    const cols = (db.sql.query("PRAGMA table_info(telemetry)").all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols.sort()).toEqual(["country", "detail", "device", "id", "kind", "name", "path", "ts", "value"])
  })

  test("POST stores the public events and silently drops the private and malformed ones", async () => {
    const res = await handleTelemetry(
      post({
        e: [
          { k: "pv", p: "/dpdp-firm/?ref=ABCD1234", d: "www.google.com|mobile" },
          { k: "pv", p: "/app/", d: "|desktop" },
          { k: "pv", p: "/ai/" + "b".repeat(64) + "/jobs", d: "|desktop" },
          { k: "err", p: "/about/", n: "js", d: "TypeError: x is undefined @/assets/index-AbC123.js:4" },
          { k: "vital", p: "/", n: "LCP", v: 1234.5 },
          { k: "bogus", p: "/", n: "x" },
          { k: "vital", p: "/", n: "CLS", v: "not a number" },
          "garbage",
          null,
        ],
      }),
      { DB: db },
      NOW,
      "in",
    )
    expect(res.status).toBe(204)
    const got = rows(db)
    expect(got.map((r) => `${r.kind}:${r.path}`)).toEqual(["pv:/dpdp-firm/", "err:/about/", "vital:/", "vital:/"])
    const pv = got[0]!
    expect(pv.detail).toBe("www.google.com")
    expect(pv.device).toBe("mobile")
    expect(pv.country).toBe("IN")
    expect(got[3]!.value).toBeNull()
    expect(JSON.stringify(got)).not.toContain("ABCD1234")
  })

  test("a request from another origin, an oversized body and a body that is not JSON store nothing, and all answer 204", async () => {
    const ok = { e: [{ k: "pv", p: "/", d: "|desktop" }] }
    expect((await handleTelemetry(post(ok, { origin: "https://evil.example" }), { DB: db }, NOW)).status).toBe(204)
    expect((await handleTelemetry(post("{not json"), { DB: db }, NOW)).status).toBe(204)
    expect((await handleTelemetry(post({ e: [{ k: "pv", p: "/", d: "x".repeat(9000) }] }), { DB: db }, NOW)).status).toBe(204)
    expect(rows(db)).toEqual([])
    // The site's own hosts are accepted.
    for (const origin of ["https://veridian-aios.com", "https://www.veridian-aios.com", "https://dpdp.veridian-aios.com", "https://app.veridian-aios.com", "https://veridian-dpdp-app.pages.dev", "https://abc123.veridian-dpdp-app.pages.dev"]) {
      expect(ALLOWED_ORIGIN_RE.test(origin), origin).toBe(true)
    }
    for (const origin of ["https://veridian-aios.com.evil.example", "http://veridian-aios.com", "https://evilveridian-aios.com", "https://x.pages.dev"]) {
      expect(ALLOWED_ORIGIN_RE.test(origin), origin).toBe(false)
    }
    expect((await handleTelemetry(post(ok, { origin: "https://veridian-aios.com" }), { DB: db }, NOW)).status).toBe(204)
    expect(rows(db).length).toBe(1)
  })

  test("a batch is capped, and the daily row budget stops writes without an error", async () => {
    await handleTelemetry(post({ e: Array.from({ length: 100 }, () => ({ k: "pv", p: "/", d: "|desktop" })) }), { DB: db }, NOW)
    expect(rows(db).length).toBe(MAX_EVENTS)
    db.sql.query("UPDATE telemetry_budget SET n = ?").run(DAILY_ROW_CAP)
    const res = await handleTelemetry(post({ e: [{ k: "pv", p: "/about/", d: "|desktop" }] }), { DB: db }, NOW)
    expect(res.status).toBe(204)
    expect(rows(db).length).toBe(MAX_EVENTS)
    // The next UTC day starts a fresh budget.
    await handleTelemetry(post({ e: [{ k: "pv", p: "/about/", d: "|desktop" }] }), { DB: db }, NOW + 86400000)
    expect(rows(db).length).toBe(MAX_EVENTS + 1)
  })

  test("with no database bound, or a failing one, the page still gets its 204", async () => {
    expect((await handleTelemetry(post({ e: [{ k: "pv", p: "/", d: "|desktop" }] }), {}, NOW)).status).toBe(204)
    const broken: D1Like = { prepare: () => { throw new Error("D1 is down") }, batch: async () => { throw new Error("D1 is down") } }
    expect((await handleTelemetry(post({ e: [{ k: "pv", p: "/", d: "|desktop" }] }), { DB: broken }, NOW)).status).toBe(204)
  })

  test("every answer says: do not index, do not cache", async () => {
    for (const res of [await handleTelemetry(post({}), { DB: db }, NOW), await handleTelemetry(new Request("https://veridian-aios.com/api/telemetry"), { DB: db, REPORT_KEY: "k" }, NOW), await handleTelemetry(new Request("https://veridian-aios.com/api/telemetry", { method: "PUT" }), {}, NOW)]) {
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow")
      expect(res.headers.get("cache-control")).toBe("no-store")
    }
  })
})

describe("the report", () => {
  const get = (auth?: string, days = "") => new Request(`https://veridian-aios.com/api/telemetry${days}`, { headers: auth ? { authorization: auth } : {} })

  test("is a 404 without the key, with a wrong key, with no key configured, and for an empty bearer", async () => {
    expect((await handleTelemetry(get(), { DB: db, REPORT_KEY: "sekret" }, NOW)).status).toBe(404)
    expect((await handleTelemetry(get("Bearer nope"), { DB: db, REPORT_KEY: "sekret" }, NOW)).status).toBe(404)
    expect((await handleTelemetry(get("Bearer sekret"), { DB: db }, NOW)).status).toBe(404)
    expect((await handleTelemetry(get("Bearer "), { DB: db, REPORT_KEY: " " }, NOW)).status).toBe(404)
    expect((await handleTelemetry(get("Bearer sekret"), { REPORT_KEY: "sekret" }, NOW)).status).toBe(404)
  })

  test("with the key it is plain text covering traffic, speed, crashes, load failures and API problems", async () => {
    await handleTelemetry(
      post({
        e: [
          { k: "pv", p: "/", d: "www.bing.com|desktop" },
          { k: "pv", p: "/partner/", d: "|mobile" },
          { k: "vital", p: "/", n: "LCP", v: 1800 },
          { k: "vital", p: "/", n: "LCP", v: 5200 },
          { k: "vital", p: "/", n: "TTFB", v: 120 },
          { k: "vital", p: "/", n: "CLS", v: 0.02 },
          { k: "err", p: "/", n: "js", d: "ReferenceError: foo @/assets/a.js:1" },
          { k: "res", p: "/", n: "load-failed", d: "/fonts/missing.woff2" },
          { k: "api", p: "/", n: "/api/x", v: 9000, d: "slow" },
        ],
      }),
      { DB: db },
      NOW,
      "IN",
    )
    const res = await handleTelemetry(get("Bearer sekret", "?days=7"), { DB: db, REPORT_KEY: "sekret\n" }, NOW + 1000)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/plain")
    const text = await res.text()
    for (const heading of ["PAGE VIEWS PER DAY", "TOP PAGES", "WHERE VISITORS COME FROM", "COUNTRIES", "DEVICES", "SPEED, ALL PAGES", "SPEED BY PAGE", "JAVASCRIPT ERRORS (crash reports)", "FILES THAT FAILED TO LOAD", "API PROBLEMS", "PROBLEMS PER DAY", "DATA HEALTH"]) {
      expect(text, heading).toContain(heading)
    }
    expect(text).toContain("www.bing.com")
    expect(text).toContain("ReferenceError: foo")
    expect(text).toContain("/fonts/missing.woff2")
    expect(text).toContain("slow")
    // Two LCP samples (1800, 5200): the 75th percentile is the higher one, which is POOR (> 4 s).
    expect(text).toMatch(/LCP\s+5200 ms .*POOR/)
    expect(text).toMatch(/CLS\s+0\.020 .*GOOD/)
  })

  test("an empty database reports 'none yet' instead of failing, and days is clamped", async () => {
    await handleTelemetry(post({ e: [{ k: "pv", p: "/", d: "|desktop" }] }), { DB: db }, NOW - 40 * 86400000)
    const text = await report(db, 7, NOW)
    expect(text).toContain("none yet")
    const huge = await handleTelemetry(get("Bearer k", "?days=99999"), { DB: db, REPORT_KEY: "k" }, NOW)
    expect(await huge.text()).toContain("last 90 day(s)")
  })

  test("safeEqual compares whole strings", () => {
    expect(safeEqual("Bearer a", "Bearer a")).toBe(true)
    expect(safeEqual("Bearer a", "Bearer b")).toBe(false)
    expect(safeEqual("Bearer a", "Bearer ab")).toBe(false)
  })
})

describe("the binder", () => {
  test("functions/api/telemetry.ts exports onRequest and passes the edge country, nothing else about the visitor", () => {
    const src = readFileSync(join(root, "functions", "api", "telemetry.ts"), "utf8")
    expect(src).toContain("export const onRequest")
    expect(src).toContain("cf?.country")
    expect(src).not.toMatch(/CF-Connecting-IP|x-forwarded-for|user-agent/i)
    const logic = readFileSync(join(root, "functions", "api", "_telemetry.ts"), "utf8")
    expect(logic).not.toMatch(/CF-Connecting-IP|x-forwarded-for|user-agent/i)
  })

  test("wrangler.toml binds the D1 database as DB, and the schema file matches the code's tables", () => {
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8")
    expect(toml).toMatch(/\[\[d1_databases\]\]\s+binding = "DB"\s+database_name = "dpdp-telemetry"\s+database_id = "[0-9a-f-]{36}"/)
    const schema = readFileSync(join(root, "data", "telemetry.sql"), "utf8")
    for (const t of ["telemetry", "telemetry_budget"]) expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${t} `)
    const statements = schema.split("\n").filter((l) => !l.startsWith("--")).join("\n")
    expect(statements).not.toMatch(/\b(ip|ip_address|user_agent|query_string|cookie)\b/i)
  })
})
