// WO-DPDP-012 §7 / WO-DPDP-013 Part 1 on the app's own host: the AI work
// link at app.veridian-aios.com/ai/<token>[/...]. Supabase serves Edge
// Function HTML on *.supabase.co as text/plain with a sandboxing CSP
// (verified live 2026-09-22), so every path of the link -- the manual a
// person opens, the JSON an AI fetches, the reports -- is served from this
// host by ONE catch-all Cloudflare Pages Function (functions/ai/
// [[path]].ts) that forwards sub-path, method, query string and body to the
// Edge Function UNCHANGED and sets the correct content-type and the
// private-page headers itself (Pages' _headers file applies to static
// assets only). The token stays in the path segment exactly as before:
// the person pastes https://app.veridian-aios.com/ai/<token>.
//
// This module is PURE -- no Cloudflare globals, only the WHATWG Request /
// Response / fetch types -- so src/lib/ai-proxy.test.ts can exercise every
// decision under `bun test` with a fake fetch. The route file is thin.

export const UPSTREAM = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-ai-link"

/** The token shape dpdp_ai_link_create mints (64 hex chars) with room for other opaque encodings; anything else is a 404, never forwarded. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/

/** The Edge Function's own one sentence for every bad token -- the same here, so a guessed URL learns nothing from which layer refused it. */
export const NOT_FOUND = "This link has expired or was revoked"

/** WO-012 §2 for a page that is private by construction; the CSP is the Edge Function's own. */
export const PRIVATE_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
}

export const HTML = "text/html; charset=utf-8"
export const MARKDOWN = "text/markdown; charset=utf-8"
export const CSV = "text/csv; charset=utf-8"
export const JSON_TYPE = "application/json; charset=utf-8"
export const TEXT = "text/plain; charset=utf-8"

/** The largest body the Edge Function accepts (its own 413 limit). */
export const MAX_BODY_BYTES = 8 * 1024

/** Sub-path segments are plain names, ids or law codes -- never a second token, never `..`. */
const SEGMENT_RE = /^[^/\\?#]{1,128}$/

export type ParsedToken = { token: string; markdown: boolean }

/** `<token>` or `<token>.md` from the first path segment; null when the token is not a token. */
export function parseTokenParam(param: string | null | undefined): ParsedToken | null {
  if (typeof param !== "string") return null
  let raw: string
  try {
    raw = decodeURIComponent(param)
  } catch {
    return null
  }
  const markdown = raw.endsWith(".md")
  const token = markdown ? raw.slice(0, -3) : raw
  if (!TOKEN_RE.test(token)) return null
  return { token, markdown }
}

export type ParsedPath = { token: string; legacyMarkdown: boolean; rest: string[] }

/** `[[path]]` = [<token>[.md], ...rest]. null when the first segment is not a token, or any later segment is not a plain segment. */
export function parsePath(path: string | string[] | null | undefined): ParsedPath | null {
  const parts = Array.isArray(path) ? path : typeof path === "string" ? path.split("/").filter(Boolean) : []
  if (parts.length === 0) return null
  const first = parseTokenParam(parts[0])
  if (!first) return null
  const rest: string[] = []
  for (const p of parts.slice(1)) {
    let seg: string
    try { seg = decodeURIComponent(p) } catch { return null }
    if (!SEGMENT_RE.test(seg) || seg === "." || seg === "..") return null
    rest.push(seg)
  }
  if (first.markdown && rest.length > 0) return null
  return { token: first.token, legacyMarkdown: first.markdown, rest }
}

/** Markdown when the path says .md or the client asks for it; HTML otherwise. */
export function wantsMarkdown(parsed: ParsedToken, accept: string | null | undefined): boolean {
  return parsed.markdown || /\btext\/markdown\b/i.test(accept ?? "")
}

export function contentTypeFor(markdown: boolean): string {
  return markdown ? MARKDOWN : HTML
}

export function upstreamUrl(token: string, markdown: boolean, draft = false): string {
  if (draft) return `${UPSTREAM}/${token}/draft`
  return `${UPSTREAM}/${token}${markdown ? ".md" : ""}`
}

/** The upstream address for a parsed path plus the query string, unchanged. */
export function upstreamUrlFor(parsed: ParsedPath, search: string): string {
  const path = parsed.legacyMarkdown ? `${parsed.token}.md` : [parsed.token, ...parsed.rest.map(encodeURIComponent)].join("/")
  return `${UPSTREAM}/${path}${search ?? ""}`
}

function withPrivateHeaders(contentType: string, extra?: Record<string, string>): Headers {
  const h = new Headers(PRIVATE_HEADERS)
  h.set("Content-Type", contentType)
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return h
}

export function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: withPrivateHeaders(TEXT) })
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: withPrivateHeaders(TEXT, { Allow: allow }) })
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "accept-language", "user-agent"]
const FORWARDED_RESPONSE_HEADERS = ["allow", "content-disposition"]

/**
 * The content-type the client must see. The Edge Function names the type it
 * meant in `x-dpdp-content-type` (the *.supabase.co gateway rewrites HTML to
 * text/plain); when that header is absent (an older upstream, a gateway
 * error page) fall back to the upstream's own type, never guessing HTML.
 */
export function responseContentType(upstream: Response): string {
  const intended = upstream.headers.get("x-dpdp-content-type")
  if (intended) return intended
  const t = upstream.headers.get("content-type") ?? ""
  if (/json/i.test(t)) return JSON_TYPE
  if (/markdown/i.test(t)) return MARKDOWN
  if (/csv/i.test(t)) return CSV
  if (/html/i.test(t)) return HTML
  return TEXT
}

/**
 * Any method, any sub-path: forward to the Edge Function unchanged
 * (method, query string, JSON body, Accept), return its body and status with
 * the intended content-type and the private headers. A bad token, a bad
 * segment, or a body over the Edge Function's own limit never reaches
 * upstream.
 */
export async function proxyRequest(request: Request, path: string | string[] | null | undefined, fetchImpl: FetchLike = fetch): Promise<Response> {
  const parsed = parsePath(path)
  if (!parsed) return notFound()
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const hasBody = method !== "GET" && method !== "HEAD"
  let body: string | undefined
  if (hasBody) {
    body = await request.text()
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Body too large (8 KB at most)", status: 413 }), { status: 413, headers: withPrivateHeaders(JSON_TYPE) })
    }
  }
  const headers: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const v = request.headers.get(name)
    if (v) headers[name] = v
  }
  if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json"
  const upstream = await fetchImpl(upstreamUrlFor(parsed, url.search), { method: method === "HEAD" ? "GET" : method, headers, ...(hasBody ? { body } : {}) })
  const text = method === "HEAD" ? "" : await upstream.text()
  const extra: Record<string, string> = {}
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name)
    if (v) extra[name] = v
  }
  return new Response(text, { status: upstream.status, headers: withPrivateHeaders(responseContentType(upstream), extra) })
}

/**
 * Pre-WO-013 entry points, kept so the two old route files' callers (and
 * the tests that pinned them) keep working -- both are the general proxy
 * with the old address shape.
 */
export async function proxyGet(request: Request, param: string | null | undefined, fetchImpl: FetchLike = fetch): Promise<Response> {
  const parsed = parseTokenParam(param)
  if (!parsed) return notFound()
  const accept = request.headers.get("accept")
  const markdown = wantsMarkdown(parsed, accept)
  const upstream = await fetchImpl(upstreamUrl(parsed.token, markdown), {
    method: "GET",
    headers: { Accept: markdown ? "text/markdown" : "text/html", ...(accept ? { "X-Original-Accept": accept } : {}) },
  })
  const body = await upstream.text()
  const upstreamType = upstream.headers.get("content-type") ?? ""
  const contentType = upstream.ok ? contentTypeFor(markdown) : /json/i.test(upstreamType) ? JSON_TYPE : TEXT
  return new Response(body, { status: upstream.status, headers: withPrivateHeaders(contentType) })
}

export async function proxyDraft(request: Request, param: string | null | undefined, fetchImpl: FetchLike = fetch): Promise<Response> {
  const parsed = parseTokenParam(param)
  if (!parsed || parsed.markdown) return notFound()
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Body too large (8 KB at most)" }), { status: 413, headers: withPrivateHeaders(JSON_TYPE) })
  }
  const upstream = await fetchImpl(upstreamUrl(parsed.token, false, true), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  })
  const text = await upstream.text()
  const upstreamType = upstream.headers.get("content-type") ?? ""
  const contentType = /json/i.test(upstreamType) || upstream.ok ? JSON_TYPE : TEXT
  return new Response(text, { status: upstream.status, headers: withPrivateHeaders(contentType) })
}
