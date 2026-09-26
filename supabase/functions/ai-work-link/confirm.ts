// PROJEXA-BUILD-001 U-47b (spec sections 9.2 W-B, 9.3, 9.5; register row BR-497; audit A-20, harness AWL-H18): the Level-2 confirmation,
// POST F/drafts/{id}/confirm, an APP route: it takes a signed-in person's session token, never a link token, and every refusal here is a
// plain answer with no WWW-Authenticate (a 401 with one starts OAuth discovery in some AI clients; spec 3.6).
//
// ORDER OF CHECKS, each before anything is changed
//   no Bearer, or a link token as Bearer (401) -> the session token (401; 503 when a key set cannot be read) -> the per-person limit (429)
//   -> the draft id (404) and the body (400) -> who the person is, through public.projexa_read_resolve_user (403 when the person is not one
//   active user of one organisation) -> public.ai_work_link_draft_confirm (drizzle/0626), which alone decides ownership, token, state and
//   expiry and moves the draft to `confirmed` in ONE UPDATE ... WHERE status = 'awaiting_confirmation'.
//
// WHAT THIS FILE NEVER DOES: reimplement the confirmation. The rules (owner only, the token compared as sha256, single use, 48-hour expiry,
// the writes switch) are the SQL function's. This file maps its five answers to stable HTTP codes and hides everything else:
//   confirmed              200  {draft_id, status: "confirmed", function_id}
//   not_enabled            503  WRITES_NOT_ENABLED (the draft waits and nothing is consumed)
//   refused not_owner      403  NOT_YOUR_DRAFT
//   refused not_found      409  CONFIRM_TOKEN_INVALID (an unknown draft and a wrong code look the same on purpose)
//   refused not_pending    409  CONFIRM_ALREADY_USED  (a reused token, or a draft already confirmed, refused or expired)
//   refused expired        410  CONFIRM_EXPIRED
//   any RPC error, throw or unknown shape: 503 CONFIRM_UNAVAILABLE and nothing is reported as confirmed (fail closed).
// The answer never carries the confirm token, the draft's parameters (they may hold money figures), or any organisation, link or person id.
//
// THE PER-PERSON LIMIT is kept in this isolate's memory (10 calls a minute per verified person, then 429): the link's own call log takes a
// LINK token and an app route has none, so no database function counts these calls. Several isolates each keep their own count, so it is a
// brake and not a hard cap; the hard limits are the 256-bit confirm token and the owner check.
import { errorBody } from "../_shared/ai-link/core.ts"
import type { Rpc } from "./reads.ts"
import type { SessionVerifier } from "./session.ts"

export type ConfirmDeps = {
  rpc: Rpc
  session: SessionVerifier
  log?: (line: string) => void
  /** Milliseconds since the epoch; the test passes its own clock. */
  now?: () => number
}

export type ConfirmAnswer = { status: number; body: unknown; headers?: Record<string, string> }

// The same sentence as src/lib/supabase/auth-guard.ts USER_NOT_LINKED_MESSAGE and projexa-read/handler.ts.
export const USER_NOT_LINKED_MESSAGE = "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin"

export const CONFIRM_LIMIT_PER_MINUTE = 10
const WINDOW_MS = 60_000
const MAX_TRACKED_PEOPLE = 5_000
const BODY_MAX_BYTES = 8 * 1024
const TOKEN_MAX_CHARS = 200
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const NOT_LINKED_REASONS = new Set(["not_linked", "deactivated", "ambiguous"])

// one Map per isolate: verified person -> the times of their calls inside the last minute
const recent = new Map<string, number[]>()

/** True when this call is over the limit. The call is counted first, so the 11th call in a minute is the first refused. */
function overLimit(person: string, at: number): boolean {
  const cut = at - WINDOW_MS
  if (recent.size >= MAX_TRACKED_PEOPLE && !recent.has(person)) {
    for (const [k, v] of recent) if (v.every((t) => t <= cut)) recent.delete(k)
    if (recent.size >= MAX_TRACKED_PEOPLE) recent.clear()
  }
  const times = (recent.get(person) ?? []).filter((t) => t > cut)
  times.push(at)
  recent.set(person, times)
  return times.length > CONFIRM_LIMIT_PER_MINUTE
}

/** Test hook: forget every count (each test starts clean). */
export function resetConfirmLimits(): void {
  recent.clear()
}

const answer = (status: number, message: string, code: string, hint?: string, headers?: Record<string, string>): ConfirmAnswer => ({
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

export async function handleConfirm(req: Request, draftId: string, deps: ConfirmDeps): Promise<ConfirmAnswer> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const at = (deps.now ?? Date.now)()

  // 1. THE SESSION -------------------------------------------------------------------------------------------------------------------------
  const token = bearerOf(req)
  if (!token || token.startsWith("pxa_")) return answer(401, "Sign in to PROJEXA and send your session token in the Authorization header.", "SESSION_REQUIRED", "A link token is not a session.")
  let who
  try {
    who = await deps.session(token)
  } catch {
    who = { ok: false as const, reason: "invalid" as const }
  }
  if (!who.ok) {
    if (who.reason === "unavailable") {
      log("ai-work-link: confirm: key set unavailable -> 503")
      return answer(503, "Service unavailable. Try again in a minute.", "SESSION_CHECK_UNAVAILABLE")
    }
    log("ai-work-link: confirm: session refused -> 401")
    return answer(401, "Your session is not valid. Sign in again.", "SESSION_INVALID")
  }

  // 2. THE BRAKE ---------------------------------------------------------------------------------------------------------------------------
  if (overLimit(`${who.issuer}|${who.sub}`, at)) {
    log("ai-work-link: confirm: over the per-person limit -> 429")
    return answer(429, `Too many confirm attempts (${CONFIRM_LIMIT_PER_MINUTE} a minute). Wait a minute.`, "RATE_LIMITED", undefined, { "Retry-After": "60" })
  }

  // 3. THE DRAFT AND THE BODY --------------------------------------------------------------------------------------------------------------
  if (!ID_RE.test(draftId)) return answer(404, "No such draft.", "DRAFT_NOT_FOUND")
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > BODY_MAX_BYTES) return answer(413, "The body is over 8 KB.", "BODY_TOO_LARGE")
  let parsed: unknown = null
  try {
    parsed = raw.trim() === "" ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }
  const confirmToken = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).confirmToken : undefined
  if (typeof confirmToken !== "string" || confirmToken.length === 0 || confirmToken.length > TOKEN_MAX_CHARS) {
    return answer(400, "The body must be JSON with the confirm code from the link, as confirmToken.", "CONFIRM_TOKEN_REQUIRED")
  }

  // 4. WHO THE PERSON IS -------------------------------------------------------------------------------------------------------------------
  let res
  try {
    res = await deps.rpc("projexa_read_resolve_user", { p_sub: who.sub, p_email: who.email })
  } catch {
    res = { data: null, error: { message: "rpc threw" } }
  }
  const person = res.error ? null : firstRow(res.data)
  if (!person) {
    log("ai-work-link: confirm: identity lookup failed -> 503")
    return answer(503, "Service unavailable. Try again in a minute.", "CONFIRM_UNAVAILABLE", "Nothing was confirmed.")
  }
  const reason = typeof person.reason === "string" ? person.reason : null
  if (reason !== null) {
    log(`ai-work-link: confirm: person not linked (${NOT_LINKED_REASONS.has(reason) ? reason : "other"}) -> 403`)
    return answer(403, USER_NOT_LINKED_MESSAGE, "USER_NOT_LINKED")
  }
  const userId = typeof person.user_id === "string" && person.user_id !== "" ? person.user_id : null
  if (!userId) {
    log("ai-work-link: confirm: identity lookup answered an unknown shape -> 503")
    return answer(503, "Service unavailable. Try again in a minute.", "CONFIRM_UNAVAILABLE", "Nothing was confirmed.")
  }

  // 5. THE CONFIRMATION, by the SQL function ----------------------------------------------------------------------------------------------
  let out
  try {
    out = await deps.rpc("ai_work_link_draft_confirm", { p_draft_id: draftId, p_confirm_token: confirmToken, p_actor_user_id: userId })
  } catch {
    out = { data: null, error: { message: "rpc threw" } }
  }
  const r = !out.error && out.data && typeof out.data === "object" && !Array.isArray(out.data) ? (out.data as Record<string, unknown>) : null
  const status = r && typeof r.status === "string" ? r.status : ""
  if (status === "confirmed") {
    const intent = r?.intent && typeof r.intent === "object" ? (r.intent as Record<string, unknown>) : {}
    const fn = typeof intent.function_id === "string" && ID_RE.test(intent.function_id) ? intent.function_id : null
    log("ai-work-link: confirm: confirmed -> 200")
    return { status: 200, body: { draft_id: draftId, status: "confirmed", function_id: fn, message: "Confirmed. The change is queued for the executor." } }
  }
  if (status === "not_enabled") {
    return answer(503, "Confirming changes is not switched on yet. The draft is kept and waits.", "WRITES_NOT_ENABLED", "It stays awaiting confirmation until it expires.")
  }
  if (status === "refused") {
    const why = typeof r?.reason === "string" ? r.reason : ""
    if (why === "not_owner") return answer(403, "This draft belongs to another person.", "NOT_YOUR_DRAFT")
    if (why === "not_found") return answer(409, "The draft or the confirm code is not valid.", "CONFIRM_TOKEN_INVALID", "Open the confirm link again.")
    if (why === "not_pending") return answer(409, "This confirm code was already used, or the draft is no longer waiting.", "CONFIRM_ALREADY_USED")
    if (why === "expired") return answer(410, "This draft expired. Ask the AI to propose it again.", "CONFIRM_EXPIRED")
  }
  log("ai-work-link: confirm: confirmation unavailable -> 503, nothing reported as confirmed")
  return answer(503, "Service unavailable. Try again in a minute.", "CONFIRM_UNAVAILABLE", "Nothing was confirmed.")
}
