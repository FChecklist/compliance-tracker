// First-party visit-journey beacon relay (owner spec 2026-10-06): POST /api/visit on the site's own host -> the dpdp-track Edge Function.
//
// Why a relay and not a direct call from the browser: Cloudflare sees the visitor's real address, country and CITY on THIS request (request.cf), the Supabase gateway does not
// give the city. The relay adds those as x-dpdp-client-* headers and proves it did with the shared secret VISIT_PROXY_KEY (a Pages secret; the same value is the Edge Function
// secret DPDP_VISIT_PROXY_KEY), so a browser can never choose them. The relay stores nothing and keeps no cookie. PURE (WHATWG Request/Response/fetch only) so
// src/lib/visit-relay.test.ts can drive it under `bun test`.

export const UPSTREAM = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-track"
export const MAX_BODY_BYTES = 6144
const ALLOWED_ORIGIN_RE = /^https:\/\/(?:(?:www|dpdp|app)\.)?veridian-aios\.com$|^https:\/\/(?:[a-z0-9-]+\.)?veridian-dpdp-app\.pages\.dev$/

export type Env = { VISIT_PROXY_KEY?: string }
type Cf = { city?: string; country?: string; asn?: number | string }
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}
const empty = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { ...HEADERS, ...extra } })

export async function relayVisit(request: Request, env: Env, cf: Cf | undefined, fetchImpl: FetchLike = fetch): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return empty(405, { Allow: "POST" })
  const origin = request.headers.get("origin")
  if (origin && !ALLOWED_ORIGIN_RE.test(origin)) return empty(204)
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return empty(413)

  const h: Record<string, string> = { "content-type": "application/json" }
  for (const name of ["user-agent", "accept-language", "sec-gpc", "dnt"]) {
    const v = request.headers.get(name)
    if (v) h[name] = v
  }
  if (origin) h.origin = origin
  // What Cloudflare saw. Taken from Cloudflare's own headers / request.cf, never from anything the browser put in the body or in x-dpdp-* headers.
  const ip = request.headers.get("cf-connecting-ip")
  if (ip) h["x-dpdp-client-ip"] = ip
  const country = request.headers.get("cf-ipcountry") || cf?.country
  if (country) h["x-dpdp-client-country"] = String(country)
  if (cf?.city) h["x-dpdp-client-city"] = encodeURIComponent(String(cf.city)).slice(0, 120)
  if (env.VISIT_PROXY_KEY) h["x-dpdp-proxy-key"] = env.VISIT_PROXY_KEY
  try {
    const up = await fetchImpl(UPSTREAM, { method: "POST", headers: h, body })
    return empty(up.status === 429 || up.status === 400 || up.status === 413 ? up.status : 204)
  } catch {
    return empty(204)
  }
}
