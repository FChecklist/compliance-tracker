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
//   5b. (AUDIT-100 A2 batch 5) A route whose handler checks its own role set (requireRole(ctx, ROLE_GROUPS.X)) gets the same check right
//      after the organisation is known (`roles`); a `root` route calls VERIDIAN's /api/v1 root instead of /api/v1/projexa; a body is read
//      strictly (`json`), leniently (`json_lenient`: an empty or broken body is {}, as `request.json().catch(() => ({}))`) or not at all and
//      sent as {} (`empty`); `body_defaults` are spread UNDER the caller's body, as `{ action: "status", ...body }`.
//   5c. (AUDIT-100 A2 batch 6) The handler's own statements, each one a spec key ported from its source and proven by the parity contract:
//      body checks in the handler's order (`body_object_error`: `!body || typeof body !== "object"`; `body_reject_if`: a field combination
//      the handler refuses; `body_required`: `if (!body.a || !body.b) 400`, and a JSON-null body there throws in the handler, so it is an
//      empty 500 here too), `body_pick` (`{ a: body.a, b: body.b }`), `body_const` (a constant body, the request body unread) with
//      `upstream_method` (DELETE answered by an upstream PATCH), `invalid_body_error` (the handler's own message for a bad JSON body),
//      `body_in_try` (a bad JSON body is caught by the handler's catch: the fallback 502), the query it rebuilds (`optional_query`:
//      `?k=` / `&k=` + encodeURIComponent when set; `query_flags`: `?k=v` only when the value is exactly v; `search_params_omit_empty`: no
//      bare "?"; `forward_query_normalized`: `searchParams.toString()`; `required_query_any`: one of several is needed), `roles_also`
//      (roles allowed on top of the own role set) and the answer it reshapes (`response_pick`: `{ k: data.k ?? default }`;
//      `response_wrap`: `{ ...with, id, into: data }`).
//   5d. (AUDIT-100 A2 batch 7) `cache_ttl`: a person-free read (the Next route caches it per organisation with unstable_cache, the call runs with
//      NO acting person) is kept in a per-instance cache for the same TTL, keyed organisation + upstream URL, a failure never kept; `body:
//      "multipart"` relays an upload form as it is (documents / drawings / permits); `search_param_defaults` / `include_allow` build the two
//      queries that depend on another parameter; `response_redact` hides a field of a list for some roles; `boq_create_verify` is the BOQ
//      create's own check of what came back. `revalidate` is read by the BROWSER only (the Next handler clears page-side cache entries the edge
//      cannot reach: the browser asks Vercel to, after the edge answered).
//   5e. (AUDIT-100 A2 batch 8) `company_scope` (src/lib/company-scope.ts requireCompanyScope): the route names a :companyId; after the ordinary
//      organisation step the person must be a member of THAT company (403 "Not a member of this company"; a failed lookup is the unhandled throw =
//      an empty 500), and the company, not the oldest membership, is the organisation whose key, cache and answer are used. `acting_user:
//      "id_only"` sends X-Acting-User without the e-mail (the company dashboard names the user id only). `category_distribution`: two reads in
//      parallel combined by the projexa repo's own pure builder (category-distribution.ts, copied byte for byte).
//   6. The answer is the Next route's answer: 200 (201 for a create) + the upstream JSON, or the same error body and status
//      (veridian-response.ts). A route whose handler forwards its whole query string (`forward_search`) gets it byte for byte.
// Nothing here logs a token, an email, a key or a body.
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { buildCategoryDistribution } from "./category-distribution.ts"
import { checkApiWriteAccess, EDGE_ROUTES, ROLE_GROUPS, SHADOW_ROUTES, SOURCE_SHA256, type EdgeMethodSpec } from "./policy.generated.ts"

export const ALLOWED_ORIGINS = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100", "http://localhost:3101"] as const
export const CORS_ALLOW_HEADERS = "authorization, content-type, accept, x-px-client"
export const CORS_EXPOSE_HEADERS = "Retry-After, Server-Timing"
export const CORS_MAX_AGE_SECONDS = 7200
/** veridian-client.ts: 8 s per attempt, 9 s for the whole call (a GET retries once after a connection failure). */
export const UPSTREAM_TIMEOUT_MS = 8_000
export const UPSTREAM_TOTAL_BUDGET_MS = 9_000
export const RETRY_AFTER_SECONDS = 5
export const BODY_MAX_BYTES = 1_048_576
/** A multipart upload (a document, drawing or permit file). Vercel's own function limit was 4.5 MB (a larger body never reached the handler);
 *  here the form is held in memory (256 MB isolate) and relayed, so the ceiling is a stated, larger one. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024
/** The per-instance cache of person-free reads: most entries kept (oldest dropped first). */
export const CACHE_MAX_ENTRIES = 256

export type Membership = { organization_id: string; role: string | null }
export type MembershipLookup = (token: string, sub: string) => Promise<{ ok: true; row: Membership | null } | { ok: false }>
/** AUDIT-100 A2 batch 8: the person's membership of ONE named company (PROJEXA public.memberships, the person's own token, row level security). */
export type CompanyMembershipLookup = (token: string, sub: string, companyId: string) => Promise<{ ok: true; row: { role: string | null } | null } | { ok: false }>
export type ApiDeps = {
  session: SessionVerifier
  /** Only tokens of this issuer are accepted (the PROJEXA Auth project): PROJEXA's own routes accept nothing else. */
  issuer: string
  membership: MembershipLookup
  /** batch 8: the company routes (`company_scope`): is the person a member of the company named in the path. */
  companyMembership?: CompanyMembershipLookup
  /** The organisation's own VERIDIAN key, or null when it has none. */
  orgKey: (organizationId: string) => Promise<string | null>
  /** VERIDIAN_API_BASE_URL (".../api/v1/projexa"), what PROJEXA's veridian-client.ts uses. */
  upstreamBase: string
  fetchImpl?: typeof fetch
  /** AUDIT-100 A2 batch 7: the per-instance cache of `cache_ttl` reads; tests inject a fresh one with a fake clock. Default: one per isolate. */
  cache?: UpstreamCache
  allowedOrigins?: readonly string[]
  /** Tests shorten the budgets. */
  timeoutMs?: number
  log?: (line: string) => void
}

type Json = Record<string, unknown>

// ---------------------------------------------------------------------------------------------------------------------------------
// The per-instance cache (batch 7). The Next routes of /api/currencies, /api/cost-centers and /api/fiscal-years keep the organisation's answer
// 60 s with unstable_cache (veridian-client.ts createCachedVeridianGet over personFreeCache): keyed by the callback + the organisation id, the call
// runs as nobody (no acting person), a throw is never stored. This is the same per isolate: key = organisation + upstream URL, fresh for `ttl`
// seconds, a failure never stored. One difference, on purpose: after the TTL the real cache serves the stale answer once and refreshes in the
// background; an isolate that may be stopped after answering cannot promise that refresh, so it refetches at once (never older than the TTL).
// ---------------------------------------------------------------------------------------------------------------------------------
export type UpstreamCache = {
  get(key: string, ttlSeconds: number): unknown | undefined
  set(key: string, value: unknown): void
  clear(): void
}
export function createUpstreamCache(now: () => number = Date.now, maxEntries = CACHE_MAX_ENTRIES): UpstreamCache {
  const store = new Map<string, { at: number; value: unknown }>()
  return {
    get(key, ttlSeconds) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (now() - hit.at >= ttlSeconds * 1000) {
        store.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      store.delete(key)
      store.set(key, { at: now(), value })
      while (store.size > maxEntries) store.delete(store.keys().next().value as string)
    },
    clear: () => store.clear(),
  }
}
const isolateCache = createUpstreamCache()

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

/** The listed route a concrete /api path is, with its decoded parameters; null when none (=> 404). Like the Next App Router, a literal
 *  segment beats a dynamic one at the same position: /api/materials/issues is that route, not /api/materials/:id with id "issues". */
export function matchRoute(apiPath: string): { route: (typeof EDGE_ROUTES)[number]; params: Record<string, string> } | null {
  let best: { route: (typeof EDGE_ROUTES)[number]; params: Record<string, string>; rank: string } | null = null
  for (const m of matchAll(apiPath)) if (!best || m.rank > best.rank) best = m
  if (!best) return null
  // a Next route that stays on Vercel and wins for this path (GET /api/drawings/export is not /api/drawings/:id): not ours, 404
  const segs = apiPath.split("/").filter(Boolean)
  for (const shadow of SHADOW_ROUTES) {
    const pat = shadow.split("/").filter(Boolean)
    if (pat.length !== segs.length || !pat.every((p, i) => p.startsWith(":") || p === segs[i])) continue
    if (pat.map((p) => (p.startsWith(":") ? "0" : "1")).join("") > best.rank) return null
  }
  return { route: best.route, params: best.params }
}

function* matchAll(apiPath: string): Generator<{ route: (typeof EDGE_ROUTES)[number]; params: Record<string, string>; rank: string }> {
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
    if (ok) yield { route, params, rank: pat.map((p) => (p.startsWith(":") ? "0" : "1")).join("") }
  }
}

/** The upstream path the Next handler builds (relative to VERIDIAN_API_BASE_URL). Exported for the tests. */
export function upstreamPathOf(spec: EdgeMethodSpec, params: Record<string, string>, search: URLSearchParams, rawSearch = ""): string {
  let path = spec.upstream.replace(/\{query:(\w+)\}/g, (_m, q: string) => encodeURIComponent(search.get(q) ?? "")).replace(/\{(\w+)\}/g, (_m, p: string) => encodeURIComponent(params[p] ?? ""))
  if (spec.search_params) {
    const out = new URLSearchParams()
    for (const k of spec.search_params) {
      // batch 7 search_param_defaults: `if (id) params.set("linkedEntityType", searchParams.get("linkedEntityType") ?? "project")`: sent only when the
      // "when" parameter is set, as the request's value (even an empty one) or the default
      const rule = spec.search_param_defaults?.[k]
      if (rule) {
        if (search.get(rule.when)) out.set(k, search.get(k) ?? rule.default)
        continue
      }
      const v = search.get(k)
      if (v) out.set(k, v)
    }
    const s = out.toString()
    // search_params_omit_empty: `qs.toString() ? `?${qs}` : ""` instead of an always-present "?"
    if (!spec.search_params_omit_empty || s) path += `?${s}`
  }
  // optional_query: `${k ? `?k=${encodeURIComponent(k)}` : ""}` ("&" when the path already has a query); query_flags: only an exact value
  const sep = () => (path.includes("?") ? "&" : "?")
  for (const k of spec.optional_query ?? []) {
    const v = search.get(k)
    if (v) path += `${sep()}${k}=${encodeURIComponent(v)}`
  }
  for (const [k, want] of Object.entries(spec.query_flags ?? {})) if (search.get(k) === want) path += `${sep()}${k}=${encodeURIComponent(want)}`
  // include_allow (batch 7): `["variation", "compare"].filter((v) => requested.has(v))` over the trimmed, comma-split `include`, joined with ","
  if (spec.include_allow) {
    const requested = new Set((search.get("include") ?? "").split(",").map((s) => s.trim()))
    const allowed = spec.include_allow.filter((v) => requested.has(v))
    if (allowed.length > 0) path += `&include=${allowed.join(",")}`
  }
  // category_distribution.boq_id (batch 8): `const boqIdParam = boqId ? `&boqId=${encodeURIComponent(boqId)}` : ""` after the project id
  if (spec.category_distribution?.boq_id) {
    const boq = search.get("boqId")
    if (boq) path += `&boqId=${encodeURIComponent(boq)}`
  }
  // forward_query_normalized: `const qs = request.nextUrl.searchParams.toString(); qs ? `?${qs}` : ""` (re-serialised, not byte for byte)
  if (spec.forward_query_normalized) {
    const s = search.toString()
    if (s) path += `?${s}`
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

/** Next renders an unhandled throw of a route handler (here: a field read on a JSON-null body) as an empty 500. */
function thrown(req: Request, deps: ApiDeps): Response {
  return new Response(null, { status: 500, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(req, deps) } })
}
class NullBodyRead extends Error {}
/** `body.field` as the handler reads it: undefined on a primitive, a TypeError (=> the empty 500) on null. */
function fieldOf(body: unknown, f: string): unknown {
  if (body === null || body === undefined) throw new NullBodyRead()
  return (body as Record<string, unknown>)[f]
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
  // the handler's own requireRole(ctx, ROLE_GROUPS.X) (auth-guard.ts: no role or a role outside the set is 403), its first statement
  if (spec.roles) {
    // roles_also (batch 6): `if (ctx.role !== "member") requireRole(ctx, X)` is the set X plus member
    const allowed = [...(ROLE_GROUPS[spec.roles] ?? []), ...(spec.roles_also ?? [])]
    if (!role || !allowed.includes(role)) return json(req, deps, 403, { error: "Forbidden: your role does not permit this action" })
  }

  // batch 8 company_scope: requireCompanyScope runs first in the handler, right after requireAuth
  let workOrg = orgId
  if (spec.company_scope) {
    const company = matched.params.companyId ?? ""
    const lookup = deps.companyMembership
    const mem = lookup ? await lookup(token, verdict.sub, company) : ({ ok: false } as const)
    if (!mem.ok) return thrown(req, deps) // a database error / a company id that is not a UUID: nothing in the handler catches it
    if (!mem.row) return json(req, deps, 403, { error: "Not a member of this company" })
    workOrg = company
  }

  // 5. the handler's own checks, then the upstream call
  for (const [q, message] of Object.entries(spec.required_query ?? {})) if (!url.searchParams.get(q)) return json(req, deps, 400, { error: message })
  if (spec.required_query_any && !spec.required_query_any.params.some((q) => url.searchParams.get(q))) return json(req, deps, 400, { error: spec.required_query_any.error })

  let body: unknown = undefined
  let form: FormData | undefined
  if (spec.body === "multipart") {
    // batch 7: `const formData = await request.formData()` inside the handler's try; anything that is not a form is the handler's catch (the fallback 502)
    const len = Number(req.headers.get("content-length") ?? "0")
    if (Number.isFinite(len) && len > UPLOAD_MAX_BYTES) return json(req, deps, 413, { error: "Request body too large" })
    try {
      form = await req.formData()
    } catch {
      return failureResponse(req, deps, spec, { kind: "other" }, 0)
    }
  } else if (spec.body_const) body = JSON.parse(JSON.stringify(spec.body_const)) // batch 6: a constant body; the request body is never read
  else if (spec.body === "json" || spec.body === "json_lenient" || spec.body === "empty") {
    if (spec.body === "empty") body = {} // the handler sends a constant {} and never reads the request body
    else {
      const read = await readBody(req)
      if (!read.ok && read.status === 400) {
        // json_lenient: `request.json().catch(() => ({}))`, an empty or broken body is {}; with body_object_error it is `.catch(() => null)`
        if (spec.body === "json_lenient") body = spec.body_object_error !== undefined ? null : {}
        // the handler's own `try { body = await request.json() } catch { return 400 <its message> }`
        else if (spec.invalid_body_error !== undefined) return json(req, deps, 400, { error: spec.invalid_body_error })
        // the body is read inside the handler's try: its catch answers veridianErrorResponse(err, fallback), the 502 of a non-upstream error
        else if (spec.body_in_try) return failureResponse(req, deps, spec, { kind: "other" }, 0)
        // a strict body read OUTSIDE the handler's try (`const body = await request.json()`, what almost every handler does): the read throws, and Next
        // answers an unhandled throw with an empty 500. (Until batch 7 this was a 400 {"error":"Invalid JSON body"}: an answer the recorded contract never
        // compared, found by recording a non-JSON body for every route that reads one.)
        else return thrown(req, deps)
      } else if (!read.ok) return json(req, deps, read.status, { error: read.error }) // over the size limit
      else body = read.value
    }
    // batch 6: the handler's own body checks, in its order
    if (spec.body_object_error !== undefined && (!body || typeof body !== "object")) return json(req, deps, 400, { error: spec.body_object_error })
    for (const rule of spec.body_reject_if ?? []) {
      // `body?.a === x && body?.b === y` (optional chaining: a null body is never refused here)
      if (Object.entries(rule.match).every(([k, v]) => (body === null || body === undefined ? undefined : (body as Record<string, unknown>)[k]) === v)) return json(req, deps, 400, { error: rule.error })
    }
    try {
      for (const check of spec.body_required ?? []) if (check.fields.some((f) => !fieldOf(body, f))) return json(req, deps, 400, { error: check.error })
      if (spec.body_pick) {
        const picked: Json = {}
        for (const f of spec.body_pick) picked[f] = fieldOf(body, f) // an undefined field is dropped by JSON.stringify, as on the Next side
        body = picked
      }
    } catch (err) {
      if (err instanceof NullBodyRead) return thrown(req, deps)
      throw err
    }
    if (spec.body_defaults) body = { ...spec.body_defaults, ...(body as Json) }
    if (spec.body_actor_email === "always") body = { ...(body as Json), actorEmail: verdict.email ?? null }
    // veridian-client.ts withSessionActorEmail(): on a call whose acting person comes from the session, a top-level actorEmail is always
    // the person's own email; a call that names its person explicitly leaves the body as it is.
    if ((spec.acting_user ?? "session") === "session" && body && typeof body === "object") {
      const proto = Object.getPrototypeOf(body)
      if ((proto === Object.prototype || proto === null) && Object.prototype.hasOwnProperty.call(body, "actorEmail")) body = { ...(body as Json), actorEmail: verdict.email }
    }
  }

  const timeoutMs = deps.timeoutMs ?? spec.timeout_ms ?? UPSTREAM_TIMEOUT_MS
  const base = deps.upstreamBase.replace(/\/+$/, "")
  // veridian-client.ts: a `root: true` call goes to VERIDIAN_API_ROOT = the base without its trailing /projexa
  const upPath = upstreamPathOf(spec, matched.params, url.searchParams, url.search)
  const target = (spec.root ? base.replace(/\/projexa$/, "") : base) + upPath
  // batch 7 cache_ttl: a fresh answer of this organisation for this URL is served without a key lookup or an upstream call (the cached function of
  // the Next route is keyed by the organisation alone and resolves the key only when it has to fill)
  const cache = deps.cache ?? isolateCache
  const cacheKey = `${workOrg}|${target}`
  if (spec.cache_ttl !== undefined) {
    const hit = cache.get(cacheKey, spec.cache_ttl)
    if (hit !== undefined) return json(req, deps, spec.success_status ?? 200, hit, spec.cache_control ? { "Cache-Control": spec.cache_control } : {})
  }
  let key: string | null
  try {
    key = await deps.orgKey(workOrg)
  } catch {
    key = null // veridian-client.ts getVeridianApiKey(): a failed lookup is "no key", never a shared key
  }
  if (!key) {
    const message = `No VERIDIAN credentials configured for organization ${workOrg}, and per-org requests may not fall back to a shared key (AR-04)`
    return spec.error_style === "plain" ? json(req, deps, 500, { error: message }) : json(req, deps, 500, { error: message, code: null }, { "Server-Timing": "upstream;dur=0" })
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` }
  // acting_user "none" (a cached person-free read): the call carries no acting person, as personFreeCache's fill (runWithoutActingPerson) sends none
  if (spec.acting_user !== "none") {
    headers["X-Acting-User"] = verdict.sub
    if (verdict.email && spec.acting_user !== "id_only") headers["X-Acting-User-Email"] = verdict.email
  }
  // a multipart form gets its Content-Type (with the boundary) from fetch itself, never written by hand
  if (body) headers["Content-Type"] = "application/json"
  // batch 8 category_distribution: `Promise.all([amounts, progress])`, then buildCategoryDistribution; the first failure (in array order) is the answer, and a
  // builder that throws on a malformed answer is the handler's catch (the fallback 502)
  let result: Awaited<ReturnType<typeof callUpstream>>
  if (spec.category_distribution) {
    const second = target.slice(0, target.length - upPath.length) + spec.category_distribution.progress.replace(/\{(\w+)\}/g, (_m, p: string) => encodeURIComponent(matched.params[p] ?? ""))
    const init = { method: "GET", headers, cache: "no-store" } as RequestInit
    const [amounts, progress] = await Promise.all([callUpstream(deps, target, init, timeoutMs), callUpstream(deps, second, init, timeoutMs)])
    if (!amounts.ok) result = amounts
    else if (!progress.ok) result = progress
    else {
      try {
        result = { ok: true, data: buildCategoryDistribution(amounts.data as never, progress.data as never) }
      } catch {
        result = { ok: false, failure: { kind: "other" }, durationMs: 0 }
      }
    }
  } else result = await callUpstream(deps, target, { method: spec.upstream_method ?? method, headers, body: form ?? (body ? JSON.stringify(body) : undefined), cache: "no-store" } as RequestInit, timeoutMs)
  if (!result.ok) {
    logLine(deps, `${method} ${matched.route.route} upstream failure ${result.failure.kind === "upstream" ? result.failure.status : "other"}`)
    return failureResponse(req, deps, spec, result.failure, result.durationMs)
  }
  // batch 6: the handler's own reshaping of the answer. response_pick `{ k: data.k ?? default }` (a null answer throws inside the handler's
  // try: its catch's fallback 502); response_wrap `{ ...with, <params>, [into]: data }`
  let data = result.data
  // batch 7 boq_create_verify (src/lib/services/boq-create-service.ts createBoqVerified): the answer must carry the saved BOQ's id and at least as many
  // line items as were sent, else 502 with the service's own message (no `code`)
  if (spec.boq_create_verify) {
    const requested = Array.isArray((body as { lineItems?: unknown } | null | undefined)?.lineItems) ? ((body as { lineItems: unknown[] }).lineItems.length) : 0
    const answer = data as { id?: unknown; lineItems?: unknown } | null | undefined
    const savedId = typeof answer?.id === "string" ? answer.id.trim() : ""
    if (!savedId) return json(req, deps, 502, { error: "BOQ was not created: the scope service reported success but returned no saved BOQ. Nothing has been saved -- please try again." })
    const savedLineItems = Array.isArray(answer!.lineItems) ? (answer!.lineItems as unknown[]).length : 0
    if (savedLineItems < requested) return json(req, deps, 502, { error: `BOQ was not saved correctly: ${requested} line item(s) were submitted but only ${savedLineItems} came back saved. Check the BOQ list before retrying.` })
  }
  if (spec.cache_ttl !== undefined) cache.set(cacheKey, data)
  // batch 7 response_redact: `ctx.role && ROLES.has(ctx.role) ? { ...data, [list]: list.map((m) => (m && typeof m === "object" ? { ...m, ...set } : m)) } : data`
  if (spec.response_redact && role && spec.response_redact.roles.includes(role) && data && typeof data === "object") {
    const rr = spec.response_redact
    const rows = (data as Record<string, unknown>)[rr.list]
    if (Array.isArray(rows)) data = { ...(data as Json), [rr.list]: rows.map((m) => (m && typeof m === "object" ? { ...(m as Json), ...rr.set } : m)) }
  }
  if (spec.response_pick) {
    if (data === null || data === undefined) return failureResponse(req, deps, spec, { kind: "other" }, 0)
    const src = data as Record<string, unknown>
    data = Object.fromEntries(Object.entries(spec.response_pick).map(([k, d]) => [k, src[k] ?? d]))
  } else if (spec.response_wrap) {
    const w = spec.response_wrap
    data = { ...w.with, ...Object.fromEntries(w.params.map((p) => [p, matched.params[p]])), [w.into]: data }
  }
  // the Next handler's own success answer: 200, or 201 for a create; a private browser cache only where the handler sets one
  return json(req, deps, spec.success_status ?? 200, data, spec.cache_control ? { "Cache-Control": spec.cache_control } : {})
}
