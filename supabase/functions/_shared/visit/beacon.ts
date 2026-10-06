// Visitor-journey tracking -- the beacon the public pages send, validated and cut down to what may be stored. PURE.
//
// The browser script (dpdp-app/public/visit.js) is small and is NOT trusted: everything here is checked again. What gets through is only ever:
//   * page paths (no query, no fragment, no private prefix, token-looking runs refused),
//   * section ids, call-to-action names, choice slugs -- short plain slugs from a closed character set (so never an e-mail, a name or typed text: "@" and spaces cannot pass),
//   * numbers (dwell milliseconds, scroll percentage).
// Limits: 6 KB body, 25 events per beacon, every string clipped. An invalid event is dropped, not an error; a malformed beacon is refused.
import { classifySource, cleanHost, type Source } from "./source.ts"

export const MAX_BODY_BYTES = 6144
export const MAX_EVENTS = 25
export const PRIVATE_PREFIXES = ["/app/", "/act/", "/unsubscribe/", "/p/", "/copy/", "/ai/", "/api/"] as const
export const KINDS = ["pv", "sec", "cta", "choice", "exit", "step"] as const
export type Kind = (typeof KINDS)[number]
export const DEVICES = ["mobile", "tablet", "desktop"] as const

export type CleanEvent = { k: Kind; p: string | null; n: string | null; v: string | null; ms: number | null; sc: number | null }
export type CleanBeacon =
  | { off: true; path: string; device: string | null }
  | { off: false; sid: string; vid: string | null; path: string; source: Source; device: string | null; language: string | null; events: CleanEvent[] }

const TOKENISH = /[A-Za-z0-9_-]{24,}/
const SLUG = /^[a-z0-9][a-z0-9_.:/-]{0,59}$/i
const VALUE = /^[a-z0-9][a-z0-9_.+-]{0,39}$/i

/** A page path as stored: pathname only, index.html folded away, no private prefix, no token-looking run. `app:<route>` is the one allowed name for the signed-in app. */
export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string") return null
  if (/^app:[a-z0-9_-]{1,40}$/i.test(p)) return p.toLowerCase()
  const path = p.split("?")[0]!.split("#")[0]!.slice(0, 120).replace(/\/index\.html$/, "/")
  if (!path.startsWith("/") || path.startsWith("//") || !/^\/[A-Za-z0-9_./-]*$/.test(path) || TOKENISH.test(path)) return null
  if (PRIVATE_PREFIXES.some((x) => path === x.slice(0, -1) || path.startsWith(x))) return null
  return path
}

const slug = (v: unknown): string | null => (typeof v === "string" && SLUG.test(v) && !TOKENISH.test(v) ? v.toLowerCase() : null)
const value = (v: unknown): string | null => (typeof v === "string" && VALUE.test(v) && !TOKENISH.test(v) ? v.toLowerCase() : null)
const ctaPath = (v: unknown): string | null => (typeof v === "string" && /^\/[a-z0-9_./-]{0,58}$/i.test(v) && !TOKENISH.test(v) ? v.toLowerCase() : null)
const num = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null)

export function cleanEvent(raw: unknown): CleanEvent | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const k = (KINDS as readonly string[]).includes(e.k as string) ? (e.k as Kind) : null
  if (!k) return null
  const p = cleanPath(e.p)
  switch (k) {
    case "pv":
      return p ? { k, p, n: null, v: null, ms: null, sc: null } : null
    case "sec": {
      const n = slug(e.n)
      return p && n ? { k, p, n, v: null, ms: num(e.ms, 3_600_000), sc: null } : null
    }
    case "cta": {
      const n = slug(e.n) ?? ctaPath(e.n)
      return n ? { k, p, n, v: null, ms: null, sc: null } : null
    }
    case "choice": {
      const n = slug(e.n), v = value(e.v)
      return n && v ? { k, p, n, v, ms: null, sc: null } : null
    }
    case "step": {
      const n = slug(e.n)
      return n ? { k, p, n, v: value(e.v), ms: null, sc: null } : null
    }
    case "exit":
      return p ? { k, p, n: slug(e.n), v: null, ms: num(e.ms, 86_400_000), sc: num(e.sc, 100) } : null
  }
}

export type BeaconResult = { ok: true; beacon: CleanBeacon } | { ok: false; status: 400 | 413; reason: string }

export function validateBeacon(rawText: string): BeaconResult {
  if (new TextEncoder().encode(rawText).length > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "too large" }
  let body: unknown
  try { body = JSON.parse(rawText) } catch { return { ok: false, status: 400, reason: "not json" } }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, reason: "not an object" }
  const b = body as Record<string, unknown>
  const path = cleanPath(b.p)
  if (!path || path.startsWith("app:")) return { ok: false, status: 400, reason: "no page" }
  const device = (DEVICES as readonly string[]).includes(b.d as string) ? (b.d as string) : null
  if (b.off === 1 || b.off === true) return { ok: true, beacon: { off: true, path, device } }
  if (typeof b.sid !== "string" || !/^[a-f0-9]{16,40}$/.test(b.sid)) return { ok: false, status: 400, reason: "bad session id" }
  const vid = typeof b.vid === "string" && /^[a-f0-9]{16,64}$/.test(b.vid) ? b.vid : null
  const u = (b.u && typeof b.u === "object" ? b.u : {}) as Record<string, unknown>
  const source = classifySource({ referrerHost: cleanHost(b.r), utm: { source: u.s, medium: u.m, campaign: u.c, term: u.t, content: u.n } })
  const lang = typeof b.l === "string" && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(b.l) ? b.l.toLowerCase() : null
  const events: CleanEvent[] = []
  if (Array.isArray(b.e)) for (const raw of b.e.slice(0, MAX_EVENTS)) { const c = cleanEvent(raw); if (c) events.push(c) }
  return { ok: true, beacon: { off: false, sid: b.sid, vid, path, source, device, language: lang, events } }
}

/** Origins the beacon may come from (same list the first-party monitoring endpoint uses). A beacon from any other Origin is dropped silently. */
export const ALLOWED_ORIGIN_RE = /^https:\/\/(?:(?:www|dpdp|app)\.)?veridian-aios\.com$|^https:\/\/(?:[a-z0-9-]+\.)?veridian-dpdp-app\.pages\.dev$/
