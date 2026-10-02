// First-party, free, privacy-safe monitoring for veridian-aios.com (2026-10-02).
//
//   POST /api/telemetry   small batches from the public pages' own /rum.js: page
//                         views, Core Web Vitals, JavaScript errors, files that
//                         failed to load, failed or slow same-origin API calls.
//   GET  /api/telemetry?days=7   with  Authorization: Bearer <REPORT_KEY>
//                         a plain-text report (traffic, speed, crashes, load
//                         failures, API problems). Without the key: a 404.
//
// What it will NOT do, and the tests pin each one (src/lib/telemetry.test.ts):
//   * store an IP address (the row has no such column; only the two-letter
//     country Cloudflare derives at the edge is kept);
//   * store a query string or fragment, anywhere -- the site has ?ref= partner
//     codes and private /app/ /act/ /p/ /unsubscribe/ /copy/ /ai/ links that
//     carry tokens. Everything after a "?" or "#" is cut from every text field,
//     any long token-looking run is replaced, and an event for a private path
//     is dropped here even if a script were ever to send one;
//   * set a cookie, or answer cross-origin posts.
// Storage is one Cloudflare D1 table (free plan), kept 90 days, with a daily
// row budget so a bot flood cannot use up the free write quota.
//
// This module is PURE (no Cloudflare globals) so `bun test` can drive it with a
// bun:sqlite-backed D1 stand-in. functions/api/telemetry.ts is the thin binder.

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export interface D1Like {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown>
}
export interface Env {
  DB?: D1Like
  REPORT_KEY?: string
}

/** The prefixes that are never measured (src/lib/public-surface.mjs PRIVATE_PAGES, plus this endpoint). src/lib/telemetry.test.ts keeps the two lists equal. */
export const PRIVATE_PREFIXES = ["/app/", "/act/", "/unsubscribe/", "/p/", "/copy/", "/ai/", "/api/"] as const
export const KINDS = ["pv", "vital", "err", "api", "res"] as const
export const DEVICES = ["mobile", "tablet", "desktop"] as const
/** Rows accepted per UTC day. D1's free plan allows 100,000 row writes a day; one page view is about 7 rows. */
export const DAILY_ROW_CAP = 20000
export const MAX_EVENTS = 30
export const MAX_BODY_BYTES = 8192
export const RETENTION_DAYS = 90
/** Hosts the beacon may come from. A request that names any other Origin is dropped silently. */
export const ALLOWED_ORIGIN_RE = /^https:\/\/(?:(?:www|dpdp|app)\.)?veridian-aios\.com$|^https:\/\/(?:[a-z0-9-]+\.)?veridian-dpdp-app\.pages\.dev$/

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n)

/** Everything from the first "?" or "#" on is dropped, then any run of 24+ token characters (a link token, an id) is replaced. */
export function scrub(s: unknown, n: number): string {
  return clip(s, n * 2)
    .replace(/[?#]\S*/g, "")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, n)
}

/** A page path as stored: pathname only, "/index.html" folded away, never a private prefix. Returns null to drop the event. */
export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string") return null
  let path = p.split("?")[0]!.split("#")[0]!.slice(0, 120)
  if (!path.startsWith("/") || path.startsWith("//")) return null
  path = path.replace(/\/index\.html$/, "/")
  if (PRIVATE_PREFIXES.some((x) => path === x.slice(0, -1) || path.startsWith(x))) return null
  return path.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
}

const NO_STORE: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}
const noContent = () => new Response(null, { status: 204, headers: NO_STORE })

let ready: D1Like | null = null
export async function ensureSchema(db: D1Like): Promise<void> {
  if (ready === db) return
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS telemetry (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, value REAL, detail TEXT, device TEXT, country TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry (ts, kind)"),
    db.prepare("CREATE TABLE IF NOT EXISTS telemetry_budget (day TEXT PRIMARY KEY, n INTEGER NOT NULL)"),
  ])
  ready = db
}
/** Test hook: forget which database was prepared. */
export function resetSchemaCache(): void {
  ready = null
}

type RawEvent = { k?: unknown; p?: unknown; n?: unknown; v?: unknown; d?: unknown }

export interface Row {
  kind: string
  path: string
  name: string
  value: number | null
  detail: string
  device: string
}

/** One beacon event to one stored row, or null if it is not storable. Pure. */
export function toRow(x: RawEvent): Row | null {
  if (!x || typeof x !== "object") return null
  const kind = String(x.k)
  if (!(KINDS as readonly string[]).includes(kind)) return null
  const path = cleanPath(x.p)
  if (path === null) return null
  let detail = scrub(x.d, 200)
  let device = ""
  if (kind === "pv") {
    // /rum.js sends the page view's detail as "<referrer host>|<device>".
    const [ref = "", dev = ""] = String(x.d ?? "").split("|")
    detail = scrub(ref, 80)
    device = (DEVICES as readonly string[]).includes(dev) ? dev : ""
  }
  const v = typeof x.v === "number" && Number.isFinite(x.v) ? x.v : null
  return { kind, path, name: scrub(x.n, 80), value: v, detail, device }
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export async function handleTelemetry(request: Request, env: Env, now: number = Date.now(), country = ""): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === "POST") {
    const origin = request.headers.get("origin")
    if (origin && !ALLOWED_ORIGIN_RE.test(origin)) return noContent()
    const declared = Number(request.headers.get("content-length") ?? 0)
    if (declared > MAX_BODY_BYTES) return noContent()
    let body: { e?: unknown }
    try {
      const text = await request.text()
      if (text.length > MAX_BODY_BYTES) return noContent()
      body = JSON.parse(text)
    } catch {
      return noContent()
    }
    const events = Array.isArray(body?.e) ? (body.e as RawEvent[]).slice(0, MAX_EVENTS) : []
    const rows = events.map(toRow).filter((r): r is Row => r !== null)
    if (!rows.length || !env.DB) return noContent()
    const db = env.DB
    try {
      await ensureSchema(db)
      const today = day(now)
      const used = (await db.prepare("SELECT n FROM telemetry_budget WHERE day = ?").bind(today).first<{ n: number }>())?.n ?? 0
      if (used >= DAILY_ROW_CAP) return noContent()
      const cc = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : ""
      const stmts = rows.map((r) =>
        db.prepare("INSERT INTO telemetry (ts,kind,path,name,value,detail,device,country) VALUES (?,?,?,?,?,?,?,?)").bind(now, r.kind, r.path, r.name, r.value, r.detail, r.device, cc),
      )
      stmts.push(db.prepare("INSERT INTO telemetry_budget (day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n").bind(today, rows.length))
      await db.batch(stmts)
      if (Math.random() < 0.01) {
        await db.batch([
          db.prepare("DELETE FROM telemetry WHERE ts < ?").bind(now - RETENTION_DAYS * 86400000),
          db.prepare("DELETE FROM telemetry_budget WHERE day < ?").bind(day(now - 14 * 86400000)),
        ])
      }
    } catch {
      /* monitoring must never break a page */
    }
    return noContent()
  }

  if (request.method === "GET") {
    const key = (env.REPORT_KEY ?? "").trim()
    const given = request.headers.get("authorization") ?? ""
    if (!key || !env.DB || !safeEqual(given, `Bearer ${key}`)) return new Response("Not found", { status: 404, headers: NO_STORE })
    await ensureSchema(env.DB)
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7))
    return new Response(await report(env.DB, days, now), { headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } })
  }
  return new Response("Method not allowed", { status: 405, headers: { ...NO_STORE, Allow: "GET, POST" } })
}

/** Constant-time string comparison (the report key). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const pct = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}
/** [good, poor] limits, from web.dev: LCP 2.5 s / 4 s, INP 200 / 500 ms, CLS 0.1 / 0.25, FCP 1.8 / 3 s, TTFB 0.8 / 1.8 s. */
export const LIMITS: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] }
const fmt = (name: string, v: number) => (name === "CLS" ? v.toFixed(3) : `${Math.round(v)} ms`)
const verdict = (name: string, v: number) => {
  const g = LIMITS[name]
  return g ? (v <= g[0] ? "GOOD" : v <= g[1] ? "NEEDS WORK" : "POOR") : ""
}

export async function report(db: D1Like, days: number, now: number = Date.now()): Promise<string> {
  const since = now - days * 86400000
  const all = async <T = Record<string, unknown>>(sql: string, ...extra: unknown[]) => (await db.prepare(sql).bind(since, ...extra).all<T>()).results
  const L: string[] = [`Monitoring report for veridian-aios.com, last ${days} day(s), generated ${new Date(now).toISOString()}`, ""]

  const pv = await all<{ d: string; c: number }>("SELECT date(ts/1000,'unixepoch') d, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY d ORDER BY d")
  L.push("PAGE VIEWS PER DAY", ...(pv.length ? pv.map((r) => `  ${r.d}  ${r.c}`) : ["  none yet"]), "")
  const top = await all<{ path: string; c: number }>("SELECT path, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY path ORDER BY c DESC LIMIT 15")
  L.push("TOP PAGES", ...top.map((r) => `  ${r.c}  ${r.path}`), "")
  const refs = await all<{ r: string; c: number }>("SELECT COALESCE(NULLIF(detail,''),'(direct or same site)') r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC LIMIT 15")
  L.push("WHERE VISITORS COME FROM (referrer site name only)", ...refs.map((r) => `  ${r.c}  ${r.r}`), "")
  const countries = await all<{ r: string; c: number }>("SELECT COALESCE(NULLIF(country,''),'?') r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC LIMIT 10")
  L.push("COUNTRIES", ...countries.map((r) => `  ${r.c}  ${r.r}`), "")
  const devices = await all<{ r: string; c: number }>("SELECT device r, COUNT(*) c FROM telemetry WHERE kind='pv' AND ts>? GROUP BY r ORDER BY c DESC")
  L.push("DEVICES", ...devices.map((r) => `  ${r.c}  ${r.r || "?"}`), "")

  const vit = await all<{ name: string; value: number; path: string }>("SELECT name, value, path FROM telemetry WHERE kind='vital' AND value IS NOT NULL AND ts>?")
  const by: Record<string, number[]> = {}
  const byPage: Record<string, Record<string, number[]>> = {}
  for (const r of vit) {
    ;(by[r.name] ||= []).push(r.value)
    ;((byPage[r.path] ||= {})[r.name] ||= []).push(r.value)
  }
  L.push("SPEED, ALL PAGES (75th percentile, the figure Google uses; good / poor limits in brackets)")
  for (const k of Object.keys(by)) {
    const v = pct(by[k]!, 0.75)
    const g = LIMITS[k]
    L.push(`  ${k.padEnd(5)} ${fmt(k, v)}  (${by[k]!.length} samples)${g ? `  [${fmt(k, g[0])} / ${fmt(k, g[1])}]  ${verdict(k, v)}` : ""}`)
  }
  if (!Object.keys(by).length) L.push("  none yet")
  L.push("", "SPEED BY PAGE (75th percentile: TTFB = how fast the server answered, LCP = when the main content showed, CLS = layout jump)")
  const pages = Object.keys(byPage).sort()
  for (const p of pages) {
    const cells = ["TTFB", "FCP", "LCP", "CLS", "INP"].filter((k) => byPage[p]![k]).map((k) => `${k} ${fmt(k, pct(byPage[p]![k]!, 0.75))} ${verdict(k, pct(byPage[p]![k]!, 0.75))}`)
    L.push(`  ${p}  ${cells.join("  |  ")}`)
  }
  if (!pages.length) L.push("  none yet")

  const errs = await all<{ path: string; detail: string; c: number }>("SELECT path, detail, COUNT(*) c FROM telemetry WHERE kind='err' AND ts>? GROUP BY path, detail ORDER BY c DESC LIMIT 20")
  L.push("", "JAVASCRIPT ERRORS (crash reports)", ...(errs.length ? errs.map((r) => `  ${r.c}x  ${r.path}  ${r.detail}`) : ["  none"]))
  const res = await all<{ detail: string; name: string; c: number }>("SELECT detail, name, COUNT(*) c FROM telemetry WHERE kind='res' AND ts>? GROUP BY detail, name ORDER BY c DESC LIMIT 15")
  L.push("", "FILES THAT FAILED TO LOAD (broken or blocked links, missing files)", ...(res.length ? res.map((r) => `  ${r.c}x  ${r.name}  ${r.detail}`) : ["  none"]))
  const api = await all<{ name: string; detail: string; c: number; avg_ms: number; max_ms: number }>(
    "SELECT name, detail, COUNT(*) c, ROUND(AVG(value)) avg_ms, ROUND(MAX(value)) max_ms FROM telemetry WHERE kind='api' AND ts>? GROUP BY name, detail ORDER BY c DESC LIMIT 20",
  )
  L.push("", "API PROBLEMS (server errors, timeouts, calls slower than 8 s, network failures)", ...(api.length ? api.map((r) => `  ${r.c}x  ${r.name}  ${r.detail}  avg ${r.avg_ms} ms, max ${r.max_ms} ms`) : ["  none"]))
  const daily = await all<{ d: string; e: number }>("SELECT date(ts/1000,'unixepoch') d, COUNT(*) e FROM telemetry WHERE kind IN ('err','res','api') AND ts>? GROUP BY d ORDER BY d")
  L.push("", "PROBLEMS PER DAY (errors + failed files + API problems)", ...(daily.length ? daily.map((r) => `  ${r.d}  ${r.e}`) : ["  none"]))

  const used = (await db.prepare("SELECT n FROM telemetry_budget WHERE day = ?").bind(day(now)).first<{ n: number }>())?.n ?? 0
  L.push("", `DATA HEALTH  rows accepted today ${used} of ${DAILY_ROW_CAP} allowed; rows are deleted after ${RETENTION_DAYS} days`)
  return L.join("\n") + "\n"
}
