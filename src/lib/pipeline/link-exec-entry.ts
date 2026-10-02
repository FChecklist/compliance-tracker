// PROJEXA-BUILD-002 WP-09b (register rows AW-504, AW-505, AW-506; spec 9.6 executeIntent): the ONE entry the ai-work-link-exec Edge function bundles.
// It runs one claimed AI-work-link write through the real pipeline and answers with a closed outcome. Nothing else of the app is reachable from here
// once the bundle table (scripts/awl-exec-aliases.mjs) is applied: scripts/verify/awl-exec-closure.mjs fails the build when it is.
//
// WHAT COMES IN. The claim of `public.ai_work_link_intent_claim`: the intent (function id and parameters, stored by record_intent) and the LIVE
// context the SQL just re-resolved (organisation, person, project, live role). Nothing comes from a header, a body the caller controls, or the
// link token: the exec function never sees a token. The role is the person's role NOW, so a demotion after the link was made already changed what
// the claim allowed (ROLE_CHANGED), and money is redacted by this role, never by the ceiling chosen at mint.
//
// WHAT RUNS. runDirectTask with `via 'ai_link'` and the link id: the same text rules (2,000 characters, control characters removed), the project pin
// (a parameter that names another project is refused before any write), the same validation and the same executors as a session write; no model call
// (Level 1 is off for a link), the task recorded as executor `ai` with model_calls 0, and a memory row marked `ai_link` without an embedding. The write
// is attributed to the person: userId and actorUserId are the link's user.
//
// WHAT GOES OUT. `done` with the record's id and route, or `failed` with a CLOSED code and the names of what is missing. Never a message: a message
// can carry a driver string or an address, and the intent row that stores the outcome keeps a code only (ai_work_link_intent_finish).
import { sql } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { ServiceError } from "@/lib/services/service-error"
import { codeForServiceError, normaliseThrownError } from "./error-codes"
import { executeRead } from "./execute-read"
import { NOT_AVAILABLE_ON_EXEC } from "./link-exec-stubs/unavailable"
import { functionWrites, hasExecutor } from "./executor"
import { runDirectTask, type RunDirectTaskInput } from "./run-submission"

/**
 * `project_id` is null in exactly one case: create_project on a USER-WIDE link (drizzle/0668), a draft made before the person picked any project. Every
 * other claim names the project it runs in; claimIsWellFormed refuses a null project for any other function.
 */
export type ClaimedIntent = {
  intent: { id: string; kind: string; function_id: string; params: unknown }
  ctx: { link_id: string; org_id: string; user_id: string; project_id: string | null; live_role: string; live_rank?: number; effective_level?: number; money_visible?: boolean }
}

/** The one function that runs with no project: it makes one. */
export const NO_PROJECT_FUNCTION = "create_project"

export type LinkRunOutcome =
  | { status: "done"; submission_id: string | null; record: { id: string | null; route: string | null } }
  | { status: "failed"; code: string; missing: string[]; submission_id?: string | null }

const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/

const failed = (code: string, missing: string[] = [], submissionId?: string | null): LinkRunOutcome => ({
  status: "failed",
  code,
  missing,
  ...(submissionId !== undefined ? { submission_id: submissionId } : {}),
})

function isText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

/** The claim must carry every field the run needs; anything else is a bug in the caller, refused before any write. */
export function claimIsWellFormed(c: ClaimedIntent | null | undefined): c is ClaimedIntent {
  if (!c || typeof c !== "object" || !c.intent || !c.ctx) return false
  const { intent, ctx } = c
  return (
    isText(intent.id) &&
    isText(intent.function_id) &&
    isText(ctx.link_id) &&
    isText(ctx.org_id) &&
    isText(ctx.user_id) &&
    // a project is named, except for create_project, which has none yet; and create_project never runs INSIDE a project (it would pin the run to it)
    (intent.function_id === NO_PROJECT_FUNCTION ? ctx.project_id === null : isText(ctx.project_id)) &&
    isText(ctx.live_role) &&
    (intent.params === null || intent.params === undefined || (typeof intent.params === "object" && !Array.isArray(intent.params)))
  )
}

/** The closed failure code of a thrown error: a service's own code when it is one, else the vocabulary's mapping of its status. */
export function codeOfThrown(error: unknown): string {
  // a module the exec bundle stubs out (link-exec-stubs/unavailable.ts) was reached: this function cannot run on the edge, which is a fact about the
  // function, not a transient fault. FUNCTION_NOT_AVAILABLE makes a laptop push `needs_server` (offer the online path) instead of INTERNAL_ERROR (retry
  // forever with the same result). Checked before anything else; the message carries only the closed code and a module name.
  if (error instanceof Error && error.message.startsWith(`${NOT_AVAILABLE_ON_EXEC}:`)) return "FUNCTION_NOT_AVAILABLE"
  if (error instanceof ServiceError) {
    if (typeof error.code === "string" && CODE_RE.test(error.code)) return error.code
    if (error.status < 500) return codeForServiceError(error.status)
  }
  return normaliseThrownError(error).failure.code
}

/**
 * The person's own row, the project and the parameters as the run needs them. The project of the LINK is the only project: parameters that name
 * another one are left as they are, and validate() and the executors refuse them (PROJECT_NOT_REACHABLE / RECORD_NOT_FOUND) before a write.
 */
export function buildRunInput(claimed: ClaimedIntent): RunDirectTaskInput {
  const { intent, ctx } = claimed
  const stored = intent.params && typeof intent.params === "object" && !Array.isArray(intent.params) ? (intent.params as Record<string, unknown>) : {}
  // no project (create_project of a user-wide link): nothing is injected and nothing is pinned; the executor makes the project and the person is its lead
  const params: Record<string, unknown> =
    ctx.project_id === null ? { ...stored } : typeof stored.projectId === "string" && stored.projectId !== "" ? { ...stored } : { ...stored, projectId: ctx.project_id }
  return {
    orgId: ctx.org_id,
    userId: ctx.user_id,
    actorUserId: ctx.user_id,
    role: ctx.live_role,
    mode: "Projects",
    projectId: ctx.project_id,
    projectScope: ctx.project_id,
    functionId: intent.function_id,
    params,
    // the intent id in the note makes a run that crashed before its outcome was stored findable from compliance.submissions.raw_input
    note: `[ai-link ${ctx.link_id} intent ${intent.id}] ${intent.function_id}`,
    via: "ai_link",
    aiLinkId: ctx.link_id,
  }
}

export async function runLinkIntent(claimed: ClaimedIntent): Promise<LinkRunOutcome> {
  if (!claimIsWellFormed(claimed)) return failed("BAD_CLAIM")
  const fn = claimed.intent.function_id
  // a write the pipeline has an executor for: a function that is not one is refused, never run as something else
  if (!hasExecutor(fn) || !functionWrites(fn)) return failed("FUNCTION_NOT_AVAILABLE")

  try {
    const result = await runDirectTask(buildRunInput(claimed))
    const task = result.tasks[0]
    if (result.status === "done" && task && task.status === "done") {
      const r = task.result && typeof task.result === "object" ? (task.result as { id?: unknown; route?: unknown }) : {}
      return {
        status: "done",
        submission_id: result.submissionId,
        record: { id: typeof r.id === "string" ? r.id : null, route: typeof r.route === "string" ? r.route : null },
      }
    }
    const f = result.failures[0]
    return failed(f && CODE_RE.test(f.code) ? f.code : "INTERNAL_ERROR", f?.missing ?? [], result.submissionId)
  } catch (error) {
    // the raw text stays in the exec function's own log; only the closed code travels on
    console.error(`[ai-work-link-exec] intent=${claimed.intent.id} function=${fn} run failed:`, error)
    return failed(codeOfThrown(error))
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A LAPTOP'S OWN EDIT (local-first push, drizzle/0681). The person edited something on their laptop; projexa-sync verified their session, resolved their LIVE
// role in SQL, checked the function is a registered write the role may run, checked the project is readable by them and checked the record's version. What arrives here
// is that already-decided context plus the function and parameters. It runs through EXACTLY the path an AI-link action takes (same guards: an executor must exist and the
// function must write; same project pin, same validation, same executors, no model call, memory without an embedding), attributed to the person. Only the provenance label
// differs: the link id is `px-sync:<device>`, so an audit can tell a laptop's push from an outside AI's action. The AI link's own caps (30 writes an hour) are applied in SQL
// by record_intent, which this path does not use; the push ledger has its own cap (drizzle/0681).
// ---------------------------------------------------------------------------------------------------------------------------------
export type SyncOp = {
  op_id: string
  function_id: string
  params: unknown
  ctx: { org_id: string; user_id: string; project_id: string | null; live_role: string; device_id: string }
}

export async function runSyncOp(op: SyncOp): Promise<LinkRunOutcome> {
  return runLinkIntent({
    intent: { id: op.op_id, kind: "action", function_id: op.function_id, params: op.params },
    ctx: { link_id: `px-sync:${op.ctx.device_id}`, org_id: op.ctx.org_id, user_id: op.ctx.user_id, project_id: op.ctx.project_id, live_role: op.ctx.live_role },
  })
}
/** The role the exec function's database connection really has: `app_runtime` when APP_RUNTIME_DATABASE_URL is the right credential. */
export async function linkExecHealth(): Promise<{ db_role: string }> {
  const rows = (await withTenantContext({ orgId: "awl-exec-health" }, (db) => db.execute(sql`select current_user as db_role`))) as unknown as { db_role: string }[]
  return { db_role: String(rows[0]?.db_role ?? "") }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A READ function through the link (BUILD-002 persona findings): POST /functions/{fn} for a function of kind read.
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * What the exec function's POST /read passes in. The ai-work-link function resolved the link and the person live in the same request and
 * holds the shared internal secret; the exec function never sees a token. The role is the person's live role, so money is redacted by it.
 */
export type ReadRequest = {
  function_id: string
  params: Record<string, unknown>
  ctx: { org_id: string; user_id: string; project_id: string; live_role: string }
  /** The link's effective function list (spec 10.9). */
  allowed_functions: string[]
}

export type LinkReadOutcome =
  | { status: "ok"; function_id: string; result: unknown }
  | { status: "failed"; code: string; missing: string[]; http: 403 | 422 | 503 }

export function readRequestIsWellFormed(r: ReadRequest | null | undefined): r is ReadRequest {
  if (!r || typeof r !== "object" || !r.ctx || typeof r.ctx !== "object") return false
  const c = r.ctx
  return (
    isText(r.function_id) &&
    isText(c.org_id) &&
    isText(c.user_id) &&
    isText(c.project_id) &&
    isText(c.live_role) &&
    !!r.params &&
    typeof r.params === "object" &&
    !Array.isArray(r.params) &&
    Array.isArray(r.allowed_functions) &&
    r.allowed_functions.every((f) => typeof f === "string")
  )
}

/**
 * Runs one read function in the read-only executor mode (execute-read.ts): no submission, task, pill use, chain row, gap row, memory or intent is
 * written. The project is the link's, money is redacted by the live role, and a function that is not a read or not on the list is refused.
 */
export async function runLinkRead(req: ReadRequest): Promise<LinkReadOutcome> {
  if (!readRequestIsWellFormed(req)) return { status: "failed", code: "BAD_REQUEST", missing: [], http: 422 }
  try {
    const out = await executeRead({
      orgId: req.ctx.org_id,
      userId: req.ctx.user_id,
      actorUserId: req.ctx.user_id,
      projectId: req.ctx.project_id,
      role: req.ctx.live_role,
      functionId: req.function_id,
      params: req.params,
      allowedFunctionIds: req.allowed_functions,
    })
    if (out.ok) return { status: "ok", function_id: out.functionId, result: out.result }
    if ("code" in out) return { status: "failed", code: out.code, missing: [], http: 403 }
    const f = out.failure
    return { status: "failed", code: CODE_RE.test(f.code) ? f.code : "INTERNAL_ERROR", missing: f.missing ?? [], http: out.status }
  } catch (error) {
    console.error(`[ai-work-link-exec] read function=${req.function_id} failed:`, error)
    return { status: "failed", code: codeOfThrown(error), missing: [], http: 503 }
  }
}
