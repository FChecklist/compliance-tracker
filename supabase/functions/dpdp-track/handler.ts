// DPDP visitor-journey tracking -- the Edge Function's logic (owner spec 2026-10-06). PURE apart from the injected `Deps`
// (src/lib/services/dpdp-track-handler.test.ts drives every route with a fake database and a fake sign-in). index.ts is the thin Deno wrapper.
//
//   POST /                  the beacon from the public pages (dpdp-app/public/visit.js, relayed by the Pages Function /api/visit). Anonymous, tiny JSON, 6 KB cap, origin check,
//                           rate limit per visitor id and per ip hash (in the database). Always 204 on success: the page learns nothing.
//   POST /link              a signed-in browser reports its visitor id; the server links it to the person's identity id (never an e-mail).
//   GET  /report            OWNER ONLY: the summary (?days=30&format=json|md).
//   GET  /journey           OWNER ONLY: one visitor's whole journey from the first visit (?vid=<visitor id> or ?identity=<identity id>).
//
// WHAT IS KEPT OF AN ADDRESS: a shortened form (IPv4 last octet zeroed, IPv6 /48) and an HMAC-SHA256 hash keyed by the secret DPDP_VISIT_KEY (_shared/visit/ip.ts). No key, no hash.
// PRIVACY SIGNAL: a beacon that says "off" (Global Privacy Control / Do Not Track) is only counted (visit_agg), with no row, no address, no visitor id.
// WHO THE VISITOR WAS (country/city/address): taken from the headers the Pages Function adds (x-dpdp-client-*) ONLY when the request proves it came from that function (shared secret
// DPDP_VISIT_PROXY_KEY); otherwise from this request's own gateway headers (cf-ipcountry, x-forwarded-for). A browser can never choose them.
// OWNER READS: same authorisation as the audit trail's staff reads (dpdp.platform_admin, via dpdp_audit_resolve_caller); the access-log row is written FIRST (dpdp_audit_staff_begin,
// organisation "*visits", a reason of at least 10 characters), so a read that cannot be logged is not served.
import { detectBot } from "../_shared/visit/bots.ts"
import { ALLOWED_ORIGIN_RE, validateBeacon } from "../_shared/visit/beacon.ts"
import { type FunnelRow, normaliseRows, reportToMarkdown } from "../_shared/visit/funnel.ts"
import { hashIp, shortenIp } from "../_shared/visit/ip.ts"

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
export type Deps = {
  rpc: Rpc
  verifyJwt: (jwt: string) => Promise<{ email: string; claims: Record<string, unknown> } | null>
  now: () => number
  env: (name: string) => string
}

const NO_STORE: Record<string, string> = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" }
export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE } })
const noContent = (): Response => new Response(null, { status: 204, headers: NO_STORE })
const fail = (status: number, error: string): Response => json({ error }, status)

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** The visitor's address, country, city and user agent as the SERVER saw them. Forwarded values count only with the proxy key. */
export function networkFacts(req: Request, proxyKey: string): { ip: string | null; country: string | null; city: string | null; userAgent: string | null } {
  const h = req.headers
  const presented = h.get("x-dpdp-proxy-key") ?? ""
  const viaProxy = proxyKey.length >= 16 && presented.length > 0 && timingSafeEqual(presented, proxyKey)
  const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null
  const ip = (viaProxy ? h.get("x-dpdp-client-ip") : null) || h.get("cf-connecting-ip") || fwd || null
  const country = ((viaProxy ? h.get("x-dpdp-client-country") : null) || h.get("cf-ipcountry") || "").slice(0, 2).toUpperCase()
  const cityRaw = viaProxy ? (h.get("x-dpdp-client-city") ?? "") : ""
  let city = cityRaw
  try { city = decodeURIComponent(cityRaw) } catch { /* keep raw */ }
  city = city.replace(/[^\p{L}\p{M} .'-]/gu, "").slice(0, 80)
  return { ip, country: /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null, city: city || null, userAgent: h.get("user-agent") }
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  const url = new URL(req.url)
  const path = (url.pathname.replace(/^.*\/dpdp-track(?=\/|$)/, "") || "/").replace(/\/+$/, "") || "/"
  try {
    if (req.method === "POST" && path === "/") return await beacon(req, d)
    if (req.method === "POST" && path === "/link") return await link(req, d)
    if (req.method === "GET" && (path === "/report" || path === "/journey")) return await ownerRead(req, d, url, path)
    return fail(404, "No such route.")
  } catch (e) {
    console.error("dpdp-track: unhandled", e instanceof Error ? e.message : String(e))
    return fail(500, "Something failed on our side.")
  }
}

// ---- the beacon ------------------------------------------------------------------------------------------------------------------------------------------------------

async function beacon(req: Request, d: Deps): Promise<Response> {
  const origin = req.headers.get("origin")
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) return noContent()
  const text = await req.text()
  const v = validateBeacon(text)
  if (!v.ok) return fail(v.status, v.reason)
  const b = v.beacon
  const net = networkFacts(req, d.env("DPDP_VISIT_PROXY_KEY"))
  const bot = detectBot(net.userAgent)
  const limit = Math.max(10, Math.min(600, Number(d.env("DPDP_VISIT_RATE_PER_MIN")) || 60))

  // Enforced HERE as well as in the script: a request that carries the browser's own privacy header is only ever counted, whatever the body says.
  const optedOut = req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1"
  if (b.off || optedOut) {
    // Privacy signal on: a counter only. No visitor id, no session row, no address, no hash.
    await d.rpc("dpdp_visit_count_only", { p: { path: b.path, country: net.country, is_bot: bot.isBot, limit: limit * 5 } })
    return noContent()
  }
  const key = d.env("DPDP_VISIT_KEY")
  const ipHash = await hashIp(net.ip, key)
  const payload = {
    sid: b.sid,
    // A crawler never gets a visitor id stored (it would pollute "returning visitors").
    vid: bot.isBot ? null : b.vid,
    ip_short: shortenIp(net.ip),
    ip_hash: ipHash,
    source_kind: b.source.kind,
    referrer_host: b.source.referrerHost,
    search_engine: b.source.searchEngine,
    utm: { source: b.source.utm.source, medium: b.source.utm.medium, campaign: b.source.utm.campaign, term: b.source.utm.term, content: b.source.utm.content },
    landing_path: b.path,
    device: b.device,
    language: b.language,
    country: net.country,
    city: net.city,
    is_bot: bot.isBot,
    bot_name: bot.name,
    limit,
    events: b.events.map((e) => ({ k: e.k, p: e.p, n: e.n, v: e.v, ms: e.ms, sc: e.sc })),
  }
  const r = await d.rpc("dpdp_visit_ingest", { p: payload })
  if (r.error) {
    console.error("dpdp-track: ingest failed", r.error.code ?? "", r.error.message)
    return noContent()
  }
  const out = r.data as { ok?: boolean; reason?: string } | null
  if (out && out.ok === false && out.reason === "rate") return new Response(null, { status: 429, headers: NO_STORE })
  return noContent()
}

// ---- link a signed-in person to their visitor id ------------------------------------------------------------------------------------------------------------------------

async function bearer(req: Request, d: Deps): Promise<{ email: string; claims: Record<string, unknown> } | null> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  if (!m) return null
  const who = await d.verifyJwt(m[1]!.trim())
  return who && who.email ? who : null
}

async function link(req: Request, d: Deps): Promise<Response> {
  const who = await bearer(req, d)
  if (!who) return fail(401, "Sign in first.")
  let body: Record<string, unknown> = {}
  try { body = JSON.parse((await req.text()) || "{}") } catch { return fail(400, "Body must be JSON.") }
  const vid = typeof body.vid === "string" ? body.vid : ""
  const sub = typeof who.claims.sub === "string" ? who.claims.sub : ""
  if (!/^[a-f0-9]{16,64}$/.test(vid) || !sub) return json({ linked: false })
  const r = await d.rpc("dpdp_visit_link", { p_visitor_id: vid, p_auth_user_id: sub, p_email: who.email })
  if (r.error) return fail(500, "Something failed on our side.")
  return json(r.data ?? { linked: false })
}

// ---- owner-only reads --------------------------------------------------------------------------------------------------------------------------------------------------

async function ownerRead(req: Request, d: Deps, url: URL, path: string): Promise<Response> {
  const who = await bearer(req, d)
  if (!who) return fail(401, "Sign in first.")
  const caller = await d.rpc("dpdp_audit_resolve_caller", { p_email: who.email })
  if (caller.error) return fail(500, "Something failed on our side.")
  if (!(caller.data as { isPlatformOwner?: boolean } | null)?.isPlatformOwner) return fail(403, "This is internal.")

  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30))
  const vid = (url.searchParams.get("vid") ?? "").trim()
  const identity = (url.searchParams.get("identity") ?? "").trim()
  if (path === "/journey" && !/^[a-f0-9]{16,64}$/.test(vid) && !/^[A-Za-z0-9_-]{8,80}$/.test(identity)) return fail(400, "Give ?vid=<visitor id> or ?identity=<identity id>.")
  const reason = (url.searchParams.get("reason") ?? "").trim() || (path === "/report" ? "Owner visitor-journey report (marketing and conversions)" : "Owner visitor-journey lookup (one visitor's path)")
  // The access-log row FIRST: no row, no data.
  const begun = await d.rpc("dpdp_audit_staff_begin", { p_email: who.email, p_org: "*visits", p_scope: path === "/report" ? "visit_report" : "visit_journey", p_reason: reason, p_filters: path === "/report" ? { days } : { vid: vid || null, identity: identity || null } })
  if (begun.error) return fail(begun.error.code === "42501" ? 403 : 400, begun.error.message)
  const logId = String(begun.data)

  if (path === "/report") {
    const rep = await d.rpc("dpdp_visit_report", { p_days: days })
    if (rep.error) return fail(500, "Something failed on our side.")
    const report = (rep.data ?? {}) as Record<string, unknown>
    const rows: FunnelRow[] = normaliseRows(report.funnel_by_source)
    await d.rpc("dpdp_audit_staff_finish", { p_log_id: logId, p_rows: rows.length })
    if ((url.searchParams.get("format") ?? "json") === "md") return new Response(reportToMarkdown(report, rows), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8", ...NO_STORE } })
    return json({ accessLogId: logId, report })
  }
  const j = await d.rpc("dpdp_visit_journey", { p_visitor_id: vid || null, p_identity_id: identity || null })
  if (j.error) return fail(500, "Something failed on our side.")
  const sessions = ((j.data as { sessions?: unknown[] } | null)?.sessions ?? []).length
  await d.rpc("dpdp_audit_staff_finish", { p_log_id: logId, p_rows: sessions })
  return json({ accessLogId: logId, journey: j.data })
}
