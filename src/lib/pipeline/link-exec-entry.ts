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
import { functionWrites, hasExecutor } from "./executor"
import { runDirectTask, type RunDirectTaskInput } from "./run-submission"

export type ClaimedIntent = {
  intent: { id: string; kind: string; function_id: string; params: unknown }
  ctx: { link_id: string; org_id: string; user_id: string; project_id: string; live_role: string; live_rank?: number; effective_level?: number; money_visible?: boolean }
}

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
    isText(ctx.project_id) &&
    isText(ctx.live_role) &&
    (intent.params === null || intent.params === undefined || (typeof intent.params === "object" && !Array.isArray(intent.params)))
  )
}

/** The closed failure code of a thrown error: a service's own code when it is one, else the vocabulary's mapping of its status. */
export function codeOfThrown(error: unknown): string {
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
  const params: Record<string, unknown> = typeof stored.projectId === "string" && stored.projectId !== "" ? { ...stored } : { ...stored, projectId: ctx.project_id }
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

/** The role the exec function's database connection really has: `app_runtime` when APP_RUNTIME_DATABASE_URL is the right credential. */
export async function linkExecHealth(): Promise<{ db_role: string }> {
  const rows = (await withTenantContext({ orgId: "awl-exec-health" }, (db) => db.execute(sql`select current_user as db_role`))) as unknown as { db_role: string }[]
  return { db_role: String(rows[0]?.db_role ?? "") }
}
