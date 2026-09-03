// R42 seq14 -- executes a validated task's function_id against a REAL
// backing action. A small registry, not a framework: M28's real function
// catalogue (compliance.screen_definitions.function_id) doesn't exist until
// seq20, so this file only wires the functions that genuinely have a real
// implementation TODAY. Anything else fails honestly (M26: "a candidate
// that fails validation is a FAIL, not a suggestion" -- the same posture
// extends to execution: an unregistered function_id blocks the task with an
// honest reason, never a fabricated success).
import { and, eq, desc } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import {
  constructionBoqLineItems,
  constructionBoqs,
  constructionActivities,
  pmsIssues,
  users,
} from "@/lib/db/schema";
import { createProgressEntry } from "@/lib/services/construction-progress-service";
import { getProjectDashboard } from "@/lib/services/construction-dashboard-service";
import { logTime } from "@/lib/services/pms-time-service";
import { dispatchTool } from "@/lib/task-execution-engine";
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard";
import { missingSlots } from "./function-slots";
// R67 C-13: the one place that decides whether a failure is the user's to fix
// or ours, and the only place a raw driver message is turned into words.
import { classifyFailure } from "./failure-classification";

/**
 * R67 C-13 -- A FAILURE NOW CARRIES ITS OWN CLASSIFICATION.
 *
 * `error` is unchanged in meaning: the sentence a client may render. What is
 * new is everything beside it, and it is what lets Task Master stop showing a
 * pooler IP to a site engineer:
 *
 *   status  -- 'failed' (a person can fix it) | 'failed_system' (nobody on
 *              site can). The needs-you list keys off this.
 *   code    -- D-03's closed vocabulary, so PROJEXA chooses the sentence
 *              rather than rendering ours.
 *   missing -- the slots to ask for, so the client can open the right picker.
 *   details -- THE RAW TEXT, FOR US. Persisted to pipeline_tasks.error_details
 *              and never returned by any route. The whole point of splitting
 *              it from `error` is that one column is safe to render and the
 *              other is not.
 *
 * All four are OPTIONAL so that every executor above can keep returning
 * `{ success: false, error }` unchanged: executeTask() fills them in from
 * failure-classification.ts, in one place, for every failure -- including the
 * ones an executor authored itself.
 */
export type ExecutionFailure = {
  success: false;
  error: string;
  status?: "failed" | "failed_system";
  code?: string;
  missing?: string[];
  details?: string;
  retryToken?: string;
};

export type ExecutionOutcome = { success: true; result: unknown } | ExecutionFailure;

export type ExecutableTask = {
  orgId: string;
  userId: string;
  projectId: string | null;
  functionId: string;
  params: Record<string, unknown>;
  /**
   * R48 gap-closure (2026-08-30, F089: "Assistant respects role and project
   * scope"). Real, confirmed gap: executeGetProjectDashboard() called
   * getProjectDashboard() directly (the raw service function), bypassing the
   * redaction api/v1/projexa/dashboard's own route now applies (F059) --
   * the AI assistant could hand a "member"-ranked user the same budget/
   * margin figures the dashboard route itself now withholds from them.
   * Optional (undefined) rather than required so callers that genuinely
   * have no role available (the personal MCP AI-link surface,
   * api/mcp/[token]/route.ts) don't silently break; that surface is
   * per-user-token-scoped to one specific person by design (not a general
   * multi-role surface), a narrower risk than the 3 session-based REST
   * routes this IS wired through (assistant/tasks/submissions), but it is
   * NOT yet wired -- see R48_PROGRESS.md's F089 entry for the honest status.
   */
  role?: string | null;
  /**
   * R67 C-03 (decision D-05, the identity bridge) -- the REAL compliance.users
   * id of the person this task is attributed to, resolved by the route.
   *
   * `userId` above is `ctx.dbUser?.id ?? ctx.apiKey!.id`, so for PROJEXA --
   * which always calls with a per-ORG API key -- it is an api_keys.id, not a
   * users.id. Writing that into a column with a hard FK to compliance.users
   * is the E-class FK-mismatch bug fixed independently three times elsewhere
   * in this repo. Any executor that attributes a row to a PERSON
   * (pms_time_entries.user_id) must use THIS field and must fail honestly
   * when it is absent, rather than fall back to userId.
   */
  actorUserId?: string | null;
};

async function executeRecordWorkProgress(task: ExecutableTask): Promise<ExecutionOutcome> {
  const itemCode = task.params.itemCode;
  const percent = task.params.percent;
  const projectId = task.projectId;
  if (typeof itemCode !== "string" || !itemCode) return { success: false, error: "itemCode is required" };
  if (typeof percent !== "number") return { success: false, error: "percent is required" };
  if (!projectId) return { success: false, error: "no project resolved for this task" };

  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    // Real data-model quirk found while wiring this (not invented): the most
    // recent BOQ for the project is used deterministically -- version DESC
    // then createdAt DESC, the same tiebreaker fix as R-33/PR compliance-
    // tracker#1328 -- rather than assuming exactly one BOQ exists.
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.orgId, task.orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: [desc(constructionBoqs.version), desc(constructionBoqs.createdAt)],
    });
    if (!boq) return { success: false, error: `no BOQ found for project "${projectId}"` };

    const lineItem = await db.query.constructionBoqLineItems.findFirst({
      where: and(eq(constructionBoqLineItems.boqId, boq.id), eq(constructionBoqLineItems.itemCode, itemCode)),
    });
    if (!lineItem) return { success: false, error: `item code "${itemCode}" not found in this project's BOQ` };

    // construction_work_progress_entries.activity_id is NOT NULL, but this
    // org's real BOQ line items carry no activity_id link of their own
    // (verified live: every line item's activity_id is null for both the
    // Oakwood and Sumeet Sample Scope BOQs) -- a genuine, pre-existing data-
    // model gap between the "activities" table and BOQ-line-based progress,
    // not something seq14 invents or should silently paper over. The
    // pragmatic, honest choice here: use any real activity already recorded
    // against this project if one exists (matches the live convention seen
    // on real verified rows, e.g. "projexa_demo_activity"); if the project
    // genuinely has none, the task fails with that reason rather than
    // fabricating an activity row.
    const activity = await db.query.constructionActivities.findFirst({
      where: and(eq(constructionActivities.orgId, task.orgId), eq(constructionActivities.projectId, projectId)),
    });
    if (!activity) return { success: false, error: `no construction activity exists yet for project "${projectId}" -- create one before recording progress` };

    const row = await createProgressEntry(
      { orgId: task.orgId, userId: task.userId },
      {
        projectId,
        activityId: activity.id,
        boqLineItemId: lineItem.id,
        entryDate: new Date().toISOString().slice(0, 10),
        quantityDone: 0,
        percentComplete: percent,
      }
    );
    return { success: true, result: row };
  });
}

// R67 C-03 -- THE SECOND WRITE THIS PIPELINE CAN RUN.
//
// Before this, WRITE_FUNCTION_IDS was exactly {record_work_progress}: the
// whole composer could record progress and nothing else, so "log 3 hours on
// joinery shop drawings today" had nowhere to land. Design Studio's real
// screen (/schedule/log-time in PROJEXA) already posts to the same service
// this calls -- pms-time-service.logTime -- so this registers a path to
// existing, working code rather than a second way to write a timesheet.
//
// THE TASK SLOT IS FUZZY-MATCHED, AND AMBIGUITY IS A REFUSAL. A person says
// "joinery drawings"; pms_issues holds "#12 Joinery shop drawings". One
// unambiguous match runs; none or several is an honest failure naming what
// was searched, never a guess -- picking the first of three would log real
// hours against the wrong task.
async function executeRecordTimesheet(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingSlots("record_timesheet", task.params);
  if (missing.length > 0) {
    return { success: false, error: `${missing[0]} is required` };
  }
  if (!task.projectId) return { success: false, error: "no project resolved for this task" };

  const hours = Number(task.params.hours);
  if (!Number.isFinite(hours) || hours <= 0) return { success: false, error: "hours is required" };

  // *** ATTRIBUTION IS A PERSON, NEVER AN API KEY. *** See ExecutableTask's
  // actorUserId comment for why falling back to task.userId here would be a
  // real FK bug, not a convenience.
  const actorId = task.actorUserId;
  if (!actorId) {
    return {
      success: false,
      error:
        "a time entry has to belong to a named person, and this request did not identify one -- sign in, or send actorEmail with the request",
    };
  }

  const resolved = await withTenantContext({ orgId: task.orgId }, async (db) => {
    const actor = await db.query.users.findFirst({
      where: and(eq(users.id, actorId), eq(users.orgId, task.orgId)),
    });
    if (!actor) return { ok: false as const, error: "the person this time entry would belong to is not a user of this organisation" };
    if (!actor.isActive) return { ok: false as const, error: "the person this time entry would belong to is deactivated" };

    const explicitIssueId = typeof task.params.issueId === "string" ? task.params.issueId.trim() : "";
    if (explicitIssueId) {
      const issue = await db.query.pmsIssues.findFirst({
        where: and(eq(pmsIssues.id, explicitIssueId), eq(pmsIssues.orgId, task.orgId)),
        columns: { id: true, number: true, title: true },
      });
      if (!issue) return { ok: false as const, error: "that task does not exist on this project" };
      return { ok: true as const, actor, issue };
    }

    const wanted = String(task.params.task ?? "").trim();
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, task.orgId), eq(pmsIssues.projectId, task.projectId!)),
      columns: { id: true, number: true, title: true },
    });
    if (issues.length === 0) return { ok: false as const, error: "this project has no tasks to log time against yet" };

    const matches = matchIssues(issues, wanted);
    if (matches.length === 0) return { ok: false as const, error: `no task on this project matches "${wanted}"` };
    if (matches.length > 1) {
      return {
        ok: false as const,
        error: `"${wanted}" matches ${matches.length} tasks on this project -- name one of them`,
      };
    }
    return { ok: true as const, actor, issue: matches[0] };
  });

  // A DISCRIMINATED union, not an `in` check: both branches of the resolver
  // widen to the same optional-property shape, so `"error" in resolved` does
  // not narrow and the error would type as string | undefined.
  if (!resolved.ok) return { success: false, error: resolved.error };

  const spentOn =
    typeof task.params.spentOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.params.spentOn)
      ? task.params.spentOn
      : new Date().toISOString().slice(0, 10);

  const entry = await logTime(
    { orgId: task.orgId, userId: resolved.actor.id, dbUser: resolved.actor },
    {
      issueId: resolved.issue.id,
      hours: hours.toFixed(2),
      spentOn,
      activityType: typeof task.params.activityType === "string" ? task.params.activityType : undefined,
      comments: typeof task.params.comments === "string" ? task.params.comments : undefined,
    }
  );

  return { success: true, result: { ...entry, issue: resolved.issue } };
}

type IssueLite = { id: string; number: number | null; title: string | null };

/**
 * The fuzzy match, in one place so it is testable and so "how did it pick
 * that task?" has an answer. Tried in order, and the FIRST tier that produces
 * any match wins -- an exact issue number is never diluted by a title that
 * happens to contain the same digits.
 */
export function matchIssues(issues: readonly IssueLite[], wanted: string): IssueLite[] {
  const needle = wanted.trim().toLowerCase();
  if (!needle) return [];

  // "#12" or "12" -- the issue number, exactly.
  const asNumber = Number(needle.replace(/^#/, ""));
  if (Number.isInteger(asNumber) && asNumber > 0 && /^#?\d+$/.test(needle)) {
    return issues.filter((i) => i.number === asNumber);
  }

  const titled = issues.filter((i) => (i.title ?? "").trim().length > 0);
  const exact = titled.filter((i) => i.title!.toLowerCase() === needle);
  if (exact.length > 0) return exact;

  const contains = titled.filter((i) => i.title!.toLowerCase().includes(needle));
  if (contains.length > 0) return contains;

  // Every word the person said appears in the title, in any order:
  // "joinery drawings" finds "Joinery shop drawings".
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];
  return titled.filter((i) => {
    const title = i.title!.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

async function executeGetProjectDashboard(task: ExecutableTask): Promise<ExecutionOutcome> {
  if (!task.projectId) return { success: false, error: "no project resolved for this task" };
  const dashboard = await getProjectDashboard({ orgId: task.orgId }, task.projectId);
  // F089/F059: same redaction the API route applies, for the same reason --
  // see this file's ExecutableTask.role comment. `task.role` undefined
  // (role not threaded through by this caller) is treated as "unknown, so
  // don't redact" to preserve prior behavior for callers not yet wired.
  const rank = task.role ? (ROLE_RANK[task.role as UserRole] ?? 0) : ROLE_RANK.manager;
  if (rank < ROLE_RANK.manager) {
    return {
      success: true,
      result: {
        ...dashboard,
        budget: null, revenue: null, expenses: null,
        projectValue: null, earnedValue: null, percentByValue: null, contractValue: null,
      },
    };
  }
  return { success: true, result: dashboard };
}

// R53 Phase 4 -- the six remaining PROJEXA construction functions, reached
// through the SAME dispatchTool() mechanism the /api/v1/projexa/assistant
// codeReference path has used since Wave 128. Not a new capability and not
// a new taxonomy: these seven ids are already the route's own
// ALLOWED_CODE_REFERENCES allowlist, already registered in
// task-execution-engine.ts, already read-only there by that function's own
// stated contract. Before R53 the pipeline could resolve exactly TWO
// functions, which is why "show me the budget" had nowhere to land and was
// silently dropped.
//
// M26 caps the candidate set at "the module's 5-15 functions ... NEVER 400
// unbound functions". Seven reads plus one write is eight. Well inside it.
const READ_ONLY_DISPATCH_FUNCTION_IDS = [
  "get_construction_budget_status",
  "get_construction_kpi_status",
  "list_delayed_activities",
  "list_over_budget_projects",
  "generate_construction_progress_summary",
  "detect_construction_budget_schedule_risk",
] as const;

function makeDispatchExecutor(codeReference: string): (task: ExecutableTask) => Promise<ExecutionOutcome> {
  return async (task) => {
    // list_over_budget_projects and list_delayed_activities are org-scoped
    // and need no project; the rest throw "Missing projectId" inside
    // dispatchTool if one was not resolved. Checked here so the user gets
    // the honest reason rather than a raw engine error.
    const needsProject = codeReference !== "list_over_budget_projects" && codeReference !== "list_delayed_activities";
    if (needsProject && !task.projectId) return { success: false, error: "no project resolved for this task" };
    const result = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
      dispatchTool(db, task.orgId, task.userId, codeReference, { inputs: { projectId: task.projectId ?? undefined } })
    );
    return { success: true, result };
  };
}

// R63 gap-closure (2026-08-29, owner directive: "complete the big domain/
// tool-scoping fix"): before this, EXECUTORS (and therefore
// EXECUTABLE_FUNCTION_IDS, and therefore run-submission.ts's
// CANDIDATE_FUNCTION_IDS -- the pipeline's WHOLE candidate set) held exactly
// 8 functions, all construction. Reproduced live: "raise an invoice" via
// chat got refused, and the composer's own "VERI ERP" chain-pill had
// nothing to select (platform.dynamic_chains has 1 row total, for a
// different org). This pipeline can ALSO run compliance/ERP/CRM read-only
// dispatchTool() functions -- they already exist in task-execution-
// engine.ts (compliance since Wave 1-era; erp/crm added this same session)
// -- they were simply never added to this registry. None of these 12 need
// a project (org-scoped reads only, matching list_over_budget_projects'
// own posture above); each service call already enforces its own per-org
// module enablement (requireErpEnabled/requireSalesEnabled) and fails
// honestly for an org that hasn't purchased that module.
const READ_ONLY_ORG_SCOPED_FUNCTION_IDS = [
  // compliance (DOMAIN_ALLOWED_TOOLS.compliance in purpose-bound-ai.ts,
  // minus get_task_status which needs task context this pipeline doesn't carry)
  "get_compliance_stats", "get_overdue_items", "list_departments",
  "list_compliance_items", "list_notices", "list_gst_import_batches", "list_gst_returns",
  // erp
  "list_customers", "list_sales_orders",
  // crm
  "list_leads", "list_opportunities", "get_sales_pipeline_overview",
] as const;

function makeOrgScopedExecutor(codeReference: string): (task: ExecutableTask) => Promise<ExecutionOutcome> {
  return async (task) => {
    const result = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
      dispatchTool(db, task.orgId, task.userId, codeReference, {})
    );
    return { success: true, result };
  };
}

const EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  record_work_progress: executeRecordWorkProgress,
  // R67 C-03: the second entry, and the second write.
  record_timesheet: executeRecordTimesheet,
  get_construction_project_dashboard: executeGetProjectDashboard,
  ...Object.fromEntries(READ_ONLY_DISPATCH_FUNCTION_IDS.map((ref) => [ref, makeDispatchExecutor(ref)])),
  ...Object.fromEntries(READ_ONLY_ORG_SCOPED_FUNCTION_IDS.map((ref) => [ref, makeOrgScopedExecutor(ref)])),
};

/**
 * R53 Phase 4's writes/reads split -- the one fact classify.ts needs to
 * separate a TASK from a CHAT.
 *
 * A CLOSED ALLOWLIST OF WRITERS, NOT A GUESS. Everything not named here is
 * treated as a read, which is the safe direction to be wrong in: mistaking
 * a write for a read blocks it with an honest reason, while mistaking a
 * read for a write would let a question record a real row.
 */
const WRITE_FUNCTION_IDS: ReadonlySet<string> = new Set(["record_work_progress", "record_timesheet"]);

export function functionWrites(functionId: string): boolean {
  return WRITE_FUNCTION_IDS.has(functionId);
}

/** The pipeline's candidate set -- every function it can actually run today. */
export const EXECUTABLE_FUNCTION_IDS: readonly string[] = Object.keys(EXECUTORS);

export function hasExecutor(functionId: string): boolean {
  return functionId in EXECUTORS;
}

/**
 * R67 C-13 -- every failure leaves here CLASSIFIED, whoever produced it.
 *
 * An executor's own returned failure is classified too, not just a thrown one:
 * "itemCode is required" is a real question for the user and it should reach
 * PROJEXA as BOQ_LINE_REQUIRED + ["itemCode"], not as a camelCase string the
 * client has to pattern-match its way back out of.
 *
 * A failure that ALREADY carries a code is left alone -- an executor that
 * knows better than a regex is the authority on its own failure.
 */
function classified(outcome: ExecutionOutcome): ExecutionOutcome {
  if (outcome.success || outcome.code) return outcome;
  const f = classifyFailure(outcome.error);
  return {
    success: false,
    // The classifier's message for a system failure (the raw text is useless
    // to a person); the executor's own sentence otherwise, masked.
    error: f.message,
    status: f.status,
    code: f.code,
    missing: f.missing,
    details: f.details,
    retryToken: f.retryToken,
  };
}

export async function executeTask(
  task: ExecutableTask,
  /**
   * TEST SEAM ONLY, and deliberately the last parameter with a default, so no
   * production call site passes it: every executor in the real registry does
   * real DB work, and C-13's own acceptance is about what executeTask does
   * with a THROWN driver error -- which cannot be reached without one.
   */
  executors: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = EXECUTORS
): Promise<ExecutionOutcome> {
  const executor = executors[task.functionId];
  if (!executor) {
    return classified({
      success: false,
      error: `no executor is registered for function_id "${task.functionId}" yet`,
    });
  }
  try {
    return classified(await executor(task));
  } catch (error) {
    // R66 visual QA (2026-09-02): this used to return error.message straight
    // through. Every executor ABOVE already returns its own clean, honest
    // string for an expected condition ("no project resolved for this task",
    // "no BOQ found for project ...") -- those are deliberate, human-authored,
    // safe to show verbatim (GET /api/v1/projexa/tasks -> M24Shell renders
    // pipeline_tasks.error on the "Needs you" blocked-row detail line, by
    // design). This catch block is different: it only fires on an UNEXPECTED
    // thrown exception -- a DB driver timeout, a network error, a bug -- and
    // .message on those can carry raw internals. Reproduced live in the R66
    // walkthrough: a Postgres connection-timeout bubbled up as
    // "write CONNECT_TIMEOUT 3.109.171.244:6543" and was rendered verbatim to
    // the end user, leaking an internal IP:port. Log the real error
    // server-side; return a safe, honest-but-generic message for display.
    //
    // R67 C-13: the generic sentence is no longer the whole answer. The same
    // exception now also produces a CODE, a status and the raw text kept
    // separately -- so a pool timeout can leave the needs-you list (nobody on
    // site can fix it) and carry a Retry, while an unexpected error that is
    // really a user's missing slot still asks its question. The message a
    // client renders is the classifier's, never `error.message`.
    console.error(`executeTask: unexpected error running "${task.functionId}"`, error);
    const f = classifyFailure(error);
    return {
      success: false,
      error: f.message,
      status: f.status,
      code: f.code,
      missing: f.missing,
      details: f.details,
      retryToken: f.retryToken,
    };
  }
}
