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
import { ATTEST_TTL_SECONDS, canonicalize, sha256Hex, type Signing } from "./sign.ts"

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
  /** per-person organisation memory for signing a pull (one manifest call a minute at most) */
  orgCache?: Map<string, { org: string; exp: number }>
  /** fetch used to read the owner-published release manifest (tests inject a fake); defaults to the global fetch */
  fetchImpl?: typeof fetch
  /** one-minute memory of the registry's current release, shared by every request of the isolate */
  releaseBox?: { at: number; value: ReleaseInfo | null }
  /** Runs one pushed write through the real pipeline (the ai-work-link-exec function). Absent: POST /push answers 503. */
  execRun?: (body: ExecRunBody) => Promise<ExecOutcome>
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
export const PULL_LIMIT_DEFAULT = 200
export const PULL_LIMIT_MAX = 500
export const SERVER_PROTOCOL = 2
export const PUSH_BODY_MAX_BYTES = 262_144
export const PUSH_OPS_MAX = 50
export const JOB_BODY_MAX_BYTES = 300_000
export const RELEASE_ORIGIN = "https://projexa-ai.com"
export const RELEASE_MANIFEST_URL = `${RELEASE_ORIGIN}/_release/release.json`
export const RELEASE_MANIFEST_MAX_BYTES = 2_000_000
export const RELEASE_TTL_MS = 60_000
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
function corsHeaders(req: Request, deps: SyncDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const allowed = deps.allowedOrigins ?? ALLOWED_ORIGINS
  const h: Record<string, string> = { Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600" }
  if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}

function respond(req: Request, deps: SyncDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json; charset=utf-8" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...corsHeaders(req, deps), ...extra },
  })
}

const NOT_FOUND = { error: "Not found" }

const ROUTES: Record<string, "GET" | "POST"> = { manifest: "GET", pull: "POST", ids: "POST", attest: "POST", changes: "POST", push: "POST", "jobs/enqueue": "POST", "jobs/claim": "POST", "jobs/heartbeat": "POST", "jobs/result": "POST", "jobs/get": "POST", install: "POST", "release/current": "GET", "release/register": "POST" }
/** Routes a laptop that is too old must still be able to reach: how else would it learn to update. */
const UPDATE_EXEMPT = new Set(["release/current", "release/register", "install"])

function routeOf(pathname: string): string {
  const m = pathname.replace(/\/+$/, "").match(/\/(manifest|pull|ids|attest|changes|push|jobs\/enqueue|jobs\/claim|jobs\/heartbeat|jobs\/result|jobs\/get|install|release\/current|release\/register)$/)
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
  if (route === "release/current") return releaseCurrent(req, deps, now)
  if (route === "release/register") return releaseRegister(req, deps, now)
  if (route === "install") return install(req, deps, who, now)
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
    return { ok: false, status: 503, body: { error: "Service unavailable. Try again in a minute." } }
  }
  if (res.error) {
    const code = res.error.code ?? ""
    if (code === "AW404") return { ok: false, status: 404, body: NOT_FOUND }
    if (code === "AW409") return { ok: false, status: 409, body: { error: "Conflict" } }
    if (code === "AW429") return { ok: false, status: 429, body: { error: "Too many requests today. Try again tomorrow." } }
    if (code === "AW400") return { ok: false, status: 400, body: { error: res.error.message === "BAD_CURSOR" ? "Bad cursor" : "Bad request" } }
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
  rememberOrg(deps, who.sub, r.data.user, now)
  const rel = await getRelease(deps, now)
  return respond(req, deps, 200, {
    user: r.data.user,
    projects: r.data.projects,
    kinds,
    view_class: typeof r.data.view_class === "string" ? r.data.view_class : null,
    release: { current: (rel?.current?.release_version as string | undefined) ?? null, min_compatible: rel?.min_compatible || null, protocol: SERVER_PROTOCOL },
    server_time: now.toISOString(),
  })
}

function rememberOrg(deps: SyncDeps, sub: string, user: unknown, now: Date) {
  const org = (user as { org_id?: unknown } | null)?.org_id
  if (typeof org !== "string") return
  deps.orgCache ??= new Map()
  deps.orgCache.set(sub, { org, exp: now.getTime() + 60_000 })
  if (deps.orgCache.size > 5000) for (const [k, v] of deps.orgCache) if (v.exp < now.getTime()) deps.orgCache.delete(k)
}

/** The organisation of a signed-in person, from a short memory or one manifest call (only needed to sign a pull). */
async function orgOf(deps: SyncDeps, who: Who, now: Date): Promise<string | null> {
  const hit = deps.orgCache?.get(who.sub)
  if (hit && hit.exp > now.getTime()) return hit.org
  const r = await callSql(deps, "projexa_sync_manifest", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return null
  rememberOrg(deps, who.sub, r.data.user, now)
  return deps.orgCache?.get(who.sub)?.org ?? null
}

// POST /ids {project_id, kind, after_id, limit}: one page of the ids of that kind the person may read now (a laptop drops what is no longer listed: deletes)
async function ids(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const raw = await req.text()
  if (raw.length > BODY_MAX_BYTES) return respond(req, deps, 413, { error: "Body too large" })
  let body: Record<string, unknown>
  try {
    const v = JSON.parse(raw)
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
    body = v as Record<string, unknown>
  } catch {
    return respond(req, deps, 400, { error: "Body must be a JSON object" })
  }
  const project = body.project_id
  const kind = body.kind
  const after = body.after_id ?? null
  const limitIn = body.limit ?? IDS_LIMIT_DEFAULT
  if (typeof project !== "string" || project === "" || project.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return respond(req, deps, 400, { error: "project_id and kind are required" })
  if (typeof limitIn !== "number" || !Number.isInteger(limitIn) || limitIn < 1 || limitIn > IDS_LIMIT_MAX) return respond(req, deps, 400, { error: `limit must be a whole number from 1 to ${IDS_LIMIT_MAX}` })
  if (after !== null && (typeof after !== "string" || !ID_RE.test(after))) return respond(req, deps, 400, { error: "Bad cursor" })
  if (!(SYNC_KINDS as readonly string[]).includes(kind)) return respond(req, deps, 404, NOT_FOUND)
  const r = await callSql(deps, "projexa_sync_ids", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_after_id: after, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  return respond(req, deps, 200, {
    ids: Array.isArray(r.data.ids) ? (r.data.ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
    has_more: r.data.has_more === true,
    next_id: typeof r.data.next_id === "string" ? r.data.next_id : null,
    server_time: now.toISOString(),
  })
}

// POST /attest {}: a short-lived signed statement of who this person is to OTHER laptops (organisation, the projects they may read, their view class),
// the public keys to verify signed rows with, and the organisation's channel name. A peer that cannot present one gets nothing from another laptop.
async function attest(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const signing = deps.signing ? await deps.signing() : null
  if (!signing) return respond(req, deps, 503, { error: "Peer sync is not available right now." })
  const r = await callSql(deps, "projexa_sync_manifest", { p_sub: who.sub, p_email: who.email })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const user = (r.data.user ?? {}) as { id?: string; org_id?: string }
  const projects = Array.isArray(r.data.projects) ? (r.data.projects as Array<{ id?: unknown }>).map((p) => p.id).filter((x): x is string => typeof x === "string") : []
  const view = typeof r.data.view_class === "string" ? r.data.view_class : ""
  if (typeof user.id !== "string" || typeof user.org_id !== "string" || view === "") return respond(req, deps, 500, { error: "Something failed on our side. Try again in a minute." })
  const iat = Math.floor(now.getTime() / 1000)
  const exp = iat + ATTEST_TTL_SECONDS
  const token = await signing.signToken({ typ: "px-peer", v: 1, sub: user.id, org: user.org_id, projects, view, iat, exp })
  return respond(req, deps, 200, {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    org_id: user.org_id,
    user_id: user.id,
    view_class: view,
    projects,
    channel: await signing.channelId(user.org_id),
    public_keys: deps.publicKeys ? await deps.publicKeys() : [],
    server_time: now.toISOString(),
  })
}

async function readBody(req: Request, deps: SyncDeps, max = BODY_MAX_BYTES): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const raw = await req.text()
  if (raw.length > max) return { ok: false, res: respond(req, deps, 413, { error: "Body too large" }) }
  try {
    const v = JSON.parse(raw)
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
    return { ok: true, body: v as Record<string, unknown> }
  } catch {
    return { ok: false, res: respond(req, deps, 400, { error: "Body must be a JSON object" }) }
  }
}

async function pull(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
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
  return respond(req, deps, 200, await buildPage(deps, who, now, project, kind, data))
}

async function buildPage(deps: SyncDeps, who: Who, now: Date, project: string, kind: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const def = kindDef(kind)
  const hidden = Array.isArray(data.hidden_fields) ? (data.hidden_fields as unknown[]).filter((x): x is string => typeof x === "string") : []
  const moneyVisible = data.money_visible === true
  const rows = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
  // Each row is signed (organisation, project, kind, id, version, updated_at, hash of the row as sent) so another laptop can verify what a peer hands it. Unsigned
  // only when no key is available: then `kid` is null and a laptop will not pass the rows on to peers.
  let signing: Signing | null = null
  let org: string | null = null
  if (deps.signing) {
    try {
      signing = await deps.signing()
      org = signing ? await orgOf(deps, who, now) : null
    } catch {
      signing = null
    }
  }
  const items = await Promise.all(
    rows.map(async (it) => {
      const row = (it.data ?? {}) as Record<string, unknown>
      // the second money pass, the AI link's own (the SQL already nulled these columns)
      const safe = def ? redactItem(def, row, { moneyVisible, hiddenFields: hidden }) : row
      const version = typeof it.version === "number" && Number.isInteger(it.version) && it.version >= 0 ? it.version : 0
      const sig = signing && org && typeof it.id === "string" && typeof it.updated_at === "string" ? await signing.signItem({ org, project, kind, id: it.id, version, updatedAt: it.updated_at, data: safe }) : undefined
      return sig ? { id: it.id, updated_at: it.updated_at, version, data: safe, sig } : { id: it.id, updated_at: it.updated_at, version, data: safe }
    }),
  )
  const nextTs = typeof data.next_ts === "string" ? data.next_ts : null
  const nextId = typeof data.next_id === "string" ? data.next_id : null
  return {
    items,
    kid: signing && org ? signing.kid : null,
    next_cursor: nextTs && nextId ? encodeCursor(nextTs, nextId) : null,
    has_more: data.has_more === true,
    hidden_fields: hidden,
    redacted: data.redacted === true || hidden.length > 0 || (!moneyVisible && !!def && def.money_columns.length > 0),
    server_time: now.toISOString(),
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
  const r = await callSql(deps, "projexa_sync_changes", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_after_seq: after, p_limit: limitIn })
  if (!r.ok) return respond(req, deps, r.status, r.body)
  const list = Array.isArray(r.data.changes) ? (r.data.changes as Array<Record<string, unknown>>) : []
  return respond(req, deps, 200, {
    changes: list
      .filter((c) => typeof c.kind === "string" && (SYNC_KINDS as readonly string[]).includes(c.kind) && typeof c.id === "string")
      .map((c) => ({ seq: Number(c.seq), kind: c.kind, id: c.id, version: Number(c.version), op: c.op })),
    next_seq: Number(r.data.next_seq ?? 0),
    has_more: r.data.has_more === true,
    head_seq: Number(r.data.head_seq ?? 0),
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

/** 426 when the laptop speaks another protocol or its release is below the floor; a laptop with no header, or a dev build, is never blocked. */
async function updateRequired(req: Request, deps: SyncDeps, now: Date): Promise<Response | null> {
  const client = parseClientHeader(req.headers.get("x-px-client"))
  if (!client) return null
  const rel = await getRelease(deps, now)
  const protocolBad = client.protocol !== null && client.protocol !== SERVER_PROTOCOL
  const floor = rel?.min_compatible ?? ""
  const releaseBad = floor !== "" && client.release !== null && RELEASE_RE.test(client.release) && client.release < floor
  if (!protocolBad && !releaseBad) return null
  return respond(req, deps, 426, { error: "Update required", code: "UPDATE_REQUIRED", current: (rel?.current?.release_version as string | undefined) ?? null, min_compatible: floor || null, protocol: SERVER_PROTOCOL, reason: protocolBad ? "protocol" : "release" })
}

async function releaseCurrent(req: Request, deps: SyncDeps, now: Date): Promise<Response> {
  const rel = await getRelease(deps, now)
  if (!rel) return respond(req, deps, 503, { error: "Service unavailable. Try again in a minute." })
  return respond(req, deps, 200, { registered: rel.registered, current: rel.current, min_compatible: rel.min_compatible || null, protocol: SERVER_PROTOCOL, server_time: now.toISOString() })
}

/** Registers what the OWNER published at projexa-ai.com/_release/release.json. Takes no input: nothing a caller sends is registered. */
async function releaseRegister(req: Request, deps: SyncDeps, now: Date): Promise<Response> {
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let text: string
  try {
    const res = await doFetch(RELEASE_MANIFEST_URL, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } })
    if (!res.ok) return respond(req, deps, 502, { error: "The release manifest could not be read.", code: "MANIFEST_UNREACHABLE" })
    text = await res.text()
  } catch {
    return respond(req, deps, 502, { error: "The release manifest could not be read.", code: "MANIFEST_UNREACHABLE" })
  }
  if (text.length > RELEASE_MANIFEST_MAX_BYTES) return respond(req, deps, 502, { error: "The release manifest is too large.", code: "MANIFEST_BAD" })
  let manifest: Record<string, unknown>
  try {
    const v = JSON.parse(text)
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("shape")
    manifest = v as Record<string, unknown>
  } catch {
    return respond(req, deps, 502, { error: "The release manifest is not valid.", code: "MANIFEST_BAD" })
  }
  // the digest must be the digest of the manifest it sits in: a manifest altered in transit, or hand-edited, is refused
  const { manifest_sha256: claimed, ...rest } = manifest
  if (typeof claimed !== "string" || claimed !== (await sha256Hex(canonicalize(rest)))) return respond(req, deps, 502, { error: "The release manifest does not match its own digest.", code: "MANIFEST_BAD" })
  const res = await deps.rpc("projexa_release_register", { p_manifest: manifest }).catch(() => null)
  if (!res) return respond(req, deps, 503, { error: "Service unavailable. Try again in a minute." })
  if (res.error) {
    const code = res.error.code ?? ""
    if (code === "AW409") return respond(req, deps, 409, { error: "That release version is already registered with different content.", code: "VERSION_TAKEN" })
    if (code === "AW400") return respond(req, deps, 502, { error: "The release manifest is not valid.", code: "MANIFEST_BAD" })
    return respond(req, deps, 500, { error: "Something failed on our side. Try again in a minute." })
  }
  await getRelease(deps, now, true)
  return respond(req, deps, 200, { ...((res.data ?? {}) as Record<string, unknown>), server_time: now.toISOString() })
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
// PUSH: what a person edited on their laptop (drizzle/0681 decides, the real pipeline writes)
// ---------------------------------------------------------------------------------------------------------------------------------
/** Codes of a failed run that mean "this cannot run on the edge": the laptop keeps the op and offers the normal online path. */
const NEEDS_SERVER_CODES = new Set(["FUNCTION_NOT_AVAILABLE", "NOT_AVAILABLE_ON_EXEC", "NOT_AVAILABLE"])
/** Codes of a failed run that mean "nothing was written and trying again later may work". */
const TRANSIENT_CODES = new Set(["INTERNAL_ERROR", "DB_UNREACHABLE", "NOT_CONFIGURED", "SYNC_NOT_AVAILABLE", "CLAIM_UNAVAILABLE", "BAD_CLAIM"])

type PushResult = Record<string, unknown>

/** The signed current row of one record (a conflict shows it; an applied op returns it at its new version). null: the row is gone or not readable. */
async function signedRow(deps: SyncDeps, who: Who, now: Date, project: string, kind: string, id: string): Promise<Record<string, unknown> | null> {
  const r = await callSql(deps, "projexa_sync_pull_ids", { p_sub: who.sub, p_email: who.email, p_project_id: project, p_kind: kind, p_ids: [id] })
  if (!r.ok) return null
  const page = await buildPage(deps, who, now, project, kind, r.data)
  const it = (page.items as Array<Record<string, unknown>>)[0]
  return it ? { kind, id, version: it.version, updated_at: it.updated_at, data: it.data, sig: it.sig ?? null, kid: page.kid } : null
}

async function push(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
  const parsed = await readBody(req, deps, PUSH_BODY_MAX_BYTES)
  if (!parsed.ok) return parsed.res
  const body = parsed.body
  const device = body.device_id
  const ops = body.ops
  if (typeof device !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(device)) return respond(req, deps, 400, { error: "device_id is required" })
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > PUSH_OPS_MAX) return respond(req, deps, 400, { error: `ops must be 1 to ${PUSH_OPS_MAX} operations` })
  if (!deps.execRun) return respond(req, deps, 503, { error: "Saving to the server is not available right now. Your changes stay on this laptop.", code: "PUSH_NOT_AVAILABLE" })
  const execRun = deps.execRun

  const results: PushResult[] = []
  // a record whose earlier op in this batch did not apply keeps its later ops waiting (order matters), without running them
  const held = new Set<string>()

  for (const raw of ops) {
    const op = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    const opId = op && typeof op.op_id === "string" ? op.op_id : null
    if (!op || !opId) {
      results.push({ op_id: opId, status: "rejected", error: { code: "BAD_OP" } })
      continue
    }
    const rec = op.record !== null && typeof op.record === "object" && !Array.isArray(op.record) ? (op.record as Record<string, unknown>) : null
    const recKey = rec && typeof rec.kind === "string" && typeof rec.id === "string" ? `${rec.kind}:${rec.id}` : null
    const hint = typeof op.record_kind === "string" && (SYNC_KINDS as readonly string[]).includes(op.record_kind) ? op.record_kind : null
    const project = typeof op.project_id === "string" ? op.project_id : null
    const hold = () => {
      if (recKey) held.add(recKey)
    }

    if (recKey && held.has(recKey)) {
      results.push({ op_id: opId, status: "failed", error: { code: "PREVIOUS_OP_BLOCKED" } })
      continue
    }

    const begin = await callSql(deps, "projexa_sync_push_begin", { p_sub: who.sub, p_email: who.email, p_device_id: device, p_op: op })
    if (!begin.ok) return respond(req, deps, begin.status, begin.body) // not linked / service down: the whole batch is refused, nothing ran
    const action = begin.data.action

    if (action === "reject") {
      results.push({ op_id: opId, status: "rejected", error: { code: String(begin.data.code ?? "REJECTED") } })
      continue
    }
    if (action === "retry") {
      hold()
      results.push({ op_id: opId, status: "failed", error: { code: String(begin.data.code ?? "RETRY") } })
      continue
    }
    if (action === "duplicate") {
      const stored = (begin.data.result ?? {}) as Record<string, unknown>
      if (begin.data.stored_status === "applied") {
        results.push({ op_id: opId, status: "duplicate", record_id: stored.id ?? begin.data.record_id ?? null, route: stored.route ?? null, version: begin.data.version ?? null })
      } else {
        results.push({ op_id: opId, status: "rejected", error: { code: String(begin.data.error_code ?? "REJECTED") } })
      }
      continue
    }
    if (action === "conflict") {
      hold()
      const kind = String(begin.data.kind)
      const server = project ? await signedRow(deps, who, now, project, kind, String(begin.data.id)) : null
      results.push({ op_id: opId, status: "conflict", version: begin.data.server_version, base_version: begin.data.base_version, server })
      continue
    }
    if (action !== "run") {
      hold()
      results.push({ op_id: opId, status: "failed", error: { code: "BAD_ANSWER" } })
      continue
    }

    // RUN: the real pipeline, as the person, with the live role the SQL just resolved
    const ctx = begin.data.ctx as ExecRunBody["ctx"]
    let outcome: ExecOutcome
    try {
      outcome = await execRun({ op_id: opId, function_id: String(op.function_id), params: (op.params ?? {}) as Record<string, unknown>, ctx })
    } catch {
      outcome = { kind: "uncertain" }
    }

    const finish = async (status: string, result: unknown, code: string | null, kind: string | null, id: string | null) => {
      const r = await deps.rpc("projexa_sync_push_finish", { p_user_id: ctx.user_id, p_op_id: opId, p_status: status, p_result: result, p_error_code: code, p_record_kind: kind, p_record_id: id }).catch(() => null)
      return r && !r.error ? ((r.data ?? {}) as Record<string, unknown>) : null
    }

    if (outcome.kind === "done") {
      const kind = hint ?? (rec && typeof rec.kind === "string" ? rec.kind : null)
      const id = outcome.record.id ?? (rec && typeof rec.id === "string" ? rec.id : null)
      const fin = await finish("applied", { id: outcome.record.id, route: outcome.record.route, submission_id: outcome.submission_id }, null, kind, id)
      if (!fin) {
        // the write happened but its ledger row could not be closed: the row reads "uncertain" after 10 minutes, and the laptop must not blindly re-send
        hold()
        results.push({ op_id: opId, status: "failed", error: { code: "EXECUTION_UNCERTAIN" } })
        continue
      }
      const server = kind && id && project ? await signedRow(deps, who, now, project, kind, id) : null
      results.push({ op_id: opId, status: "applied", record_id: id, route: outcome.record.route, version: fin.version ?? null, server })
      continue
    }
    if (outcome.kind === "failed") {
      const needsServer = NEEDS_SERVER_CODES.has(outcome.code)
      const transient = TRANSIENT_CODES.has(outcome.code)
      await finish(needsServer ? "needs_server" : transient ? "failed" : "rejected", { missing: outcome.missing }, outcome.code, null, null)
      if (needsServer || transient) hold()
      results.push({ op_id: opId, status: needsServer ? "needs_server" : transient ? "failed" : "rejected", error: { code: outcome.code, missing: outcome.missing } })
      continue
    }
    if (outcome.kind === "unavailable") {
      hold()
      await finish("failed", null, "SYNC_NOT_AVAILABLE", null, null)
      results.push({ op_id: opId, status: "failed", error: { code: "SYNC_NOT_AVAILABLE" } })
      continue
    }
    // uncertain: the call went out and nothing came back
    hold()
    await finish("uncertain", null, "EXECUTION_UNCERTAIN", null, null)
    results.push({ op_id: opId, status: "failed", error: { code: "EXECUTION_UNCERTAIN" } })
  }

  return respond(req, deps, 200, { results, server_time: now.toISOString() })
}
// ---------------------------------------------------------------------------------------------------------------------------------
// JOBS: work an online laptop runs for another (drizzle/0682): leased, display-only types, a result is a PROPOSAL the server never writes into a business table
// ---------------------------------------------------------------------------------------------------------------------------------
async function jobs(req: Request, deps: SyncDeps, who: Who, now: Date, action: string): Promise<Response> {
  const parsed = await readBody(req, deps, JOB_BODY_MAX_BYTES)
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