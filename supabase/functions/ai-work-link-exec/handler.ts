// PROJEXA-BUILD-002 WP-09b (register rows AW-505, AW-506, AW-510; spec 9.6 executeIntent, 9.8): the router of the ai-work-link-exec Edge function.
// PURE: the database, the pipeline and the clock are passed in (`ExecDeps`), so bun tests it with fakes and the local execution host
// (scripts/awl-local-exec-host.ts) serves the SAME handler over a real run.
//
//   POST /run     {"intent_id": "..."}   claim the intent, run it through the pipeline, finish it, answer the outcome
//   GET  /health                         {ok, db_role} (the role the database connection really has), for the switch-on pre-flight
//
// WHO MAY CALL. Only the ai-work-link function: every request must carry `Authorization: Bearer <AWL_EXEC_INTERNAL_SECRET>`, compared in constant
// time. That secret and APP_RUNTIME_DATABASE_URL are the two things the OWNER sets; while either is absent EVERYTHING answers 503 NOT_CONFIGURED
// and nothing is read or written (so a deployed exec function with no secrets is inert). No link token ever reaches this function.
//
// THE RUN (the executeIntent of spec 9.6), in this order:
//   1. ai_work_link_intent_claim(intent_id): SQL, atomic. Writes off -> not_enabled and nothing changes. Otherwise it accepts a recorded action or a
//      confirmed draft, re-resolves the link and the person LIVE, recomputes the effective level and function list from the live role, and refuses
//      ROLE_CHANGED (a function that left the list, a direct action whose level dropped) or LINK_GONE, recording the refusal on the intent. On
//      success it sets `executing` and returns the intent and the live context: organisation, person, project, role.
//   2. deps.run(claim): the pipeline (src/lib/pipeline/link-exec-entry.ts). The text rules, the project pin and the same-project id check are its.
//   3. ai_work_link_intent_finish(...): the outcome is stored as {id, route} on success or {code, missing} on failure, never a message.
// The business write and step 3 are not one transaction. A crash between them leaves `executing`; SQL reads it as failed EXECUTION_UNCERTAIN after
// 10 minutes and it is NEVER retried by this function.
//
// WHAT IT NEVER DOES: log or answer an intent's parameters, a message from a thrown error, a connection string or a secret; call a model; run
// anything for an intent it did not claim.

export type ExecRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>

/** What the claim returns on success (drizzle/0629 ai_work_link_intent_claim). The same shape as src/lib/pipeline/link-exec-entry.ts ClaimedIntent. */
export type Claimed = {
  intent: { id: string; kind: string; function_id: string; params: unknown }
  ctx: { link_id: string; org_id: string; user_id: string; project_id: string; live_role: string; live_rank?: number; effective_level?: number; money_visible?: boolean }
}

/** What the pipeline answers (link-exec-entry.ts LinkRunOutcome). */
export type Ran =
  | { status: "done"; submission_id: string | null; record: { id: string | null; route: string | null } }
  | { status: "failed"; code: string; missing: string[]; submission_id?: string | null }

export type ExecDeps = {
  /** The service-role client's rpc (claim and finish are granted to service_role only). */
  rpc: ExecRpc
  /** AWL_EXEC_INTERNAL_SECRET; undefined or empty means not configured. */
  secret: string | undefined
  /** True when APP_RUNTIME_DATABASE_URL is set (its value is never passed around). */
  dbConfigured: boolean
  /** The pipeline. */
  run: (claimed: Claimed) => Promise<Ran>
  /** The role of the database connection the pipeline uses. */
  health: () => Promise<{ db_role: string }>
  log?: (line: string) => void
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const BODY_MAX_BYTES = 2 * 1024
const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: HEADERS })

/** Compares two strings without stopping at the first difference (the length is folded in, so a short guess costs the same as a long one). */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** The route after the function's own name: the platform passes `/ai-work-link-exec/run` or `/run` depending on the gateway. */
export function routeOf(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean)
  const at = segs.lastIndexOf("ai-work-link-exec")
  return (at >= 0 ? segs.slice(at + 1) : segs.slice(-1)).join("/")
}

function claimIsOk(v: unknown): v is { status: "ok" } & Claimed {
  if (!v || typeof v !== "object") return false
  const c = v as Record<string, unknown>
  const i = c.intent as Record<string, unknown> | undefined
  const x = c.ctx as Record<string, unknown> | undefined
  const t = (o: unknown) => typeof o === "string" && o !== ""
  return c.status === "ok" && !!i && !!x && t(i.id) && t(i.function_id) && t(x.link_id) && t(x.org_id) && t(x.user_id) && t(x.project_id) && t(x.live_role)
}

async function readIntentId(req: Request): Promise<string | null> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > BODY_MAX_BYTES) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    const id = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).intent_id : undefined
    return typeof id === "string" && ID_RE.test(id) ? id : null
  } catch {
    return null
  }
}

/** The refusal a claim answered, as the exec answer: the SQL's reason in the closed upper-case vocabulary. */
function refusalOf(intentId: string, claim: Record<string, unknown>): Response {
  const reason = typeof claim.reason === "string" ? claim.reason : ""
  if (reason === "already_executing") return json(200, { intent_id: intentId, status: "executing" })
  const upper = reason.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64)
  return json(200, { intent_id: intentId, status: "refused", code: CODE_RE.test(upper) ? upper : "NOT_CLAIMABLE" })
}

export async function handleExec(req: Request, deps: ExecDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const missing: string[] = []
  if (!deps.secret) missing.push("AWL_EXEC_INTERNAL_SECRET")
  if (!deps.dbConfigured) missing.push("APP_RUNTIME_DATABASE_URL")
  // 1. not configured: inert, before anything else (even an unauthenticated caller learns only the NAMES of what is missing)
  if (missing.length) return json(503, { ok: false, code: "NOT_CONFIGURED", missing })

  // 2. who is calling
  const bearer = /^Bearer[ ]+([^\s]+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  if (!bearer || !constantTimeEqual(bearer[1], deps.secret as string)) return json(401, { ok: false, code: "UNAUTHORIZED" })

  const route = routeOf(new URL(req.url).pathname)
  const method = req.method.toUpperCase()

  if (route === "health") {
    if (method !== "GET") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" })
    try {
      const h = await deps.health()
      return json(200, { ok: true, db_role: h.db_role })
    } catch {
      log("ai-work-link-exec: health: database unreachable -> 503")
      return json(503, { ok: false, code: "DB_UNREACHABLE" })
    }
  }

  if (route !== "run") return json(404, { ok: false, code: "NOT_FOUND" })
  if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" })

  const intentId = await readIntentId(req)
  if (!intentId) return json(400, { ok: false, code: "BAD_REQUEST" })

  // 3. claim
  let claim: unknown
  try {
    const res = await deps.rpc("ai_work_link_intent_claim", { p_intent_id: intentId })
    if (res.error) throw new Error("claim failed")
    claim = res.data
  } catch {
    log("ai-work-link-exec: claim unavailable -> 503, nothing was claimed")
    return json(503, { ok: false, code: "CLAIM_UNAVAILABLE" })
  }
  const c = claim && typeof claim === "object" && !Array.isArray(claim) ? (claim as Record<string, unknown>) : {}
  if (c.status === "not_enabled") return json(200, { intent_id: intentId, status: "refused", code: "WRITES_NOT_ENABLED" })
  if (c.status === "refused") return refusalOf(intentId, c)
  if (!claimIsOk(claim)) {
    log("ai-work-link-exec: claim answered an unknown shape -> 503")
    return json(503, { ok: false, code: "CLAIM_UNAVAILABLE" })
  }

  // 4. run
  let ran: Ran
  try {
    ran = await deps.run(claim)
  } catch {
    // the pipeline turns its own errors into outcomes; a throw here is a bug, recorded as a closed failure (the raw text is not kept)
    log(`ai-work-link-exec: intent ${intentId}: the run threw -> failed INTERNAL_ERROR`)
    ran = { status: "failed", code: "INTERNAL_ERROR", missing: [] }
  }

  // 5. finish: the outcome is stored on the intent (a code, never a message)
  const finishArgs =
    ran.status === "done"
      ? { p_intent_id: intentId, p_status: "done", p_submission_id: ran.submission_id ?? null, p_result: { id: ran.record.id, route: ran.record.route }, p_failure: null }
      : { p_intent_id: intentId, p_status: "failed", p_submission_id: ran.submission_id ?? null, p_result: null, p_failure: { code: ran.code, missing: ran.missing } }
  let stored = false
  for (let attempt = 0; attempt < 2 && !stored; attempt++) {
    try {
      const res = await deps.rpc("ai_work_link_intent_finish", finishArgs)
      stored = !res.error
    } catch {
      stored = false
    }
  }
  if (!stored) log(`ai-work-link-exec: intent ${intentId}: the outcome ${ran.status} could not be stored; the row reads failed EXECUTION_UNCERTAIN after 10 minutes`)

  if (ran.status === "done") return json(200, { intent_id: intentId, status: "done", submission_id: ran.submission_id, record: ran.record, stored })
  return json(200, { intent_id: intentId, status: "failed", code: ran.code, missing: ran.missing, stored })
}
