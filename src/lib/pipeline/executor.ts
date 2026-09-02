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
import { constructionBoqLineItems, constructionBoqs, constructionActivities } from "@/lib/db/schema";
import { createProgressEntry } from "@/lib/services/construction-progress-service";
import { getProjectDashboard } from "@/lib/services/construction-dashboard-service";
import { dispatchTool } from "@/lib/task-execution-engine";
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard";

export type ExecutionOutcome = { success: true; result: unknown } | { success: false; error: string };

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
};

async function executeRecordWorkProgress(task: ExecutableTask): Promise<ExecutionOutcome> {
  const itemCode = task.params.itemCode;
  const percent = task.params.percent;
  const projectId = task.projectId;
  if (typeof itemCode !== "string" || !itemCode) return { success: false, error: "itemCode is required" };
  if (typeof percent !== "number") return { success: false, error: "percent is required" };
  if (!projectId) return { success: false, error: "no project resolved for this task" };

  // R67 F-15 (R-232/R-251) -- THE PIPELINE'S ONE WRITE PATH WAS NESTING.
  //
  // This used to hold a tenant transaction open for its three lookups AND for
  // createProgressEntry(), which opens its OWN -- two of tenant-scoped.ts's
  // five app_runtime connections held by one task, on the exact path M24's
  // Task Master uses to record work progress. The D-06 guard added in F-12 now
  // makes that an error rather than a slow success.
  //
  // Split, not threaded: the lookups resolve in their own transaction, which
  // CLOSES, and then createProgressEntry opens its own. Nothing is lost by
  // that, because createProgressEntry re-validates every one of these
  // references itself, scoped to the same project (see its own comments): the
  // resolution here is a lookup for the user's shorthand ("item 1.01"), not an
  // invariant that has to hold across the write. If a row disappears between
  // the two, the write refuses with its own 404 -- which is the correct answer,
  // not a lost guarantee.
  // Explicitly typed so the two arms stay a real discriminated union: without
  // it the inferred shape carries `error?: string | undefined` on both arms and
  // the narrowing below is not a narrowing at all.
  type ResolvedTarget = { error: string } | { activityId: string; boqLineItemId: string };
  const resolved = await withTenantContext<ResolvedTarget>({ orgId: task.orgId, userId: task.userId }, async (db): Promise<ResolvedTarget> => {
    // Real data-model quirk found while wiring this (not invented): the most
    // recent BOQ for the project is used deterministically -- version DESC
    // then createdAt DESC, the same tiebreaker fix as R-33/PR compliance-
    // tracker#1328 -- rather than assuming exactly one BOQ exists.
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.orgId, task.orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: [desc(constructionBoqs.version), desc(constructionBoqs.createdAt)],
    });
    if (!boq) return { error: `no BOQ found for project "${projectId}"` };

    const lineItem = await db.query.constructionBoqLineItems.findFirst({
      where: and(eq(constructionBoqLineItems.boqId, boq.id), eq(constructionBoqLineItems.itemCode, itemCode)),
    });
    if (!lineItem) return { error: `item code "${itemCode}" not found in this project's BOQ` };

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
    if (!activity) return { error: `no construction activity exists yet for project "${projectId}" -- create one before recording progress` };

    return { activityId: activity.id, boqLineItemId: lineItem.id };
  });

  if ("error" in resolved) return { success: false, error: resolved.error };

  const row = await createProgressEntry(
    { orgId: task.orgId, userId: task.userId },
    {
      projectId,
      activityId: resolved.activityId,
      boqLineItemId: resolved.boqLineItemId,
      entryDate: new Date().toISOString().slice(0, 10),
      quantityDone: 0,
      percentComplete: percent,
    }
  );
  return { success: true, result: row };
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
const WRITE_FUNCTION_IDS: ReadonlySet<string> = new Set(["record_work_progress"]);

export function functionWrites(functionId: string): boolean {
  return WRITE_FUNCTION_IDS.has(functionId);
}

/** The pipeline's candidate set -- every function it can actually run today. */
export const EXECUTABLE_FUNCTION_IDS: readonly string[] = Object.keys(EXECUTORS);

export function hasExecutor(functionId: string): boolean {
  return functionId in EXECUTORS;
}

export async function executeTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  const executor = EXECUTORS[task.functionId];
  if (!executor) {
    return { success: false, error: `no executor is registered for function_id "${task.functionId}" yet` };
  }
  try {
    return await executor(task);
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
    console.error(`executeTask: unexpected error running "${task.functionId}"`, error);
    return {
      success: false,
      error: "This couldn't be completed right now due to an internal error. Retry shortly, or contact support if it persists.",
    };
  }
}
