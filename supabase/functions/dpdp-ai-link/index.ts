// WO-DPDP-012 §7 -- the AI link's non-browser reader, as a Supabase Edge
// Function (Deno). Vercel is not in this path. See README.md alongside.
//
//   GET  /dpdp-ai-link/<token>        -> clean HTML (no scripts, inline CSS)
//   GET  /dpdp-ai-link/<token>.md     -> Markdown (also: Accept: text/markdown)
//   POST /dpdp-ai-link/<token>/draft  -> { draftUrl } for ONE of five verbs
//
// The token IS the credential: an AI tool fetches this with no headers at
// all, so the function is deployed with verify_jwt = false and calls the
// database with the service-role client, which is the only role granted
// public.dpdp_ai_link_read / public.dpdp_draft_action (drizzle/0607). The
// database decides everything -- which rows, whether the link is live,
// whether the verb is allowed, whether the job is in scope; this file only
// renders and maps errors. A bad token of ANY kind gets the same 404 and
// the same sentence, and the lookup is an indexed sha256 match inside the
// database whichever way it fails, so timing and wording leak nothing.
//
// The draft reply puts the confirm token in the URL FRAGMENT
// (`#draft=<id>.<token>`), never in a path or query string, so it never
// reaches any server log -- the dpdp-app reads it client-side (WO-012 §2).
//
// The service-role key never leaves this process: it is an env secret the
// platform injects, used only to construct the client below, and no
// response body or log line ever includes it or the caller's token.
import { createClient } from "npm:@supabase/supabase-js@2"
import { renderHtml, renderMarkdown, type AiLinkView } from "./render.ts"

const FUNCTION_NAME = "dpdp-ai-link"
const LINK_GONE = "This link has expired or was revoked"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// Defaults to the production static-app origin so the function works with
// only the platform-injected env (function secrets cannot be set from the
// PM's machine -- same reason as dpdp-monday-email).
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || "https://app.veridian-aios.com").replace(/\/+$/, "")
const PUBLIC_BASE = `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`

// Simple per-IP rate limit, in memory, per isolate: 30 requests per rolling
// minute. Best-effort by design (a new isolate starts empty, several
// isolates don't share state) -- it blunts a scripted token-guessing loop
// against one instance, it is not a security boundary; the 32-byte random
// token is.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30
const buckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string, now = Date.now()): boolean {
  const b = buckets.get(ip)
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    return false
  }
  b.count += 1
  return b.count > RATE_MAX
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown"
}

function privateHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }
}

function text(status: number, body: string): Response {
  return new Response(body + "\n", { status, headers: privateHeaders("text/plain; charset=utf-8") })
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: privateHeaders("application/json; charset=utf-8") })
}

type Route = { token: string; kind: "read"; format: "html" | "md" } | { token: string; kind: "draft" }

/** `/dpdp-ai-link/<token>`, `/dpdp-ai-link/<token>.md`, `/dpdp-ai-link/<token>/draft` -- tolerant of a `/functions/v1` prefix. */
export function parseRoute(pathname: string, accept: string | null): Route | null {
  const parts = pathname.split("/").filter(Boolean)
  const at = parts.lastIndexOf(FUNCTION_NAME)
  const rest = at >= 0 ? parts.slice(at + 1) : parts
  if (rest.length === 0 || rest.length > 2) return null
  let token = rest[0]
  if (rest.length === 2) {
    if (rest[1] !== "draft") return null
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null
    return { token, kind: "draft" }
  }
  let format: "html" | "md" = accept && /text\/markdown/i.test(accept) ? "md" : "html"
  if (token.endsWith(".md")) { token = token.slice(0, -3); format = "md" }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null
  return { token, kind: "read", format }
}

// Errors the database raises on purpose, with plain-English messages meant
// for the caller. Anything else is an internal error and is not echoed.
const LINK_GONE_CODES = new Set(["42501", "P0002"])
const CALLER_ERROR_CODES = new Set(["22023", "P0001", "22007", "22008"])

function dbClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function handleRead(route: Extract<Route, { kind: "read" }>): Promise<Response> {
  const { data, error } = await dbClient().rpc("dpdp_ai_link_read", { p_token: route.token })
  if (error) {
    if (LINK_GONE_CODES.has(error.code ?? "")) return text(404, LINK_GONE)
    console.error(`${FUNCTION_NAME}: read failed (${error.code ?? "?"})`)
    return text(500, "Could not open that link right now.")
  }
  const view = data as AiLinkView
  const opts = {
    draftEndpoint: `${PUBLIC_BASE}/${route.token}/draft`,
    markdownUrl: `${PUBLIC_BASE}/${route.token}.md`,
    htmlUrl: `${PUBLIC_BASE}/${route.token}`,
    now: new Date(),
  }
  if (route.format === "md") return new Response(renderMarkdown(view, opts), { headers: privateHeaders("text/markdown; charset=utf-8") })
  return new Response(renderHtml(view, opts), { headers: privateHeaders("text/html; charset=utf-8") })
}

async function handleDraft(req: Request, route: Extract<Route, { kind: "draft" }>): Promise<Response> {
  if (!APP_ORIGIN) {
    console.error(`${FUNCTION_NAME}: APP_ORIGIN is not set -- cannot build a draft URL`)
    return text(500, "This service is not fully configured (APP_ORIGIN). Ask the administrator.")
  }
  const raw = await req.text()
  if (raw.length > 8_192) return json(413, { error: "Request body is too large (8 KB at most)." })
  let body: { verb?: unknown; obligationId?: unknown; payload?: unknown }
  try {
    body = JSON.parse(raw || "{}")
  } catch {
    return json(400, { error: "Body must be JSON: { verb, obligationId, payload }." })
  }
  if (!body || typeof body !== "object") return json(400, { error: "Body must be a JSON object: { verb, obligationId, payload }." })
  const verb = typeof body.verb === "string" ? body.verb : ""
  const obligationId = typeof body.obligationId === "string" && body.obligationId.trim() ? body.obligationId.trim() : null
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {}

  const { data, error } = await dbClient().rpc("dpdp_draft_action", {
    p_token: route.token,
    p_verb: verb,
    p_obligation_id: obligationId,
    p_payload: payload,
  })
  if (error) {
    if (LINK_GONE_CODES.has(error.code ?? "")) return text(404, LINK_GONE)
    if (CALLER_ERROR_CODES.has(error.code ?? "")) return json(400, { error: error.message })
    console.error(`${FUNCTION_NAME}: draft failed (${error.code ?? "?"})`)
    return json(500, { error: "Could not save that draft right now." })
  }
  const d = data as { draftId: string; confirmToken: string; verb: string; obligationId: string | null; expiresAt: string }
  return json(201, {
    draftId: d.draftId,
    verb: d.verb,
    obligationId: d.obligationId,
    expiresAt: d.expiresAt,
    draftUrl: `${APP_ORIGIN}/app/#draft=${d.draftId}.${d.confirmToken}`,
    next: "Give draftUrl to the person. They open it in their own browser, sign in, and confirm. Nothing has changed yet.",
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(`${FUNCTION_NAME}: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing`)
    return text(500, "This service is not configured.")
  }
  if (rateLimited(clientIp(req))) return text(429, "Too many requests from this address. Try again in a minute.")

  const url = new URL(req.url)
  const route = parseRoute(url.pathname, req.headers.get("accept"))
  if (!route) return text(404, LINK_GONE)

  if (route.kind === "read") {
    if (req.method === "GET" || req.method === "HEAD") return handleRead(route)
    return text(405, "Use GET to read this link.")
  }
  if (req.method === "POST") return handleDraft(req, route)
  return text(405, "Use POST to draft an action.")
})
