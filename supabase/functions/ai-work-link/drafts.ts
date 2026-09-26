// PROJEXA-BUILD-002 WP-09a (register rows AW-501, AW-503, AW-507, AW-508; spec sections 9.2, 9.3, 9.5, 9.6, 10.9; write-path gap report G4 to G7,
// G11, G12, G17): the change routes of the ai-work-link Edge function. A NEW file, so the routes of other units stay in their own files and
// handler.ts holds one dispatch line per route.
//
//   POST /drafts                    (link token)  records a DRAFT: checks scope, the body and the parameters, then calls
//                                                  public.ai_work_link_record_intent(kind 'draft') and answers {draft_id, confirm_url, expires_at}.
//                                                  LIVE while writes are off: a draft changes nothing until its person confirms it while signed in.
//   GET  /drafts/{id}               (link token)  the state of one draft this link made (404 for anything else, an action included).
//   GET|POST /drafts/{id}/preview   (session)     what the person sees BEFORE confirming: the function, every parameter, and for a BOQ function the
//                                                  total. Owner and confirm code are checked by public.ai_work_link_draft_state; it works while
//                                                  writes are off.
//   POST /actions                   (link token)  a direct level-1 change. Refuses with a TRUE reason while the switch is off (403
//                                                  WRITES_NOT_ENABLED), and never with LEVEL_NOT_ALLOWED unless the level really is the reason. When the
//                                                  switch and the exec function are both on and the level allows: record_intent(kind 'action'), then
//                                                  ai_work_link_intent_claim, then the exec function (a later unit supplies it as `env.exec`).
//
// WHAT THIS FILE NEVER DOES: run a pipeline function, call a model, hold a database client, log a token or a confirm code, or send the confirm
// code anywhere but the fragment of confirm_url in the ONE answer that mints it. A replay of a draft never returns the code again (SQL returns it
// once and stores only its sha256). The route order is the spec 4.3 order: scope (403) -> body and parameters (400, 413, 422) -> availability
// (503) -> the work.
import { cleanDeep, errorBody } from "../_shared/ai-link/core.ts"
import { functionDef } from "./api-definition.ts"
import { readConfirmBody, personGate, sessionGate, type ConfirmDeps } from "./confirm.ts"
import { AwlError, availabilityOf, callRpc, checkChange, fail, readIntent, requireScope, type ExecOutcome, type ReadEnv } from "./reads.ts"

export type Answer = { status: number; body: unknown; headers?: Record<string, string> }

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const KEY_MAX_CHARS = 128

// ---------------------------------------------------------------------------------------------------------------------------------
// The call: parameters and idempotency key
// ---------------------------------------------------------------------------------------------------------------------------------

function paramsOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}
}

/** The caller's idempotency_key: absent is null (SQL derives one from the function, the parameters and the UTC date); a non-string or a long one is 400. */
function idempotencyKeyOf(body: Record<string, unknown>): string | null {
  const k = body.idempotency_key
  if (k === undefined || k === null || k === "") return null
  if (typeof k !== "string" || k.length > KEY_MAX_CHARS) throw fail(400, `idempotency_key must be text of at most ${KEY_MAX_CHARS} characters.`)
  return k
}

type Recorded = {
  intent_id: string
  status: string
  kind: string
  function_id: string
  replayed: boolean
  confirm_token: string | null
  expires_at: string
  submission_id: string | null
  result: { id?: string; route?: string } | null
  failure: { code?: string; missing?: string[] } | null
}

async function recordIntent(env: ReadEnv, kind: "draft" | "action", fn: string, params: Record<string, unknown>, key: string | null): Promise<Recorded> {
  const data = (await callRpc(env.rpc, "ai_work_link_record_intent", { p_token: env.token, p_kind: kind, p_function_id: fn, p_params: params, p_idempotency_key: key })) as Recorded | null
  if (!data || typeof data.intent_id !== "string" || typeof data.status !== "string") throw fail(500, "Something failed on our side. Try again in a minute.")
  return data
}

// ---------------------------------------------------------------------------------------------------------------------------------
// POST /drafts
// ---------------------------------------------------------------------------------------------------------------------------------

/** The page the person opens to confirm. The draft id and the one-time confirm code ride in the FRAGMENT, so they never reach a server log. */
export function confirmUrlFor(confirmHost: string, draftId: string, confirmToken: string): string {
  return `https://${confirmHost}/ai-confirm.html#d=${draftId}.${confirmToken}`
}

export async function draftCreate(env: ReadEnv, body: Record<string, unknown>): Promise<Answer> {
  const params = paramsOf(body)
  requireScope(env.ctx, body.function, params)
  const def = functionDef(String(body.function))
  if (def?.kind !== "write") throw fail(400, "Reads go to /functions or /records, not /drafts.")
  const key = idempotencyKeyOf(body)
  // before anything is recorded: a draft holds its idempotency key and one of the link's 30 hourly slots for 48 hours (G17)
  const check = checkChange(env, body.function, body.params)
  if (!check.valid) throw fail(422, "The change is not valid yet.", check.problems.join(" ") || undefined, { code: "PARAMS_INVALID", missing: check.missing })
  // and before the code is minted: with no host to send the person to, the one-time code would be created and thrown away
  if (env.config.confirmHost.endsWith(".invalid")) {
    throw fail(503, "Drafts cannot be confirmed yet: the confirm page address is not set.", "The person who runs this link must set it. Nothing was recorded.", { code: "CONFIRM_HOST_NOT_SET" })
  }

  const rec = await recordIntent(env, "draft", def.function_id, params, key)
  const av = availabilityOf(env)
  const waits = av.writes_enabled ? "" : " Confirming is not switched on yet, so the draft is kept until it expires."

  if (rec.replayed || rec.confirm_token === null) {
    return {
      status: 200,
      body: {
        draft_id: rec.intent_id, intent_id: rec.intent_id, status: rec.status, kind: "draft", function: def.function_id, replayed: true, expires_at: rec.expires_at,
        status_url: `${env.base}/drafts/${rec.intent_id}`,
        submission_id: rec.submission_id, result: rec.result, failure: rec.failure,
        hint: "This draft was recorded before. Its confirm link was shown once, with the first answer, and cannot be shown again: send a different idempotency_key to record a new draft.",
      },
    }
  }
  return {
    status: 201,
    body: {
      draft_id: rec.intent_id, intent_id: rec.intent_id, status: rec.status, kind: "draft", function: def.function_id, replayed: false, expires_at: rec.expires_at,
      confirm_url: confirmUrlFor(env.config.confirmHost, rec.intent_id, rec.confirm_token),
      status_url: `${env.base}/drafts/${rec.intent_id}`,
      note: `Nothing has changed. Give confirm_url to the person: they open it, sign in, type the code the page shows and confirm. It works once and expires at ${rec.expires_at}.${waits}`,
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GET /drafts/{id}
// ---------------------------------------------------------------------------------------------------------------------------------

const NEXT: Record<string, string> = {
  awaiting_confirmation: "Waiting for the person to open the confirm link, sign in and confirm. Nothing has changed.",
  confirmed: "The person confirmed it. It is applied when the executor runs it: read this address again.",
  executing: "It is being applied now: read this address again in a moment.",
  done: "Applied. result names the record.",
  failed: "It was not applied. failure says why; a corrected draft can be recorded with the same parameters.",
  refused: "It was refused when it was about to run (the person's role or the link changed). failure says why.",
  expired: "It expired before it was confirmed and applied. Record a new draft.",
}

export async function draftGet(env: ReadEnv, id: string): Promise<Record<string, unknown>> {
  const doc = await readIntent(env, id)
  if (doc.kind !== "draft") throw fail(404, "No such draft on this link.")
  return { draft_id: id, ...doc, next: NEXT[String(doc.status)] ?? "" }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GET|POST /drafts/{id}/preview  (a signed-in person)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The total a BOQ draft would create: quantity times rate of every line that has no parent (a child line is derived from its parent's when the
 * BOQ is saved, so it is not added again). Null when the draft carries no lines. The link's own BOQ function carries none today; the widened
 * BOQ functions of the coverage work carry lineItems.
 */
export function boqTotalOf(functionId: string, params: Record<string, unknown>): { lines: number; total: number; basis: string } | null {
  if (!/^create_boq/.test(functionId)) return null
  const items = params.lineItems
  if (!Array.isArray(items) || items.length === 0) return null
  let total = 0
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const line = raw as Record<string, unknown>
    if (typeof line.parentItemCode === "string" && line.parentItemCode !== "") continue
    const q = Number(line.quantity)
    const r = Number(line.rate)
    if (Number.isFinite(q) && Number.isFinite(r)) total += q * r
  }
  return { lines: items.length, total: Math.round(total * 100) / 100, basis: "quantity times rate of each line without a parent" }
}

const CONFIRM_HEADER = "x-confirm-token"

export async function draftPreview(req: Request, draftId: string, deps: ConfirmDeps): Promise<Answer> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const gate = await sessionGate(req, deps)
  if (!gate.ok) return gate.answer

  // POST carries the confirm code in the body (what the static page sends); GET reads the x-confirm-token header, for a program
  let confirmToken: string
  if (req.method === "GET") {
    if (!ID_RE.test(draftId)) return { status: 404, body: errorBody(404, "No such draft.", undefined, { code: "DRAFT_NOT_FOUND" }) }
    const h = (req.headers.get(CONFIRM_HEADER) ?? "").trim()
    if (h === "" || h.length > 200) {
      return { status: 400, body: errorBody(400, "Send the confirm code from the link in the x-confirm-token header.", undefined, { code: "CONFIRM_TOKEN_REQUIRED" }) }
    }
    confirmToken = h
  } else {
    const body = await readConfirmBody(req, draftId)
    if (!body.ok) return body.answer
    confirmToken = body.value
  }

  const person = await personGate(gate.value, deps)
  if (!person.ok) return person.answer

  let out
  try {
    out = await deps.rpc("ai_work_link_draft_state", { p_draft_id: draftId, p_actor_user_id: person.value, p_confirm_token: confirmToken })
  } catch {
    out = { data: null, error: { message: "rpc threw" } }
  }
  const r = !out.error && out.data && typeof out.data === "object" && !Array.isArray(out.data) ? (out.data as Record<string, unknown>) : null
  const status = r && typeof r.status === "string" ? r.status : ""
  if (status === "refused") {
    const why = typeof r?.reason === "string" ? r.reason : ""
    if (why === "not_owner") return { status: 403, body: errorBody(403, "This draft belongs to another person.", undefined, { code: "NOT_YOUR_DRAFT" }) }
    if (why === "not_found") return { status: 409, body: errorBody(409, "The draft or the confirm code is not valid.", "Open the confirm link again.", { code: "CONFIRM_TOKEN_INVALID" }) }
  }
  const d = status === "ok" && r?.draft && typeof r.draft === "object" ? (r.draft as Record<string, unknown>) : null
  if (!d || typeof d.function_id !== "string" || typeof d.state !== "string") {
    log("ai-work-link: preview: draft state unavailable -> 503")
    return { status: 503, body: errorBody(503, "Service unavailable. Try again in a minute.", "Nothing was shown.", { code: "CONFIRM_UNAVAILABLE" }) }
  }

  const params = d.params && typeof d.params === "object" && !Array.isArray(d.params) ? (d.params as Record<string, unknown>) : {}
  const def = functionDef(d.function_id)
  const total = boqTotalOf(d.function_id, params)
  const writes = d.writes_enabled === true
  return {
    status: 200,
    body: {
      draft_id: draftId,
      function_id: d.function_id,
      label: def?.label ?? d.function_id,
      // text a person or an AI wrote: cleaned, and shown by the page as text, never as markup
      params: cleanDeep(params),
      ...(total ? { total } : {}),
      state: d.state,
      can_confirm: d.state === "awaiting_confirmation",
      writes_enabled: writes,
      created_at: d.created_at ?? null,
      expires_at: d.expires_at ?? null,
      confirmed_at: d.confirmed_at ?? null,
      submission_id: d.submission_id ?? null,
      result: d.result ?? null,
      failure: d.failure ?? null,
      message:
        d.state === "awaiting_confirmation"
          ? writes
            ? "Check the change, type the code and confirm. Nothing changes until you do."
            : "Check the change. Confirming is not switched on yet: your draft is kept until it expires."
          : "This draft is not waiting for a confirmation.",
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// POST /actions
// ---------------------------------------------------------------------------------------------------------------------------------

/** Best effort: an intent that was claimed but could not be handed to the exec function must not stay `executing` and hold its key. */
async function finishFailed(env: ReadEnv, intentId: string, code: string): Promise<void> {
  try {
    await env.rpc("ai_work_link_intent_finish", { p_intent_id: intentId, p_status: "failed", p_submission_id: null, p_result: null, p_failure: { code, missing: [] } })
  } catch {
    // the sweep of the next POST turns a stale executing row into a failed one
  }
}

function fromExec(intentId: string, out: ExecOutcome): Answer {
  if (out.status === "done") {
    return { status: 201, body: { intent_id: intentId, status: "done", record: out.record ?? null, submission_id: out.submission_id ?? null, replayed: false } }
  }
  const code = typeof out.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(out.code) ? out.code : "UNKNOWN"
  if (out.status === "refused") return { status: 403, body: errorBody(403, "This change is no longer allowed on this link.", undefined, { code }) }
  return { status: 422, body: errorBody(422, "The change could not be applied.", "code and missing say what to fix; a corrected request with the same parameters can run.", { code, missing: Array.isArray(out.missing) ? out.missing : [] }) }
}

export async function actionCreate(env: ReadEnv, body: Record<string, unknown>): Promise<Answer> {
  const params = paramsOf(body)
  requireScope(env.ctx, body.function, params)
  const def = functionDef(String(body.function))
  if (def?.kind !== "write") throw fail(400, "Reads go to /functions or /records, not /actions.")
  const av = availabilityOf(env)

  // 1. facts about THIS link: each says what is really the reason
  if (env.ctx.authority_level < 1) {
    throw fail(403, "This link was made at level 0: it can propose and draft changes, and the person confirms each one.", "POST /drafts records a draft.", { code: "LEVEL_NOT_ALLOWED" })
  }
  if (def.link_level !== 1) {
    throw fail(403, "This function needs the person's confirmation: use /drafts.", undefined, { code: "LEVEL_NOT_ALLOWED" })
  }
  if (av.writes_enabled && env.ctx.effective_level < 1) {
    throw fail(403, "This person's role no longer allows direct changes: use /drafts.", undefined, { code: "LEVEL_NOT_ALLOWED" })
  }
  const key = idempotencyKeyOf(body)

  // 2. the change itself
  const check = checkChange(env, body.function, body.params)
  if (!check.valid) throw fail(422, "The change is not valid yet.", check.problems.join(" ") || undefined, { code: "PARAMS_INVALID", missing: check.missing })

  // 3. the switch: the ONE reason a valid direct change is refused for every link at once
  if (!av.writes_enabled) {
    // 403, not 503: the harness (H23) and the spec read a level-0 link's refused write as 403, and it is what this link may do now. The CODE
    // says the truth: it is the switch, not this link's level.
    throw fail(403, "Direct changes are switched off for every link at the moment.", "POST /drafts records a draft and the person confirms it.", { code: "WRITES_NOT_ENABLED", available: false })
  }
  if (!av.changes_run || !env.exec) {
    throw fail(503, "The executor is not available yet, so no change can be applied.", "POST /drafts records a draft and the person confirms it.", { code: "EXECUTOR_NOT_AVAILABLE", available: false })
  }

  // 4. record, claim, run
  const rec = await recordIntent(env, "action", def.function_id, params, key)
  if (rec.replayed) {
    if (rec.status === "done") {
      return { status: 200, body: { intent_id: rec.intent_id, status: "done", replayed: true, record: rec.result, submission_id: rec.submission_id } }
    }
    if (rec.status === "executing") return { status: 200, body: { intent_id: rec.intent_id, status: "executing", replayed: true, hint: "Read GET /intents/{id} in a moment." } }
    // a recorded action that was never claimed is driven again below
  }
  const claim = (await callRpc(env.rpc, "ai_work_link_intent_claim", { p_intent_id: rec.intent_id })) as { status?: string; reason?: string } | null
  if (claim?.status === "not_enabled") throw fail(403, "Direct changes are switched off for every link at the moment.", "POST /drafts records a draft and the person confirms it.", { code: "WRITES_NOT_ENABLED", available: false })
  if (claim?.status === "refused") {
    if (claim.reason === "already_executing") return { status: 200, body: { intent_id: rec.intent_id, status: "executing", replayed: true, hint: "Read GET /intents/{id} in a moment." } }
    if (claim.reason === "LINK_GONE") throw new AwlError(410, errorBody(410, "This link has expired or was revoked.", "Ask the person for a new link."))
    if (claim.reason === "ROLE_CHANGED") throw fail(403, "This person's role no longer allows this change.", "POST /drafts records a draft.", { code: "ROLE_CHANGED" })
    throw fail(409, "This change can no longer be run.", undefined, { code: String(claim.reason ?? "NOT_CLAIMABLE").toUpperCase() })
  }
  if (claim?.status !== "ok") throw fail(500, "Something failed on our side. Try again in a minute.")

  let out: ExecOutcome
  try {
    out = await env.exec(rec.intent_id)
  } catch {
    await finishFailed(env, rec.intent_id, "EXEC_UNAVAILABLE")
    throw fail(503, "The executor did not answer. The change was not applied.", "Send the same request again in a minute.", { code: "EXEC_UNAVAILABLE", available: false })
  }
  return fromExec(rec.intent_id, out)
}
