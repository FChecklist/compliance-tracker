// WO-DPDP-012 §7 on the app's own host: the AI link's human-readable page.
// Supabase serves Edge Function HTML on *.supabase.co as text/plain with a
// sandboxing CSP (verified live 2026-09-22), so the page a person opens --
// and the one an AI fetches -- is served from app.veridian-aios.com/ai/
// <token> by a Cloudflare Pages Function (functions/ai/[token].ts,
// functions/ai/[token]/draft.ts) that proxies the Edge Function and sets
// the correct content-type and the private-page headers itself (Pages'
// _headers file applies to static assets only).
//
// This module is PURE -- no Cloudflare globals, only the WHATWG Request /
// Response / fetch types -- so src/lib/ai-proxy.test.ts can exercise every
// decision under `bun test` with a fake fetch. The route files are thin.

export const UPSTREAM = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-ai-link"

/** The token shape dpdp_create_ai_link mints (64 hex chars) with room for other opaque encodings; anything else is a 404, never forwarded. */
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
export const JSON_TYPE = "application/json; charset=utf-8"

export type ParsedToken = { token: string; markdown: boolean }

/** `<token>` or `<token>.md` from the path segment; null when the token is not a token. */
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

function withPrivateHeaders(contentType: string, extra?: Record<string, string>): Headers {
  const h = new Headers(PRIVATE_HEADERS)
  h.set("Content-Type", contentType)
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v)
  return h
}

export function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: withPrivateHeaders("text/plain; charset=utf-8") })
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: withPrivateHeaders("text/plain; charset=utf-8", { Allow: allow }) })
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * GET /ai/<token> or /ai/<token>.md: fetch the Edge Function server-side
 * (Accept passed through), return its body and status with the CORRECT
 * content-type -- text/html or text/markdown, both utf-8 -- and the
 * private headers. An upstream error body (its 404 sentence, a JSON error)
 * keeps its own text/plain or JSON type so nothing is mislabelled as HTML.
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
  const contentType = upstream.ok ? contentTypeFor(markdown) : /json/i.test(upstreamType) ? JSON_TYPE : "text/plain; charset=utf-8"
  return new Response(body, { status: upstream.status, headers: withPrivateHeaders(contentType) })
}

/** The largest draft body the Edge Function accepts (its own 413 limit). */
export const MAX_DRAFT_BYTES = 8 * 1024

/**
 * POST /ai/<token>/draft: the JSON body goes through untouched, the JSON
 * answer comes back untouched (status included -- 201 on a draft, 400 with
 * the RPC's own plain-English refusal, 404 for a bad token), with the
 * private headers. A body over the Edge Function's own limit is refused
 * here rather than forwarded.
 */
export async function proxyDraft(request: Request, param: string | null | undefined, fetchImpl: FetchLike = fetch): Promise<Response> {
  const parsed = parseTokenParam(param)
  if (!parsed || parsed.markdown) return notFound()
  const body = await request.text()
  if (new TextEncoder().encode(body).length > MAX_DRAFT_BYTES) {
    return new Response(JSON.stringify({ error: "Body too large (8 KB at most)" }), { status: 413, headers: withPrivateHeaders(JSON_TYPE) })
  }
  const upstream = await fetchImpl(upstreamUrl(parsed.token, false, true), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  })
  const text = await upstream.text()
  const upstreamType = upstream.headers.get("content-type") ?? ""
  const contentType = /json/i.test(upstreamType) || upstream.ok ? JSON_TYPE : "text/plain; charset=utf-8"
  return new Response(text, { status: upstream.status, headers: withPrivateHeaders(contentType) })
}
