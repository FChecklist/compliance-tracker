// Copies each visit beacon the relay accepts into the ONE central visitor database (owner spec 2026-11-03: one private dashboard for every site). The site's own journey tracker (public/visit.js
// -> /api/visit -> the dpdp-track Edge Function) is NOT changed and there is no second script: this runs inside the relay, after the beacon passed its method / origin / size checks.
//
// The beacon is translated to the central format first (different field names, 24-hex visitor codes, "cta"/"choice" events); nothing the browser did not already send is added, and the
// address, country, city and network come from what Cloudflare saw on THIS request, never from the body. The central collector (../_analytics/core.ts, a copy of site-analytics/src/core.ts)
// keeps the shortened address and a keyed hash only, honours Global Privacy Control / Do Not Track (counters only), and refuses every path under /app /act /unsubscribe /p /copy /ai /api.
// Without the ANALYTICS binding this does nothing; it never throws and never waits more than 1.5 seconds. PURE, so src/lib/visit-mirror.test.ts can drive it under `bun test`.
import { mirrorBeacon, type AEnv } from "../_analytics/core"

export type MirrorEnv = Partial<Pick<AEnv, "ANALYTICS" | "ANALYTICS_KEY">>
type Cf = { city?: string; country?: string; asn?: number | string; asOrganization?: string }

const HEX = /^[a-f0-9]{16,64}$/
const KINDS = ["mobile", "tablet", "desktop"]
/** The site's visitor code is 24 hex digits; the central format wants 32. A fixed tail keeps one visitor = one code. */
const canon32 = (v: unknown): string => (typeof v === "string" && HEX.test(v) ? (v + "d9".repeat(16)).slice(0, 32) : "")
const slug24 = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

type Ev = { k: string; p?: string; n?: string; v?: string; ms?: number; sc?: number }

/** The site's beacon text as the central format, or null when it is not one this mirror can use. */
export function toCentral(body: string): string | null {
  let j: Record<string, unknown> | null
  try { j = JSON.parse(body) as Record<string, unknown> } catch { return null }
  if (!j || typeof j !== "object") return null
  const dv = KINDS.includes(String(j.d)) ? String(j.d) : ""
  if (j.off === 1) return JSON.stringify({ s: "00".repeat(16), g: 1, lp: j.p, dv, e: [{ k: "pv", p: j.p }] }) // a privacy-signal ping: counters only, nothing identifies it
  const sid = typeof j.sid === "string" && HEX.test(j.sid) ? j.sid.slice(0, 32) : ""
  if (!sid) return null
  const e: Record<string, unknown>[] = []
  for (const x of (Array.isArray(j.e) ? (j.e as Ev[]) : []).slice(0, 25)) {
    if (!x || typeof x !== "object" || typeof x.p !== "string") continue
    if (x.k === "pv") e.push({ k: "pv", p: x.p })
    else if (x.k === "sec") e.push({ k: "sec", p: x.p, n: slug24(x.n), m: num(x.ms) })
    else if (x.k === "cta" && typeof x.n === "string") e.push({ k: "act", p: x.p, n: (x.n.startsWith("/") ? "go:" + x.n : x.n).slice(0, 40) })
    else if (x.k === "choice" && typeof x.n === "string") e.push({ k: "act", p: x.p, n: ("choice:" + x.n).slice(0, 40), v: String(x.v ?? "").slice(0, 40) })
    else if (x.k === "exit") e.push({ k: "exit", p: x.p, n: slug24(x.n), m: num(x.ms), x: num(x.sc) })
  }
  const out: Record<string, unknown> = { s: sid, d: canon32(j.vid), dv, l: j.l, e }
  // Only the first message of a visit carries where it came from (the site sends the campaign tags then): that is also the landing page.
  if (j.u && typeof j.u === "object") {
    const u = j.u as Record<string, unknown>
    out.lp = j.p; out.u = { s: u.s, m: u.m, c: u.c }
    if (j.r) out.r = j.r
  }
  return JSON.stringify(out)
}

/** Fire-and-forget from the relay's point of view: no binding = nothing; any failure = nothing; at most 1.5 s. */
export async function mirrorVisit(request: Request, env: MirrorEnv, cf: Cf | undefined, body: string, now: number = Date.now()): Promise<void> {
  if (!env.ANALYTICS) return
  try {
    const text = toCentral(body)
    if (!text) return
    const where = (request as unknown as { cf?: Cf }).cf ?? cf
    // The Workers runtime keeps `cf` read-only on a Request: it can only be given in the constructor's init (assigning it throws, and the catch below would hide that: nothing would ever be stored,
    // which is what the first live release did, 3 Nov 2026). A runtime that ignores the init option (the unit tests) gets it as an own property instead.
    const req = new Request(request.url, { method: "POST", headers: request.headers, cf: where } as RequestInit)
    if (where && !(req as unknown as { cf?: Cf }).cf) { try { Object.defineProperty(req, "cf", { value: where }) } catch { /* the runtime carries it already */ } }
    await mirrorBeacon(env as AEnv, req, text, now)
  } catch { /* the visit journey never waits for the central database */ }
}
