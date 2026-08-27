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

export type ExecutionOutcome = { success: true; result: unknown } | { success: false; error: string };

export type ExecutableTask = {
  orgId: string;
  userId: string;
  projectId: string | null;
  functionId: string;
  params: Record<string, unknown>;
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

async function executeGetProjectDashboard(task: ExecutableTask): Promise<ExecutionOutcome> {
  if (!task.projectId) return { success: false, error: "no project resolved for this task" };
  const dashboard = await getProjectDashboard({ orgId: task.orgId }, task.projectId);
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

const EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  record_work_progress: executeRecordWorkProgress,
  get_construction_project_dashboard: executeGetProjectDashboard,
  ...Object.fromEntries(READ_ONLY_DISPATCH_FUNCTION_IDS.map((ref) => [ref, makeDispatchExecutor(ref)])),
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
    return { success: false, error: error instanceof Error ? error.message : "unknown execution error" };
  }
}
