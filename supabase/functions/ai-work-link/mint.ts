// PROJEXA-BUILD-002 WP-08 (register rows AW-401 to AW-404 and AW-406; spec sections 3.4, 10.1 to 10.3): the signed-in app routes that let a
// person make, list and revoke their own work links, and read the warning they must see first. They are APP routes: they take a signed-in
// person's session token in Authorization, never a link token, and every refusal is a plain answer with no WWW-Authenticate (spec 3.6).
//   POST /mint                      make a link for a project the person can read
//   GET  /links[?project=]          the person's own links (never a token, never a hash)
//   POST /links/{id}/revoke         revoke one
//   GET|POST /warning?level=&project=   the true warning sentence for the current state
//   POST /new-project               "New project with my AI": a shell project and a level 0 link for the same person, in one action
//
// ORDER OF CHECKS, each before anything is written
//   no Bearer, or a link token as Bearer (401) -> the session token (401; 503 when a key set cannot be read)
//   -> for /mint and /new-project only: a FRESH session, issued within the last 15 minutes (401 SESSION_STALE)
//   -> the per-person brake (429) -> the parameters (400) -> who the person is, through public.projexa_read_resolve_user (403 when the person
//   is not one active user of one organisation) -> one SQL function of drizzle/0631 (or ai_work_link_revoke_service through it), which alone
//   decides readability, rank, the caps and the write.
//
// WHY A FRESH SESSION FOR MINT. session.ts cannot check that a session is still live (no call to the Auth service from this function), so a
// signed-out but unexpired access token still verifies for up to an hour. Minting creates a credential, so a token older than 15 minutes is
// refused with 401 SESSION_STALE and the browser refreshes its session and tries again.
//
// THE RATE LIMITS. The hard limit is in SQL (0631): 10 links an hour and 30 a day per person, 5 shell projects a day, counted in the table the
// links are written to, under a per-person lock. This file adds a brake in this isolate's memory: 5 mint or new-project calls a minute per
// verified person and 60 calls a minute for the reads, then 429. Several isolates each keep their own count, so the brake is not a cap.
//
// THE TOKEN. It is returned once, in the body of the 201 answer, and is never logged: log lines here carry a route name and a status only, the
// call log is not used (an app route has no link token to log), and the SQL layer stores only its sha256. The answer has Cache-Control:
// no-store (core.ts privateHeaders).
//
// CORS. The token is a bearer secret, so these answers name the PROJEXA browser origins only (the list of projexa-read's ALLOWED_ORIGINS;
// a test holds the two equal). An origin that is not on the list gets a header naming the production origin, which its browser refuses to
// match, so a page on another site cannot read a response. The preflight answer of handler.ts stays the shared one.
//
// WHAT THIS FILE NEVER DOES: build SQL, read a table, decide who may read a project or what rank a function needs (all SQL), echo the text of
// a database error, or take an organisation from the caller.
import { errorBody, linkBase } from "../_shared/ai-link/core.ts"
import { DEFAULT_CONFIRM_HOST } from "./config.ts"
import type { AwlConfig, Rpc } from "./reads.ts"
import type { SessionVerifier } from "./session.ts"

export type MintDeps = {
  rpc: Rpc
  session: SessionVerifier
  config: AwlConfig
  log?: (line: string) => void
  /** Milliseconds since the epoch; the test passes its own clock. */
  now?: () => number
}

export type MintAnswer = { status: number; body: unknown; headers?: Record<string, string> }

// The same sentence as src/lib/supabase/auth-guard.ts USER_NOT_LINKED_MESSAGE and confirm.ts.
export const USER_NOT_LINKED_MESSAGE = "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin"

// The PROJEXA browser origins of supabase/functions/projexa-read/handler.ts ALLOWED_ORIGINS (production and the local dev server).
export const PROJEXA_ORIGINS: ReadonlyArray<string> = ["https://projexa-ai.com", "https://www.projexa-ai.com", "http://localhost:3100"]

export const MINT_SESSION_MAX_AGE_SECONDS = 15 * 60
export const MINT_LIMIT_PER_MINUTE = 5
export const READ_LIMIT_PER_MINUTE = 60

const CLOCK_SKEW_SECONDS = 60
const WINDOW_MS = 60_000
const MAX_TRACKED = 5_000
const BODY_MAX_BYTES = 8 * 1024
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TOKEN_RE = /^pxa_[0-9a-f]{64}$/
const NOT_LINKED_REASONS = new Set(["not_linked", "deactivated", "ambiguous"])
const DAYS = [1, 7, 30]

export type MintRoute = "mint" | "links" | "revoke" | "warning" | "new-project"

/** Which of this file's routes an app path is, or null (drafts and everything else belong to other files). */
export function mintRouteOf(route: string[]): MintRoute | null {
  if (route.length === 1 && route[0] === "mint") return "mint"
  if (route.length === 1 && route[0] === "links") return "links"
  if (route.length === 3 && route[0] === "links" && route[2] === "revoke") return "revoke"
  if (route.length === 1 && route[0] === "warning") return "warning"
  if (route.length === 1 && route[0] === "new-project") return "new-project"
  return null
}

export function isMintRoute(route: string[]): boolean {
  return mintRouteOf(route) !== null
}

// one Map per isolate: bucket -> the times of the calls inside the last minute
const recent = new Map<string, number[]>()

/** True when this call is over the limit. The call is counted first, so the call after the limit is the first refused. */
function overLimit(bucket: string, at: number, limit: number): boolean {
  const cut = at - WINDOW_MS
  if (recent.size >= MAX_TRACKED && !recent.has(bucket)) {
    for (const [k, v] of recent) if (v.every((t) => t <= cut)) recent.delete(k)
    if (recent.size >= MAX_TRACKED) recent.clear()
  }
  const times = (recent.get(bucket) ?? []).filter((t) => t > cut)
  times.push(at)
  recent.set(bucket, times)
  return times.length > limit
}

/** Test hook: forget every count (each test starts clean). */
export function resetMintLimits(): void {
  recent.clear()
}

const answer = (status: number, message: string, code: string, hint?: string, headers?: Record<string, string>): MintAnswer => ({
  status, body: errorBody(status, message, hint, { code }), headers,
})

function bearerOf(req: Request): string | null {
  const m = /^Bearer[ ]+([^\s]+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  return m ? m[1] : null
}

/** A row of a TABLE-returning function comes back from PostgREST as an array of one; a plain object is accepted too. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data
  return row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  return { "Access-Control-Allow-Origin": PROJEXA_ORIGINS.includes(origin) ? origin : PROJEXA_ORIGINS[0], Vary: "Origin" }
}

/** The database's coded exceptions (drizzle/0631 and 0624 headers) as stable HTTP answers. Anything not in the table is 503 and echoes nothing. */
const SQL_ERRORS: Record<string, { status: number; code: string; message: string; retryAfter?: string }> = {
  USER_NOT_ACTIVE: { status: 403, code: "USER_NOT_LINKED", message: USER_NOT_LINKED_MESSAGE },
  // a project of another organisation and a private project the person may not read look the same: no oracle for what exists
  PROJECT_NOT_FOUND: { status: 404, code: "PROJECT_NOT_FOUND", message: "No such project for you." },
  PROJECT_NOT_READABLE: { status: 404, code: "PROJECT_NOT_FOUND", message: "No such project for you." },
  LEVEL_NOT_ALLOWED: { status: 403, code: "LEVEL_NOT_ALLOWED", message: "Your role may not choose that level." },
  FUNCTION_NOT_ALLOWED: { status: 403, code: "FUNCTION_NOT_ALLOWED", message: "Your role may not put one of those functions on a link." },
  ROLE_TOO_LOW: { status: 403, code: "ROLE_TOO_LOW", message: "Creating a project needs the member role or above." },
  PRODUCT_NOT_FOUND: { status: 404, code: "PRODUCT_NOT_FOUND", message: "No such product for your organisation." },
  BAD_LEVEL: { status: 400, code: "BAD_LEVEL", message: "level must be 0 or 1." },
  BAD_DAYS: { status: 400, code: "BAD_DAYS", message: "days must be 1, 7 or 30." },
  MINT_CAP_HOUR: { status: 429, code: "MINT_CAP_HOUR", message: "You made 10 links in the last hour. Wait before making another.", retryAfter: "3600" },
  MINT_CAP_DAY: { status: 429, code: "MINT_CAP_DAY", message: "You made 30 links in the last day. Try again tomorrow.", retryAfter: "3600" },
  SHELL_CAP_DAY: { status: 429, code: "SHELL_CAP_DAY", message: "You started 5 new projects with an AI in the last day. Try again tomorrow.", retryAfter: "3600" },
  NOT_FOUND: { status: 404, code: "LINK_NOT_FOUND", message: "No such link." },
  NOT_ALLOWED: { status: 403, code: "NOT_YOUR_LINK", message: "That link is not yours to revoke." },
}

type Called = { ok: true; data: unknown } | { ok: false; out: MintAnswer }

/** One database call. A coded exception is mapped; a transport failure or anything else is 503 and nothing is reported as done. */
async function call(deps: MintDeps, name: string, fn: string, args: Record<string, unknown>, log: (l: string) => void): Promise<Called> {
  let res
  try {
    res = await deps.rpc(fn, args)
  } catch {
    res = { data: null, error: { message: "rpc threw", code: undefined as string | undefined } }
  }
  if (res.error) {
    const hit = (res.error.code ?? "").startsWith("AW") ? SQL_ERRORS[(res.error.message ?? "").trim()] : undefined
    if (hit) {
      log(`ai-work-link: ${name}: refused (${hit.code}) -> ${hit.status}`)
      return { ok: false, out: answer(hit.status, hit.message, hit.code, undefined, hit.retryAfter ? { "Retry-After": hit.retryAfter } : undefined) }
    }
    log(`ai-work-link: ${name}: database error -> 503`)
    return { ok: false, out: answer(503, "Service unavailable. Try again in a minute.", "MINT_UNAVAILABLE", "Nothing was changed.") }
  }
  return { ok: true, data: res.data }
}

const unavailable = (): MintAnswer => answer(503, "Service unavailable. Try again in a minute.", "MINT_UNAVAILABLE", "Nothing was changed.")

async function readObject(req: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; out: MintAnswer }> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > BODY_MAX_BYTES) return { ok: false, out: answer(413, "The body is over 8 KB.", "BODY_TOO_LARGE") }
  if (raw.trim() === "") return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, out: answer(400, "The body must be JSON.", "BODY_NOT_JSON") }
  }
  if (!isObject(parsed)) return { ok: false, out: answer(400, "The body must be a JSON object.", "BODY_NOT_OBJECT") }
  return { ok: true, value: parsed }
}

const bad = (code: string, message: string): { ok: false; out: MintAnswer } => ({ ok: false, out: answer(400, message, code) })

function idOf(v: unknown): string | null {
  return typeof v === "string" && ID_RE.test(v) ? v : null
}

/** A level or days value: absent means the default; anything else must be one of the allowed integers. */
function intOf(v: unknown, allowed: number[], fallback: number): number | null {
  if (v === undefined || v === null) return fallback
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) && allowed.includes(n) ? n : null
}

type MintArgs = { projectId: string; level: number; days: number; functions: string[] | null; hidePersonal: boolean; label: string | null }

function parseMintBody(body: Record<string, unknown>): { ok: true; value: MintArgs } | { ok: false; out: MintAnswer } {
  const projectId = idOf(body.projectId ?? body.project)
  if (!projectId) return bad("PROJECT_REQUIRED", "projectId is required (letters, digits, - and _, at most 128).")
  const level = intOf(body.level, [0, 1], 0)
  if (level === null) return bad("BAD_LEVEL", "level must be 0 or 1.")
  const days = intOf(body.days, DAYS, 7)
  if (days === null) return bad("BAD_DAYS", "days must be 1, 7 or 30.")
  let functions: string[] | null = null
  if (body.functions !== undefined && body.functions !== null) {
    const list = body.functions
    if (!Array.isArray(list) || list.length === 0 || list.length > 50 || !list.every((f) => typeof f === "string" && ID_RE.test(f))) {
      return bad("BAD_FUNCTIONS", "functions must be a list of 1 to 50 function ids, or left out for every function your role may have.")
    }
    functions = Array.from(new Set(list as string[]))
  }
  let hidePersonal = true
  if (body.hidePersonal !== undefined && body.hidePersonal !== null) {
    if (typeof body.hidePersonal !== "boolean") return bad("BAD_HIDE_PERSONAL", "hidePersonal must be true or false.")
    hidePersonal = body.hidePersonal
  }
  let label: string | null = null
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string" || body.label.length > 80 || /[\u0000-\u001f\u007f]/.test(body.label)) return bad("BAD_LABEL", "label must be plain text of at most 80 characters.")
    label = body.label.trim() === "" ? null : body.label.trim()
  }
  return { ok: true, value: { projectId, level, days, functions, hidePersonal, label } }
}

/** The one-time answer of a mint: the link and the token, built from the fixed settings (never from the request's Host header). */
function mintedBody(config: AwlConfig, created: unknown): Record<string, unknown> | null {
  if (!isObject(created) || typeof created.token !== "string" || !TOKEN_RE.test(created.token) || typeof created.link_id !== "string") return null
  const token = created.token
  const inbox = config.confirmHost === DEFAULT_CONFIRM_HOST ? null : `https://${config.confirmHost}/ai-inbox.html#t=${token}`
  return {
    link_id: created.link_id,
    level: created.level,
    allowed_functions: created.allowed_functions,
    hide_personal: created.hide_personal,
    label: created.label ?? null,
    expires_at: created.expires_at,
    project: created.project,
    token,
    links: { link: linkBase(config.functionBase, token), header_base: linkBase(config.functionBase, null), inbox },
    notice: "This is the only time the link is shown. Copy it now and paste it into an assistant that only you use.",
  }
}

const LINK_FIELDS = ["id", "project_id", "project_name", "label", "level", "allowed_functions", "hide_personal", "created_at", "expires_at", "revoked_at", "last_used_at", "call_count", "write_count", "active"]
const WARNING_FIELDS = ["project", "lines", "tasks", "people", "money_visible", "level", "can_record", "writes_enabled", "rank", "max_level", "functions", "sentence"]

function pick(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in row) out[f] = row[f]
  return out
}

export async function handleMint(req: Request, route: string[], deps: MintDeps): Promise<MintAnswer> {
  const out = await run(req, route, deps)
  return { ...out, headers: { ...corsFor(req), ...(out.headers ?? {}) } }
}

type Parsed =
  | { kind: "mint"; args: MintArgs }
  | { kind: "links"; project: string | null }
  | { kind: "revoke"; id: string }
  | { kind: "warning"; project: string; level: number }
  | { kind: "new-project"; product: string | null; days: number }

type Who = { sub: string; email: string | null; issuer: string; iat: number | null }

/** The session, a fresh one for the two routes that create a credential, and the per-person brake. */
async function gate(req: Request, kind: MintRoute, deps: MintDeps, log: (l: string) => void, at: number): Promise<{ ok: true; who: Who } | { ok: false; out: MintAnswer }> {
  const creates = kind === "mint" || kind === "new-project"
  // 1. THE SESSION ------------------------------------------------------------------------------------------------------------------
  const bearer = bearerOf(req)
  if (!bearer || bearer.startsWith("pxa_")) {
    return { ok: false, out: answer(401, "Sign in to PROJEXA and send your session token in the Authorization header.", "SESSION_REQUIRED", "A link token is not a session.") }
  }
  let verdict
  try {
    verdict = await deps.session(bearer)
  } catch {
    verdict = { ok: false as const, reason: "invalid" as const }
  }
  if (!verdict.ok) {
    if (verdict.reason === "unavailable") {
      log(`ai-work-link: ${kind}: key set unavailable -> 503`)
      return { ok: false, out: answer(503, "Service unavailable. Try again in a minute.", "SESSION_CHECK_UNAVAILABLE") }
    }
    log(`ai-work-link: ${kind}: session refused -> 401`)
    return { ok: false, out: answer(401, "Your session is not valid. Sign in again.", "SESSION_INVALID") }
  }
  // 2. A FRESH SESSION, for the two routes that create a credential ------------------------------------------------------------------
  if (creates) {
    const nowSeconds = Math.floor(at / 1000)
    if (verdict.iat === null || nowSeconds - verdict.iat > MINT_SESSION_MAX_AGE_SECONDS || verdict.iat - nowSeconds > CLOCK_SKEW_SECONDS) {
      log(`ai-work-link: ${kind}: session too old -> 401`)
      return { ok: false, out: answer(401, "Sign in again to make a link: this session is more than 15 minutes old.", "SESSION_STALE", "Refresh your session and try again.") }
    }
  }
  // 3. THE BRAKE --------------------------------------------------------------------------------------------------------------------
  if (overLimit(`${creates ? "mint" : "read"}:${verdict.issuer}|${verdict.sub}`, at, creates ? MINT_LIMIT_PER_MINUTE : READ_LIMIT_PER_MINUTE)) {
    log(`ai-work-link: ${kind}: over the per-person limit -> 429`)
    return { ok: false, out: answer(429, "Too many calls in a minute. Wait a minute.", "RATE_LIMITED", undefined, { "Retry-After": "60" }) }
  }
  return { ok: true, who: { sub: verdict.sub, email: verdict.email, issuer: verdict.issuer, iat: verdict.iat } }
}

/** 4. The parameters of each route (query string or JSON body), checked before anything is read. */
async function parseParams(req: Request, route: string[], kind: MintRoute, method: string): Promise<{ ok: true; value: Parsed } | { ok: false; out: MintAnswer }> {
  const url = new URL(req.url)
  if (kind === "mint") {
    const body = await readObject(req)
    if (!body.ok) return body
    const args = parseMintBody(body.value)
    return args.ok ? { ok: true, value: { kind, args: args.value } } : args
  }
  if (kind === "links") {
    const raw = url.searchParams.get("project") ?? url.searchParams.get("projectId")
    const project = raw === null ? null : idOf(raw)
    if (raw !== null && project === null) return bad("PROJECT_REQUIRED", "project must be a project id.")
    return { ok: true, value: { kind, project } }
  }
  if (kind === "revoke") {
    const id = idOf(route[1])
    return id ? { ok: true, value: { kind, id } } : { ok: false, out: answer(404, "No such link.", "LINK_NOT_FOUND") }
  }
  if (kind === "warning") {
    let source: Record<string, unknown> = { project: url.searchParams.get("project") ?? url.searchParams.get("projectId") ?? undefined, level: url.searchParams.get("level") ?? undefined }
    if (method === "POST") {
      const body = await readObject(req)
      if (!body.ok) return body
      source = body.value
    }
    const project = idOf(source.projectId ?? source.project)
    if (!project) return bad("PROJECT_REQUIRED", "project is required (letters, digits, - and _, at most 128).")
    const level = intOf(source.level, [0, 1], 0)
    return level === null ? bad("BAD_LEVEL", "level must be 0 or 1.") : { ok: true, value: { kind, project, level } }
  }
  const body = await readObject(req)
  if (!body.ok) return body
  let product: string | null = null
  if (body.value.productId !== undefined && body.value.productId !== null) {
    product = idOf(body.value.productId)
    if (!product) return bad("BAD_PRODUCT", "productId must be a product id.")
  }
  const days = intOf(body.value.days, DAYS, 7)
  return days === null ? bad("BAD_DAYS", "days must be 1, 7 or 30.") : { ok: true, value: { kind: "new-project", product, days } }
}

/** 5. Who the person is: one active user of one organisation, through the gateway's own lookup. */
async function resolvePerson(deps: MintDeps, who: Who, kind: MintRoute, log: (l: string) => void): Promise<{ ok: true; userId: string } | { ok: false; out: MintAnswer }> {
  let res
  try {
    res = await deps.rpc("projexa_read_resolve_user", { p_sub: who.sub, p_email: who.email })
  } catch {
    res = { data: null, error: { message: "rpc threw" } }
  }
  const row = res.error ? null : firstRow(res.data)
  if (!row) {
    log(`ai-work-link: ${kind}: identity lookup failed -> 503`)
    return { ok: false, out: unavailable() }
  }
  const reason = typeof row.reason === "string" ? row.reason : null
  if (reason !== null) {
    log(`ai-work-link: ${kind}: person not linked (${NOT_LINKED_REASONS.has(reason) ? reason : "other"}) -> 403`)
    return { ok: false, out: answer(403, USER_NOT_LINKED_MESSAGE, "USER_NOT_LINKED") }
  }
  const userId = typeof row.user_id === "string" && row.user_id !== "" ? row.user_id : null
  if (!userId) {
    log(`ai-work-link: ${kind}: identity lookup answered an unknown shape -> 503`)
    return { ok: false, out: unavailable() }
  }
  return { ok: true, userId }
}

async function run(req: Request, route: string[], deps: MintDeps): Promise<MintAnswer> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const kind = mintRouteOf(route)
  if (!kind) return answer(404, "No such path", "NOT_FOUND")
  const method = req.method === "HEAD" ? "GET" : req.method
  const allowed = kind === "mint" || kind === "revoke" || kind === "new-project" ? ["POST"] : kind === "warning" ? ["GET", "POST"] : ["GET"]
  if (!allowed.includes(method)) return answer(405, "Wrong method for this path.", "METHOD_NOT_ALLOWED", undefined, { Allow: allowed.join(", ") })

  const gated = await gate(req, kind, deps, log, (deps.now ?? Date.now)())
  if (!gated.ok) return gated.out
  const parsed = await parseParams(req, route, kind, method)
  if (!parsed.ok) return parsed.out
  const person = await resolvePerson(deps, gated.who, kind, log)
  if (!person.ok) return person.out
  return execute(parsed.value, person.userId, deps, log)
}

/** 6. The SQL function of the route, and the answer built from what it returns (an unknown shape is 503). */
async function execute(parsed: Parsed, userId: string, deps: MintDeps, log: (l: string) => void): Promise<MintAnswer> {
  const kind = parsed.kind
  if (parsed.kind === "mint") {
    const a = parsed.args
    const done = await call(deps, kind, "ai_work_link_mint_for", {
      p_user_id: userId, p_project_id: a.projectId, p_level: a.level, p_functions: a.functions, p_days: a.days, p_hide_personal: a.hidePersonal, p_label: a.label,
    }, log)
    if (!done.ok) return done.out
    const body = mintedBody(deps.config, done.data)
    if (!body) {
      log("ai-work-link: mint: answered an unknown shape -> 503")
      return unavailable()
    }
    log("ai-work-link: mint -> 201")
    return { status: 201, body }
  }
  if (parsed.kind === "new-project") {
    const done = await call(deps, kind, "ai_work_link_new_project_for", { p_user_id: userId, p_product_id: parsed.product, p_days: parsed.days }, log)
    if (!done.ok) return done.out
    const made = isObject(done.data) ? done.data : null
    const minted = made ? mintedBody(deps.config, made.link) : null
    if (!made || !minted || !isObject(made.project) || typeof made.project.id !== "string") {
      log("ai-work-link: new-project: answered an unknown shape -> 503")
      return unavailable()
    }
    log("ai-work-link: new-project -> 201")
    return { status: 201, body: { shell: true, product_id: made.project.product_id ?? null, ...minted } }
  }
  if (parsed.kind === "links") {
    const done = await call(deps, kind, "ai_work_link_list_for", { p_user_id: userId, p_project_id: parsed.project }, log)
    if (!done.ok) return done.out
    if (!Array.isArray(done.data)) {
      log("ai-work-link: links: answered an unknown shape -> 503")
      return unavailable()
    }
    log("ai-work-link: links -> 200")
    return { status: 200, body: { links: done.data.filter(isObject).map((l) => pick(l, LINK_FIELDS)) } }
  }
  if (parsed.kind === "revoke") {
    const done = await call(deps, kind, "ai_work_link_revoke_for", { p_user_id: userId, p_link_id: parsed.id }, log)
    if (!done.ok) return done.out
    if (!isObject(done.data) || typeof done.data.revoked !== "boolean") {
      log("ai-work-link: revoke: answered an unknown shape -> 503")
      return unavailable()
    }
    log("ai-work-link: revoke -> 200")
    return { status: 200, body: { link_id: parsed.id, revoked: done.data.revoked, already: done.data.already === true } }
  }
  const done = await call(deps, kind, "ai_work_link_warning_for", { p_user_id: userId, p_project_id: parsed.project, p_level: parsed.level }, log)
  if (!done.ok) return done.out
  if (!isObject(done.data) || typeof done.data.sentence !== "string") {
    log("ai-work-link: warning: answered an unknown shape -> 503")
    return unavailable()
  }
  log("ai-work-link: warning -> 200")
  return { status: 200, body: pick(done.data, WARNING_FIELDS) }
}
