// PROJEXA LOCAL-FIRST SYNC, READ SIDE: the router of the projexa-sync Edge function. Pure and bun-testable: no Deno global, the database is the injected
// `rpc(name, args)` (the service-role client in index.ts, a PGlite in the tests) and the session verifier is injected too.
//
//   GET  /manifest   -> {user, projects, kinds, server_time}
//   POST /pull       body {project_id, kind, after, limit} -> {items, next_cursor, has_more, hidden_fields, redacted, server_time}
//
// AUTHORITY IS NOT DECIDED HERE. The session (the PROJEXA person's access token) is verified by ai-work-link/session.ts; the person, the project
// binding, the row scope and every redaction are decided by the SQL functions public.projexa_sync_manifest / projexa_sync_pull (drizzle/0676), which
// call the AI work link's own functions (projexa_read_resolve_user, ai_work_link__bind, ai_work_link__records_core). This file only adds a second
// money-nulling pass from the AI link's own generated kind table (redactItem), the cursor encoding, CORS and a per-person rate cap.
// An unknown project, an unknown kind, a project of another organisation and a project the person may not read are ONE answer (404, same body).
// Nothing here logs a token, an email or a row.
import { redactItem } from "../_shared/ai-link/core.ts"
import { kindDef } from "../ai-work-link/api-definition.ts"
import type { SessionVerifier } from "../ai-work-link/session.ts"

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>
export type SyncDeps = { rpc: Rpc; session: SessionVerifier; now?: () => Date; limiter?: RateLimiter; allowedOrigins?: readonly string[] }

export const ALLOWED_ORIGINS = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100", "http://localhost:3101"] as const
export const SYNC_KINDS = ["project", "tasks", "boqs", "boq_lines", "activities", "progress", "rfis", "submittals", "punch_list", "change_orders", "milestones", "materials", "documents"] as const
export const PULL_LIMIT_DEFAULT = 200
export const PULL_LIMIT_MAX = 500
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

function routeOf(pathname: string): string {
  const m = pathname.replace(/\/+$/, "").match(/\/(manifest|pull)$/)
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
  if ((route === "manifest" && req.method !== "GET") || (route === "pull" && req.method !== "POST")) return respond(req, deps, 405, { error: "Method not allowed" }, { Allow: route === "manifest" ? "GET, OPTIONS" : "POST, OPTIONS" })

  const token = bearer(req)
  if (!token) return respond(req, deps, 401, { error: "Sign in again" })
  const who = await deps.session(token)
  if (!who.ok) return who.reason === "unavailable" ? respond(req, deps, 503, { error: "Service unavailable. Try again in a minute." }) : respond(req, deps, 401, { error: "Sign in again" })

  deps.limiter ??= new RateLimiter()
  if (!deps.limiter.take(who.sub, now.getTime())) return respond(req, deps, 429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" })

  if (route === "manifest") return manifest(req, deps, who, now)
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
  return respond(req, deps, 200, { user: r.data.user, projects: r.data.projects, kinds, server_time: now.toISOString() })
}

async function pull(req: Request, deps: SyncDeps, who: Who, now: Date): Promise<Response> {
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
  const after = body.after ?? null
  const limitIn = body.limit ?? PULL_LIMIT_DEFAULT
  if (typeof project !== "string" || project === "" || project.length > 128 || typeof kind !== "string" || kind === "" || kind.length > 64) return respond(req, deps, 400, { error: "project_id and kind are required" })
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

  const def = kindDef(kind)
  const hidden = Array.isArray(r.data.hidden_fields) ? (r.data.hidden_fields as unknown[]).filter((x): x is string => typeof x === "string") : []
  const moneyVisible = r.data.money_visible === true
  const rows = Array.isArray(r.data.items) ? (r.data.items as Array<Record<string, unknown>>) : []
  const items = rows.map((it) => {
    const data = (it.data ?? {}) as Record<string, unknown>
    // the second money pass, the AI link's own (the SQL already nulled these columns)
    const safe = def ? redactItem(def, data, { moneyVisible, hiddenFields: hidden }) : data
    return { id: it.id, updated_at: it.updated_at, data: safe }
  })
  const nextTs = typeof r.data.next_ts === "string" ? r.data.next_ts : null
  const nextId = typeof r.data.next_id === "string" ? r.data.next_id : null
  return respond(req, deps, 200, {
    items,
    next_cursor: nextTs && nextId ? encodeCursor(nextTs, nextId) : null,
    has_more: r.data.has_more === true,
    hidden_fields: hidden,
    redacted: r.data.redacted === true || hidden.length > 0 || !moneyVisible && !!def && def.money_columns.length > 0,
    server_time: now.toISOString(),
  })
}
