// PROJEXA LOCAL-FIRST SYNC, READ SIDE: the router of the projexa-sync Edge function. Pure and bun-testable: no Deno global, the database is the injected
// `rpc(name, args)` (the service-role client in index.ts, a PGlite in the tests) and the session verifier is injected too.
//
//   GET  /manifest   -> {user, projects, kinds, server_time}
//   POST /pull       body {project_id, kind, after, limit} -> {items, next_cursor, has_more, hidden_fields, redacted, server_time}
//
// AUTHORITY IS NOT DECIDED HERE. The session (the PROJEXA person's access token) is verified by ai-work-link/session.ts; the person, the project
// binding, the row scope and every redaction are decided by the SQL functions public.projexa_sync_manifest / projexa_sync_pull (drizzle/0677), which
// call the AI work link's own functions (projexa_read_resolve_user, ai_work_link__bind, ai_work_link__records_core). This file only adds a second
// money-nulling pass from the AI link's own generated kind table (redactItem), the cursor encoding, CORS and a per-person rate cap.
// An unknown project, an unknown kind, a project of another organisation and a project the person may not read are ONE answer (404, same body).
// Nothing here logs a token, an email or a row.
import { redactItem } from "../_shared/ai-link/core.ts"
import { kindDef } from "../ai-work-link/api-definition.ts"
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { ATTEST_TTL_SECONDS, canonicalize, jwkThumbprint, parseDevicePublicJwk, sha256Hex, type KeyRecord, type Signing } from "./sign.ts"

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
export type PublicKeyInfo = { kid: string; alg: string; jwk: unknown; active: boolean }
export type SyncDeps = {
  rpc: Rpc
  session: SessionVerifier
  now?: () => Date
  limiter?: RateLimiter
  allowedOrigins?: readonly string[]
  /** The signing key (index.ts loads it from platform.projexa_sync_key). Absent: rows are returned unsigned and /attest answers 503. */
  signing?: () => Promise<Signing | null>
  /** Public halves a laptop verifies against. */
  publicKeys?: () => Promise<PublicKeyInfo[]>
  /** per-person organisation (and view class) memory for signing a pull (one manifest call a minute at most) */
  orgCache?: Map<string, { org: string; exp: number; view?: string; orgView?: string }>
  /** fetch used to read the owner-published release manifest (tests inject a fake); defaults to the global fetch */
  fetchImpl?: typeof fetch
  /** five-minute memory of the registry's current release, shared by every request of the isolate */
  releaseBox?: { at: number; value: ReleaseInfo | null }
  /** the isolate's last /release/register answer: replayed for a minute whoever asks, so the owner's manifest is fetched at most once a minute per isolate */
  registerBox?: { at: number; answer: { status: number; body: unknown } | null }
  /** Runs one pushed write through the real pipeline (the ai-work-link-exec function). Absent: POST /push answers 503. */
  execRun?: (body: ExecRunBody) => Promise<ExecOutcome>
  /** Runs several pushed writes in ONE exec invocation (ai-work-link-exec /sync-run-batch), one outcome per body in the same order. Preferred over execRun when present. */
  execRunBatch?: (bodies: ExecRunBody[]) => Promise<ExecOutcome[]>
  /** Milliseconds for the push deadline (tests advance it); defaults to Date.now. `now` stays the request's one fixed time. */
  clock?: () => number
  /** One redacted line (a class and a status, never a token, an email, a row or a message). Defaults to console.error. */
  log?: (line: string) => void
}

function logLine(deps: SyncDeps, line: string) {
  try {
    ;(deps.log ?? ((l: string) => console.error(l)))(`projexa-sync: ${line}`)
  } catch {
    // logging never breaks an answer
  }
}

/** What the exec function answered for one pushed write (index.ts maps its HTTP answer to this). "unavailable": nothing ran. "uncertain": it was sent and no answer came back, so the write may have happened. */
export type ExecRunBody = { op_id: string; function_id: string; params: Record<string, unknown>; ctx: { org_id: string; user_id: string; project_id: string | null; live_role: string; device_id: string } }
export type ExecOutcome =
  | { kind: "done"; record: { id: string | null; route: string | null }; submission_id: string | null }
  | { kind: "failed"; code: string; missing: string[] }
  | { kind: "unavailable" }
  | { kind: "uncertain" }

export type ReleaseInfo = { registered: boolean; current: Record<string, unknown> | null; min_compatible: string }

export const ALLOWED_ORIGINS = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100", "http://localhost:3101"] as const
// the 13 of drizzle/0677, then the 15 of 0683; the SQL list is public.projexa_sync__kinds() and a test asserts the two stay equal
export const SYNC_KINDS = [
  "project", "tasks", "boqs", "boq_lines", "activities", "progress", "rfis", "submittals", "punch_list", "change_orders", "milestones", "materials", "documents",
  "roster", "attendance", "timesheets", "meetings", "meeting_minutes", "site_diaries", "site_instructions", "progress_claims", "interim_bills",
  "material_receipts", "material_issues", "expenses", "schedule_baselines", "ffe_items", "wiki_pages",
] as const
// the ORGANISATION kinds of drizzle/0684 (not project-scoped): the SQL list is public.projexa_sync__org_kinds(); a test asserts the two stay equal. Their feed and signatures use the sentinel project.
export const ORG_KINDS = ["vendors", "customers", "companies", "boq_categories", "currencies", "exchange_rates", "departments", "org_people", "cost_visibility",
  // drizzle/0691: ERP / HR / interior / knowledge-base organisation kinds
  "warehouses", "item_groups", "stock_items", "stock_entries", "accounts", "fiscal_years", "budgets", "purchase_orders", "goods_receipts", "requisitions", "rfqs",
  "quotations", "sales_orders", "invoices", "floor_plans", "mood_boards", "knowledge_base", "employees"] as const
export const ORG_SENTINEL = "__org__"
const isOrgKind = (k: unknown): boolean => typeof k === "string" && (ORG_KINDS as readonly string[]).includes(k)
export const PULL_LIMIT_DEFAULT = 200
export const PULL_LIMIT_MAX = 500
export const SERVER_PROTOCOL = 2
// every body limit is in UTF-8 BYTES, checked on Content-Length before reading and while streaming (review D1 F-10), never after buffering it all
export const PUSH_BODY_MAX_BYTES = 262_144
export const PUSH_OPS_MAX = 50
/** No new op of a push starts after this; with one exec call of at most EXEC_TIMEOUT_MS the push answers inside the laptop's 60 s timeout. */
export const PUSH_START_CUTOFF_MS = 30_000
/** This many begin failures in a row (the database failing every op) stops the push; the rest are RETRY_LATER. */
export const PUSH_MAX_BEGIN_ERRORS_IN_A_ROW = 3
/** /jobs/result carries the job's output; the other job routes carry a few ids (claim/heartbeat/get) or params the SQL caps at 16 KB (enqueue). */
export const JOB_BODY_MAX_BYTES = 300_000
export const JOB_BODY_MAX_BYTES_BY_ACTION: Readonly<Record<string, number>> = { result: JOB_BODY_MAX_BYTES, enqueue: 20_480, claim: 2048, heartbeat: 2048, get: 2048 }
/** /pull by exact ids: 200 ids of up to 64 characters is about 13.4 KB, so the 4 KB default refused a real batch (review D1 F5). */
export const PULL_BODY_MAX_BYTES = 16_384
export const RELEASE_ORIGIN = "https://projexa-ai.com"
export const RELEASE_MANIFEST_URL = `${RELEASE_ORIGIN}/_release/release.json`
export const RELEASE_MANIFEST_MAX_BYTES = 2_000_000
// the gate and the manifest need only version and floor; each refresh reads the release row from the database, so five minutes, not one (review D1 F7)
export const RELEASE_TTL_MS = 300_000
export const REGISTER_COOLDOWN_MS = 60_000
export const IDS_LIMIT_DEFAULT = 5000
export const IDS_LIMIT_MAX = 5000
export const PULL_IDS_MAX = 200
export const CHANGES_LIMIT_DEFAULT = 1000
export const CHANGES_LIMIT_MAX = 1000
export const REQUESTS_PER_MINUTE = 120
export const BODY_MAX_BYTES = 4096

// ---------------------------------------------------------------------------------------------------------------------------------
// Rate cap: a rolling minute per person (best effort: per isolate; the database is the real limit)
// ---------------------------------------------------------------------------------------------------------------------------------
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private perMinute = REQUESTS_PER_MINUTE) {}
  /** True when the call may go on. */
  take(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < 60_000)
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(nowMs)
    this.hits.set(key, recent)
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((t) => nowMs - t >= 60_000)) this.hits.delete(k)
    return true
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Cursor: opaque base64url of [ts, id]
// ---------------------------------------------------------------------------------------------------------------------------------
const TS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$/
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/

export function encodeCursor(ts: string, id: string): string {
  return btoa(JSON.stringify([ts, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
export function decodeCursor(cursor: string): { ts: string; id: string } | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/")
    const v = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || typeof v[1] !== "string" || !TS_RE.test(v[0]) || !ID_RE.test(v[1])) return null
    return { ts: v[0], id: v[1] }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------------------
// A browser preflights every laptop call (Authorization + the custom X-Px-Client are not CORS-safelisted). Every request header the laptop sends must be
// listed or the browser blocks the call before it leaves; Retry-After must be exposed or browser JS cannot read the 429 back-off; and the preflight is
// cached for 2 h (Chromium's ceiling) because an OPTIONS is answered in this function, i.e. it is one more billed invocation per URL per cache period.
export const CORS_ALLOW_HEADERS = "authorization, content-type, x-px-client"
export const CORS_EXPOSE_HEADERS = "Retry-After"
export const CORS_MAX_AGE_SECONDS = 7200
// Every user's laptop is its own server (owner aim 2026-10-06), on whatever port is free: any loopback origin is the laptop itself. Safe because the
// answer carries no credentials (no cookies; auth is the Bearer token), so only a page running ON that laptop can read it.
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin) || LOOPBACK_ORIGIN.test(origin)
}
function corsHeaders(req: Request, deps: SyncDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const allowed = deps.allowedOrigins ?? ALLOWED_ORIGINS
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
  }
  if (origin && isAllowedOrigin(origin, allowed)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function respond(req: Request, deps: SyncDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json; charset=utf-8" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(req, deps), ...extra },
  })
}

const NOT_FOUND = { error: "Not found" }

const ROUTES: Record<string, "GET" | "POST"> = { manifest: "GET", heads: "GET", pull: "POST", ids: "POST", attest: "POST", changes: "POST", push: "POST", "jobs/enqueue": "POST", "jobs/claim": "POST", "jobs/heartbeat": "POST", "jobs/result": "POST", "jobs/get": "POST", install: "POST", prepare: "POST", "release/current": "GET", "release/register": "POST" }
/** Routes a laptop that is too old must still be able to reach: how else would it learn to update. */
const UPDATE_EXEMPT = new Set(["release/current", "release/register", "install", "prepare"])

function routeOf(pathname: string): string {
  const m = pathname.replace(/\/+$/, "").match(/\/(manifest|heads|pull|ids|attest|changes|push|jobs\/enqueue|jobs\/claim|jobs\/heartbeat|jobs\/result|jobs\/get|install|prepare|release\/current|release\/register)$/)
  return m ? m[1] : ""
}

function bearer(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------------------------------------------
export async function handleSync(req: Request, deps: SyncDeps): Promise<Response> {
  // an unexpected throw anywhere below is ONE closed 500 with the CORS headers (a browser can read it) and one log line naming the route, never the
  // error's text (it may carry a row or an address) (review D1 F-14a)
  try {
    return await routeRequest(req, deps)
  } catch {
    logLine(deps, `unexpected error on ${routeOf(safePath(req))} -> 500`)
    return respond(req, deps, 500, { error: "Something failed on our side. Try again in a minute." })
  }
}

function safePath(req: Request): string {
  try {
    return new URL(req.url).pathname
  } catch {
    return ""
  }
}

async function routeRequest(req: Request, deps: SyncDeps): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))()
  if (req.method === "OPTIONS") return respond(req, deps, 204, null)
  const route = routeOf(new URL(req.url).pathname)
  if (route === "") return respond(req, deps, 404, NOT_FOUND)
  if (req.method !== ROUTES[route]) return respond(req, deps, 405, { error: "Method not allowed" }, { Allow: `${ROUTES[route]}, OPTIONS` })

  const token = bearer(req)
  if (!token) return respond(req, deps, 401, { error: "Sign in again" })
  const who = await deps.session(token)
  if (!who.ok) return who.reason === "unavailable" ? respond(req, deps, 503, { error: "Service unavailable. Try again in a minute." }) : respond(req, deps, 401, { error: "Sign in again" })

  deps.limiter ??= new RateLimiter()
  if (!deps.limiter.take(who.sub, now.getTime())) return respond(req, deps, 429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" })

  if (!UPDATE_EXEMPT.has(route)) {
    const blocked = await updateRequired(req, deps, now)
    if (blocked) return blocked
  }

  if (route === "manifest") return manifest(req, deps, who, now)
  if (route === "heads") return heads(req, deps, who, now)
  if (route === "release/current") return releaseCurrent(req, deps, now)
  if (route === "release/register") return releaseRegister(req, deps, now)
  if (route === "install") return install(req, deps, who, now)
  if (route === "prepare") return prepare(req, deps, who, now)
  if (route === "ids") return ids(req, deps, who, now)
  if (route === "attest") return attest(req, deps, who, now)
  if (route === "changes") return changes(req, deps, who, now)
  if (route === "push") return push(req, deps, who, now)
  if (route.startsWith("jobs/")) return jobs(req, deps, who, now, route.slice(5))
  return pull(req, deps, who, now)
}

type Who = { sub: string; email: string | null }

async function callSql(deps: SyncDeps, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; body: unknown }> {
  let res: RpcResult
  try {
    res = await deps.rpc(fn, args)
  } catch {
    logLine(deps, `${fn}: database unreachable -> 503`)
    return { ok: false, status: 503, body: { error: "Service unavailable. Try again in a minute." } }
  }
  if (res.error) {
    const code = res.error.code ?? ""
    if (code === "AW404") return { ok: false, status: 404, body: NOT_FOUND }
    if (code === "AW409") return { ok: false, status: 409, body: { error: "Conflict" } }
    if (code === "AW429") return { ok: false, status: 429, body: { error: "Too many requests today. Try again tomorrow." } }
    if (code === "AW400") return { ok: false, status: 400, body: { error: res.error.message === "BAD_CURSOR" ? "Bad cursor" : "Bad request" } }
    // the SQLSTATE only (a class, never the message: it can name a relation or carry a value)
    logLine(deps, `${fn}: SQL error ${/^[0-9A-Z]{5}$/.test(code) ? code : "?"} -> 500`)
    return { ok: false, status: 500, body: { error: "Something failed on our side. Try again in a minute." } }
  }
  const d = (res.data ?? {}) as Record<string, unknown>
  const status = d.status
  if (status !== "ok") {
    // a person who does not resolve: no data at all, one answer for every reason
    return { ok: false, status: 403, body: { error: "This sign-in is not linked to a PROJEXA person.", code: "NOT_LINKED" } }
  }
  return { ok: true, data: d }
}

async function manifest(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const r = await callSql(deps, "projexa_sync_manifest", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const kinds = Array.isArray(r.data.kinds) ? (r.data.kinds as Array<Record<string, unknown>>).filter((k) => typeof k.kind === "string" && (SYNC_KINDS as readonly string[]).includes(k.kind as string)) : []
  rememberOrg(deps, who.sub, r.data.user, now, r.data)
  const rel = await getRelease(deps, now)
  return respond(req, deps, 200, {
    // `user.id` is the VERIDIAN user (compliance.users.id, a cuid); the laptop only knows the sign-in id, the verified token subject. Both travel so a laptop can check
    // that a manifest is its own person's (client review F01: comparing the wrong pair made every real sync end in user_mismatch).
    user: r.data.user && typeof r.data.user === "object" ? { ...(r.data.user as Record<string, unknown>), auth_user_id: who.sub } : r.data.user,
    projects: r.data.projects,
    kinds,
    view_class: typeof r.data.view_class === "string" ? r.data.view_class : null,
    org_kinds: Array.isArray(r.data.org_kinds) ? (r.data.org_kinds as Array<Record<string, unknown>>).filter((k) => isOrgKind(k.kind)) : [],
    org_view_class: typeof r.data.org_view_class === "string" ? r.data.org_view_class : null,
    release: { current: (rel?.current?.release_version as string | undefined) ?? null, min_compatible: rel?.min_compatible || null, protocol: SERVER_PROTOCOL },
    server_time: now.toISOString(),
  })
}

function rememberOrg(deps: SyncDeps, sub: string, user: unknown, now: Date, data?: Record<string, unknown>) {
  const org = (user as { org_id?: unknown } | null)?.org_id
  if (typeof org !== "string") return
  deps.orgCache ??= new Map()
  const view = typeof data?.view_class === "string" ? data.view_class : undefined
  const orgView = typeof data?.org_view_class === "string" ? data.org_view_class : undefined
  deps.orgCache.set(sub, { org, exp: now.getTime() + 60_000, ...(view ? { view } : {}), ...(orgView ? { orgView } : {}) })
  if (deps.orgCache.size > 5000) for (const [k, v] of deps.orgCache) if (v.exp < now.getTime()) deps.orgCache.delete(k)
}

type OrgMemory = { org: string; exp: number; view?: string; orgView?: string }
/** The organisation (and view classes) of a signed-in person, from a short memory or one manifest call (only needed to sign a pull). */
async function orgOf(deps: SyncDeps, who: Who, now: Date): Promise<OrgMemory | null> {
  const hit = deps.orgCache?.get(who.sub) as OrgMemory | undefined
  if (hit && hit.exp > now.getTime()) return hit
  const r = await callSql(deps, "projexa_sync_manifest", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return null
  rememberOrg(deps, who.sub, r.data.user, now, r.data)
  return (deps.orgCache?.get(who.sub) as OrgMemory | undefined) ?? null
}

// GET /heads: the one cheap poll (drizzle/0686). {heads: {<project>: head, "__org__": head}, projects_etag, role, view_class, org_view_class, epoch}.
// A laptop calls /changes only for a head that moved, /manifest only when projects_etag changed, and resets its copy when a class or the epoch changed.
async function heads(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const r = await callSql(deps, "projexa_sync_heads", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const raw = (r.data.heads ?? {}) as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) out[k] = v
  return respond(req, deps, 200, {
    heads: out,
    projects_etag: typeof r.data.projects_etag === "string" ? r.data.projects_etag : null,
    role: typeof r.data.role === "string" ? r.data.role : null,
    view_class: typeof r.data.view_class === "string" ? r.data.view_class : null,
    org_view_class: typeof r.data.org_view_class === "string" ? r.data.org_view_class : null,
    epoch: typeof r.data.epoch === "string" ? r.data.epoch : null,
    server_time: now.toISOString(),
  })
}

/** The keys 0679/0684 add to an /ids page: the version of every listed id (aligned, 0 = untracked), the feed head read BEFORE the list, the epoch. */
function idsExtras(data: Record<string, unknown>, count: number): Record<string, unknown> {
  const v = Array.isArray(data.versions) ? (data.versions as unknown[]) : []
  return {
    versions: v.length === count && v.every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0) ? v : null,
    head_seq: typeof data.head_seq === "number" ? data.head_seq : null,
    epoch: typeof data.epoch === "string" ? data.epoch : null,
  }
}

// POST /ids {project_id, kind, after_id, limit}: one page of the ids of that kind the person may read now (a laptop drops what is no longer listed: deletes)
// POST /ids {project_id, kinds:[...], digest:true}: per kind {count, xor} (drizzle/0686) so the laptop lists ids only for a kind whose digest differs from its own
async function ids(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
  const project = body.project_id
  const kind = body.kind
  const after = body.after_id ?? null
  if (body.digest === true) {
    const kinds = body.kinds
    const allowed: readonly string[] = project === ORG_SENTINEL ? ORG_KINDS : SYNC_KINDS
    if (typeof project !== "string" || project === "" || project.length > 128) return respond(req, deps, 400, { error: "project_id is required" })
    if (!Array.isArray(kinds) || kinds.length < 1 || kinds.length > 64 || !kinds.every((k) => typeof k === "string")) return respond(req, deps, 400, { error: "kinds must be 1 to 64 kinds" })
    if (!kinds.every((k) => allowed.includes(k as string))) return respond(req, deps, 404, NOT_FOUND)
    const r = await callSql(deps, "projexa_sync_ids_digest", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kinds: kinds })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, {
      digests: r.data.digests ?? {},
      head_seq: typeof r.data.head_seq === "number" ? r.data.head_seq : null,
      epoch: typeof r.data.epoch === "string" ? r.data.epoch : null,
      server_time: now.toISOString(),
    })
  }
  if (isOrgKind(kind)) {
    // the organisation inventory: no project (absent, null or the sentinel); a real project id for an organisation kind is the one 404
    if (project !== undefined && project !== null && project !== ORG_SENTINEL) return respond(req, deps, 404, NOT_FOUND)
    const lim = body.limit ?? IDS_LIMIT_DEFAULT
    if (typeof lim !== "number" || !Number.isInteger(lim) || lim < 1 || lim > IDS_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${IDS_LIMIT_MAX}` })
    if (after !== null && (typeof after !== "string" || !ID_RE.test(after))) return respond(req, deps, 400, { error: "Bad cursor" })
    const r = await callSql(deps, "projexa_sync_org_ids", { p_sub: who.sub, p_email: who.email, p_kind: kind, p_after_id: after, p_limit: lim })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    const list = Array.isArray(r.data.ids) ? (r.data.ids as unknown[]).filter((x): x is string => typeof x === "string") : []
    return respond(req, deps, 200, {
      ids: list,
      has_more: r.data.has_more === true,
      next_id: typeof r.data.next_id === "string" ? r.data.next_id : null,
      ...idsExtras(r.data, list.length),
      server_time: now.toISOString(),
    })
  }
  const limitIn = body.limit ?? IDS_LIMIT_DEFAULT
  if (typeof project !== "string" || project === "" || project.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return respond(req, deps, 400, { error: "project_id and kind are required" })
  if (typeof limitIn !== "number" || !Number.isInteger(limitIn) || limitIn < 1 || limitIn > IDS_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${IDS_LIMIT_MAX}` })
  if (after !== null && (typeof after !== "string" || !ID_RE.test(after))) return respond(req, deps, 400, { error: "Bad cursor" })
  if (!(SYNC_KINDS as readonly string[]).includes(kind)) return respond(req, deps, 404, NOT_FOUND)
  const r = await callSql(deps, "projexa_sync_ids", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_after_id: after, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const list = Array.isArray(r.data.ids) ? (r.data.ids as unknown[]).filter((x): x is string => typeof x === "string") : []
  return respond(req, deps, 200, {
    ids: list,
    has_more: r.data.has_more === true,
    next_id: typeof r.data.next_id === "string" ? r.data.next_id : null,
    ...idsExtras(r.data, list.length),
    server_time: now.toISOString(),
  })
}

// POST /attest {}: a short-lived signed statement of who this person is to OTHER laptops (organisation, the projects they may read, their view class),
// the public keys to verify signed rows with, and the organisation's channel name. A peer that cannot present one gets nothing from another laptop.
// Body (optional): {device_pub_jwk}: the laptop's own ES256 P-256 public key. When sent, the token carries cnf.jkt (its RFC 7638 thumbprint) and a peer
// must prove possession of that key in the handshake (sign.ts verifyHolderProof): a token copied by another laptop is then useless to it (review D1 TI-2).
// With no key the old bearer token is issued (holder_bound false) until every laptop sends one; README.md documents the handshake step.
async function attest(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const raw = await readLimited(req, BODY_MAX_BYTES)
  if (raw === null) return respond(req, deps, 413, { error: "Body too large" })
  let body: Record<string, unknown> = {}
  if (raw.trim() !== "") {
    try {
      const v = JSON.parse(raw)
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
      body = v as Record<string, unknown>
    } catch {
      return respond(req, deps, 400, { error: "Body must be a JSON object" })
    }
  }
  let jkt: string | null = null
  if (body.device_pub_jwk !== undefined && body.device_pub_jwk !== null) {
    const jwk = await parseDevicePublicJwk(body.device_pub_jwk)
    if (!jwk) return respond(req, deps, 400, { error: "device_pub_jwk must be an ES256 (P-256) public key", code: "BAD_DEVICE_KEY" })
    jkt = await jwkThumbprint(jwk)
  }
  const signing = deps.signing ? await deps.signing() : null
  if (!signing) return respond(req, deps, 503, { error: "Peer sync is not available right now." })
  const r = await callSql(deps, "projexa_sync_manifest", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const user = (r.data.user ?? {}) as { id?: string; org_id?: string }
  const projects = Array.isArray(r.data.projects) ? (r.data.projects as Array<{ id?: unknown }>).map((p) => p.id).filter((x): x is string => typeof x === "string") : []
  const view = typeof r.data.view_class === "string" ? r.data.view_class : ""
  if (typeof user.id !== "string" || typeof user.org_id !== "string" || view === "") return respond(req, deps, 500, { error: "Something failed on our side. Try again in a minute." })
  rememberOrg(deps, who.sub, r.data.user, now, r.data)
  const iat = Math.floor(now.getTime() / 1000)
  const exp = iat + ATTEST_TTL_SECONDS
  const token = await signing.signToken({ typ: "px-peer", v: 1, sub: user.id, org: user.org_id, projects, view, iat, exp, ...(jkt ? { cnf: { jkt } } : {}) })
  return respond(req, deps, 200, {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    org_id: user.org_id,
    user_id: user.id,
    view_class: view,
    projects,
    holder_bound: jkt !== null,
    channel: await signing.channelId(user.org_id),
    // only laptops of the same view class can exchange rows, so they need not hear each other's signalling: a channel per (organisation, view class)
    // cuts Realtime fan-out to compatible peers (review D1 F15). `channel` (per organisation) stays for laptops that do not use it yet.
    class_channel: await signing.channelId(`${user.org_id}\u0001view\u0001${view}`),
    public_keys: deps.publicKeys ? await deps.publicKeys() : [],
    server_time: now.toISOString(),
  })
}

/** The body as text, or null when it is over `max` UTF-8 bytes: refused on Content-Length before reading, and while streaming (never buffered whole first). */
export async function readLimited(req: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number): Promise<string | null> {
  const cl = req.headers.get("content-length")
  if (cl !== null && /^[0-9]{1,15}$/.test(cl) && Number(cl) > max) {
    await req.body?.cancel().catch(() => {})
    return null
  }
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

async function readBody(req: Request, deps: SyncDeps, max = BODY_MAX_BYTES): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const raw = await readLimited(req, max)
  if (raw === null) return { ok: false, res: respond(req, deps, 413, { error: "Body too large" }) }
  try {
    const v = JSON.parse(raw)
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
    return { ok: true, body: v as Record<string, unknown> }
  } catch {
    return { ok: false, res: respond(req, deps, 400, { error: "Body must be a JSON object" }) }
  }
}

async function pull(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps, PULL_BODY_MAX_BYTES)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
  if (isOrgKind(body.kind)) return orgPull(req, deps, who, now, body)
  const project = body.project_id
  const kind = body.kind
  if (typeof project !== "string" || project === "" || project.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return respond(req, deps, 400, { error: "project_id and kind are required" })

  // EXACT ROWS: {project_id, kind, ids:[...]}. A table without updated_at changes without moving the keyset cursor; the change log names such a row and this fetches it.
  if (body.ids !== undefined) {
    const idList = body.ids
    if (!Array.isArray(idList) || idList.length < 1 || idList.length > PULL_IDS_MAX || !idList.every((x) => typeof x === "string" && ID_RE.test(x))) return respond(req, deps, 400, { error: `ids must be 1 to ${PULL_IDS_MAX} valid ids` })
    if (!(SYNC_KINDS as readonly string[]).includes(kind)) return respond(req, deps, 404, NOT_FOUND)
    const r = await callSql(deps, "projexa_sync_pull_ids", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_ids: idList })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return pageResponse(req, deps, who, now, project, kind, r.data)
  }

  const after = body.after ?? null
  const limitIn = body.limit ?? PULL_LIMIT_DEFAULT
  if (typeof limitIn !== "number" || !Number.isInteger(limitIn) || limitIn < 1 || limitIn > PULL_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${PULL_LIMIT_MAX}` })
  let cur: { ts: string; id: string } | null = null
  if (after !== null) {
    if (typeof after !== "string") return respond(req, deps, 400, { error: "Bad cursor" })
    cur = decodeCursor(after)
    if (!cur) return respond(req, deps, 400, { error: "Bad cursor" })
  }
  // an unsupported kind is the same 404 as an unknown or unreadable project
  if (!(SYNC_KINDS as readonly string[]).includes(kind)) return respond(req, deps, 404, NOT_FOUND)

  const r = await callSql(deps, "projexa_sync_pull", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_after_ts: cur?.ts ?? null, p_after_id: cur?.id ?? null, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  return pageResponse(req, deps, who, now, project, kind, r.data)
}

/** One page of rows (keyset or exact ids): the second money pass, the version, the signature. */
async function pageResponse(req: Request, deps: SyncDeps, who: Who, now: Date, project: string, kind: string, data: Record<string, unknown>): Promise<Response> {
  const built = await buildPageChecked(deps, who, now, project, kind, data)
  // a key is configured but could not be used right now: answer 503 rather than unsigned rows, because the laptop's cursor would move past them and
  // they could never be handed to a peer (review D1 F13). The laptop retries the same page later. No key configured at all (deps.signing absent): unsigned, kid null.
  if (built.signFailed) {
    logLine(deps, "pull: signing unavailable -> 503")
    return respond(req, deps, 503, { error: "Service unavailable. Try again in a minute.", code: "SIGNING_UNAVAILABLE" }, { "Retry-After": "60" })
  }
  return respond(req, deps, 200, built.page)
}

async function buildPage(deps: SyncDeps, who: Who, now: Date, project: string, kind: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await buildPageChecked(deps, who, now, project, kind, data)).page
}

async function buildPageChecked(deps: SyncDeps, who: Who, now: Date, project: string, kind: string, data: Record<string, unknown>): Promise<{ page: Record<string, unknown>; signFailed: boolean }> {
  // an organisation kind has no AI-link kind definition (org_people is NOT the AI link's `people`): its columns and money are decided in SQL (drizzle/0684)
  const def = isOrgKind(kind) ? null : kindDef(kind)
  const hidden = Array.isArray(data.hidden_fields) ? (data.hidden_fields as unknown[]).filter((x): x is string => typeof x === "string") : []
  const moneyVisible = data.money_visible === true
  const rows = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
  // Each row is signed (organisation, project, kind, id, version, updated_at, hash of the row as sent) so another laptop can verify what a peer hands it. Unsigned
  // only when no key is available: then `kid` is null and a laptop will not pass the rows on to peers.
  let signing: Signing | null = null
  let org: string | null = null
  let view: string | null = null
  let signFailed = false
  if (deps.signing) {
    try {
      signing = await deps.signing()
      // the organisation from the SQL page itself when it carries it (no manifest call), else the one-minute memory / one manifest call
      const mem = signing ? await orgOf(deps, who, now) : null
      org = signing ? (typeof data.org_id === "string" ? data.org_id : (mem?.org ?? null)) : null
      view = (isOrgKind(kind) ? mem?.orgView : mem?.view) ?? null
    } catch {
      signing = null
    }
    signFailed = rows.length > 0 && (!signing || !org)
  }
  const items = await Promise.all(
    rows.map(async (it) => {
      const row = (it.data ?? {}) as Record<string, unknown>
      // the second money pass, the AI link's own (the SQL already nulled these columns)
      const safe = def ? redactItem(def, row, { moneyVisible, hiddenFields: hidden }) : row
      const version = typeof it.version === "number" && Number.isInteger(it.version) && it.version >= 0 ? it.version : 0
      const signable = signing && org && typeof it.id === "string" && typeof it.updated_at === "string"
      const sig = signable ? await signing!.signItem({ org: org!, project, kind, id: it.id as string, version, updatedAt: it.updated_at as string, data: safe }) : undefined
      const sig3 = signable && view && signing!.signItemV3 ? await signing!.signItemV3({ org: org!, project, kind, view, id: it.id as string, version, updatedAt: it.updated_at as string, data: safe }) : undefined
      return sig ? { id: it.id, updated_at: it.updated_at, version, data: safe, sig, ...(sig3 ? { sig3 } : {}) } : { id: it.id, updated_at: it.updated_at, version, data: safe }
    }),
  )
  const nextTs = typeof data.next_ts === "string" ? data.next_ts : null
  const nextId = typeof data.next_id === "string" ? data.next_id : null
  return {
    signFailed,
    page: {
      items,
      kid: signing && org ? signing.kid : null,
      next_cursor: nextTs && nextId ? encodeCursor(nextTs, nextId) : null,
      has_more: data.has_more === true,
      hidden_fields: hidden,
      redacted: data.redacted === true || hidden.length > 0 || (!moneyVisible && !!def && def.money_columns.length > 0),
      // the role fingerprint the page was redacted under (0679/0684): a laptop that sees it differ from the one it stored resets that organisation's copy
      ...(typeof data.view_class === "string" ? { view_class: data.view_class } : {}),
      ...(typeof data.org_view_class === "string" ? { org_view_class: data.org_view_class } : {}),
      server_time: now.toISOString(),
    },
  }
}

// POST /changes {project_id, after_seq, limit}: what changed in a project since a sequence number, tombstones included (after_seq null: just the head sequence)
async function changes(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
  const project = body.project_id
  const after = body.after_seq ?? null
  const limitIn = body.limit ?? CHANGES_LIMIT_DEFAULT
  if (typeof project !== "string" || project === "" || project.length > 128) return respond(req, deps, 400, { error: "project_id is required" })
  if (typeof limitIn !== "number" || !Number.isInteger(limitIn) || limitIn < 1 || limitIn > CHANGES_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${CHANGES_LIMIT_MAX}` })
  if (after !== null && (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)) return respond(req, deps, 400, { error: "Bad cursor" })
  // the organisation feed (project "__org__"): only the organisation kinds the person's role may read (decided in SQL)
  const orgFeed = project === ORG_SENTINEL
  const r = orgFeed
    ? await callSql(deps, "projexa_sync_org_changes", { p_sub: who.sub, p_email: who.email, p_after_seq: after, p_limit: limitIn })
    : await callSql(deps, "projexa_sync_changes", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_after_seq: after, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const list = Array.isArray(r.data.changes) ? (r.data.changes as Array<Record<string, unknown>>) : []
  const allowedKinds: readonly string[] = orgFeed ? ORG_KINDS : SYNC_KINDS
  return respond(req, deps, 200, {
    changes: list
      .filter((c) => typeof c.kind === "string" && allowedKinds.includes(c.kind) && typeof c.id === "string")
      .map((c) => ({ seq: Number(c.seq), kind: c.kind, id: c.id, version: Number(c.version), op: c.op })),
    next_seq: Number(r.data.next_seq ?? 0),
    has_more: r.data.has_more === true,
    head_seq: Number(r.data.head_seq ?? 0),
    // 0679: the cursor is commit-order safe; reset_required = this laptop's cursor is older than the pruned history or from another database state, so it must
    // resync the project (keyset pull + /ids) and continue from head_seq; epoch changes when the version tables were re-created (a rollback)
    reset_required: r.data.reset_required === true,
    epoch: typeof r.data.epoch === "string" ? r.data.epoch : null,
    server_time: now.toISOString(),
  })
}
// ---------------------------------------------------------------------------------------------------------------------------------
// Releases: the registry the laptop's downloaded app is matched against (drizzle/0680)
// ---------------------------------------------------------------------------------------------------------------------------------
const RELEASE_RE = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}$/

/** The registry's newest release, remembered for a minute. null = the registry could not be read (then nobody is told to update). */
async function getRelease(deps: SyncDeps, now: Date, fresh = false): Promise<ReleaseInfo | null> {
  deps.releaseBox ??= { at: 0, value: null }
  const box = deps.releaseBox
  if (!fresh && box.value && now.getTime() - box.at < RELEASE_TTL_MS) return box.value
  try {
    const res = await deps.rpc("projexa_release_current", {})
    if (res.error) return box.value
    const d = (res.data ?? {}) as Record<string, unknown>
    box.value = { registered: d.registered === true, current: (d.current ?? null) as Record<string, unknown> | null, min_compatible: typeof d.min_compatible === "string" ? d.min_compatible : "" }
    box.at = now.getTime()
    return box.value
  } catch {
    return box.value
  }
}

/** X-Px-Client: "<release>; protocol=<n>; schema=<n>" */
export function parseClientHeader(h: string | null): { release: string | null; protocol: number | null; schema: number | null } | null {
  if (!h) return null
  const parts = h.split(";").map((s) => s.trim())
  const out = { release: parts[0] || null, protocol: null as number | null, schema: null as number | null }
  for (const p of parts.slice(1)) {
    const m = /^(protocol|schema)=(\d{1,4})$/.exec(p)
    if (m) out[m[1] as "protocol" | "schema"] = Number(m[2])
  }
  return out
}

/**
 * 426 only when the laptop is OLDER than the server: its protocol is below SERVER_PROTOCOL, or its release is below the floor. A laptop with no header,
 * or a dev build, is never blocked. A NEWER protocol (laptops updated before this function was redeployed, or the function rolled back) is not something
 * the laptop can fix by updating: it gets a retryable 503 SERVER_UPDATING and keeps its queue (review D1 F-09). Deploy order: server first, then release.
 */
async function updateRequired(req: Request, deps: SyncDeps, now: Date): Promise<Response | null> {
  const client = parseClientHeader(req.headers.get("x-px-client"))
  if (!client) return null
  if (client.protocol !== null && client.protocol > SERVER_PROTOCOL) {
    return respond(req, deps, 503, { error: "The server is being updated. Try again in a few minutes.", code: "SERVER_UPDATING", protocol: SERVER_PROTOCOL }, { "Retry-After": "300" })
  }
  const rel = await getRelease(deps, now)
  const protocolBad = client.protocol !== null && client.protocol < SERVER_PROTOCOL
  const floor = rel?.min_compatible ?? ""
  const releaseBad = floor !== "" && client.release !== null && RELEASE_RE.test(client.release) && client.release < floor
  if (!protocolBad && !releaseBad) return null
  return respond(req, deps, 426, { error: "Update required", code: "UPDATE_REQUIRED", current: (rel?.current?.release_version as string | undefined) ?? null, min_compatible: floor || null, protocol: SERVER_PROTOCOL, reason: protocolBad ? "protocol" : "release" })
}

async function releaseCurrent(req: Request, deps: SyncDeps, now: Date): Promise<Response> {
  const rel = await getRelease(deps, now)
  if (!rel) return respond(req, deps, 503, { error: "Service unavailable. Try again in a minute." })
  // ?files=0: the version, digest and floor without the file table (up to 5,000 rows): what a laptop needs to learn THAT it should update (review D1 F7)
  let current = rel.current
  if (current && new URL(req.url).searchParams.get("files") === "0") {
    const { files: _files, ...light } = current
    current = light
  }
  // `registered` answers the question the laptop asks: is the release I REPORTED (X-Px-Client) the one the registry holds as current? It used to say
  // "the registry holds some release", so after the first registration no newer build was ever registered and every install record for it was
  // refused (400). A laptop that names no release, or a non-release build name (a commit, "dev"), is told what the registry holds.
  const clientRelease = parseClientHeader(req.headers.get("x-px-client"))?.release ?? null
  const reportsRelease = clientRelease !== null && /^\d{4}\.\d{2}\.\d{2}-\d{3}$/.test(clientRelease)
  const currentVersion = current && typeof (current as Record<string, unknown>).release_version === "string" ? ((current as Record<string, unknown>).release_version as string) : null
  const registered = rel.registered && (!reportsRelease || clientRelease === currentVersion)
  return respond(req, deps, 200, { registered, current, min_compatible: rel.min_compatible || null, protocol: SERVER_PROTOCOL, server_time: now.toISOString() })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Signing-key caches for index.ts (pure: the rpc and the crypto helpers are passed in, so bun tests them; review D1 F-11)
//   * a refresh that fails keeps serving the last good key (a database blip after the TTL no longer makes /pull answer unsigned rows)
//   * concurrent cold requests share ONE load (no N x generateKeyRecord + 2 RPCs)
//   * an errored or empty public-key list is not cached (a transient failure no longer hands out `public_keys: []` for 5 minutes)
// ---------------------------------------------------------------------------------------------------------------------------------
export const KEY_TTL_MS = 5 * 60_000
export function createKeyCaches(o: {
  rpc: Rpc
  createSigning: (rec: KeyRecord) => Promise<Signing>
  generateKeyRecord: () => Promise<KeyRecord>
  clock?: () => number
}): { signing: () => Promise<Signing | null>; publicKeys: () => Promise<PublicKeyInfo[]> } {
  const clock = o.clock ?? (() => Date.now())
  let signingCache: { signing: Signing; at: number } | null = null
  let signingLoad: Promise<Signing | null> | null = null
  let publicCache: { keys: PublicKeyInfo[]; at: number } | null = null
  let publicLoad: Promise<PublicKeyInfo[]> | null = null

  const loadSigning = async (): Promise<Signing | null> => {
    let res = await o.rpc("projexa_sync_key_active")
    if (res.error) throw new Error("key read failed")
    let rec = res.data as KeyRecord | null
    if (!rec) {
      const fresh = await o.generateKeyRecord()
      res = await o.rpc("projexa_sync_key_put", { p_kid: fresh.kid, p_public: fresh.public_jwk, p_private: fresh.private_jwk })
      if (res.error) throw new Error("key put failed")
      rec = res.data as KeyRecord | null
    }
    if (!rec || !rec.private_jwk) throw new Error("no key")
    const signing = await o.createSigning(rec)
    signingCache = { signing, at: clock() }
    return signing
  }
  const loadPublic = async (): Promise<PublicKeyInfo[]> => {
    const res = await o.rpc("projexa_sync_public_keys")
    if (res.error || !Array.isArray(res.data)) throw new Error("public keys failed")
    const keys = res.data as PublicKeyInfo[]
    if (keys.length > 0) publicCache = { keys, at: clock() }
    return keys
  }
  return {
    async signing() {
      if (signingCache && clock() - signingCache.at < KEY_TTL_MS) return signingCache.signing
      signingLoad ??= loadSigning().finally(() => {
        signingLoad = null
      })
      try {
        return await signingLoad
      } catch {
        return signingCache?.signing ?? null
      }
    },
    async publicKeys() {
      if (publicCache && clock() - publicCache.at < KEY_TTL_MS) return publicCache.keys
      publicLoad ??= loadPublic().finally(() => {
        publicLoad = null
      })
      try {
        return await publicLoad
      } catch {
        return publicCache?.keys ?? []
      }
    },
  }
}

/**
 * Registers what the OWNER published at projexa-ai.com/_release/release.json. Takes no input: nothing a caller sends is registered. Laptops call it
 * (release-client.ts), so it stays person-callable, but it costs an outbound fetch of up to 2 MB from Vercel and an advisory-locked RPC: the isolate
 * fetches at most once per REGISTER_COOLDOWN_MS whoever asks and replays its last answer meanwhile, and an "already registered" answer no longer forces
 * a fresh read of the registry (review D1 F-01).
 */
async function releaseRegister(req: Request, deps: SyncDeps, now: Date): Promise<Response> {
  deps.registerBox ??= { at: 0, answer: null }
  const box = deps.registerBox
  if (box.answer && now.getTime() - box.at < REGISTER_COOLDOWN_MS) return respond(req, deps, box.answer.status, box.answer.body)
  const res = await releaseRegisterOnce(deps, now)
  box.at = now.getTime()
  box.answer = res
  return respond(req, deps, res.status, res.body)
}

async function releaseRegisterOnce(deps: SyncDeps, now: Date): Promise<{ status: number; body: unknown }> {
  const answer = (status: number, body: unknown) => ({ status, body })
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let text: string | null
  try {
    const res = await doFetch(RELEASE_MANIFEST_URL, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return answer(502, { error: "The release manifest could not be read.", code: "MANIFEST_UNREACHABLE" })
    }
    // a real Response is read as a stream and stopped at the cap; anything else that only offers text() is measured in bytes after the fact
    if (res.headers instanceof Headers && res.body instanceof ReadableStream) text = await readLimited(res, RELEASE_MANIFEST_MAX_BYTES)
    else {
      const t = await res.text()
      text = utf8Bytes(t) > RELEASE_MANIFEST_MAX_BYTES ? null : t
    }
  } catch {
    return answer(502, { error: "The release manifest could not be read.", code: "MANIFEST_UNREACHABLE" })
  }
  if (text === null) return answer(502, { error: "The release manifest is too large.", code: "MANIFEST_BAD" })
  let manifest: Record<string, unknown>
  try {
    const v = JSON.parse(text)
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
    manifest = v as Record<string, unknown>
  } catch {
    return answer(502, { error: "The release manifest is not valid.", code: "MANIFEST_BAD" })
  }
  // the digest must be the digest of the manifest it sits in: a manifest altered in transit, or hand-edited, is refused
  const { manifest_sha256: claimed, ...rest } = manifest
  if (typeof claimed !== "string" || claimed !== (await sha256Hex(canonicalize(rest)))) return answer(502, { error: "The release manifest does not match its own digest.", code: "MANIFEST_BAD" })
  const res = await Promise.resolve()
    .then(() => deps.rpc("projexa_release_register", { p_manifest: manifest }))
    .catch(() => null)
  if (!res) return answer(503, { error: "Service unavailable. Try again in a minute." })
  if (res.error) {
    const code = res.error.code ?? ""
    if (code === "AW409") return answer(409, { error: "That release version is already registered with different content.", code: "VERSION_TAKEN" })
    if (code === "AW400") return answer(502, { error: "The release manifest is not valid.", code: "MANIFEST_BAD" })
    return answer(500, { error: "Something failed on our side. Try again in a minute." })
  }
  const data = (res.data ?? {}) as Record<string, unknown>
  // only a NEW registration changes what is current; "already registered" leaves the memory as it is
  if (data.registered === true) await getRelease(deps, now, true)
  return answer(200, { ...data, server_time: now.toISOString() })
}

// POST /install {device_id, release_version, manifest_sha256, previous_release, downloaded_at, installed_at, files, bytes, status, error}: one row of that laptop's install history
async function install(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps)
  if (!parsed.ok) return parsed.res
  const b = parsed.body
  // a field that is ABSENT is null; a field that is present but invalid is a 400 (never silently dropped)
  const absent = (v: unknown) => v === undefined || v === null
  let bad = false
  const str = (v: unknown, max: number): string | null => {
    if (absent(v)) return null
    if (typeof v === "string" && v.length > 0 && v.length <= max) return v
    bad = true
    return null
  }
  const when = (v: unknown): string | null => {
    if (absent(v)) return null
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v))) return v
    bad = true
    return null
  }
  const int = (v: unknown, max: number): number | null => {
    if (absent(v)) return null
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max) return v
    bad = true
    return null
  }
  const device = str(b.device_id, 64)
  const release = str(b.release_version, 32)
  const status = str(b.status, 16)
  const downloaded = when(b.downloaded_at)
  const fields = { manifest: str(b.manifest_sha256, 64), previous: str(b.previous_release, 32), installed: when(b.installed_at), files: int(b.files, 100000), bytes: int(b.bytes, 10_000_000_000) }
  if (!device || !release || !status || !downloaded || bad) return respond(req, deps, 400, { error: "device_id, release_version, status and downloaded_at are required, and every other field must be valid" })
  const r = await callSql(deps, "projexa_install_record", {
    p_sub: who.sub,
    p_email: who.email,
    p_device_id: device,
    p_release_version: release,
    p_manifest_sha256: fields.manifest,
    p_previous_release: fields.previous,
    p_downloaded_at: downloaded,
    p_installed_at: fields.installed,
    p_files: fields.files,
    p_bytes: fields.bytes,
    p_status: status,
    p_error: typeof b.error === "string" ? b.error.slice(0, 300) : null,
  })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  return respond(req, deps, 200, { recorded: r.data.recorded, server_time: now.toISOString() })
}
// ---------------------------------------------------------------------------------------------------------------------------------
// PREPARE: what a laptop's "Preparing your PROJEXA workspace" run is doing (drizzle/0688). A report, never a command: it changes nothing
// about what the laptop may read or write. Update-exempt: a laptop too old to sync must still be able to say it is stuck.
// ---------------------------------------------------------------------------------------------------------------------------------
async function prepare(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps, 4096)
  if (!parsed.ok) return parsed.res
  const b = parsed.body
  const device = typeof b.device_id === "string" ? b.device_id : ""
  const stage = typeof b.stage === "string" ? b.stage : ""
  const status = typeof b.status === "string" ? b.status : ""
  const percent = typeof b.percent === "number" && Number.isInteger(b.percent) ? b.percent : -1
  const attempt = typeof b.attempt === "number" && Number.isInteger(b.attempt) ? b.attempt : 1
  const release = typeof b.release_version === "string" && b.release_version.length > 0 && b.release_version.length <= 40 ? b.release_version : null
  const errorClass = typeof b.error_class === "string" && b.error_class.length <= 40 ? b.error_class : null
  const detail = typeof b.error_detail === "string" ? b.error_detail.slice(0, 300) : null
  if (!device || !stage || !status || percent < 0) return respond(req, deps, 400, { error: "device_id, stage, status and percent are required" })
  const r = await callSql(deps, "projexa_prepare_report", {
    p_sub: who.sub, p_email: who.email, p_device_id: device, p_release_version: release, p_stage: stage, p_percent: percent,
    p_status: status, p_attempt: attempt, p_error_class: errorClass, p_error_detail: detail,
  })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  return respond(req, deps, 200, { recorded: true, server_time: now.toISOString() })
}
// ---------------------------------------------------------------------------------------------------------------------------------
// PUSH: what a person edited on their laptop (drizzle/0681 decides, the real pipeline writes)
// ---------------------------------------------------------------------------------------------------------------------------------
// WHAT A FAILED RUN MEANS (review D1 SYNC-04 / tests-quality:F02). The codes are the ones the pipeline REALLY returns (src/lib/pipeline/error-codes.ts
// PIPELINE_ERROR_CODES, normaliseThrownError) plus the few the exec function and the service layer add; projexa-sync-edge-push.test.ts fails when a pipeline
// code has no deliberate class here. Three classes:
//   rejected      a definite business refusal (the request's own fault): sending the same op again gives the same answer. Terminal.
//   failed        our side (BACKEND_UNAVAILABLE = could not connect, UPSTREAM_TIMEOUT = the statement was cancelled and its transaction rolled back,
//                 INTERNAL_ERROR, the exec function not reachable): nothing was kept, the SAME op_id may run again, later ops on the record wait.
//   needs_server  the function cannot run on the edge (FUNCTION_NOT_AVAILABLE): the laptop keeps the op and offers the normal online path.
// A code NOT in this table defaults to `failed`: an unknown code must never turn a transient fault into a permanent loss of the person's edit (the
// worst an unknown business code can cost is a bounded retry, never data).
export type FailureClass = "rejected" | "failed" | "needs_server"
export const PUSH_FAILURE_CLASS: Readonly<Record<string, FailureClass>> = {
  // the pipeline's closed vocabulary: what the request is missing / names wrongly / may not do
  PROJECT_REQUIRED: "rejected", BOQ_LINE_REQUIRED: "rejected", VALUE_REQUIRED: "rejected", DATE_REQUIRED: "rejected", WORKER_REQUIRED: "rejected",
  TITLE_REQUIRED: "rejected", TASK_REQUIRED: "rejected", ACTIVITY_REQUIRED: "rejected", HOURS_REQUIRED: "rejected", MATERIAL_REQUIRED: "rejected",
  QUANTITY_REQUIRED: "rejected", CATEGORY_REQUIRED: "rejected", LINK_REQUIRED: "rejected", BOQ_VERSION_REQUIRED: "rejected",
  BOQ_LINE_NOT_FOUND: "rejected", BOQ_LINE_IS_PARENT: "rejected", PROJECT_NOT_REACHABLE: "rejected", VALUE_OUT_OF_RANGE: "rejected",
  RECORD_NOT_FOUND: "rejected", ALREADY_RECORDED: "rejected", REQUEST_REJECTED: "rejected",
  TOTAL_MISMATCH: "rejected", BOQ_SEALED: "rejected", DUPLICATE_ITEM_CODE: "rejected",
  NOT_PERMITTED: "rejected", READ_AS_QUESTION: "rejected",
  // a previous step of the same submission failed; for a one-op push that step may have been transient, so it may run again
  DEPENDENCY_FAILED: "failed",
  FUNCTION_NOT_AVAILABLE: "needs_server",
  // our side: never the person's fault, the same op may run again (the pipeline's RETRYABLE_ERROR_CODES are both here)
  BACKEND_UNAVAILABLE: "failed", UPSTREAM_TIMEOUT: "failed", INTERNAL_ERROR: "failed",
  // the exec function's own answers (ai-work-link-exec/handler.ts) and this function's
  BAD_CLAIM: "failed", SYNC_NOT_AVAILABLE: "failed", NOT_CONFIGURED: "failed", RETRY_LATER: "failed",
  // the push-ledger claim of /sync-run (nothing ran): the row was not `running` any more, or the claim could not be read
  NOT_CLAIMED: "failed", CLAIM_UNAVAILABLE: "failed",
  BAD_OP: "rejected", TOO_LARGE: "rejected", BAD_REQUEST: "rejected",
  // ServiceError codes services raise for a business condition (src/lib/services/*: `new ServiceError(msg, 4xx, "CODE")`)
  VALIDATION_FAILED: "rejected", VALIDATION: "rejected", TEXT_TOO_LONG: "rejected", NOT_FOUND: "rejected",
}
export function classifyFailure(code: string): FailureClass {
  return Object.prototype.hasOwnProperty.call(PUSH_FAILURE_CLASS, code) ? PUSH_FAILURE_CLASS[code] : "failed"
}

// THE SHAPE OF AN OP, checked here BEFORE any database call (review D1 F-02, F-03, F-08). The same rules as projexa_sync_push_begin's step 1 (drizzle/0681),
// so a malformed op costs no RPC, plus three the SQL cannot apply cheaply: the op's size in UTF-8 BYTES (the exec function measures bytes, the SQL
// measured characters: a 25,000-character Devanagari note passed the SQL and was refused by exec forever), no U+0000 (Postgres jsonb cannot store it, so
// begin would fail and, before this, fail the whole batch) and a nesting limit. PUSH_OP_MAX_BYTES leaves room under the exec cap (72 KiB) for the context
// the exec body adds, so an op accepted here can always be sent to exec.
export const PUSH_OP_MAX_BYTES = 60_000
export const PUSH_OP_MAX_DEPTH = 32
const OP_ID_RE = /^[A-Za-z0-9_-]{8,128}$/
const FN_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const te = new TextEncoder()
export const utf8Bytes = (s: string): number => te.encode(s).length

function depthOf(v: unknown, d = 0): number {
  if (v === null || typeof v !== "object") return d
  let m = d + 1
  for (const x of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
    m = Math.max(m, depthOf(x, d + 1))
    if (m > PUSH_OP_MAX_DEPTH) return m
  }
  return m
}

export type OpCheck = { ok: true; op: Record<string, unknown>; opId: string } | { ok: false; opId: string | null; code: "BAD_OP" | "TOO_LARGE" }
export function checkOp(raw: unknown): OpCheck {
  const op = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const opId = op && typeof op.op_id === "string" ? op.op_id : null
  if (!op || !opId || !OP_ID_RE.test(opId)) return { ok: false, opId, code: "BAD_OP" }
  const fn = op.function_id
  if (typeof fn !== "string" || !FN_ID_RE.test(fn)) return { ok: false, opId, code: "BAD_OP" }
  if (op.params === null || typeof op.params !== "object" || Array.isArray(op.params)) return { ok: false, opId, code: "BAD_OP" }
  const project = op.project_id
  if (fn === "create_project" ? project !== undefined && project !== null : typeof project !== "string" || project === "" || project.length > 128) return { ok: false, opId, code: "BAD_OP" }
  const rec = op.record
  if (rec !== undefined && rec !== null) {
    if (typeof rec !== "object" || Array.isArray(rec)) return { ok: false, opId, code: "BAD_OP" }
    const r = rec as Record<string, unknown>
    const bv = r.base_version
    const bvOk = (typeof bv === "number" && Number.isSafeInteger(bv) && bv >= 0 && String(bv).length <= 15) || (typeof bv === "string" && /^[0-9]{1,15}$/.test(bv))
    if (typeof r.kind !== "string" || !(SYNC_KINDS as readonly string[]).includes(r.kind) || typeof r.id !== "string" || !ID_RE.test(r.id) || !bvOk) return { ok: false, opId, code: "BAD_OP" }
  }
  let text: string
  try {
    text = JSON.stringify(op)
  } catch {
    return { ok: false, opId, code: "BAD_OP" }
  }
  if (text.includes("\\u0000") || depthOf(op) > PUSH_OP_MAX_DEPTH) return { ok: false, opId, code: "BAD_OP" }
  if (utf8Bytes(text) > PUSH_OP_MAX_BYTES) return { ok: false, opId, code: "TOO_LARGE" }
  return { ok: true, op, opId }
}

// THE EXEC FUNCTION'S ANSWER -> what happened (review D1 tests-quality:F06, F-03, F-07, F-14c). Pure and exported so it is tested as a table; index.ts only
// supplies fetch, the URL and the secret.
//   network error / abort / timeout, 5xx (500, 502, 504, 546 ...) or an unreadable 200     -> uncertain   (the run may have started: never blindly re-run)
//   400 BAD_REQUEST (the body was refused before anything ran; it will be refused again)  -> failed BAD_OP (classified rejected, terminal: no poison op)
//   413 (a gateway refused the size)                                                       -> failed TOO_LARGE (terminal)
//   401, 404, 405, 429, 503 and any other 4xx (refused before anything ran)                -> unavailable (retry later, nothing was written)
// Every early return cancels the response body so a failed op does not hold a connection until garbage collection.
export function execOutcomeOf(status: number, body: unknown): ExecOutcome {
  if (status === 400) return { kind: "failed", code: "BAD_OP", missing: [] }
  if (status === 413) return { kind: "failed", code: "TOO_LARGE", missing: [] }
  if (status >= 500 && status !== 503) return { kind: "uncertain" }
  if (status !== 200) return { kind: "unavailable" }
  const j = (body ?? null) as { status?: string; record?: { id?: string | null; route?: string | null }; submission_id?: string | null; code?: string; missing?: unknown } | null
  if (!j || typeof j !== "object") return { kind: "uncertain" }
  if (j.status === "done") return { kind: "done", record: { id: j.record?.id ?? null, route: j.record?.route ?? null }, submission_id: j.submission_id ?? null }
  if (j.status === "failed" && typeof j.code === "string") return { kind: "failed", code: j.code, missing: Array.isArray(j.missing) ? (j.missing as unknown[]).filter((m): m is string => typeof m === "string") : [] }
  // the batch route's "this op was not started" (the exec function's own time budget ran out before it): nothing ran
  if (j.status === "not_run") return { kind: "unavailable" }
  return { kind: "uncertain" }
}

export const EXEC_TIMEOUT_MS = 25_000
export const EXEC_BATCH_TIMEOUT_MS = 50_000
type ExecClientOptions = { url: string; secret: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number; batchTimeoutMs?: number }

async function execPost(o: ExecClientOptions, path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown } | null> {
  const doFetch = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let res: Response
  try {
    res = await doFetch(`${o.url}/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${o.secret}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    return null
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {})
    return { status: res.status, json: null }
  }
  try {
    return { status: 200, json: await res.json() }
  } catch {
    return { status: 200, json: null }
  }
}

/** One pushed write through POST {url}/sync-run. */
export function createExecRun(o: ExecClientOptions): (body: ExecRunBody) => Promise<ExecOutcome> {
  return async (body) => {
    if (!o.secret || !o.url) return { kind: "unavailable" }
    const r = await execPost(o, "sync-run", body, o.timeoutMs ?? EXEC_TIMEOUT_MS)
    return r ? execOutcomeOf(r.status, r.json) : { kind: "uncertain" }
  }
}

/** Several pushed writes through ONE call to POST {url}/sync-run-batch (one Edge invocation instead of one per op; review D1 F8 / F-02). */
export function createExecRunBatch(o: ExecClientOptions): (bodies: ExecRunBody[]) => Promise<ExecOutcome[]> {
  return async (bodies) => {
    if (!o.secret || !o.url) return bodies.map(() => ({ kind: "unavailable" }) as ExecOutcome)
    const r = await execPost(o, "sync-run-batch", { ops: bodies }, o.batchTimeoutMs ?? EXEC_BATCH_TIMEOUT_MS)
    if (!r) return bodies.map(() => ({ kind: "uncertain" }) as ExecOutcome)
    // an exec function deployed before the batch route existed answers 404 NOT_FOUND (nothing ran): fall back to one call per op, so deploy order never breaks push
    if (r.status === 404) {
      const one = createExecRun(o)
      const out: ExecOutcome[] = []
      for (const b of bodies) out.push(await one(b))
      return out
    }
    if (r.status !== 200) {
      const one = execOutcomeOf(r.status, null)
      return bodies.map(() => one)
    }
    const list = (r.json as { results?: unknown } | null)?.results
    if (!Array.isArray(list)) return bodies.map(() => ({ kind: "uncertain" }) as ExecOutcome)
    // an answer per op, matched by op_id (never by position alone); a missing one is uncertain (it may have run)
    const byId = new Map<string, unknown>()
    for (const x of list) if (x && typeof x === "object" && typeof (x as { op_id?: unknown }).op_id === "string") byId.set((x as { op_id: string }).op_id, x)
    return bodies.map((b) => (byId.has(b.op_id) ? execOutcomeOf(200, byId.get(b.op_id)) : ({ kind: "uncertain" } as ExecOutcome)))
  }
}

type PushResult = Record<string, unknown>

/** The signed current rows of several records of one kind in one call (a conflict shows the row; an applied op returns it at its new version). */
async function signedRows(deps: SyncDeps, who: Who, now: Date, project: string, kind: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>()
  const list = [...new Set(ids)].filter((x) => ID_RE.test(x)).slice(0, PULL_IDS_MAX)
  if (list.length === 0) return out
  const r = await callSql(deps, "projexa_sync_pull_ids", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_ids: list })
  if (!r.ok) return out
  const page = await buildPage(deps, who, now, project, kind, r.data)
  for (const it of page.items as Array<Record<string, unknown>>) {
    if (typeof it.id === "string") out.set(it.id, { kind, id: it.id, version: it.version, updated_at: it.updated_at, data: it.data, sig: it.sig ?? null, kid: page.kid })
  }
  return out
}

async function push(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps, PUSH_BODY_MAX_BYTES)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
  const device = body.device_id
  const ops = body.ops
  if (typeof device !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(device)) return respond(req, deps, 400, { error: "device_id is required" })
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > PUSH_OPS_MAX) return respond(req, deps, 400, { error: `ops must be 1 to ${PUSH_OPS_MAX} operations` })
  if (!deps.execRun && !deps.execRunBatch) return respond(req, deps, 503, { error: "Saving to the server is not available right now. Your changes stay on this laptop.", code: "PUSH_NOT_AVAILABLE" })
  const clock = deps.clock ?? (() => Date.now())
  const startedAt = clock()

  // results[i] answers ops[i], whatever order they are settled in
  const results: Array<PushResult | undefined> = new Array(ops.length)
  // a record whose earlier op in this batch did not apply keeps its later ops waiting (order matters), without running them
  const held = new Set<string>()
  // ops the SQL said to RUN, not yet sent to the exec function (batch mode); never two of the same record (order on one record is kept by flushing first)
  type Pending = { i: number; opId: string; op: Record<string, unknown>; ctx: ExecRunBody["ctx"]; rec: Record<string, unknown> | null; recKey: string | null; hint: string | null; project: string | null }
  let pending: Pending[] = []
  // conflicts whose current server row is fetched once per (project, kind) at the end
  const conflicts: Array<{ i: number; project: string | null; kind: string; id: string }> = []
  const applied: Array<{ i: number; project: string; kind: string; id: string }> = []
  let begunAny = false
  let beginErrorsInARow = 0

  const finish = async (p: Pending, status: string, result: unknown, code: string | null, kind: string | null, id: string | null) => {
    const r = await Promise.resolve()
      .then(() => deps.rpc("projexa_sync_push_finish", { p_user_id: p.ctx.user_id, p_op_id: p.opId, p_status: status, p_result: result, p_error_code: code, p_record_kind: kind, p_record_id: id }))
      .catch(() => null)
    return r && !r.error ? ((r.data ?? {}) as Record<string, unknown>) : null
  }
  const holdKey = (k: string | null) => {
    if (k) held.add(k)
  }
  const uncertainResult = (opId: string): PushResult => ({ op_id: opId, status: "failed", uncertain: true, error: { code: "EXECUTION_UNCERTAIN" } })

  /** Sends the pending ops to the exec function (one call in batch mode) and settles each one in the ledger. */
  const flush = async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const bodies = batch.map((p) => ({ op_id: p.opId, function_id: String(p.op.function_id), params: (p.op.params ?? {}) as Record<string, unknown>, ctx: p.ctx }))
    let outcomes: ExecOutcome[]
    if (deps.execRunBatch) {
      try {
        outcomes = await deps.execRunBatch(bodies)
        if (!Array.isArray(outcomes) || outcomes.length !== batch.length) outcomes = batch.map(() => ({ kind: "uncertain" }))
      } catch {
        outcomes = batch.map(() => ({ kind: "uncertain" }))
      }
    } else {
      outcomes = []
      for (const b of bodies) {
        try {
          outcomes.push(await (deps.execRun as NonNullable<SyncDeps["execRun"]>)(b))
        } catch {
          outcomes.push({ kind: "uncertain" })
        }
      }
    }
    for (let k = 0; k < batch.length; k++) {
      const p = batch[k]
      const outcome = outcomes[k]
      if (outcome.kind === "done") {
        const kind = p.hint ?? (p.rec && typeof p.rec.kind === "string" ? p.rec.kind : null)
        const id = outcome.record.id ?? (p.rec && typeof p.rec.id === "string" ? p.rec.id : null)
        const fin = await finish(p, "applied", { id: outcome.record.id, route: outcome.record.route, submission_id: outcome.submission_id }, null, kind, id)
        if (!fin) {
          // the write happened but its ledger row could not be closed: the row reads "uncertain" after 10 minutes, and the laptop must not blindly re-send
          holdKey(p.recKey)
          results[p.i] = uncertainResult(p.opId)
          logLine(deps, "push: finish failed after a done run -> EXECUTION_UNCERTAIN")
          continue
        }
        results[p.i] = { op_id: p.opId, status: "applied", record_id: id, route: outcome.record.route, version: fin.version ?? null, server: null }
        if (kind && id && p.project) applied.push({ i: p.i, project: p.project, kind, id })
        continue
      }
      if (outcome.kind === "failed") {
        const cls = classifyFailure(outcome.code)
        await finish(p, cls, { missing: outcome.missing }, outcome.code, null, null)
        if (cls !== "rejected") holdKey(p.recKey)
        results[p.i] = { op_id: p.opId, status: cls, error: { code: outcome.code, missing: outcome.missing } }
        continue
      }
      if (outcome.kind === "unavailable") {
        holdKey(p.recKey)
        await finish(p, "failed", null, "SYNC_NOT_AVAILABLE", null, null)
        results[p.i] = { op_id: p.opId, status: "failed", error: { code: "SYNC_NOT_AVAILABLE" } }
        continue
      }
      // uncertain: the call went out and nothing came back
      holdKey(p.recKey)
      await finish(p, "uncertain", null, "EXECUTION_UNCERTAIN", null, null)
      results[p.i] = uncertainResult(p.opId)
      logLine(deps, "push: exec answer lost -> EXECUTION_UNCERTAIN")
    }
  }

  /** Every op not yet answered gets the same retryable answer (nothing ran for it). */
  const answerRest = (from: number, code: string) => {
    for (let j = from; j < ops.length; j++) {
      if (results[j]) continue
      const c = checkOp(ops[j])
      results[j] = { op_id: c.opId, status: c.ok ? "failed" : "rejected", error: { code: c.ok ? code : c.code } }
    }
  }

  for (let i = 0; i < ops.length; i++) {
    const checked = checkOp(ops[i])
    if (!checked.ok) {
      results[i] = { op_id: checked.opId, status: "rejected", error: { code: checked.code } }
      continue
    }
    const { op, opId } = checked
    const rec = op.record !== null && typeof op.record === "object" && !Array.isArray(op.record) ? (op.record as Record<string, unknown>) : null
    const recKey = rec && typeof rec.kind === "string" && typeof rec.id === "string" ? `${rec.kind}:${rec.id}` : null
    const hint = typeof op.record_kind === "string" && (SYNC_KINDS as readonly string[]).includes(op.record_kind) ? op.record_kind : null
    const project = typeof op.project_id === "string" ? op.project_id : null

    // an earlier op on the same record is still waiting to run: run it first, so its outcome decides this one
    if (recKey && pending.some((p) => p.recKey === recKey)) await flush()
    if (recKey && held.has(recKey)) {
      results[i] = { op_id: opId, status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } }
      continue
    }

    // the DEADLINE (review D1 F-07): no new op starts after PUSH_START_CUTOFF_MS, so a push always answers inside the laptop's 60 s timeout and the
    // platform's wall clock; the rest come back RETRY_LATER (nothing ran for them, the laptop sends them in its next push)
    if (clock() - startedAt > PUSH_START_CUTOFF_MS) {
      await flush()
      answerRest(i, "RETRY_LATER")
      break
    }

    const begin = await callSql(deps, "projexa_sync_push_begin", { p_sub: who.sub, p_email: who.email, p_device_id: device, p_op: op })
    if (!begin.ok) {
      // not linked / service down: before anything ran, the whole batch is refused as before; after, the ops already settled keep their answers
      if (begin.status === 403 || begin.status === 503) {
        if (!begunAny) return respond(req, deps, begin.status, begin.body)
        await flush()
        answerRest(i, begin.status === 403 ? "NOT_LINKED" : "SERVICE_UNAVAILABLE")
        break
      }
      // a failure of THIS op only (an SQL error on its content, a cap): it gets its own answer and the batch goes on (review D1 F-08)
      beginErrorsInARow++
      if (begin.status === 400 || begin.status === 404) {
        results[i] = { op_id: opId, status: "rejected", error: { code: "BAD_OP" } }
      } else {
        holdKey(recKey)
        results[i] = { op_id: opId, status: "failed", error: { code: begin.status === 429 ? "RATE_LIMITED" : "BEGIN_FAILED" } }
        logLine(deps, `push: begin failed with ${begin.status}`)
      }
      // the database is failing every op: stop paying for the rest
      if (beginErrorsInARow >= PUSH_MAX_BEGIN_ERRORS_IN_A_ROW) {
        await flush()
        answerRest(i + 1, "RETRY_LATER")
        break
      }
      continue
    }
    beginErrorsInARow = 0
    begunAny = true
    const action = begin.data.action

    if (action === "reject") {
      results[i] = { op_id: opId, status: "rejected", error: { code: String(begin.data.code ?? "REJECTED") } }
      continue
    }
    if (action === "retry") {
      holdKey(recKey)
      const code = String(begin.data.code ?? "RETRY")
      results[i] = code === "EXECUTION_UNCERTAIN" ? uncertainResult(opId) : { op_id: opId, status: "failed", error: { code } }
      continue
    }
    if (action === "duplicate") {
      const stored = (begin.data.result ?? {}) as Record<string, unknown>
      if (begin.data.stored_status === "applied") {
        results[i] = { op_id: opId, status: "duplicate", record_id: stored.id ?? begin.data.record_id ?? null, route: stored.route ?? null, version: begin.data.version ?? null }
      } else {
        results[i] = { op_id: opId, status: "rejected", error: { code: String(begin.data.error_code ?? "REJECTED") } }
      }
      continue
    }
    if (action === "conflict") {
      holdKey(recKey)
      const kind = String(begin.data.kind)
      results[i] = { op_id: opId, status: "conflict", version: begin.data.server_version, base_version: begin.data.base_version, server: null }
      conflicts.push({ i, project, kind, id: String(begin.data.id) })
      continue
    }
    if (action !== "run" || !begin.data.ctx || typeof begin.data.ctx !== "object") {
      holdKey(recKey)
      results[i] = { op_id: opId, status: "failed", error: { code: "BAD_ANSWER" } }
      continue
    }

    // RUN: the real pipeline, as the person, with the live role the SQL just resolved
    pending.push({ i, opId, op, ctx: begin.data.ctx as ExecRunBody["ctx"], rec, recKey, hint, project })
    if (!deps.execRunBatch) await flush()
  }
  await flush()

  // the current signed rows: one pull-by-ids per (project, kind) for the whole push, not one per op
  const groups = new Map<string, { project: string; kind: string; ids: string[] }>()
  for (const x of [...conflicts.filter((c): c is { i: number; project: string; kind: string; id: string } => c.project !== null), ...applied]) {
    const g = groups.get(`${x.project}\u0001${x.kind}`) ?? { project: x.project, kind: x.kind, ids: [] }
    g.ids.push(x.id)
    groups.set(`${x.project}\u0001${x.kind}`, g)
  }
  const rows = new Map<string, Record<string, unknown>>()
  for (const g of groups.values()) for (const [id, row] of await signedRows(deps, who, now, g.project, g.kind, g.ids)) rows.set(`${g.project}\u0001${g.kind}\u0001${id}`, row)
  for (const x of [...conflicts, ...applied]) {
    const r = results[x.i]
    if (r && x.project) r.server = rows.get(`${x.project}\u0001${x.kind}\u0001${x.id}`) ?? null
  }

  return respond(req, deps, 200, { results, server_time: now.toISOString() })
}
// ---------------------------------------------------------------------------------------------------------------------------------
// JOBS: work an online laptop runs for another (drizzle/0682): leased, display-only types, a result is a PROPOSAL the server never writes into a business table
// ---------------------------------------------------------------------------------------------------------------------------------
async function jobs(req: Request, deps: SyncDeps, who: Who, now: Date, action: string): Promise<Response> {
  const parsed = await readBody(req, deps, JOB_BODY_MAX_BYTES_BY_ACTION[action] ?? BODY_MAX_BYTES)
  if (!parsed.ok) return parsed.res
  const b = parsed.body
  const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null)

  if (action === "enqueue") {
    const project = text(b.project_id, 128)
    const type = text(b.type, 32)
    const visibility = b.visibility === undefined ? "requester" : text(b.visibility, 16)
    if (!project || !type || !visibility || b.params === null || typeof b.params !== "object" || Array.isArray(b.params)) return respond(req, deps, 400, { error: "project_id, type and params are required" })
    const r = await callSql(deps, "projexa_job_enqueue", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_type: type, p_params: b.params, p_visibility: visibility })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, { job_id: r.data.job_id, server_time: now.toISOString() })
  }

  if (action === "claim") {
    const device = text(b.device_id, 64)
    const types = b.types
    if (!device || !Array.isArray(types) || types.length < 1 || types.length > 8 || !types.every((x) => typeof x === "string" && x.length <= 32)) return respond(req, deps, 400, { error: "device_id and types are required" })
    const lease = b.lease_seconds === undefined ? 60 : b.lease_seconds
    if (typeof lease !== "number" || !Number.isInteger(lease) || lease < 10 || lease > 120) return respond(req, deps, 400, { error: "lease_seconds must be 10 to 120" })
    const r = await callSql(deps, "projexa_job_claim", { p_sub: who.sub, p_email: who.email, p_device_id: device, p_types: types, p_lease_seconds: lease })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, { job: r.data.job ?? null, server_time: now.toISOString() })
  }

  if (action === "heartbeat") {
    const job = text(b.job_id, 64)
    const leaseId = text(b.lease_id, 64)
    if (!job || !leaseId) return respond(req, deps, 400, { error: "job_id and lease_id are required" })
    const r = await callSql(deps, "projexa_job_heartbeat", { p_sub: who.sub, p_email: who.email, p_job_id: job, p_lease_id: leaseId })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, { outcome: r.data.outcome, lease_expires_at: r.data.lease_expires_at ?? null, server_time: now.toISOString() })
  }

  if (action === "result") {
    const job = text(b.job_id, 64)
    const leaseId = text(b.lease_id, 64)
    if (!job || !leaseId || typeof b.ok !== "boolean") return respond(req, deps, 400, { error: "job_id, lease_id and ok are required" })
    if (b.ok && (b.result === null || b.result === undefined || typeof b.result !== "object")) return respond(req, deps, 400, { error: "result is required when ok" })
    const r = await callSql(deps, "projexa_job_result", { p_sub: who.sub, p_email: who.email, p_job_id: job, p_lease_id: leaseId, p_ok: b.ok, p_result: b.ok ? b.result : null, p_error: typeof b.error === "string" ? b.error.slice(0, 64) : null })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, { outcome: r.data.outcome, job_status: r.data.job_status ?? null, server_time: now.toISOString() })
  }

  if (action === "get") {
    const job = text(b.job_id, 64)
    if (!job) return respond(req, deps, 400, { error: "job_id is required" })
    const r = await callSql(deps, "projexa_job_get", { p_sub: who.sub, p_email: who.email, p_job_id: job })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return respond(req, deps, 200, { job_status: r.data.job_status, attempts: r.data.attempts, type: r.data.type, result: r.data.result ?? null, error_code: r.data.error_code ?? null, ran_here: r.data.ran_here === true, server_time: now.toISOString() })
  }

  return respond(req, deps, 404, NOT_FOUND)
}
// POST /pull for an ORGANISATION kind {kind, after, limit} or {kind, ids:[...]}: no project (absent, null or the sentinel). Same page, same cursor, same signature (project "__org__").
async function orgPull(req: Request, deps: SyncDeps, who: Who, now: Date, body: Record<string, unknown>): Promise<Response> {
  const kind = String(body.kind)
  const project = body.project_id
  // a real project id for an organisation kind is the one 404 (it names something that does not exist)
  if (project !== undefined && project !== null && project !== ORG_SENTINEL) return respond(req, deps, 404, NOT_FOUND)
  if (body.ids !== undefined) {
    const idList = body.ids
    if (!Array.isArray(idList) || idList.length < 1 || idList.length > PULL_IDS_MAX || !idList.every((x) => typeof x === "string" && ID_RE.test(x))) return respond(req, deps, 400, { error: `ids must be 1 to ${PULL_IDS_MAX} valid ids` })
    const r = await callSql(deps, "projexa_sync_org_pull_ids", { p_sub: who.sub, p_email: who.email, p_kind: kind, p_ids: idList })
    if (!r.ok) return respond(req, deps, r.status, r.body)
    return pageResponse(req, deps, who, now, ORG_SENTINEL, kind, r.data)
  }
  const after = body.after ?? null
  const limitIn = body.limit ?? PULL_LIMIT_DEFAULT
  if (typeof limitIn !== "number" || !Number.isInteger(limitIn) || limitIn < 1 || limitIn > PULL_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${PULL_LIMIT_MAX}` })
  let cur: { ts: string; id: string } | null = null
  if (after !== null) {
    if (typeof after !== "string") return respond(req, deps, 400, { error: "Bad cursor" })
    cur = decodeCursor(after)
    if (!cur) return respond(req, deps, 400, { error: "Bad cursor" })
  }
  const r = await callSql(deps, "projexa_sync_org_pull", { p_sub: who.sub, p_email: who.email, p_kind: kind, p_after_ts: cur?.ts ?? null, p_after_id: cur?.id ?? null, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  return pageResponse(req, deps, who, now, ORG_SENTINEL, kind, r.data)
}