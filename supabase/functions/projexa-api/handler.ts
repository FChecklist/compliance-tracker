// PROJEXA API EDGE PROXY (AUDIT-100 A2): the Supabase Edge Function that answers some of PROJEXA's /api routes instead of a Vercel function.
// Pure and bun-testable: no Deno global. index.ts wires Deno.serve, the session verifier, the membership lookup and the org-key lookup.
//
// WHAT IT DOES, per request, in the same order as PROJEXA's Next pipeline (src/middleware.ts, then the route handler):
//   1. DENY BY DEFAULT: the path must be one of EDGE_ROUTES (policy.generated.ts, generated from the projexa repo); anything else is 404.
//      A method the route does not have is 405.
//   2. The caller's PROJEXA Supabase access token (Authorization: Bearer) is verified (ai-work-link/session.ts, ES256 against the PROJEXA Auth
//      project's published keys; a token of any other issuer is refused). No or bad token: 401 {"error":"Unauthorized"} (auth-guard.ts).
//   3. The person's organisation and PROJEXA role come from PROJEXA's own `memberships` table, read WITH THE PERSON'S OWN TOKEN (row level
//      security decides, exactly like requireAuth()), oldest membership first. Failed twice: 503; none: 400 {"error":"No organization"}.
//   4. A write (POST/PUT/PATCH/DELETE) is gated by the same role-tier table as src/middleware.ts: 403 with the same body.
//   5. The org's own VERIDIAN key (PROJEXA public.veridian_credentials, read server-side; never a shared key: AR-04) authenticates the
//      upstream call; the acting person goes as X-Acting-User / X-Acting-User-Email, built from the verified token only (an inbound
//      X-Acting-User is never forwarded). Method, path, the query the Next route forwards and the JSON body are sent as the Next route sends them.
//   6. The answer is the Next route's answer: 200 (201 for a create) + the upstream JSON, or the same error body and status
//      (veridian-response.ts). A route whose handler forwards its whole query string (`forward_search`) gets it byte for byte.
// Nothing here logs a token, an email, a key or a body.
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { checkApiWriteAccess, EDGE_ROUTES, SOURCE_SHA256, type EdgeMethodSpec } from "./policy.generated.ts"

export const ALLOWED_ORIGINS = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100", "http://localhost:3101"] as const
export const CORS_ALLOW_HEADERS = "authorization, content-type, accept, x-px-client"
export const CORS_EXPOSE_HEADERS = "Retry-After, Server-Timing"
export const CORS_MAX_AGE_SECONDS = 7200
/** veridian-client.ts: 8 s per attempt, 9 s for the whole call (a GET retries once after a connection failure). */
export const UPSTREAM_TIMEOUT_MS = 8_000
export const UPSTREAM_TOTAL_BUDGET_MS = 9_000
export const RETRY_AFTER_SECONDS = 5
export const BODY_MAX_BYTES = 1_048_576

export type Membership = { organization_id: string; role: string | null }
export type MembershipLookup = (token: string, sub: string) => Promise<{ ok: true; row: Membership | null } | { ok: false }>
export type ApiDeps = {
  session: SessionVerifier
  /** Only tokens of this issuer are accepted (the PROJEXA Auth project): PROJEXA's own routes accept nothing else. */
  issuer: string
  membership: MembershipLookup
  /** The organisation's own VERIDIAN key, or null when it has none. */
  orgKey: (organizationId: string) => Promise<string | null>
  /** VERIDIAN_API_BASE_URL (".../api/v1/projexa"), what PROJEXA's veridian-client.ts uses. */
  upstreamBase: string
  fetchImpl?: typeof fetch
  allowedOrigins?: readonly string[]
  /** Tests shorten the budgets. */
  timeoutMs?: number
  log?: (line: string) => void
}

type Json = Record<string, unknown>

// ---------------------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------------------
function corsHeaders(req: Request, deps: ApiDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
  }
  if (origin && (deps.allowedOrigins ?? ALLOWED_ORIGINS).includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function json(req: Request, deps: ApiDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(req, deps), ...extra },
  })
}

function logLine(deps: ApiDeps, line: string) {
  try {
    ;(deps.log ?? ((l: string) => console.error(l)))(`projexa-api: ${line}`)
  } catch {
    // logging never breaks an answer
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Routing (deny by default)
// ---------------------------------------------------------------------------------------------------------------------------------
/** "/functions/v1/projexa-api/api/documents/x" or "/projexa-api/api/documents/x" or "/api/documents/x" -> "/api/documents/x"; else null. */
export function apiPathOf(pathname: string): string | null {
  const i = pathname.indexOf("/api/")
  if (i < 0) return null
  const before = pathname.slice(0, i)
  if (before !== "" && !/(^|\/)projexa-api$/.test(before)) return null
  return pathname.slice(i).replace(/\/+$/, "")
}

/** The listed route a concrete /api path is, with its decoded parameters; null when none (=> 404). */
export function matchRoute(apiPath: string): { route: (typeof EDGE_ROUTES)[number]; params: Record<string, string> } | null {
  const segs = apiPath.split("/").filter(Boolean)
  for (const route of EDGE_ROUTES) {
    const pat = route.route.split("/").filter(Boolean)
    if (pat.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(":")) {
        let v: string
        try {
          v = decodeURIComponent(segs[i])
        } catch {
          ok = false
          break
        }
        if (v === "") {
          ok = false
          break
        }
        params[pat[i].slice(1)] = v
      } else if (pat[i] !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}

/** The upstream path the Next handler builds (relative to VERIDIAN_API_BASE_URL). Exported for the tests. */
export function upstreamPathOf(spec: EdgeMethodSpec, params: Record<string, string>, search: URLSearchParams, rawSearch = ""): string {
  let path = spec.upstream.replace(/\{query:(\w+)\}/g, (_m, q: string) => encodeURIComponent(search.get(q) ?? "")).replace(/\{(\w+)\}/g, (_m, p: string) => encodeURIComponent(params[p] ?? ""))
  if (spec.search_params) {
    const out = new URLSearchParams()
    for (const k of spec.search_params) {
      const v = search.get(k)
      if (v) out.set(k, v)
    }
    path += `?${out.toString()}`
  }
  // forward_search: the Next handler appends request.nextUrl.search as it came ("" or "?a=1&b=2"), byte for byte
  if (spec.forward_search) path += rawSearch
  return path
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Upstream call (veridian-client.ts's rules: budget, one retry for a GET after a connection failure, the closed error vocabulary)
// ---------------------------------------------------------------------------------------------------------------------------------
type UpstreamError = { kind: "upstream"; status: number; message: string; code: "UPSTREAM_TIMEOUT" | "UPSTREAM_500" | "STORAGE_UNAVAILABLE" | "NETWORK" | null }
type Failure = UpstreamError | { kind: "other" }

const STORAGE_MESSAGE = "The construction data service's file storage is not configured. Nothing was lost — this needs an administrator."
const TIMEOUT_MESSAGE = "The construction data service did not respond in time. Please retry."
const NETWORK_MESSAGE = "Couldn't reach the construction data service. Please retry."

async function attempt(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response } | { err: unknown; timedOut: boolean }> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return { res: await fetchImpl(url, { ...init, signal: controller.signal }) }
  } catch (err) {
    return { err, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

/** Calls the upstream; returns the parsed JSON of a 2xx answer or a Failure shaped exactly like the error the Next route would have caught. */
async function callUpstream(deps: ApiDeps, url: string, init: RequestInit, timeoutMs: number): Promise<{ ok: true; data: unknown } | { ok: false; failure: Failure; durationMs: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const started = Date.now()
  const canRetry = (init.method ?? "GET") === "GET"
  const total = timeoutMs === UPSTREAM_TIMEOUT_MS ? UPSTREAM_TOTAL_BUDGET_MS : timeoutMs + 1_000
  let last: { err: unknown; timedOut: boolean } | null = null
  for (let n = 1; n <= 2; n++) {
    const out = await attempt(fetchImpl, url, init, timeoutMs)
    if ("res" in out) {
      const res = out.res
      const durationMs = Date.now() - started
      if (!res.ok) {
        let body: Json
        try {
          body = (await res.json()) as Json
        } catch {
          body = { error: res.statusText }
        }
        const raw = body && typeof body === "object" && "error" in body && body.error !== undefined && body.error !== null ? String(body.error) : `VERIDIAN API request failed (${res.status})`
        const code = /supabasekey is required/i.test(raw) ? "STORAGE_UNAVAILABLE" : res.status >= 500 ? "UPSTREAM_500" : null
        return { ok: false, durationMs, failure: { kind: "upstream", status: res.status, message: code === "STORAGE_UNAVAILABLE" ? STORAGE_MESSAGE : raw, code } }
      }
      try {
        return { ok: true, data: await res.json() }
      } catch {
        return { ok: false, durationMs, failure: { kind: "other" } } // a 2xx that is not JSON: the Next route's res.json() throws
      }
    }
    last = out
    const isAbort = out.err instanceof Error && (out.err.name === "AbortError" || out.err.name === "TimeoutError")
    if (out.timedOut || isAbort || !canRetry || !(out.err instanceof TypeError)) break
    if (n === 2 || Date.now() - started > total - timeoutMs) break
  }
  const durationMs = Date.now() - started
  const err = last?.err
  if (last?.timedOut || (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))) {
    return { ok: false, durationMs, failure: { kind: "upstream", status: 504, message: TIMEOUT_MESSAGE, code: "UPSTREAM_TIMEOUT" } }
  }
  // Deno's fetch reports every connection failure (refused, DNS, TLS, reset) as a TypeError; Node's veridian-client names the same set by code.
  if (err instanceof TypeError) return { ok: false, durationMs, failure: { kind: "upstream", status: 502, message: NETWORK_MESSAGE, code: "NETWORK" } }
  return { ok: false, durationMs, failure: { kind: "other" } }
}

/** veridianErrorResponse() (src/lib/veridian-response.ts) or, for error_style "plain", the drawings route's own catch. */
function failureResponse(req: Request, deps: ApiDeps, spec: EdgeMethodSpec, failure: Failure, durationMs: number): Response {
  const timing = { "Server-Timing": `upstream;dur=${Math.max(0, Math.round(durationMs))}` }
  if (spec.error_style === "plain") {
    return failure.kind === "upstream" ? json(req, deps, failure.status, { error: failure.message }) : json(req, deps, 502, { error: spec.fallback })
  }
  if (failure.kind === "other") return json(req, deps, 502, { error: spec.fallback, code: "NETWORK" }, { ...timing, "Retry-After": String(RETRY_AFTER_SECONDS) })
  const retryable = failure.code === "UPSTREAM_TIMEOUT" || failure.code === "NETWORK"
  return json(req, deps, retryable ? 503 : failure.status, { error: failure.message, code: failure.code }, retryable ? { ...timing, "Retry-After": String(RETRY_AFTER_SECONDS) } : timing)
}

function bearer(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

async function readBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const len = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(len) && len > BODY_MAX_BYTES) return { ok: false, status: 413, error: "Request body too large" }
  const text = await req.text()
  if (text.length > BODY_MAX_BYTES) return { ok: false, status: 413, error: "Request body too large" }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------------------------------------------
export async function handleApi(req: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  if (method === "OPTIONS") return json(req, deps, 204, null)
  // the hash of the generated policy + route table this deployment enforces, so a deploy can be checked against the projexa repo (no data)
  if (method === "GET" && /\/_policy\/?$/.test(url.pathname)) return json(req, deps, 200, { source_sha256: SOURCE_SHA256, routes: EDGE_ROUTES.map((r) => r.route) })

  const apiPath = apiPathOf(url.pathname)
  const matched = apiPath ? matchRoute(apiPath) : null
  if (!apiPath || !matched) return json(req, deps, 404, { error: "Not found" })
  const spec = matched.route.methods[method]
  if (!spec) return json(req, deps, 405, { error: "Method not allowed" }, { Allow: Object.keys(matched.route.methods).join(", ") })

  // 2. the person
  const token = bearer(req)
  if (!token) return json(req, deps, 401, { error: "Unauthorized" })
  const verdict = await deps.session(token)
  if (!verdict.ok) return verdict.reason === "unavailable" ? json(req, deps, 503, { error: "Sign-in could not be checked just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) }) : json(req, deps, 401, { error: "Unauthorized" })
  if (verdict.issuer !== deps.issuer) return json(req, deps, 401, { error: "Unauthorized" })

  // 3. the organisation and role (one retry, as requireAuth())
  let found = await deps.membership(token, verdict.sub)
  if (!found.ok) found = await deps.membership(token, verdict.sub)
  if (!found.ok) {
    logLine(deps, "membership lookup failed twice")
    return json(req, deps, 503, { error: "Could not verify organization membership, please retry" })
  }
  const role = found.row?.role ?? null

  // 4. the write gate (middleware.ts): runs before the handler's own "No organization", exactly like the Next pipeline
  const gate = checkApiWriteAccess(method, apiPath, role)
  if (!gate.allowed) return json(req, deps, 403, { error: "Forbidden: your role does not permit this action" })
  if (!found.row) return json(req, deps, 400, { error: "No organization" })
  const orgId = found.row.organization_id

  // 5. the handler's own checks, then the upstream call
  for (const [q, message] of Object.entries(spec.required_query ?? {})) if (!url.searchParams.get(q)) return json(req, deps, 400, { error: message })

  let body: unknown = undefined
  if (spec.body === "json") {
    const read = await readBody(req)
    if (!read.ok) return json(req, deps, read.status, { error: read.error })
    body = read.value
    if (spec.body_actor_email === "always") body = { ...(body as Json), actorEmail: verdict.email ?? null }
    // veridian-client.ts withSessionActorEmail(): on a call whose acting person comes from the session, a top-level actorEmail is always
    // the person's own email; a call that names its person explicitly leaves the body as it is.
    if ((spec.acting_user ?? "session") === "session" && body && typeof body === "object") {
      const proto = Object.getPrototypeOf(body)
      if ((proto === Object.prototype || proto === null) && Object.prototype.hasOwnProperty.call(body, "actorEmail")) body = { ...(body as Json), actorEmail: verdict.email }
    }
  }

  const timeoutMs = deps.timeoutMs ?? spec.timeout_ms ?? UPSTREAM_TIMEOUT_MS
  let key: string | null
  try {
    key = await deps.orgKey(orgId)
  } catch {
    key = null // veridian-client.ts getVeridianApiKey(): a failed lookup is "no key", never a shared key
  }
  if (!key) {
    const message = `No VERIDIAN credentials configured for organization ${orgId}, and per-org requests may not fall back to a shared key (AR-04)`
    return spec.error_style === "plain" ? json(req, deps, 500, { error: message }) : json(req, deps, 500, { error: message, code: null }, { "Server-Timing": "upstream;dur=0" })
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "X-Acting-User": verdict.sub }
  if (verdict.email) headers["X-Acting-User-Email"] = verdict.email
  if (body) headers["Content-Type"] = "application/json"
  const target = deps.upstreamBase.replace(/\/+$/, "") + upstreamPathOf(spec, matched.params, url.searchParams, url.search)
  const result = await callUpstream(deps, target, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" } as RequestInit, timeoutMs)
  if (!result.ok) {
    logLine(deps, `${method} ${matched.route.route} upstream failure ${result.failure.kind === "upstream" ? result.failure.status : "other"}`)
    return failureResponse(req, deps, spec, result.failure, result.durationMs)
  }
  // the Next handler's own success answer: 200, or 201 for a create; a private browser cache only where the handler sets one
  return json(req, deps, spec.success_status ?? 200, result.data, spec.cache_control ? { "Cache-Control": spec.cache_control } : {})
}
