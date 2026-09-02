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
import { createRosterEntry, recordAttendance } from "@/lib/services/construction-labour-service";
import { createBoqRevision } from "@/lib/services/construction-boq-service";
import { createMeeting } from "@/lib/services/pms-meeting-service";
import { createDocumentRecord } from "@/lib/services/document-service";
import { dispatchTool } from "@/lib/task-execution-engine";
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard";
import { normaliseThrownError, pipelineFailure, type PipelineFailure } from "./error-codes";
import { functionSpec, WRITE_FUNCTION_IDS as REGISTERED_WRITES } from "./function-registry";

/**
 * R67 lane B (B-01, decision D-03). `error: string` is gone: a failure is a
 * CODE plus the parameters that are missing, and the sentence a human reads
 * is composed in projexa's src/lib/task-errors.ts. `debug` is the raw driver
 * text -- it is logged server-side and is NEVER persisted and NEVER returned
 * by GET /api/v1/projexa/tasks, which is how "write CONNECT_TIMEOUT
 * 3.109.171.244:6543" reached an end user's screen in the R66 walkthrough.
 */
export type ExecutionOutcome =
  | { success: true; result: unknown }
  | { success: false; failure: PipelineFailure; debug?: string };

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

/**
 * R67 B-04 -- THE SERVER-SIDE RE-CHECK.
 *
 * validate() already refuses a task whose declared required params are
 * missing, and chain-options only ever offers real records. This checks the
 * same list again anyway, at the last moment before a real write, because
 * "the client only offered valid options" is not a security property: a
 * caller can POST {functionId, params} straight at tasks/route.ts. Same
 * closed vocabulary, so the user sees the same sentence either way, and the
 * service is never reached with a missing field (which would surface as its
 * own English "attendanceDate is required" through the catch block).
 */
function missingRequiredParam(task: ExecutableTask): PipelineFailure | null {
  const spec = functionSpec(task.functionId);
  if (!spec) return null;
  for (const required of spec.requiredParams) {
    const value = required.name === "projectId" ? (task.projectId ?? task.params.projectId) : task.params[required.name];
    const empty = value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
    // R67 B-09/B-10: the D-03 vocabulary key, same as validate() reports.
    if (empty) return pipelineFailure(required.code, [required.field ?? required.name]);
  }
  return null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

async function executeRecordWorkProgress(task: ExecutableTask): Promise<ExecutionOutcome> {
  const itemCode = str(task.params.itemCode);
  // R67 B-07: the verdict offers the project's real BOQ lines as chips, so
  // what comes back on confirm is a LINE ITEM ID, not a code the user
  // retyped. Both are accepted; the id wins when both are present, because
  // it is the one that cannot be ambiguous.
  const boqLineItemId = str(task.params.boqLineItemId);
  const percent = task.params.percent;
  const projectId = task.projectId ?? str(task.params.projectId) ?? null;
  if (!itemCode && !boqLineItemId) return { success: false, failure: pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]) };
  if (typeof percent !== "number") return { success: false, failure: pipelineFailure("VALUE_REQUIRED", ["value"]) };
  if (!projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };

  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    // Real data-model quirk found while wiring this (not invented): the most
    // recent BOQ for the project is used deterministically -- version DESC
    // then createdAt DESC, the same tiebreaker fix as R-33/PR compliance-
    // tracker#1328 -- rather than assuming exactly one BOQ exists.
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.orgId, task.orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: [desc(constructionBoqs.version), desc(constructionBoqs.createdAt)],
    });
    // R67 B-01: a project with no BOQ at all and a project whose BOQ has no
    // such line are the SAME fact to the person typing -- the line they named
    // is not there to record against -- so both carry BOQ_LINE_NOT_FOUND and
    // the client's one sentence ("There is no line {code} on {project}
    // {version} -- pick a line") is true in both cases. `version` is null
    // when there is no BOQ, and the dictionary drops an empty slot.
    if (!boq) {
      return { success: false, failure: pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], { itemCode: itemCode ?? null, version: null }) };
    }

    // Scoped to THIS project's BOQ either way, so a line item id posted from
    // another project's chips resolves to nothing rather than to a write on
    // the wrong project.
    const lineItem = await db.query.constructionBoqLineItems.findFirst({
      where: boqLineItemId
        ? and(eq(constructionBoqLineItems.boqId, boq.id), eq(constructionBoqLineItems.id, boqLineItemId))
        : and(eq(constructionBoqLineItems.boqId, boq.id), eq(constructionBoqLineItems.itemCode, itemCode!)),
    });
    if (!lineItem) {
      return {
        success: false,
        failure: pipelineFailure("BOQ_LINE_NOT_FOUND", [boqLineItemId ? "boqLineItemId" : "itemCode"], {
          itemCode: itemCode ?? null,
          version: boq.version ?? null,
        }),
      };
    }

    // T-WPR-15-1's invariant, checked BEFORE the write instead of letting
    // createProgressEntry throw its own English sentence through the catch
    // block below: a parent line's percent is derived from its children and
    // must never be stored directly.
    const child = await db.query.constructionBoqLineItems.findFirst({
      where: eq(constructionBoqLineItems.parentLineItemId, lineItem.id),
    });
    if (child) {
      // The line's own code, whichever way the caller addressed it, so the
      // client's sentence can name it ("EX-00 is a parent line ...").
      return { success: false, failure: pipelineFailure("BOQ_LINE_IS_PARENT", ["boqLine"], { itemCode: lineItem.itemCode ?? itemCode ?? null }) };
    }

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
    if (!activity) return { success: false, failure: pipelineFailure("ACTIVITY_REQUIRED", ["activityId"]) };

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
  if (!task.projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };
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
    // R67 B-02: the project may have arrived on the task's own params
    // (validate() fills it from the submission's projectId) even when the
    // top-level projectId was not threaded through by this caller.
    const projectId = task.projectId ?? (typeof task.params.projectId === "string" ? task.params.projectId : null);
    if (needsProject && !projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };
    const result = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
      dispatchTool(db, task.orgId, task.userId, codeReference, { inputs: { projectId: projectId ?? undefined } })
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

// ── R67 B-04: Sumeet's daily writes, through the existing services ────────
//
// Each executor below calls THE SAME service function the PROJEXA create
// route already calls, with no new SQL and no second validation path. Every
// one of them:
//   - re-checks its declared required params server-side (missingRequiredParam);
//   - lets the service open its own withTenantContext, and opens NONE of its
//     own -- D-06 forbids a nested tenant transaction, and every service
//     below already runs its project/record existence checks inside that one;
//   - returns the created row's id and the route its object lives at, so the
//     client can print a receipt line and land the right pane on the real
//     record.
type WriteResult = { id: string; route: string; record: unknown };

function created(id: string, route: string, record: unknown): ExecutionOutcome {
  return { success: true, result: { id, route, record } satisfies WriteResult };
}

async function executeRecordAttendance(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = (task.projectId ?? str(task.params.projectId))!;
  const row = await recordAttendance(
    { orgId: task.orgId },
    {
      projectId,
      rosterId: str(task.params.rosterId)!,
      // The pipeline's own parameter vocabulary is `date`; the service's
      // column is attendanceDate. Adapted here, once.
      attendanceDate: str(task.params.date)!,
      status: str(task.params.status) ?? "present",
      hoursWorked: num(task.params.hours),
    }
  );
  return created(row.id, `/labour?tab=attendance`, row);
}

async function executeAddRosterEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = (task.projectId ?? str(task.params.projectId))!;
  const row = await createRosterEntry(
    { orgId: task.orgId },
    {
      projectId,
      name: str(task.params.name)!,
      dailyRate: num(task.params.dailyRate) ?? 0,
      trade: str(task.params.trade),
      employeeCode: str(task.params.employeeCode),
      skillLevel: str(task.params.skillLevel),
      vendorId: str(task.params.vendorId),
    }
  );
  return created(row.id, `/labour/${row.id}`, row);
}

async function executeCreateMeeting(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = (task.projectId ?? str(task.params.projectId))!;
  const agenda = Array.isArray(task.params.agendaItems)
    ? (task.params.agendaItems as unknown[]).filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : undefined;
  const row = await createMeeting({ orgId: task.orgId, userId: task.userId }, projectId, {
    title: str(task.params.title)!,
    scheduledAt: str(task.params.scheduledAt)!,
    durationMinutes: num(task.params.durationMinutes),
    agendaItems: agenda,
  });
  return created(row.id, `/moms/${row.id}`, row);
}

async function executeCreateBoqRevision(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const row = await createBoqRevision({ orgId: task.orgId, userId: task.userId }, str(task.params.boqId)!, {
    title: str(task.params.title),
  });
  return created(row.id, `/scope/${row.id}`, row);
}

async function executeCreateDocument(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  // LINK-ONLY, deliberately. createDocumentRecord's other branch takes a
  // File, and a chat submission carries JSON params -- it cannot carry
  // bytes. Uploading a file stays on /documents/upload, which is the real
  // path for it; this covers the link-only record the service already
  // supports (a drawing set, a 3D walkthrough URL).
  const row = await createDocumentRecord(
    { orgId: task.orgId, userId: task.userId },
    {
      name: str(task.params.name)!,
      category: str(task.params.category)!,
      externalUrl: str(task.params.externalUrl)!,
      expiryDate: str(task.params.expiryDate) ?? null,
      linkedEntityType: task.projectId ? "project" : null,
      linkedEntityId: task.projectId ?? null,
    }
  );
  return created(row.id, `/documents/${row.id}`, row);
}

/**
 * R67 B-02 -- CATALOGUE IDS THAT RESOLVE TO AN EXISTING READ.
 *
 * Every budget screenshot in the R66 walkthrough showed the left pane
 * repeating "Review Budget -- blocked -- no project resolved for this task"
 * while the right pane was already scoped to that project. Two separate
 * defects produced that line: the submission's projectId never reached the
 * candidate's params (fixed in validate.ts), and `review_budget` -- the id
 * PROJEXA's Budget card carries -- had no executor at all.
 *
 * It is registered as an ALIAS of a real read, not as a second
 * implementation, and deliberately NOT in WRITE_FUNCTION_IDS: reviewing a
 * budget records nothing.
 */
const READ_ONLY_ALIASES: Readonly<Record<string, string>> = {
  review_budget: "get_construction_budget_status",
};

const EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  record_work_progress: executeRecordWorkProgress,
  record_attendance: executeRecordAttendance,
  add_roster_entry: executeAddRosterEntry,
  create_meeting: executeCreateMeeting,
  create_boq_revision: executeCreateBoqRevision,
  create_document: executeCreateDocument,
  get_construction_project_dashboard: executeGetProjectDashboard,
  ...Object.fromEntries(READ_ONLY_DISPATCH_FUNCTION_IDS.map((ref) => [ref, makeDispatchExecutor(ref)])),
  ...Object.fromEntries(Object.entries(READ_ONLY_ALIASES).map(([id, ref]) => [id, makeDispatchExecutor(ref)])),
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
 *
 * R67 B-04: the list is now DERIVED from function-registry.ts's own `writes`
 * flag rather than repeated here, so a write registered in the catalogue can
 * never be missing from this set (which would let classify.ts call it a
 * CHAT and run a write off a question). Filtered to what actually has an
 * executor, so the set stays a statement about what this file can run.
 */
const WRITE_FUNCTION_IDS: ReadonlySet<string> = new Set([...REGISTERED_WRITES].filter((id) => id in EXECUTORS));

export function functionWrites(functionId: string): boolean {
  return WRITE_FUNCTION_IDS.has(functionId);
}

/** The pipeline's candidate set -- every function it can actually run today. */
export const EXECUTABLE_FUNCTION_IDS: readonly string[] = Object.keys(EXECUTORS);

export function hasExecutor(functionId: string): boolean {
  return functionId in EXECUTORS;
}

/**
 * `executors` is injectable for tests ONLY -- every production caller uses
 * the default registry. It exists because B-01's whole point is what happens
 * when an executor THROWS a transport error, and there is no honest way to
 * make a real Postgres connection time out inside a unit test.
 */
export async function executeTask(
  task: ExecutableTask,
  executors: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = EXECUTORS
): Promise<ExecutionOutcome> {
  const executor = executors[task.functionId];
  if (!executor) {
    return { success: false, failure: pipelineFailure("FUNCTION_NOT_AVAILABLE", [], { functionId: task.functionId }) };
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
    //
    // R67 B-01 replaces that generic sentence with a CODE. The raw text is
    // still logged here in full, and travels no further than `debug` --
    // which run-submission.ts logs and deliberately does not persist, so
    // GET /api/v1/projexa/tasks cannot select it.
    console.error(`executeTask: unexpected error running "${task.functionId}"`, error);
    const { failure, debug } = normaliseThrownError(error);
    return { success: false, failure, debug };
  }
}
