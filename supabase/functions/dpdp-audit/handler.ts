// DPDP audit trail -- the Edge Function's logic (owner spec 2026-10-06, items 3, 4, 7 and 9). PURE apart from the injected `Deps` (so src/lib/services/dpdp-audit-handler.test.ts
// drives every route with a fake database, a fake sign-in and a real key ring). index.ts is the thin Deno wrapper.
//
//   POST /event               the browser tells us about a sign-in (login / failed_login) or a read of personal data. Only these three types are accepted from a browser;
//                             every mutation is recorded by the database itself (triggers, drizzle/0731), never by a browser's say-so.
//   GET  /orgs                what this signed-in person may download (own log; whole organisation if owner / head of department)
//   GET  /my                  the person's OWN rows, masked, as a downloadable file         -- signed in + a code confirmed in the last 10 minutes + rate limited
//   GET  /org                 the organisation's whole log, masked (owner or head of department only; same three conditions)
//   POST /verify              verify the organisation's whole chain (owner or head of department)
//   POST /verify-file         is this downloaded file untouched, and did we issue it?
//   POST /policy/hod          the organisation's owner names who may download the whole log
//   POST /staff/read          INTERNAL: platform owner only, reason required, the access log is written FIRST, full values returned
//   POST /staff/legal-hold    INTERNAL: platform owner only; suspends the 365-day deletion for an organisation
//
// "Fresh code": the person must have just signed in with an e-mailed code or link (the existing Supabase e-mail OTP flow the app already uses -- App.tsx signInWithOtp /
// verifyOtp). The access token Supabase issues records that moment in its `amr` claim; we accept the download only when the newest code-based sign-in is within
// DPDP_AUDIT_CODE_MAX_AGE_SECONDS (default 600). No new code mechanism, nothing stored.
// "Browser download only, NEVER e-mailed": the file is the HTTP response to the signed-in browser's own request. Nothing here sends a log by e-mail.
import { type KeyRing } from "../_shared/audit/seal.ts"
import { GENESIS, type ChainRow, verifyChain, verifyRowSelf } from "../_shared/audit/chain.ts"
import { type StoredRow, buildDownload, fileIsIntact, fullRow, toDownloadText } from "../_shared/audit/download.ts"
import { type AuditInput, type EventType } from "../_shared/audit/event.ts"
import { type Rpc, makeWriter, netFromHeaders } from "../_shared/audit/writer.ts"

export type Deps = {
  rpc: Rpc
  verifyJwt: (jwt: string) => Promise<{ email: string; claims: Record<string, unknown> } | null>
  ring: () => Promise<KeyRing>
  now: () => number
  env: (name: string) => string
}

type Membership = { orgId: string; orgName: string | null; level: string; hod: boolean }
type Caller = { identityId: string | null; email: string; memberships: Membership[]; isPlatformOwner: boolean; claims: Record<string, unknown> }

export const BROWSER_EVENTS: ReadonlyArray<EventType> = ["login", "failed_login", "read_personal_data"]
const CODE_METHODS = ["otp", "magiclink", "email", "email_otp"]
const PAGE = 2000

export const NOTICE_TEXT =
  "This file lists what was done with your organisation's DPDP records and who did it. Every identifier is masked. It is for your own use and is not a legal record on its own: the verification hash lets us confirm the file is untouched."

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", ...extra } })

const fail = (status: number, error: string, code?: string, extra: Record<string, string> = {}): Response => json({ error, ...(code ? { code } : {}) }, status, extra)

/** Newest code-based sign-in in the access token's `amr` claim, in seconds since the epoch, or null. */
export function lastCodeSignInSeconds(claims: Record<string, unknown>): number | null {
  const amr = claims.amr
  if (!Array.isArray(amr)) return null
  let best: number | null = null
  for (const e of amr) {
    const m = e as { method?: unknown; timestamp?: unknown }
    if (typeof m?.method === "string" && CODE_METHODS.includes(m.method) && typeof m.timestamp === "number") best = best === null ? m.timestamp : Math.max(best, m.timestamp)
  }
  return best
}
export function freshCodeOk(claims: Record<string, unknown>, nowMs: number, maxAgeSeconds: number): boolean {
  const t = lastCodeSignInSeconds(claims)
  if (t === null) return false
  const age = nowMs / 1000 - t
  return age >= -30 && age <= maxAgeSeconds
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {}
  return {
    "access-control-allow-origin": origin, "vary": "origin",
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info, x-client-time, x-client-tz, x-device-id",
    "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-expose-headers": "content-disposition, x-verification-hash", "access-control-max-age": "600",
  }
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  const url = new URL(req.url)
  const path = (url.pathname.replace(/^.*\/dpdp-audit(?=\/|$)/, "") || "/").replace(/\/+$/, "") || "/"
  const appOrigin = (d.env("APP_ORIGIN") || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")
  const allowed = (d.env("DPDP_AUDIT_ALLOWED_ORIGINS") || `${appOrigin},https://app.veridian-aios.com`).split(",").map((s) => s.trim()).filter(Boolean)
  const cors = corsHeaders(req.headers.get("origin"), allowed)
  const withCors = (r: Response): Response => { for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  try {
    return withCors(await route(req, d, url, path, appOrigin))
  } catch (e) {
    console.error("dpdp-audit: unhandled", e instanceof Error ? e.message : String(e))
    return withCors(fail(500, "Something failed on our side. Try again in a minute."))
  }
}

async function route(req: Request, d: Deps, url: URL, path: string, appOrigin: string): Promise<Response> {
  const writer = makeWriter(d.rpc, d.ring, d.now)
  const method = req.method.toUpperCase()

  // ---- the one route that may be called without a sign-in: a failed sign-in attempt ----
  if (method === "POST" && path === "/event") {
    const body = await readJson(req)
    if (body instanceof Response) return body
    const type = String(body.type ?? "")
    if (!(BROWSER_EVENTS as readonly string[]).includes(type)) return fail(400, `A browser may only report: ${BROWSER_EVENTS.join(", ")}. Everything else is recorded by the server.`)
    return type === "failed_login" ? failedLogin(req, d, body, writer) : authedEvent(req, d, body, writer, type as EventType)
  }

  const caller = await authenticate(req, d)
  if (caller instanceof Response) return caller

  if (method === "GET" && path === "/orgs") {
    return json({
      orgs: caller.memberships.map((m) => ({ orgId: m.orgId, orgName: m.orgName, canDownloadOwn: true, canDownloadOrganisation: m.level === "owner" || m.hod, isOwner: m.level === "owner", isHod: m.hod })),
      codeFresh: freshCodeOk(caller.claims, d.now(), maxAge(d)),
      codeMaxAgeSeconds: maxAge(d),
      isPlatformOwner: caller.isPlatformOwner,
      appOrigin,
    })
  }
  if (method === "GET" && (path === "/my" || path === "/org")) return download(req, d, url, caller, writer, path === "/my" ? "own" : "organisation")
  if (method === "POST" && path === "/verify") return verify(req, d, caller)
  if (method === "POST" && path === "/verify-file") return verifyFile(req, d, caller)
  if (method === "POST" && path === "/policy/hod") return setHod(req, d, caller)
  if (method === "POST" && path === "/staff/read") return staffRead(req, d, caller, writer)
  if (method === "POST" && path === "/staff/legal-hold") return legalHold(req, d, caller)
  return fail(404, "No such route.")
}

const maxAge = (d: Deps): number => Math.max(60, Math.min(3600, Number(d.env("DPDP_AUDIT_CODE_MAX_AGE_SECONDS")) || 600))
const perHour = (d: Deps): number => Math.max(1, Math.min(100, Number(d.env("DPDP_AUDIT_EXPORTS_PER_HOUR")) || 5))

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  const raw = await req.text()
  if (raw.length > 4_000_000) return fail(413, "Too large.")
  try {
    const v = JSON.parse(raw || "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(400, "Body must be a JSON object.")
  } catch {
    return fail(400, "Body must be JSON.")
  }
}

async function authenticate(req: Request, d: Deps): Promise<Caller | Response> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  if (!m) return fail(401, "Sign in first.")
  const who = await d.verifyJwt(m[1].trim())
  if (!who || !who.email) return fail(401, "Sign in first.")
  const r = await d.rpc("dpdp_audit_resolve_caller", { p_email: who.email })
  if (r.error) return fail(500, "Something failed on our side. Try again in a minute.")
  const c = r.data as { identityId: string | null; memberships: Membership[]; isPlatformOwner: boolean }
  return { identityId: c.identityId, email: who.email, memberships: c.memberships ?? [], isPlatformOwner: !!c.isPlatformOwner, claims: who.claims }
}

function loginMethodOf(claims: Record<string, unknown>): string | null {
  const amr = claims.amr
  if (!Array.isArray(amr) || amr.length === 0) return null
  const last = [...amr].sort((a, b) => Number((b as { timestamp?: number }).timestamp ?? 0) - Number((a as { timestamp?: number }).timestamp ?? 0))[0] as { method?: string }
  return typeof last?.method === "string" ? last.method : null
}

function baseInput(req: Request, body: Record<string, unknown>): Pick<AuditInput, "net" | "client" | "sessionId"> {
  const net = netFromHeaders(req.headers)
  return {
    net: { ...net, deviceId: strOrNull(body.device_id) ?? req.headers.get("x-device-id") },
    client: { time: strOrNull(body.client_time) ?? req.headers.get("x-client-time"), timeZone: strOrNull(body.client_tz) ?? req.headers.get("x-client-tz") },
    sessionId: strOrNull(body.session_id),
  }
}
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null)

async function failedLogin(req: Request, d: Deps, body: Record<string, unknown>, writer: ReturnType<typeof makeWriter>): Promise<Response> {
  const email = strOrNull(body.email)
  // Always the same answer, so this route cannot be used to find out which addresses have an account.
  const same = (): Response => json({ ok: true }, 202)
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return same()
  const r = await d.rpc("dpdp_audit_resolve_caller", { p_email: email })
  if (r.error) return same()
  const c = r.data as { identityId: string | null; memberships: Membership[] }
  if (!c.identityId || !c.memberships?.length) return same()
  const org = c.memberships[0].orgId
  const since = new Date(d.now() - 10 * 60_000).toISOString()
  const n = await d.rpc("dpdp_audit_count_recent", { p_org: org, p_actor: c.identityId, p_type: "failed_login", p_since: since })
  if (!n.error && Number(n.data) >= 10) return same() // a guessing run is already on the record; do not let it fill the log
  await writer.append({ orgId: org, eventType: "failed_login", outcome: "failed", actorType: "human", actorUserId: c.identityId, actorEmail: email, loginMethod: strOrNull(body.method) ?? "otp", ...baseInput(req, body) })
  return same()
}

async function authedEvent(req: Request, d: Deps, body: Record<string, unknown>, writer: ReturnType<typeof makeWriter>, type: EventType): Promise<Response> {
  const caller = await authenticate(req, d)
  if (caller instanceof Response) return caller
  if (!caller.identityId || !caller.memberships.length) return json({ ok: true, recorded: false })
  const wanted = strOrNull(body.org_id)
  const m = (wanted && caller.memberships.find((x) => x.orgId === wanted)) || caller.memberships[0]
  const n = await d.rpc("dpdp_audit_count_recent", { p_org: m.orgId, p_actor: caller.identityId, p_type: type, p_since: new Date(d.now() - 3_600_000).toISOString() })
  if (!n.error && Number(n.data) >= (type === "login" ? 30 : 300)) return json({ ok: true, recorded: false, reason: "rate_limited" }, 429)
  const target = type === "read_personal_data" && strOrNull(body.target_table) ? { table: String(body.target_table).slice(0, 80), id: String(body.target_id ?? "").slice(0, 120) } : null
  const res = await writer.append({
    orgId: m.orgId, eventType: type, actorType: "human", actorUserId: caller.identityId, actorRole: m.level, actorEmail: caller.email, target,
    loginMethod: loginMethodOf(caller.claims), requestId: strOrNull(body.request_id), ...baseInput(req, body), sessionId: strOrNull(body.session_id) ?? (typeof caller.claims.session_id === "string" ? caller.claims.session_id : null),
  })
  return json({ ok: res.ok, recorded: res.ok })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------------------------------------------------------------

async function logDenied(writer: ReturnType<typeof makeWriter>, caller: Caller, orgId: string, why: string, scope: string): Promise<void> {
  await writer.append({ orgId, eventType: "denied", outcome: "denied", actorType: "human", actorUserId: caller.identityId, actorRole: caller.memberships.find((m) => m.orgId === orgId)?.level ?? null, details: { action: "audit_download", why, scope } })
}

async function pageRows(d: Deps, org: string, actor: string | null, afterSeq: number, limit: number, from: string | null, to: string | null): Promise<ChainRow[]> {
  const out: ChainRow[] = []
  let after = afterSeq
  while (out.length < limit) {
    const want = Math.min(PAGE, limit - out.length)
    const r = await d.rpc("dpdp_audit_fetch", { p_org: org, p_actor: actor, p_after_seq: after, p_limit: want, p_from: from, p_to: to })
    if (r.error) throw new Error("fetch failed")
    const rows = r.data as ChainRow[]
    out.push(...rows)
    if (rows.length < want) break
    after = Number(rows[rows.length - 1].seq)
  }
  return out
}

function parseDate(v: string | null): string | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

async function download(req: Request, d: Deps, url: URL, caller: Caller, writer: ReturnType<typeof makeWriter>, scope: "own" | "organisation"): Promise<Response> {
  if (!caller.identityId || !caller.memberships.length) return fail(403, "You are not a member of any organisation here.")
  const wanted = url.searchParams.get("org_id")
  const m = (wanted && caller.memberships.find((x) => x.orgId === wanted)) || (wanted ? null : caller.memberships[0])
  if (!m) return fail(403, "You are not a member of that organisation.")
  if (scope === "organisation" && !(m.level === "owner" || m.hod)) {
    await logDenied(writer, caller, m.orgId, "not_owner_or_hod", scope)
    return fail(403, "Only the organisation's owner or a head of department can download the whole log.")
  }
  if (!freshCodeOk(caller.claims, d.now(), maxAge(d))) {
    await logDenied(writer, caller, m.orgId, "no_fresh_code", scope)
    return fail(403, "Confirm a fresh code first: sign in again with the code we e-mail you, then download within a few minutes.", "FRESH_CODE_REQUIRED")
  }
  const since = new Date(d.now() - 3_600_000).toISOString()
  const used = await d.rpc("dpdp_audit_count_exports", { p_org: m.orgId, p_actor: caller.identityId, p_since: since })
  if (used.error) return fail(500, "Something failed on our side. Try again in a minute.")
  if (Number(used.data) >= perHour(d)) {
    await writer.append({ orgId: m.orgId, eventType: "download_export", outcome: "denied", actorType: "human", actorUserId: caller.identityId, actorRole: m.level, details: { scope, why: "rate_limited" } })
    return fail(429, `You can download up to ${perHour(d)} files an hour. Try again later.`, "RATE_LIMITED", { "retry-after": "3600" })
  }

  const limit = Math.max(1, Math.min(20000, Number(url.searchParams.get("limit")) || 5000))
  const afterSeq = Math.max(0, Number(url.searchParams.get("after_seq")) || 0)
  const from = parseDate(url.searchParams.get("from"))
  const to = parseDate(url.searchParams.get("to"))
  const rows = await pageRows(d, m.orgId, scope === "own" ? caller.identityId : null, afterSeq, limit + 1, from, to)
  const more = rows.length > limit
  if (more) rows.pop()

  const state = ((await d.rpc("dpdp_audit_chain_state", { p_org: m.orgId })).data ?? {}) as { anchor?: string; head?: string | null }
  let chain: { verified: boolean | null; rows: number; head: string | null; detail?: string }
  if (scope === "organisation") {
    const v = await verifyChain(rows, afterSeq === 0 ? state.anchor ?? GENESIS : rows[0]?.prev_hash ?? GENESIS)
    chain = v.ok ? { verified: true, rows: v.rows, head: v.head, ...(afterSeq === 0 ? {} : { detail: "checked within this stretch only (it continues an earlier page)" }) } : { verified: false, rows: v.rows, head: null, detail: `${v.reason} at row ${v.brokenAtSeq}: ${v.detail}` }
  } else {
    let allSelf = true
    for (const r of rows) if (!(await verifyRowSelf(r))) { allSelf = false; break }
    chain = { verified: allSelf, rows: rows.length, head: state.head ?? null, detail: "each row of yours was checked against its own hash; your rows are not a continuous stretch of the organisation's chain, so ask the owner to run Verify chain for the whole log" }
  }

  const body = await buildDownload(await d.ring(), rows as unknown as StoredRow[], {
    scope, orgId: m.orgId, orgName: m.orgName, requestedBy: { userId: caller.identityId, role: m.level, email: caller.email }, generatedAtUtc: new Date(d.now()).toISOString(),
    fromUtc: from, toUtc: to, chain, notice: NOTICE_TEXT,
  })
  if (more) { body.more = true; body.next_after_seq = Number(rows[rows.length - 1]?.seq ?? afterSeq) }

  // Fail closed: if the export cannot be recorded, it is not handed out.
  const logged = await writer.append({
    orgId: m.orgId, eventType: "download_export", outcome: "ok", actorType: "human", actorUserId: caller.identityId, actorRole: m.level, actorEmail: caller.email,
    details: { scope, rows: rows.length, from, to, more }, refHash: String(body.verification_hash), sessionId: typeof caller.claims.session_id === "string" ? caller.claims.session_id : null,
    loginMethod: loginMethodOf(caller.claims), net: netFromHeaders(req.headers),
  })
  if (!logged.ok) return fail(500, "The download could not be recorded, so it was not issued. Try again in a minute.")
  const name = `dpdp-audit-log-${scope === "own" ? "mine" : "organisation"}-${new Date(d.now()).toISOString().slice(0, 10)}.json`
  return new Response(toDownloadText(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "x-verification-hash": String(body.verification_hash), "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" },
  })
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------------------------------------------

export const MAX_VERIFY_ROWS = 200_000

function pickOrg(caller: Caller, wanted: unknown, needAll: boolean): Membership | null {
  const w = typeof wanted === "string" ? wanted : null
  const pool = caller.memberships.filter((m) => !needAll || m.level === "owner" || m.hod)
  return (w ? pool.find((m) => m.orgId === w) : pool[0]) ?? null
}

async function verify(req: Request, d: Deps, caller: Caller): Promise<Response> {
  const body = await readJson(req)
  if (body instanceof Response) return body
  const m = pickOrg(caller, body.org_id, true)
  if (!m) return fail(403, "Only the organisation's owner or a head of department can verify its chain.")
  const state = ((await d.rpc("dpdp_audit_chain_state", { p_org: m.orgId })).data ?? {}) as { anchor?: string; anchorSeq?: number; head?: string | null }
  const heads = ((await d.rpc("dpdp_audit_recorded_heads", { p_org: m.orgId, p_limit: 400 })).data ?? []) as Array<{ head_date: string; head_hash: string; last_seq: number }>
  const wantSeq = new Map<number, { hash: string; date: string }>()
  const anchorSeq = Number(state.anchorSeq ?? 0)
  for (const h of heads) if (Number(h.last_seq) > anchorSeq) wantSeq.set(Number(h.last_seq), { hash: h.head_hash, date: h.head_date })

  let prev = state.anchor ?? GENESIS
  let after = 0
  let total = 0
  let head: string | null = null
  const seen = new Map<number, string>()
  for (;;) {
    const r = await d.rpc("dpdp_audit_fetch", { p_org: m.orgId, p_actor: null, p_after_seq: after, p_limit: PAGE, p_from: null, p_to: null })
    if (r.error) return fail(500, "Something failed on our side. Try again in a minute.")
    const rows = r.data as ChainRow[]
    if (!rows.length) break
    const v = await verifyChain(rows, prev)
    if (!v.ok) return json({ ok: false, orgId: m.orgId, rows: total + v.rows, brokenAtSeq: v.brokenAtSeq, reason: v.reason, detail: v.detail })
    for (const row of rows) if (wantSeq.has(Number(row.seq))) seen.set(Number(row.seq), row.row_hash)
    total += v.rows; head = v.head; prev = v.head ?? prev
    after = Number(rows[rows.length - 1].seq)
    if (total >= MAX_VERIFY_ROWS) return json({ ok: true, orgId: m.orgId, rows: total, head, truncated: true, detail: `checked the first ${MAX_VERIFY_ROWS} rows only` })
    if (rows.length < PAGE) break
  }
  // Every daily head we recorded (and e-mailed to the owner) must still be in the chain: removing the newest rows would not break any link, but it would fail this.
  const missing = [...wantSeq.entries()].filter(([seq, h]) => seen.get(seq) !== h.hash).map(([seq, h]) => ({ seq, date: h.date }))
  if (missing.length) return json({ ok: false, orgId: m.orgId, rows: total, reason: "recorded_head_missing", detail: "a daily chain hash we recorded is no longer in the chain (rows were removed or replaced)", missing: missing.slice(0, 20) })
  return json({ ok: true, orgId: m.orgId, rows: total, head, recordedHeadsChecked: wantSeq.size })
}

async function verifyFile(req: Request, d: Deps, caller: Caller): Promise<Response> {
  void caller
  const body = await readJson(req)
  if (body instanceof Response) return body
  const file = (body.file && typeof body.file === "object" ? body.file : body) as Record<string, unknown>
  const intact = await fileIsIntact(file)
  let issued: { found?: boolean; issuedAt?: string } = { found: false }
  if (intact && typeof file.verification_hash === "string") {
    const r = await d.rpc("dpdp_audit_find_export", { p_hash: file.verification_hash })
    if (!r.error) issued = r.data as typeof issued
  }
  return json({ intact, issuedByUs: !!issued.found, issuedAt: issued.found ? issued.issuedAt : null })
}

async function setHod(req: Request, d: Deps, caller: Caller): Promise<Response> {
  const body = await readJson(req)
  if (body instanceof Response) return body
  const m = caller.memberships.find((x) => x.orgId === body.org_id && x.level === "owner")
  if (!m) return fail(403, "Only an owner of this organisation can name who may download its whole log.")
  const ids = Array.isArray(body.identity_ids) ? (body.identity_ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : []
  const r = await d.rpc("dpdp_audit_set_hod", { p_email: caller.email, p_org: m.orgId, p_identity_ids: ids })
  return r.error ? fail(r.error.code === "42501" ? 403 : 400, r.error.message) : json(r.data)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Internal staff access (owner only, for now)
// ---------------------------------------------------------------------------------------------------------------------------------

async function staffRead(req: Request, d: Deps, caller: Caller, writer: ReturnType<typeof makeWriter>): Promise<Response> {
  if (!caller.isPlatformOwner) return fail(403, "This is internal.")
  const body = await readJson(req)
  if (body instanceof Response) return body
  const org = strOrNull(body.org_id)
  if (!org) return fail(400, "org_id is required.")
  const reason = strOrNull(body.reason) ?? ""
  const filters = { actor: strOrNull(body.actor_user_id), from: parseDate(strOrNull(body.from)), to: parseDate(strOrNull(body.to)), after_seq: Number(body.after_seq) || 0, limit: Math.min(2000, Number(body.limit) || 200) }
  // The access-log row is written FIRST. No row, no values: if this fails nothing is opened.
  const begun = await d.rpc("dpdp_audit_staff_begin", { p_email: caller.email, p_org: org, p_scope: "rows", p_reason: reason, p_filters: filters })
  if (begun.error) return fail(begun.error.code === "42501" ? 403 : 400, begun.error.message)
  const logId = String(begun.data)
  const rows = await pageRows(d, org, filters.actor, filters.after_seq, filters.limit, filters.from, filters.to)
  const ring = await d.ring()
  const full: Array<Record<string, unknown>> = []
  for (const r of rows) full.push(await fullRow(ring, r as unknown as StoredRow))
  await d.rpc("dpdp_audit_staff_finish", { p_log_id: logId, p_rows: full.length })
  // The read is also on the organisation's own chain, so its owner can see that the platform looked.
  await writer.append({ orgId: org, eventType: "staff_read", actorType: "human", actorUserId: null, actorRole: "platform_owner", details: { access_log_id: logId, rows: full.length, reason_recorded: true }, net: netFromHeaders(req.headers) })
  return json({ accessLogId: logId, rows: full.length, items: full }, 200, { "x-internal": "1" })
}

async function legalHold(req: Request, d: Deps, caller: Caller): Promise<Response> {
  if (!caller.isPlatformOwner) return fail(403, "This is internal.")
  const body = await readJson(req)
  if (body instanceof Response) return body
  const r = await d.rpc("dpdp_audit_set_legal_hold", { p_email: caller.email, p_org: strOrNull(body.org_id), p_hold: body.hold === true, p_reason: strOrNull(body.reason) ?? "" })
  return r.error ? fail(r.error.code === "42501" ? 403 : 400, r.error.message) : json(r.data)
}
