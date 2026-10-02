// PROJEXA-BUILD-002 WP-09b (register rows AW-505, AW-506, AW-510; spec 9.6 executeIntent, 9.8): the router of the ai-work-link-exec Edge function.
// PURE: the database, the pipeline and the clock are passed in (`ExecDeps`), so bun tests it with fakes and the local execution host
// (scripts/awl-local-exec-host.ts) serves the SAME handler over a real run.
//
//   POST /run     {"intent_id": "..."}   claim the intent, run it through the pipeline, finish it, answer the outcome
//   POST /read    {"function_id","params","ctx","allowed_functions"}   run one READ function read-only (no intent, no submission, nothing written)
//   POST /sync-run {"op_id","function_id","params","ctx"}   run one write a LAPTOP pushed (local-first sync, drizzle/0681); projexa-sync already verified the session and decided the live role, project and version
//   POST /sync-run-batch {"ops":[...]}  the ops of one push in one invocation, in order, under a time budget (see the route)
//   The two sync routes take AWL_SYNC_EXEC_SECRET when the owner sets it, and claim each op from the push ledger when the database has the claim function.
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
  /** project_id is null only for create_project on a user-wide link (drizzle/0668): a draft made before any project was picked. */
  ctx: { link_id: string; org_id: string; user_id: string; project_id: string | null; live_role: string; live_rank?: number; effective_level?: number; money_visible?: boolean }
}

/** What the pipeline answers (link-exec-entry.ts LinkRunOutcome). */
export type Ran =
  | { status: "done"; submission_id: string | null; record: { id: string | null; route: string | null } }
  | { status: "failed"; code: string; missing: string[]; submission_id?: string | null }

/** What POST /read answers (link-exec-entry.ts LinkReadOutcome). */
export type ReadRan =
  | { status: "ok"; function_id: string; result: unknown }
  | { status: "failed"; code: string; missing: string[]; http: 403 | 422 | 503 }

export type ExecDeps = {
  /** The service-role client's rpc (claim and finish are granted to service_role only). */
  rpc: ExecRpc
  /** AWL_EXEC_INTERNAL_SECRET; undefined or empty means not configured. */
  secret: string | undefined
  /** True when APP_RUNTIME_DATABASE_URL is set (its value is never passed around). */
  dbConfigured: boolean
  /** The pipeline. */
  run: (claimed: Claimed) => Promise<Ran>
  /** The read-only executor mode (POST /read). Absent means reads answer 503 READ_NOT_AVAILABLE. */
  read?: (req: ReadBody) => Promise<ReadRan>
  /** One write pushed by a laptop (POST /sync-run). Absent means it answers 503 SYNC_NOT_AVAILABLE. */
  syncRun?: (op: SyncBody) => Promise<Ran>
  /** The role of the database connection the pipeline uses. */
  health: () => Promise<{ db_role: string }>
  log?: (line: string) => void
  /** AWL_SYNC_EXEC_SECRET: when set, /sync-run and /sync-run-batch accept ONLY this secret (not the AI link's); unset, they accept `secret` as before. */
  syncSecret?: string
  /** The push ledger as the claim (see runOneSync). Absent: the caller's context is used. */
  syncClaim?: (op: SyncBody) => Promise<SyncClaim>
  /** Milliseconds, for the batch time budget (tests advance it); defaults to Date.now. */
  clock?: () => number
}

/** ok:true = the ledger row was `running` with these values and is now claimed (the LIVE context to run with); ok:false = refuse (nothing runs); "unsupported" = the claim function is not deployed. */
export type SyncClaim = { ok: true; ctx: { org_id: string; user_id: string; project_id: string | null; live_role: string } } | { ok: false; code: string } | { ok: "unsupported" }

/** The body of POST /read: the ai-work-link function resolved the link live in the same request and passes what the run needs. */
export type ReadBody = {
  function_id: string
  params: Record<string, unknown>
  ctx: { org_id: string; user_id: string; project_id: string; live_role: string }
  allowed_functions: string[]
}

/** The body of POST /sync-run: the context was decided by projexa-sync in the same request (session verified, live role, project readable, version checked). */
export type SyncBody = {
  op_id: string
  function_id: string
  params: Record<string, unknown>
  ctx: { org_id: string; user_id: string; project_id: string | null; live_role: string; device_id: string }
}

export const SYNC_BODY_MAX_BYTES = 72 * 1024
// a push is at most 50 ops and 256 KB of ops (projexa-sync PUSH_BODY_MAX_BYTES, bytes); the context each op gains is well under 1 KB
export const SYNC_BATCH_OPS_MAX = 50
export const SYNC_BATCH_BODY_MAX_BYTES = 400 * 1024
export const SYNC_BATCH_START_CUTOFF_MS = 20_000
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/
const READ_BODY_MAX_BYTES = 16 * 1024
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
  // the project is named, except for create_project (it makes one) and then it must be null: any other function with no project is refused here, before the run
  const projectOk = !!i && !!x && (i.function_id === "create_project" ? x.project_id === null : t(x.project_id))
  return c.status === "ok" && !!i && !!x && t(i.id) && t(i.function_id) && t(x.link_id) && t(x.org_id) && t(x.user_id) && projectOk && t(x.live_role)
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

async function readReadBody(req: Request): Promise<ReadBody | null> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > READ_BODY_MAX_BYTES) return null
  try {
    const b = JSON.parse(raw) as Record<string, unknown>
    const c = b?.ctx as Record<string, unknown> | undefined
    const t = (o: unknown): o is string => typeof o === "string" && o !== ""
    if (!b || typeof b !== "object" || Array.isArray(b) || !c || typeof c !== "object") return null
    if (!t(b.function_id) || !ID_RE.test(b.function_id)) return null
    if (!t(c.org_id) || !t(c.user_id) || !t(c.project_id) || !t(c.live_role)) return null
    if (!b.params || typeof b.params !== "object" || Array.isArray(b.params)) return null
    if (!Array.isArray(b.allowed_functions) || !b.allowed_functions.every((f) => typeof f === "string")) return null
    return { function_id: b.function_id, params: b.params as Record<string, unknown>, ctx: { org_id: c.org_id, user_id: c.user_id, project_id: c.project_id, live_role: c.live_role }, allowed_functions: b.allowed_functions as string[] }
  } catch {
    return null
  }
}

/** One pushed op of a /sync-run or /sync-run-batch body, or null when its shape is wrong. */
export function parseSyncOp(v: unknown): SyncBody | null {
  const b = v as Record<string, unknown> | null
  const c = b?.ctx as Record<string, unknown> | undefined
  const t = (o: unknown): o is string => typeof o === "string" && o !== ""
  if (!b || typeof b !== "object" || Array.isArray(b) || !c || typeof c !== "object" || Array.isArray(c)) return null
  if (!t(b.op_id) || !ID_RE.test(b.op_id) || !t(b.function_id) || !ID_RE.test(b.function_id)) return null
  if (!b.params || typeof b.params !== "object" || Array.isArray(b.params)) return null
  if (!t(c.org_id) || !t(c.user_id) || !t(c.live_role) || !t(c.device_id) || !DEVICE_RE.test(c.device_id)) return null
  // a project is named, except for create_project (it makes one)
  const project = c.project_id === null ? null : t(c.project_id) ? c.project_id : undefined
  if (project === undefined || (b.function_id === "create_project") !== (project === null)) return null
  return { op_id: b.op_id, function_id: b.function_id, params: b.params as Record<string, unknown>, ctx: { org_id: c.org_id, user_id: c.user_id, project_id: project, live_role: c.live_role, device_id: c.device_id } }
}

async function readJsonLimited(req: Request, max: number): Promise<unknown | undefined> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > max) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

async function readSyncBody(req: Request): Promise<SyncBody | null> {
  const v = await readJsonLimited(req, SYNC_BODY_MAX_BYTES)
  return v === undefined ? null : parseSyncOp(v)
}

/**
 * Runs ONE pushed op: the ledger claim (when the database has it), then the pipeline. The answer body is the same for /sync-run and for one entry of
 * /sync-run-batch. THE TRUST BOUNDARY: the caller is projexa-sync holding the sync secret; with deps.syncClaim the context that runs is the one the
 * DATABASE returns for a ledger row projexa_sync_push_begin left `running` (one-shot), not the one in the body, so a leaked secret alone cannot write
 * as anyone (review D1 TI-3 / F-05). Without the claim function deployed the body's context is used, as before (logged).
 */
async function runOneSync(deps: ExecDeps, body: SyncBody, log: (l: string) => void): Promise<Record<string, unknown>> {
  let op = body
  if (deps.syncClaim) {
    let claim: SyncClaim
    try {
      claim = await deps.syncClaim(body)
    } catch {
      claim = { ok: false, code: "CLAIM_UNAVAILABLE" }
    }
    if (claim.ok === false) return { op_id: body.op_id, status: "failed", code: claim.code, missing: [] }
    if (claim.ok === true) op = { ...body, ctx: { ...claim.ctx, device_id: body.ctx.device_id } }
    else log("ai-work-link-exec: sync-run: the ledger claim function is not deployed; running with the caller's context")
  }
  let ranSync: Ran
  try {
    ranSync = await (deps.syncRun as NonNullable<ExecDeps["syncRun"]>)(op)
  } catch {
    log("ai-work-link-exec: sync-run: the run threw -> failed INTERNAL_ERROR")
    ranSync = { status: "failed", code: "INTERNAL_ERROR", missing: [] }
  }
  // no intent row exists for a laptop push: the outcome goes back to projexa-sync, which stores it in the push ledger (a closed code, never a message)
  if (ranSync.status === "done") return { op_id: body.op_id, status: "done", submission_id: ranSync.submission_id, record: ranSync.record }
  return { op_id: body.op_id, status: "failed", code: CODE_RE.test(ranSync.code) ? ranSync.code : "INTERNAL_ERROR", missing: ranSync.missing.slice(0, 20).map((m) => String(m).slice(0, 64)) }
}

// The SQL this needs is NOT in this package (it is a migration; see the D1 report): public.projexa_sync_push_claim(p_user_id, p_op_id, p_org_id,
// p_function_id, p_project_id) RETURNS jsonb, service_role only, atomically flipping a platform.projexa_sync_op row from `running` (younger than 10
// minutes, matching user/org/function/project, not yet claimed) to claimed and returning {status:'ok', ctx:{org_id, user_id, project_id, live_role}}
// with the role re-resolved LIVE, or {status:'refused', reason}. Until it exists PostgREST answers "function not found" and the op runs as before.
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"])
export async function claimSyncOp(rpc: ExecRpc, op: SyncBody): Promise<SyncClaim> {
  const res = await rpc("projexa_sync_push_claim", { p_user_id: op.ctx.user_id, p_op_id: op.op_id, p_org_id: op.ctx.org_id, p_function_id: op.function_id, p_project_id: op.ctx.project_id })
  if (res.error) return MISSING_FUNCTION_CODES.has(res.error.code ?? "") ? { ok: "unsupported" } : { ok: false, code: "CLAIM_UNAVAILABLE" }
  const d = (res.data ?? null) as { status?: unknown; ctx?: Record<string, unknown> } | null
  const c = d?.ctx
  const t = (o: unknown): o is string => typeof o === "string" && o !== ""
  if (d?.status !== "ok" || !c || !t(c.org_id) || !t(c.user_id) || !t(c.live_role) || !(c.project_id === null || t(c.project_id))) return { ok: false, code: "NOT_CLAIMED" }
  // the database's values, never the body's; a claim for another person, organisation or project than the one asked for is refused
  if (c.user_id !== op.ctx.user_id || c.org_id !== op.ctx.org_id || c.project_id !== op.ctx.project_id) return { ok: false, code: "NOT_CLAIMED" }
  return { ok: true, ctx: { org_id: c.org_id, user_id: c.user_id, project_id: c.project_id as string | null, live_role: c.live_role } }
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
  const route = routeOf(new URL(req.url).pathname)
  const bearer = /^Bearer[ ]+([^\s]+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  // the laptop-push routes take their own secret once the owner sets one, so the AI link's secret alone can no longer reach them
  const expected = (route === "sync-run" || route === "sync-run-batch") && deps.syncSecret ? deps.syncSecret : (deps.secret as string)
  if (!bearer || !constantTimeEqual(bearer[1], expected)) return json(401, { ok: false, code: "UNAUTHORIZED" })

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

  if (route === "read") {
    if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" })
    if (!deps.read) return json(503, { ok: false, code: "READ_NOT_AVAILABLE" })
    const body = await readReadBody(req)
    if (!body) return json(400, { ok: false, code: "BAD_REQUEST" })
    let ranRead: ReadRan
    try {
      ranRead = await deps.read(body)
    } catch {
      // the pipeline turns its own errors into outcomes; a throw here is a bug, answered as a closed failure (the raw text is not kept)
      log("ai-work-link-exec: read: the run threw -> failed INTERNAL_ERROR")
      ranRead = { status: "failed", code: "INTERNAL_ERROR", missing: [], http: 503 }
    }
    // a read writes no intent and no row: the answer is the result, or a closed code and the names of what is missing, never a message
    if (ranRead.status === "ok") return json(200, { status: "ok", function_id: ranRead.function_id, result: ranRead.result })
    return json(200, { status: "failed", code: CODE_RE.test(ranRead.code) ? ranRead.code : "INTERNAL_ERROR", missing: ranRead.missing.slice(0, 20).map((m) => String(m).slice(0, 64)), http: ranRead.http })
  }

  if (route === "sync-run") {
    if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" })
    if (!deps.syncRun) return json(503, { ok: false, code: "SYNC_NOT_AVAILABLE" })
    const body = await readSyncBody(req)
    if (!body) return json(400, { ok: false, code: "BAD_REQUEST" })
    return json(200, await runOneSync(deps, body, log))
  }

  // POST /sync-run-batch {ops:[...]}: the ops of ONE push in ONE invocation (an Edge invocation per op was the largest cost term of a push; review D1
  // F8 / F-02). In order, one at a time (the pool is 5 connections and ops on one record must keep their order). No new op starts after
  // SYNC_BATCH_START_CUTOFF_MS, so the batch answers well inside projexa-sync's wait; an op not started is answered `not_run` (nothing ran). An op of a
  // wrong shape is answered `failed BAD_OP` on its own and the rest still run.
  if (route === "sync-run-batch") {
    if (method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" })
    if (!deps.syncRun) return json(503, { ok: false, code: "SYNC_NOT_AVAILABLE" })
    const v = await readJsonLimited(req, SYNC_BATCH_BODY_MAX_BYTES)
    const list = v && typeof v === "object" && !Array.isArray(v) ? (v as { ops?: unknown }).ops : undefined
    if (!Array.isArray(list) || list.length < 1 || list.length > SYNC_BATCH_OPS_MAX) return json(400, { ok: false, code: "BAD_REQUEST" })
    const clock = deps.clock ?? (() => Date.now())
    const started = clock()
    const results: Array<Record<string, unknown>> = []
    for (const raw of list) {
      const rawId = raw && typeof raw === "object" && typeof (raw as { op_id?: unknown }).op_id === "string" ? (raw as { op_id: string }).op_id : null
      const op = parseSyncOp(raw)
      if (!op) {
        results.push({ op_id: rawId, status: "failed", code: "BAD_OP", missing: [] })
        continue
      }
      if (clock() - started > SYNC_BATCH_START_CUTOFF_MS) {
        results.push({ op_id: op.op_id, status: "not_run" })
        continue
      }
      results.push(await runOneSync(deps, op, log))
    }
    return json(200, { results })
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
