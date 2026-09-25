// R42 seq14 -- executes a validated task's function_id against a REAL
// backing action. A small registry, not a framework: M28's real function
// catalogue (compliance.screen_definitions.function_id) doesn't exist until
// seq20, so this file only wires the functions that genuinely have a real
// implementation TODAY. Anything else fails honestly (M26: "a candidate
// that fails validation is a FAIL, not a suggestion" -- the same posture
// extends to execution: an unregistered function_id blocks the task with an
// honest reason, never a fabricated success).
import { and, eq, desc } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { constructionBoqLineItems, constructionBoqs, constructionActivities, constructionChangeOrders, constructionLabourRoster, constructionMaterials, documents, erpSuppliers, pmsIssues, projects, users } from "@/lib/db/schema";
import { createProgressEntry } from "@/lib/services/construction-progress-service";
import { approveTimeEntry, getTimeEntry, logTime, rejectTimeEntry, REJECTION_REASON_MIN_LENGTH } from "@/lib/services/pms-time-service";
import { getProjectDashboard } from "@/lib/services/construction-dashboard-service";
import { createRosterEntry, recordAttendance } from "@/lib/services/construction-labour-service";
import { createBoq, createBoqRevision, getProjectBoqLinePage, updateLineItemBudget, validateBoqBodyShape, type BoqLineItemInput } from "@/lib/services/construction-boq-service";
import { redactProjectSideFields } from "@/lib/services/cost-visibility-service";
import { createMeeting } from "@/lib/services/pms-meeting-service";
import { createDocumentRecord, createDrawingRecord } from "@/lib/services/document-service";
import { createChangeOrder, getChangeOrder, listChangeOrders } from "@/lib/services/construction-change-order-service";
import { createSiteInstruction } from "@/lib/services/construction-site-instruction-service";
import { buildReportTable, designerTimesheetReport, manpowerCostReport, REPORT_REGISTRY, type ReportName, type ReportTable } from "@/lib/services/construction-reports-service";
import { getBaseCurrency } from "@/lib/services/erp-accounting-service";
import { getProjectAnalysis, listOrgAnalysis, sortAnalysisRows } from "@/lib/services/boq-analysis-service";
import { listIssues } from "@/lib/services/pms-issue-service";
import { createScheduleActivity, type ScheduleActivityInput } from "@/lib/services/schedule-service";
import { createMilestone, listMilestones, resolveDefaultIssueTypeId, updateMilestone, type MilestonePatch } from "@/lib/services/pms-taxonomy-service";
import { listBillingDueQueue, listClaims } from "@/lib/services/construction-billing-workflow-service";
import { createVeriMeeting } from "@/lib/services/veri-meeting-service";
import { createMaterial, createMaterialReceipt } from "@/lib/services/construction-materials-service";
import { recordTimesheetDecisionTasks } from "@/lib/services/timesheet-review-task-service";
import { recallMemory } from "@/lib/services/memory-recall-service";
import { createSourceObject } from "@/lib/crr/capture";
import { createReportShareLink } from "@/lib/services/report-share-service";
import { analyseBoqPreview, parseBoqSpreadsheet, toPreviewRows } from "@/lib/services/construction-boq-import-service";
import { categoryForKind, DRAWING_STATUSES } from "@/lib/drawings-register";
import { dispatchTool } from "@/lib/task-execution-engine";
import { ServiceError } from "@/lib/services/compliance-service";
import { financialsAllowedForRole, redactProjectDashboardFinancials } from "@/lib/task-execution/construction-tools";
import { codeForServiceError, normaliseThrownError, pipelineFailure, type PipelineFailure } from "./error-codes";
import { functionSpec, requiredParamSatisfied, WRITE_FUNCTION_IDS as REGISTERED_WRITES } from "./function-registry";

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
   * have no role available don't fail to compile.
   *
   * PROJEXA-BUILD-001 U-01 (2026-09-25): an absent role no longer means "show
   * the figures". Every financial redaction this role feeds (the dashboard
   * below, and the dispatch reads via dispatchTool -> construction-tools.ts)
   * now treats undefined/null as NOT manager, via financialsAllowedForRole().
   * api/mcp/[token]/route.ts now passes the link owner's role, and
   * makeDispatchExecutor now forwards this field to dispatchTool, which it
   * used to drop.
   */
  role?: string | null;
  /**
   * R67 FIX PASS -- the project's HUMAN NAME, for the failure context only.
   *
   * D-03's BOQ_LINE_NOT_FOUND sentence is "There is no line {code} on
   * {project} {version} - pick a line". validate() fills {project} from
   * ValidationContext.projectLabel, but the executor's own copy of the same
   * failure had no project at all, so the identical code rendered as "There
   * is no line EX-01 on 1 - pick a line" -- with the BOQ's bare version
   * number standing where the project name belongs. Both run paths in
   * run-submission.ts already resolve this label (resolveRootLabel, for the
   * derived chain), so passing it costs no extra read.
   *
   * Optional: a caller that has no label yields a sentence with the clause
   * omitted, never one with a hole in it.
   */
  projectLabel?: string | null;
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
    const fallback = required.name === "projectId" ? task.projectId : undefined;
    // R67 B-09/B-10: the D-03 vocabulary key, same as validate() reports.
    if (!requiredParamSatisfied(required, task.params, fallback)) {
      return pipelineFailure(required.code, [required.field ?? required.name]);
    }
  }
  return null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * R67 FIX PASS -- the BOQ version as the client's sentence wants it ("v2"),
 * matching what validate() puts in the same context key. A bare number here
 * used to land in the {project} slot of "There is no line {code} on {project}
 * {version} - pick a line", so the row read "... on 1 - pick a line".
 */
function versionLabel(version: number | null | undefined): string | null {
  return version === null || version === undefined ? null : `v${version}`;
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
  // R67 B-11: "record 2 nos done today" is how a site engineer says it, and
  // it is the value chip chain-options offers next to "40 %" -- so a QUANTITY
  // in the line's own unit is a real answer to "how much is done", not a
  // second-class one. Both arrive here; the percent wins when both are given,
  // because it is the column the roll-up actually reads. A quantity is
  // converted below, once the line (and therefore its total quantity) is
  // known -- it cannot be converted before the read.
  const quantityDone = num(task.params.quantityDone);
  const projectId = task.projectId ?? str(task.params.projectId) ?? null;
  if (!itemCode && !boqLineItemId) return { success: false, failure: pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]) };
  if (typeof percent !== "number" && quantityDone === undefined) {
    return { success: false, failure: pipelineFailure("VALUE_REQUIRED", ["value"]) };
  }
  if (!projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };

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
  // it the inferred shape carries optional keys on both arms and the narrowing
  // below is not a narrowing at all.
  //
  // MERGE NOTE (R67 F-15 x R67 B-01/B-11). The resolution below returns B's
  // structured PipelineFailure values rather than F-15's original free-text
  // `{ error }` -- ExecutionOutcome no longer carries a free-text arm, and a
  // code is what gives the client its one sentence and its picker. The
  // discriminant is `ok`, not `success`, so this internal union is never
  // mistaken for an ExecutionOutcome: only the WRITE below produces one.
  type ResolvedTarget =
    | { ok: false; failure: PipelineFailure }
    | { ok: true; activityId: string; boqLineItemId: string; percentComplete: number; quantityDone: number };
  const resolved = await withTenantContext<ResolvedTarget>({ orgId: task.orgId, userId: task.userId }, async (db): Promise<ResolvedTarget> => {
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
      return {
        ok: false,
        // R67 FIX PASS: the SAME context shape validate() supplies -- the
        // project's name under `project`, the version as "v3" rather than a
        // bare 3 -- so one code has one sentence whichever stage produced it.
        failure: pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], {
          itemCode: itemCode ?? null,
          project: task.projectLabel ?? null,
          version: null,
        }),
      };
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
        ok: false,
        failure: pipelineFailure("BOQ_LINE_NOT_FOUND", [boqLineItemId ? "boqLineItemId" : "itemCode"], {
          itemCode: itemCode ?? null,
          project: task.projectLabel ?? null,
          version: versionLabel(boq.version),
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
      return {
        ok: false,
        failure: pipelineFailure("BOQ_LINE_IS_PARENT", ["boqLine"], {
          itemCode: lineItem.itemCode ?? itemCode ?? null,
          project: task.projectLabel ?? null,
          version: versionLabel(boq.version),
        }),
      };
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
    if (!activity) return { ok: false, failure: pipelineFailure("ACTIVITY_REQUIRED", ["activityId"]) };

    // R67 B-11: the quantity -> percent conversion, done HERE because the
    // line's own total quantity is the only honest denominator and it is not
    // knowable before this read. A line whose quantity is 0 (or absent) has
    // no denominator, so a quantity answer cannot be interpreted at all --
    // that is VALUE_REQUIRED, not a silent 0 %. The stored percent is
    // clamped to the column's own 0..100 rule that createProgressEntry
    // enforces one line later, so an over-recorded quantity is capped rather
    // than rejected after the fact.
    const lineQuantity = Number(lineItem.quantity ?? 0);
    let percentComplete: number;
    if (typeof percent === "number") {
      percentComplete = percent;
    } else if (Number.isFinite(lineQuantity) && lineQuantity > 0) {
      percentComplete = Math.min(100, Math.max(0, Math.round(((quantityDone as number) / lineQuantity) * 100)));
    } else {
      return { ok: false, failure: pipelineFailure("VALUE_REQUIRED", ["value"]) };
    }

    // The transaction ENDS here (F-15): everything below this point is the
    // write, and it opens its own. B-11's conversion stays on this side of the
    // boundary because the line's total quantity is the only honest
    // denominator and it is only knowable from the read above.
    return { ok: true, activityId: activity.id, boqLineItemId: lineItem.id, percentComplete, quantityDone: quantityDone ?? 0 };
  });

  if (!resolved.ok) return { success: false, failure: resolved.failure };

  const row = await createProgressEntry(
    { orgId: task.orgId, userId: task.userId },
    {
      projectId,
      activityId: resolved.activityId,
      boqLineItemId: resolved.boqLineItemId,
      entryDate: new Date().toISOString().slice(0, 10),
      // Was hard-coded 0 before B-11, so the quantity column of every
      // pipeline-written entry was a lie by omission. It now carries what the
      // user actually said when they said it in units, and the percent is the
      // converted one -- not the raw `percent` param, which is undefined
      // whenever the user answered in quantity.
      quantityDone: resolved.quantityDone,
      percentComplete: resolved.percentComplete,
    }
  );
  return { success: true, result: row };
}

async function executeGetProjectDashboard(task: ExecutableTask): Promise<ExecutionOutcome> {
  if (!task.projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };
  const dashboard = await getProjectDashboard({ orgId: task.orgId }, task.projectId);
  // F089/F059: same redaction the API route applies, for the same reason --
  // see this file's ExecutableTask.role comment. U-01: `task.role`
  // undefined/null (role not threaded through by this caller) is "unknown,
  // so redact" -- the same rule construction-tools.ts applies.
  if (!financialsAllowedForRole(task.role)) {
    return { success: true, result: redactProjectDashboardFinancials(dashboard) };
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
    // U-01: task.role is forwarded as dispatchTool's own `role` argument. It
    // was dropped here, so get_construction_budget_status (and its alias
    // review_budget) and list_over_budget_projects never saw the caller's
    // role and ran unredacted for every pipeline caller of any rank.
    const result = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
      dispatchTool(db, task.orgId, task.userId, codeReference, { inputs: { projectId: projectId ?? undefined } }, task.role ?? null)
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
//   - lets the service open its own withTenantContext, and holds NONE of its
//     own open around it -- D-06 forbids a nested tenant transaction, and every
//     service below already runs its project/record existence checks inside
//     that one (U-18: the same-project check of onAnotherProject() is a short
//     lookup that closes before the service call, not around it);
//   - returns the created row's id and the route its object lives at, so the
//     client can print a receipt line and land the right pane on the real
//     record.
type WriteResult = { id: string; route: string; record: unknown };

function created(id: string, route: string, record: unknown): ExecutionOutcome {
  return { success: true, result: { id, route, record } satisfies WriteResult };
}

/**
 * PROJEXA-BUILD-001 U-18 (BR-288, audit A-11): an id parameter must name a
 * record of the task's OWN project, not merely of its org. recordAttendance
 * finds the roster member, and createBoqRevision the parent BOQ, by id and org
 * only -- so a worker of project B posted with project A got attendance booked
 * on A, and a BOQ of project B was revised for a caller whose project is A
 * (for a project-scoped link or key, a write outside its project).
 *
 * True only when the record exists on ANOTHER project: a record that does not
 * exist at all still reaches the service and gets its own 404, as before. Its
 * own short transaction, closed before the service opens one (the F-15 shape
 * executeRecordWorkProgress already uses; D-06 forbids nesting).
 *
 * PROJEXA-BUILD-001 U-28 (BR-408): a revision's sourceChangeOrderId is an id
 * parameter too. createBoqRevision() finds the change order by id and org only
 * and then writes the new revision's id onto it, so a change order of project
 * B named on a project-A revision would be linked to A's BOQ.
 */
async function onAnotherProject(
  task: ExecutableTask,
  record: "roster" | "boq" | "change_order",
  id: string,
  projectId: string
): Promise<boolean> {
  const found = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    record === "roster"
      ? db.query.constructionLabourRoster.findFirst({
          where: and(eq(constructionLabourRoster.id, id), eq(constructionLabourRoster.orgId, task.orgId)),
          columns: { projectId: true },
        })
      : record === "boq"
        ? db.query.constructionBoqs.findFirst({
            where: and(eq(constructionBoqs.id, id), eq(constructionBoqs.orgId, task.orgId)),
            columns: { projectId: true },
          })
        : db.query.constructionChangeOrders.findFirst({
            where: and(eq(constructionChangeOrders.id, id), eq(constructionChangeOrders.orgId, task.orgId)),
            columns: { projectId: true },
          })
  );
  return found !== undefined && found.projectId !== projectId;
}

async function executeRecordAttendance(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = (task.projectId ?? str(task.params.projectId))!;
  const rosterId = str(task.params.rosterId)!;
  // U-18 (BR-288): a worker of another project is not on this one.
  if (await onAnotherProject(task, "roster", rosterId, projectId)) {
    return { success: false, failure: pipelineFailure("RECORD_NOT_FOUND", ["worker"]) };
  }
  const row = await recordAttendance(
    { orgId: task.orgId },
    {
      projectId,
      rosterId,
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

// ── PROJEXA-BUILD-001 U-28: the BOQ writes (BR-406, BR-408) ────────────────
//
// create_boq wraps createBoq() and create_boq_revision wraps
// createBoqRevision(), the same services POST /api/v1/construction/boq and
// POST /api/v1/construction/boq/[id]/revisions call. Both are write function
// ids (WRITE_FUNCTION_IDS), so the dry run only proposes them and a proposal is
// executed by confirmSubmission() for the person who confirms (PMD-05); a
// caller that names no person cannot execute them at all (the first rule
// below). Three rules hold for both:
//   - the person the row is recorded under (createdById) is task.actorUserId,
//     the person who confirmed -- never task.userId, which is the org API key's
//     id on the PROJEXA proxy. The two routes refuse a key call that names no
//     person (U-20b); these executors refuse it the same way
//     executeRecordTimesheet does, before anything is read or written;
//   - the line items reach the service as the caller sent them, and the
//     service's own rules (validateBoqBodyShape, validateLineItemInputs) decide
//     whether they are acceptable -- one validation path, not a second one here.
//     A block the service cannot even read as a list is refused with the same
//     REQUEST_REJECTED shape the service's own 400 produces;
//   - the result carries no project-side cost field (redactProjectSideFields,
//     the cost-visibility gate's own redaction), whatever the caller's role: it
//     is written to pipeline_tasks.result and shown on the task receipt.
//
// The read of the same record type (get_boq_line_items, BR-407) is
// executeGetBoqLineItems below; nothing in these two executors changed for it.

/** lineItems as createBoq/createBoqRevision read it: absent (undefined), or a list of objects. */
function lineItemsParam(task: ExecutableTask): { ok: true; items: BoqLineItemInput[] | undefined } | { ok: false; failure: PipelineFailure } {
  const raw = task.params.lineItems;
  if (raw === undefined || raw === null) return { ok: true, items: undefined };
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    // A string, a single object or a list of scalars would reach the service's
    // items.forEach() and come back as a TypeError (INTERNAL_ERROR). It is a
    // malformed request, so it gets the shape the service's own 400 gets.
    return { ok: false, failure: pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId }) };
  }
  return { ok: true, items: raw as BoqLineItemInput[] };
}

function unidentifiedActor(): ExecutionOutcome {
  return { success: false, failure: pipelineFailure("NOT_PERMITTED", [], { reason: "unidentified_actor" }) };
}

async function executeCreateBoq(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  // The BOQ is created on the task's own project. A params.projectId naming a
  // different one is refused rather than silently dropped: run-submission.ts
  // sets task.projectId from the validated params, so the two only differ when
  // a caller asked for a project this task does not act on.
  const named = str(task.params.projectId);
  if (task.projectId && named && named !== task.projectId) {
    return { success: false, failure: pipelineFailure("PROJECT_NOT_REACHABLE", ["projectId"]) };
  }
  const projectId = (task.projectId ?? named)!;
  const actorId = task.actorUserId;
  if (!actorId) return unidentifiedActor();
  const lineItems = lineItemsParam(task);
  if (!lineItems.ok) return { success: false, failure: lineItems.failure };
  // "line_items" / "items" in place of lineItems would otherwise make a
  // header-only BOQ and report success. Throws the service's own 400.
  validateBoqBodyShape(task.params);
  // createBoq() looks the project up by id AND org (task.orgId), so a project
  // of another org is its own 404 -> RECORD_NOT_FOUND, with nothing written.
  const row = await createBoq(
    { orgId: task.orgId, userId: actorId },
    { projectId, title: str(task.params.title)!, lineItems: lineItems.items ?? [] }
  );
  return created(row.id, `/scope/${row.id}`, redactProjectSideFields(row));
}

async function executeCreateBoqRevision(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = (task.projectId ?? str(task.params.projectId))!;
  const boqId = str(task.params.boqId)!;
  const actorId = task.actorUserId;
  if (!actorId) return unidentifiedActor();
  const lineItems = lineItemsParam(task);
  if (!lineItems.ok) return { success: false, failure: lineItems.failure };
  // Without it a misspelled key reads as "no lineItems", which createBoqRevision
  // treats as "copy every parent line forward": a revision that ignored what
  // the caller sent and still reported success.
  validateBoqBodyShape(task.params);
  // U-18 (BR-288): only a BOQ of this task's own project is revised.
  if (await onAnotherProject(task, "boq", boqId, projectId)) {
    return { success: false, failure: pipelineFailure("RECORD_NOT_FOUND", ["boqVersion"]) };
  }
  // U-28: and only a change order of this project is linked to the revision.
  // Refused with the same failure the service's own "Change order not found"
  // 404 produces, so another project's change order reads as absent.
  const sourceChangeOrderId = str(task.params.sourceChangeOrderId);
  if (sourceChangeOrderId && (await onAnotherProject(task, "change_order", sourceChangeOrderId, projectId))) {
    return { success: false, failure: pipelineFailure("RECORD_NOT_FOUND", [], { status: 404, functionId: task.functionId }) };
  }
  // U-28 (BR-408): this used to forward the title only, so a revision posted
  // through the pipeline always copied the parent's lines forward unchanged,
  // could never pass the scope-reduction override, and never recorded the
  // change order it came from (R-98).
  const row = await createBoqRevision({ orgId: task.orgId, userId: actorId }, boqId, {
    title: str(task.params.title),
    // undefined (not sent) keeps the service's copy-forward default; an
    // explicit [] is a deliberate empty revision, exactly as on the route.
    lineItems: lineItems.items,
    // Only a real boolean true overrides: the block exists to stop completed
    // work being descoped, so a string "true" from a model does not lift it.
    allowScopeReductionOverride: task.params.allowScopeReductionOverride === true,
    sourceChangeOrderId,
  });
  return created(row.id, `/scope/${row.id}`, redactProjectSideFields(row));
}

// ── PROJEXA-BUILD-001 U-28 part 2: the BOQ line-item read (BR-407) ─────────
//
// get_boq_line_items is a READ (a readSpec() row in function-registry.ts, so
// never in WRITE_FUNCTION_IDS). It pages one BOQ of the task's own project
// through the U-27 keyset reader, via getProjectBoqLinePage(), which opens ONE
// transaction per call and holds no other open (D-06):
//   - at most GET_BOQ_LINE_ITEMS_MAX_LIMIT lines per call, whatever `limit`
//     asks; `nextCursor` (the opaque U-27 cursor) fetches the next page and is
//     null on the last one;
//   - the BOQ is params.boqId, else the one the cursor points into, else the
//     project's current BOQ (resolveCurrentBoq()). A boqId that is not a BOQ of
//     this project reads as absent: RECORD_NOT_FOUND, the failure a revision of
//     another project's BOQ gets. A cursor that does not decode, or points
//     outside the project, is REQUEST_REJECTED 400. Neither reads a line;
//   - the result carries no project-side cost field, whatever the caller's
//     role (redactProjectSideFields, as the two BOQ writes above);
//   - BUILD001_BOQ_KEYSET_PAGINATION is not read: it decides the response
//     shape of the two v1 routes, and this read always pages.
const GET_BOQ_LINE_ITEMS_MAX_LIMIT = 50;

/** params.limit: absent is the cap; a whole number from 1 up is capped at 50; anything else is null (refused). */
function boqLineItemsLimit(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return GET_BOQ_LINE_ITEMS_MAX_LIMIT;
  const asked = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(asked) || asked < 1) return null;
  return Math.min(asked, GET_BOQ_LINE_ITEMS_MAX_LIMIT);
}

async function executeGetBoqLineItems(task: ExecutableTask): Promise<ExecutionOutcome> {
  // The same project rule as executeCreateBoq: the task's own project, and a
  // params.projectId naming another one is refused rather than dropped.
  const named = str(task.params.projectId);
  if (task.projectId && named && named !== task.projectId) {
    return { success: false, failure: pipelineFailure("PROJECT_NOT_REACHABLE", ["projectId"]) };
  }
  const projectId = task.projectId ?? named ?? null;
  if (!projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };

  // A malformed request gets the shape the service's own 400 gets (below).
  const rejected: ExecutionOutcome = {
    success: false,
    failure: pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId }),
  };
  const limit = boqLineItemsLimit(task.params.limit);
  if (limit === null) return rejected;
  const { cursor, boqId } = task.params;
  if (cursor !== undefined && cursor !== null && typeof cursor !== "string") return rejected;
  if (boqId !== undefined && boqId !== null && typeof boqId !== "string") return rejected;

  // A cursor the service cannot use throws its own ServiceError(400), which
  // executeTask turns into the same REQUEST_REJECTED shape as `rejected`.
  const page = await getProjectBoqLinePage({ orgId: task.orgId }, projectId, { boqId: str(boqId), cursor, limit });
  if (!page) return { success: false, failure: pipelineFailure("RECORD_NOT_FOUND", ["boqVersion"]) };
  return {
    success: true,
    result: redactProjectSideFields({ boqId: page.boqId, lineItems: page.lineItems, nextCursor: page.nextCursor }),
  };
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

// R67 C-03 -- THE TIMESHEET WRITE.
//
// "log 3 hours on joinery shop drawings today" is the sentence Design
// Studio's own users type, and it had nowhere to land. PROJEXA's real screen
// (/schedule/log-time) already posts to the same service this calls --
// pms-time-service.logTime -- so this registers a path to existing, working
// code rather than a second way to write a timesheet.
//
// FIX PASS, decision D-11: re-expressed in lane B's PipelineFailure shape.
// Every hand-written English refusal below became a code from the closed
// vocabulary, which is the whole point of B-01 -- the strings this executor
// used to return ("hours is required", "no task on this project matches ...")
// were exactly the prose D-03 removes from the Task Master pane.
//
// THE TASK SLOT IS FUZZY-MATCHED, AND AMBIGUITY IS A REFUSAL. A person says
// "joinery drawings"; pms_issues holds "#12 Joinery shop drawings". One
// unambiguous match runs; none or several is an honest failure naming what
// was searched, never a guess -- picking the first of three would log real
// hours against the wrong task.
async function executeRecordTimesheet(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return { success: false, failure: missing };
  const projectId = task.projectId ?? str(task.params.projectId) ?? null;
  if (!projectId) return { success: false, failure: pipelineFailure("PROJECT_REQUIRED", ["projectId"]) };

  const hours = num(task.params.hours);
  if (hours === undefined || hours <= 0 || hours > 24) {
    return { success: false, failure: pipelineFailure("HOURS_REQUIRED", ["value"]) };
  }

  // *** ATTRIBUTION IS A PERSON, NEVER AN API KEY. *** See ExecutableTask's
  // actorUserId comment for why falling back to task.userId here would be a
  // real FK bug, not a convenience. NOT_PERMITTED rather than a missing-slot
  // code: there is no field the user can fill in to fix this -- the request
  // has to arrive identified.
  const actorId = task.actorUserId;
  if (!actorId) {
    return { success: false, failure: pipelineFailure("NOT_PERMITTED", [], { reason: "unidentified_actor" }) };
  }

  const resolved = await withTenantContext({ orgId: task.orgId }, async (db) => {
    const actor = await db.query.users.findFirst({
      where: and(eq(users.id, actorId), eq(users.orgId, task.orgId)),
    });
    if (!actor || !actor.isActive) {
      return { ok: false as const, failure: pipelineFailure("NOT_PERMITTED", [], { reason: "unknown_actor" }) };
    }

    const explicitIssueId = str(task.params.issueId);
    if (explicitIssueId) {
      // U-18 (BR-288, audit A-11): the task must be on THIS project -- an
      // issue of another project of the org is not found here, so no hours are
      // logged against it.
      const issue = await db.query.pmsIssues.findFirst({
        where: and(eq(pmsIssues.id, explicitIssueId), eq(pmsIssues.orgId, task.orgId), eq(pmsIssues.projectId, projectId)),
        columns: { id: true, number: true, title: true },
      });
      if (!issue) return { ok: false as const, failure: pipelineFailure("RECORD_NOT_FOUND", ["task"]) };
      return { ok: true as const, actor, issue };
    }

    const wanted = String(task.params.task ?? "").trim();
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.orgId, task.orgId), eq(pmsIssues.projectId, projectId)),
      columns: { id: true, number: true, title: true },
    });
    if (issues.length === 0) {
      return { ok: false as const, failure: pipelineFailure("TASK_REQUIRED", ["task"], { matches: 0 }) };
    }

    const matches = matchIssues(issues, wanted);
    // NONE and SEVERAL are the same answer to the user -- "name the task" --
    // and the same code. `matches` travels as context so the client can say
    // which of the two happened without this repo composing the sentence.
    if (matches.length !== 1) {
      return {
        ok: false as const,
        failure: pipelineFailure("TASK_REQUIRED", ["task"], { task: wanted, matches: matches.length }),
      };
    }
    return { ok: true as const, actor, issue: matches[0] };
  });

  // A DISCRIMINATED union, not an `in` check: both branches of the resolver
  // widen to the same optional-property shape, so `"failure" in resolved`
  // does not narrow.
  if (!resolved.ok) return { success: false, failure: resolved.failure };

  const spentOnParam = str(task.params.spentOn);
  const spentOn =
    spentOnParam && /^\d{4}-\d{2}-\d{2}$/.test(spentOnParam) ? spentOnParam : new Date().toISOString().slice(0, 10);

  const entry = await logTime(
    { orgId: task.orgId, userId: resolved.actor.id, dbUser: resolved.actor },
    {
      issueId: resolved.issue.id,
      hours: hours.toFixed(2),
      spentOn,
      activityType: str(task.params.activityType),
      comments: str(task.params.comments),
    }
  );

  return created(entry.id, `/schedule/timesheet`, { ...entry, issue: resolved.issue });
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

// ── PROJEXA-BUILD-001 U-38 (BR-512, BR-513): THE REMAINING REGISTRY ENTRIES ───
//
// 26 entries, each calling the service function the matching PROJEXA route
// already calls (PROJEXA_BUILD_SPEC section 5). None re-implements a rule of its
// service; what each adds around the call is the same four things the U-28
// entries add:
//   - the project rule: the entry acts on the task's own project, and a
//     params.projectId naming another one is refused (PROJECT_NOT_REACHABLE)
//     instead of dropped;
//   - the person rule (PMD-34): a write whose caller names no person
//     (task.actorUserId) is refused before anything is read or written, and the
//     row is recorded under that person, never under task.userId, which is the
//     org API key's id on the PROJEXA proxy. Every write below is also in
//     WRITE_FUNCTION_IDS, so it is proposed and only executed once a person
//     confirms (PMD-05);
//   - the same-project rule for an id parameter (U-18): a record that exists on
//     ANOTHER project of the org reads as absent;
//   - the money rule (U-01): below manager rank, or with no known role, the
//     cost fields of a result come back null and the result carries
//     financialsRedacted: true. Project-side BOQ cost fields never appear.
//
// Not built, on purpose: any billing-claim write (R-95, held for the owner), so
// billing has list_billing_claims and get_billing_due_queue and nothing else.
//
// create_drawing calls createDrawingRecord() and not createDocumentRecord(): the
// generic writer never supersedes the previous current revision of a Drawing No.
// (trap 1). create_mom calls createVeriMeeting() and not the older
// pms-meeting-service createMeeting() that create_meeting wraps (trap 2).

function ok(result: unknown): ExecutionOutcome {
  return { success: true, result };
}

function refuse(failure: PipelineFailure): ExecutionOutcome {
  return { success: false, failure };
}

/** A record that is absent, or that belongs to another project, reads the same way. */
function notFound(task: ExecutableTask): ExecutionOutcome {
  return refuse(pipelineFailure("RECORD_NOT_FOUND", [], { status: 404, functionId: task.functionId }));
}

/** A request the service would refuse with its own 400, in the shape that 400 gets. */
function badRequest(task: ExecutableTask): ExecutionOutcome {
  return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId }));
}

/** One rule for "manager rank or above": the U-01 rule the dashboard reads already use. */
const atManagerRank = financialsAllowedForRole;

type ProjectPick = { projectId: string | null } | { failure: PipelineFailure };

/** The task's own project. A params.projectId that names another project is refused, not dropped. */
function pickProject(task: ExecutableTask): ProjectPick {
  const named = str(task.params.projectId);
  if (task.projectId && named && named !== task.projectId) {
    return { failure: pipelineFailure("PROJECT_NOT_REACHABLE", ["projectId"]) };
  }
  return { projectId: task.projectId ?? named ?? null };
}

/** A read that needs one project: the registry's own required parameters first, then the project rule. */
async function projectRead(task: ExecutableTask, run: (projectId: string) => Promise<ExecutionOutcome>): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  return run(pick.projectId);
}

/** A write on one project: required parameters, the project rule, then the person rule, in that order. */
async function projectWrite(
  task: ExecutableTask,
  run: (scope: { projectId: string; actorId: string }) => Promise<ExecutionOutcome>
): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (!task.actorUserId) return unidentifiedActor();
  return run({ projectId: pick.projectId, actorId: task.actorUserId });
}

/** A write that needs a person but no project (the project, when named, is still the task's own). */
async function personWrite(
  task: ExecutableTask,
  run: (scope: { projectId: string | null; actorId: string }) => Promise<ExecutionOutcome>
): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!task.actorUserId) return unidentifiedActor();
  return run({ projectId: pick.projectId, actorId: task.actorUserId });
}

/**
 * The cost fields each entry's result can carry, by function id. A field named
 * here is set to null (not removed) for a caller below manager rank. The BOQ
 * line's contract side (rate, amount) is not a cost field: the cost-visibility
 * rules keep it visible to every reader of the BOQ.
 */
const MONEY_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  list_change_orders: new Set(["costImpact"]),
  get_change_order: new Set(["costImpact"]),
  create_change_order: new Set(["costImpact"]),
  update_line_item_budget: new Set([
    "budgetPercentage", "vendorAmount", "materialAmount", "manpowerAmount", "computedBudget",
    "materialCost", "labourCost", "equipmentCost",
  ]),
  get_manpower_cost_report: new Set(["totalCost"]),
  get_designer_timesheet_report: new Set(["actual", "budget", "variance", "overallBudget", "overallActual", "overallVariance"]),
  record_material_receipt: new Set(["unitCost"]),
};

function nullFields(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => nullFields(item, fields));
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, fields.has(key) ? null : nullFields(inner, fields)])
    );
  }
  return value;
}

/** The money rule for one result. A manager's result is returned as it is. */
function withholdMoney(task: ExecutableTask, result: object): object {
  if (atManagerRank(task.role)) return result;
  const fields = MONEY_FIELDS[task.functionId] ?? new Set<string>();
  return { ...(nullFields(result, fields) as object), financialsRedacted: true };
}

/** The same rule for a report table: a column the report declares as currency is null in every row and has no total. */
function withholdCurrencyColumns(table: ReportTable): object {
  const money = new Set(table.columns.filter((column) => column.unit === "currency").map((column) => column.key));
  return {
    ...table,
    rows: table.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, money.has(key) ? null : cell]))),
    totals: table.totals ? Object.fromEntries(Object.entries(table.totals).filter(([key]) => !money.has(key))) : undefined,
    financialsRedacted: true,
  };
}

/** The acting person as an active user of the task's org: the row a service needs as its dbUser. */
async function loadActor(
  task: ExecutableTask,
  personId: string
): Promise<{ actor: typeof users.$inferSelect } | { failure: PipelineFailure }> {
  const actor = await withTenantContext({ orgId: task.orgId }, (db) =>
    db.query.users.findFirst({ where: and(eq(users.id, personId), eq(users.orgId, task.orgId)) })
  );
  if (!actor || !actor.isActive) return { failure: pipelineFailure("NOT_PERMITTED", [], { reason: "unknown_actor" }) };
  return { actor };
}

/** True when the project does not exist in the task's org. Its own transaction, closed before the service opens one (D-06). */
async function projectMissing(task: ExecutableTask, projectId: string): Promise<boolean> {
  const found = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { id: true } })
  );
  return found === undefined;
}

/**
 * U-18's same-project rule for the two id parameters onAnotherProject() does
 * not cover: a BOQ line (through its BOQ) and a material. True only when the
 * record exists on ANOTHER project; a record that does not exist reaches the
 * service and gets its own 404.
 */
async function onAnotherProjectU38(task: ExecutableTask, record: "boq_line" | "material", id: string, projectId: string): Promise<boolean> {
  const owner = await withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    if (record === "material") {
      const material = await db.query.constructionMaterials.findFirst({
        where: and(eq(constructionMaterials.id, id), eq(constructionMaterials.orgId, task.orgId)),
        columns: { projectId: true },
      });
      return material?.projectId;
    }
    const line = await db.query.constructionBoqLineItems.findFirst({
      where: and(eq(constructionBoqLineItems.id, id), eq(constructionBoqLineItems.orgId, task.orgId)),
      columns: { boqId: true },
    });
    if (!line) return undefined;
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.id, line.boqId), eq(constructionBoqs.orgId, task.orgId)),
      columns: { projectId: true },
    });
    return boq?.projectId;
  });
  return owner !== undefined && owner !== projectId;
}

/** A list of non-empty strings from a string or a list, in the order given. */
function textList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

const today = () => new Date().toISOString().slice(0, 10);

// -- change orders (R-97) --

async function executeListChangeOrders(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const changeOrders = await listChangeOrders({ orgId: task.orgId }, projectId, { status: str(task.params.status) });
    return ok(withholdMoney(task, { changeOrders }));
  });
}

async function executeGetChangeOrder(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const row = await getChangeOrder({ orgId: task.orgId }, str(task.params.changeOrderId)!);
    // getChangeOrder() finds by id and org only, so a change order of another
    // project is read here and then refused as absent.
    if (row.projectId !== projectId) return notFound(task);
    return ok(withholdMoney(task, row));
  });
}

async function executeCreateChangeOrder(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // createChangeOrder() does not look the project up, so an id of no project
    // of this org would reach the insert.
    if (await projectMissing(task, projectId)) throw new ServiceError("Project not found", 404);
    const row = await createChangeOrder(
      { orgId: task.orgId, userId: actorId },
      {
        projectId,
        title: str(task.params.title)!,
        description: str(task.params.description),
        reason: str(task.params.reason),
        costImpact: num(task.params.costImpact),
        scheduleImpactDays: num(task.params.scheduleImpactDays),
        trade: str(task.params.trade),
      }
    );
    return created(row.id, `/change-orders/${row.id}`, withholdMoney(task, row));
  });
}

// -- site instructions (R-C14) --

async function executeCreateSiteInstruction(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // The service looks the project up itself; a BOQ named on the instruction is
    // found by id and org only, so it is held to this project here.
    const boqId = str(task.params.boqId);
    if (boqId && (await onAnotherProject(task, "boq", boqId, projectId))) return notFound(task);
    const row = await createSiteInstruction(
      { orgId: task.orgId, userId: actorId },
      {
        projectId,
        issueDate: str(task.params.issueDate)!,
        toContractor: str(task.params.toContractor)!,
        description: str(task.params.description)!,
        drawingRef: str(task.params.drawingRef),
        // The two flags say that the instruction changes cost or time; they are
        // not amounts, so a boolean true is the only value that sets them.
        costImpact: task.params.costImpact === true,
        timeImpact: task.params.timeImpact === true,
        boqId,
      }
    );
    return created(row.id, "/site-instructions", row);
  });
}

// -- reports and analysis (R-33, R-41..R-45, R-52, R-99, R-100, R-C07, R-C11, R-C12) --

// designer-timesheet answers with an org-wide block as well as the project's own
// (see designerTimesheetReport), so it has its own entry below that returns the
// project's part only, and is left out of the named-report entry.
const NAMED_REPORT_SLUGS: ReadonlySet<string> = new Set(Object.keys(REPORT_REGISTRY).filter((slug) => slug !== "designer-timesheet"));
// The [reportName] route refuses this one below manager rank; so does the entry.
const MANAGER_ONLY_REPORTS: ReadonlySet<string> = new Set(["budget-vs-actual"]);
const WEEK_REPORTS: ReadonlySet<string> = new Set(["weekly-project", "certified-payroll"]);

/** The report functions take different optional parameters; this maps the task's params the way the route maps its query string. */
function runReport(task: ExecutableTask, slug: ReportName, projectId: string): Promise<unknown> {
  const ctx = { orgId: task.orgId };
  const p = task.params;
  switch (slug) {
    case "weekly-project":
    case "certified-payroll":
      return REPORT_REGISTRY[slug](ctx, projectId, str(p.weekStart)!);
    case "work-progress":
      return REPORT_REGISTRY[slug](ctx, projectId, { categoryFilter: textList(p.category) });
    case "budget-variance":
      return REPORT_REGISTRY[slug](ctx, projectId, {
        categories: textList(p.category),
        vendorId: str(p.vendorId),
        groupBy: p.groupBy === "category" ? "category" : "scope",
      });
    case "manpower-cost":
      return REPORT_REGISTRY[slug](ctx, projectId, str(p.date), str(p.trade));
    case "manpower-daily-summary":
      return REPORT_REGISTRY[slug](ctx, projectId, str(p.date));
    case "category-boq-amounts":
      return REPORT_REGISTRY[slug](ctx, projectId, { boqId: str(p.boqId) });
    default:
      return (REPORT_REGISTRY[slug] as (c: { orgId: string }, id: string) => Promise<unknown>)(ctx, projectId);
  }
}

async function executeRunNamedReport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const slug = str(task.params.reportSlug)!;
    if (!NAMED_REPORT_SLUGS.has(slug)) return badRequest(task);
    if (MANAGER_ONLY_REPORTS.has(slug) && !atManagerRank(task.role)) {
      return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "manager_rank_required" }));
    }
    if (WEEK_REPORTS.has(slug) && !str(task.params.weekStart)) return refuse(pipelineFailure("DATE_REQUIRED", ["date"]));
    // The same id rule as the other BOQ ids: an explicit BOQ is of this project.
    const boqId = str(task.params.boqId);
    if (slug === "category-boq-amounts" && boqId && (await onAnotherProject(task, "boq", boqId, projectId))) return notFound(task);

    const payload = await runReport(task, slug as ReportName, projectId);
    // The base currency is read after the report, in its own transaction, as the route does.
    const currency = await getBaseCurrency({ orgId: task.orgId }).then((c) => c.baseCurrency?.code ?? null).catch(() => null);
    const table = buildReportTable(slug as ReportName, payload, currency);
    return ok(atManagerRank(task.role) ? table : withholdCurrencyColumns(table));
  });
}

async function executeGetProjectAnalysis(task: ExecutableTask): Promise<ExecutionOutcome> {
  // The route refuses the whole report below manager rank ("the route is
  // refused, not a column hidden"), so the entry does the same.
  if (!atManagerRank(task.role)) return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "manager_rank_required" }));
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (pick.projectId) return ok({ row: await getProjectAnalysis({ orgId: task.orgId }, pick.projectId) });
  const rows = await listOrgAnalysis({ orgId: task.orgId });
  return ok({ rows: sortAnalysisRows(rows, "profitOnGross", "desc") });
}

async function executeGetManpowerCostReport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const p = task.params;
    const report = await manpowerCostReport({ orgId: task.orgId }, projectId, str(p.date), str(p.trade), str(p.dateFrom), str(p.dateTo));
    return ok(withholdMoney(task, report));
  });
}

async function executeGetDesignerTimesheetReport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const report = await designerTimesheetReport(
      { orgId: task.orgId },
      projectId,
      { from: str(task.params.from) ?? null, to: str(task.params.to) ?? null }
    );
    // The org-wide block (every designer and every project of the org) is not
    // returned: a project-scoped tool never carries another project's figures.
    return ok(withholdMoney(task, { period: report.period, projectScoped: report.projectScoped }));
  });
}

// -- line budget (R-C09) --

async function executeUpdateLineItemBudget(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId }) => {
    const lineId = str(task.params.boqLineItemId)!;
    const p = task.params;
    const input = {
      budgetPercentage: num(p.budgetPercentage),
      vendorId: str(p.vendorId),
      vendorAmount: num(p.vendorAmount),
      materialAmount: num(p.materialAmount),
      manpowerAmount: num(p.manpowerAmount),
      category: str(p.category),
    };
    // Nothing to change is a request the caller can fix, not a silent no-op.
    if (Object.values(input).every((v) => v === undefined)) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
    // updateLineItemBudget() finds the line by id and org only.
    if (await onAnotherProjectU38(task, "boq_line", lineId, projectId)) return refuse(pipelineFailure("BOQ_LINE_NOT_FOUND", ["boqLineItemId"]));
    const row = await updateLineItemBudget({ orgId: task.orgId }, lineId, input);
    return created(row.id, "/scope", redactProjectSideFields(withholdMoney(task, row)));
  });
}

// -- schedule and milestones (R-C10, R-94) --

async function executeGetProjectSchedule(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const tasks = await listIssues({ orgId: task.orgId }, projectId, {
      statusId: str(task.params.statusId),
      assigneeId: str(task.params.assigneeId),
    });
    return ok({ tasks });
  });
}

async function executeCreateScheduleTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // The route gives a task the org's default issue type when none is named.
    const typeId = str(task.params.typeId) ?? (await resolveDefaultIssueTypeId({ orgId: task.orgId }));
    if (!typeId) return badRequest(task);
    const boqLineItemId = str(task.params.boqLineItemId);
    if (boqLineItemId && (await onAnotherProjectU38(task, "boq_line", boqLineItemId, projectId))) {
      return refuse(pipelineFailure("BOQ_LINE_NOT_FOUND", ["boqLineItemId"]));
    }
    const input: ScheduleActivityInput = {
      projectId,
      typeId,
      title: str(task.params.title)!,
      description: str(task.params.description),
      priority: str(task.params.priority),
      dueDate: str(task.params.dueDate),
      startDate: str(task.params.startDate),
      durationDays: num(task.params.durationDays),
      predecessorId: str(task.params.predecessorId),
      boqLineItemId,
      assigneeIds: Array.isArray(task.params.assigneeIds) ? textList(task.params.assigneeIds) : undefined,
    };
    // createScheduleActivity() checks the project itself (through createIssue)
    // and holds a predecessor to the same project.
    const row = await createScheduleActivity({ orgId: task.orgId, userId: actorId, dbUser: null }, input);
    return created(String(row.id), "/schedule", row);
  });
}

async function executeListMilestones(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => ok({ milestones: await listMilestones({ orgId: task.orgId }, projectId) }));
}

async function executeCreateMilestone(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    if (await projectMissing(task, projectId)) throw new ServiceError("Project not found", 404);
    const row = await createMilestone({ orgId: task.orgId, userId: actorId, dbUser: null }, projectId, {
      name: str(task.params.title)!,
      description: str(task.params.description),
      targetDate: str(task.params.targetDate),
    });
    return created(row.id, "/milestones", row);
  });
}

async function executeUpdateMilestone(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    const p = task.params;
    const patch: MilestonePatch = {
      ...(str(p.title) !== undefined ? { name: str(p.title) } : {}),
      ...(str(p.description) !== undefined ? { description: str(p.description) } : {}),
      ...(str(p.targetDate) !== undefined ? { targetDate: str(p.targetDate) } : {}),
      // The service checks the value against its own list of statuses.
      ...(str(p.status) !== undefined ? { status: str(p.status) as MilestonePatch["status"] } : {}),
    };
    if (Object.keys(patch).length === 0) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
    // updateMilestone() finds the milestone by id and org only, so the project's
    // own list is read first and the id must be on it.
    const milestoneId = str(p.milestoneId)!;
    const known = await listMilestones({ orgId: task.orgId }, projectId);
    if (!known.some((m) => m.id === milestoneId)) return notFound(task);
    const row = await updateMilestone({ orgId: task.orgId, userId: actorId, dbUser: null }, milestoneId, patch);
    return created(row.id, "/milestones", row);
  });
}

// -- billing claims (R-95): the two reads, and no write --

async function executeListBillingClaims(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => ok({ claims: await listClaims({ orgId: task.orgId }, projectId) }));
}

async function executeGetBillingDueQueue(task: ExecutableTask): Promise<ExecutionOutcome> {
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  return ok({ claims: await listBillingDueQueue({ orgId: task.orgId }, pick.projectId ?? undefined) });
}

// -- drawings and minutes (R-C02, R-C04): the two traps --

async function executeCreateDrawing(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // createDrawingRecord() writes the drawing under the project id it is given
    // and does not look the project up.
    if (await projectMissing(task, projectId)) throw new ServiceError("Project not found", 404);
    const status = str(task.params.status);
    if (status && !(DRAWING_STATUSES as readonly string[]).includes(status)) return badRequest(task);
    // Link-only, as create_document is: a task carries JSON, not the file's bytes.
    // createDrawingRecord() takes the previous 'current' revision of the same
    // Drawing No. on this project to 'superseded' in the same transaction as the
    // insert; createDocumentRecord() would leave both current.
    const row = await createDrawingRecord(
      { orgId: task.orgId, userId: actorId },
      {
        name: str(task.params.name)!,
        category: categoryForKind(str(task.params.kind)),
        projectId,
        discipline: str(task.params.discipline),
        drawingNo: str(task.params.drawingNo),
        rev: str(task.params.rev),
        ...(status ? { status: status as (typeof DRAWING_STATUSES)[number] } : {}),
        externalUrl: str(task.params.externalUrl)!,
      }
    );
    return created(row.id, `/drawings/${row.id}`, row);
  });
}

async function executeCreateMom(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // createVeriMeeting() needs the person as a real user row (its dbUser), and
    // does not look the project up.
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return refuse(loaded.failure);
    if (await projectMissing(task, projectId)) throw new ServiceError("Project not found", 404);
    const p = task.params;
    // createVeriMeeting(), never pms-meeting-service createMeeting(): it is the
    // service the MoM screens, the PDF and the share link read.
    const row = await createVeriMeeting(
      { orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor },
      {
        title: str(p.title)!,
        meetingType: str(p.meetingType),
        scheduledAt: str(p.scheduledAt)!,
        attendees: textList(p.attendees),
        agenda: textList(p.agenda),
        contextEntityType: "project",
        contextEntityId: projectId,
        minutes: str(p.minutes),
        actionItems: Array.isArray(p.actionItems) ? (p.actionItems as { title: string }[]) : undefined,
      }
    );
    return created(row.id, `/moms/${row.id}`, row);
  });
}

// -- material receipts (R-C08) --

/** The id of this project's material with that name (case and edge spaces ignored), when it has one. */
async function materialIdByName(task: ExecutableTask, projectId: string, name: string): Promise<string | undefined> {
  const wanted = name.trim().toLowerCase();
  const rows = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, task.orgId), eq(constructionMaterials.projectId, projectId)),
      columns: { id: true, name: true },
    })
  );
  return rows.find((m) => m.name.trim().toLowerCase() === wanted)?.id;
}

/** True for a YYYY-MM-DD string that names a real calendar day: it must read back unchanged, so "2026-02-30" and "2026-9-22" are not one. */
function isCalendarDay(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** True when this org has a supplier with that id; a supplier of another org reads as absent. */
async function supplierInOrg(task: ExecutableTask, supplierId: string): Promise<boolean> {
  const row = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.erpSuppliers.findFirst({
      where: and(eq(erpSuppliers.orgId, task.orgId), eq(erpSuppliers.id, supplierId)),
      columns: { id: true },
    })
  );
  return row !== undefined;
}

async function executeRecordMaterialReceipt(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    const p = task.params;
    const quantity = num(p.quantity);
    if (quantity === undefined || quantity <= 0) return refuse(pipelineFailure("QUANTITY_REQUIRED", ["value"]));

    // The date and the vendor are checked before anything is written. A new
    // material is committed by createMaterial() in a transaction of its own; a
    // receipt that the service then refused (a date Postgres cannot read) or
    // that would point at no supplier of this org (vendor_id has no foreign key)
    // would leave that material behind with no receipt.
    const dateGiven = p.receivedDate !== undefined && p.receivedDate !== null && !(typeof p.receivedDate === "string" && p.receivedDate.trim() === "");
    const receivedDate = dateGiven ? str(p.receivedDate) : today();
    if (!receivedDate || !isCalendarDay(receivedDate)) return refuse(pipelineFailure("DATE_REQUIRED", ["date"]));
    const vendorId = str(p.vendorId);
    if (vendorId && !(await supplierInOrg(task, vendorId))) return refuse(pipelineFailure("RECORD_NOT_FOUND", ["vendor"]));

    let materialId = str(p.materialId);
    let material: unknown = null;
    if (materialId) {
      // createMaterialReceipt() finds the material by id and org only.
      if (await onAnotherProjectU38(task, "material", materialId, projectId)) return refuse(pipelineFailure("RECORD_NOT_FOUND", ["material"]));
    } else {
      // A material named in words: this project's own material of that name,
      // or a new one when there is none and the caller gave its unit. Another
      // project's material of the same name is not reused. Two calls at the same
      // moment that name a new material can each create one: the table has no
      // unique key on (org, project, name) to stop the second.
      const name = str(p.materialName)!;
      materialId = await materialIdByName(task, projectId, name);
      if (!materialId) {
        const unit = str(p.unit);
        if (!unit) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
        const made = await createMaterial({ orgId: task.orgId }, { projectId, name, unit, spec: str(p.spec), unitCost: num(p.unitCost) });
        materialId = made.id;
        material = made;
      }
    }
    const receipt = await createMaterialReceipt(
      { orgId: task.orgId },
      {
        projectId,
        materialId,
        receivedDate,
        quantity,
        unitCost: num(p.unitCost),
        vendorId,
        reference: str(p.reference),
        notes: str(p.notes),
        createdById: actorId,
      }
    );
    return created(receipt.id, "/materials", withholdMoney(task, { receipt, material }));
  });
}

// -- timesheet approval (R-C12) --

/**
 * The reviewer's decision on one time entry, as the approve and reject routes
 * take it: a manager-rank person, the entry read first (so a missing entry is a
 * 404 and an entry of another project is refused before anything changes), the
 * service's own self-approval rule, then the reviewer's Task Master rows.
 */
async function reviewTimesheet(task: ExecutableTask, decision: "approved" | "rejected"): Promise<ExecutionOutcome> {
  return personWrite(task, async ({ projectId, actorId }) => {
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return refuse(loaded.failure);
    // The person's own row decides, not task.role: an approval is not a read.
    if (!atManagerRank(loaded.actor.role)) return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "manager_rank_required" }));
    const reason = decision === "rejected" ? (str(task.params.rejectionReason) ?? null) : null;
    if (decision === "rejected" && (reason ?? "").length < REJECTION_REASON_MIN_LENGTH) {
      return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
    }
    const entryId = str(task.params.timeEntryId)!;
    const ctx = { orgId: task.orgId, userId: loaded.actor.id };
    const detail = await getTimeEntry({ orgId: task.orgId }, entryId);
    if (projectId && detail.projectId !== projectId) return notFound(task);
    const entry = decision === "approved" ? await approveTimeEntry(ctx, entryId) : await rejectTimeEntry(ctx, entryId, reason ?? undefined);
    const tasks = await recordTimesheetDecisionTasks(ctx, entryId, decision, reason, entry);
    return created(entry.id, "/timesheets", { ...entry, ...tasks });
  });
}

async function executeApproveTimesheet(task: ExecutableTask): Promise<ExecutionOutcome> {
  return reviewTimesheet(task, "approved");
}

async function executeRejectTimesheet(task: ExecutableTask): Promise<ExecutionOutcome> {
  return reviewTimesheet(task, "rejected");
}

// -- institutional memory and sharing (R-C16, R-C15) --

const RECALL_MAX_LIMIT = 10;
const CAPTURE_MAX_CHARS = 50_000;

async function executeRecallPrecedent(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  // A read has no confirming person, so the caller's own id stands in; an API
  // key id is not a user, and a memory scope needs one.
  const loaded = await loadActor(task, task.actorUserId ?? task.userId);
  if ("failure" in loaded) return refuse(loaded.failure);
  const actor = loaded.actor;
  const asked = num(task.params.limit);
  const limit = asked === undefined ? RECALL_MAX_LIMIT : Math.min(RECALL_MAX_LIMIT, Math.max(1, Math.floor(asked)));
  // maxTier "keyword": the exact and full-text tiers read the database only.
  // The vector and graph tiers call an embedding provider, and the AI link makes
  // no server-side model call (U-43).
  const result = await withTenantContext({ orgId: task.orgId, userId: actor.id }, (db) =>
    recallMemory(db, { orgId: task.orgId, userId: actor.id, dbUser: actor }, str(task.params.query)!, {
      limit,
      maxTier: "keyword",
      registryRef: str(task.params.registryRef),
    })
  );
  return ok(result);
}

async function executeCaptureArtifact(task: ExecutableTask): Promise<ExecutionOutcome> {
  return personWrite(task, async ({ projectId, actorId }) => {
    const text = str(task.params.text)!;
    if (text.length > CAPTURE_MAX_CHARS) return badRequest(task);
    if (projectId && (await projectMissing(task, projectId))) throw new ServiceError("Project not found", 404);
    const title = str(task.params.title)!;
    // Text only: a task carries JSON, so the artifact is the note's own text.
    const id = await createSourceObject({
      orgId: task.orgId,
      origin: "inapp",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode(text),
      title,
      linkedEntityType: projectId ? "project" : null,
      linkedEntityId: projectId,
      createdById: actorId,
    });
    return created(id, "/documents", { id, title });
  });
}

async function executeCreateReportShareLink(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    const hours = task.params.expiresInHours === undefined ? undefined : num(task.params.expiresInHours);
    if (task.params.expiresInHours !== undefined && (hours === undefined || hours <= 0)) return badRequest(task);
    // The report type and the reference are checked by the service; the project
    // in the reference is the task's own.
    const link = await createReportShareLink(
      { orgId: task.orgId, userId: actorId },
      {
        reportType: str(task.params.reportType) as Parameters<typeof createReportShareLink>[1]["reportType"],
        reportRef: { projectId, from: str(task.params.from)!, to: str(task.params.to)! },
        expiresInHours: hours,
      }
    );
    // Only the token and its expiry, as the share route answers.
    return created(link.id, "/reports", { token: link.token, expiresAt: link.expiresAt });
  });
}

// -- BOQ import from a stored document (R-70..R-72) --

const IMPORT_MAX_BYTES = 10 * 1024 * 1024; // the import route's own cap
const DOCUMENT_BUCKET = "compliance-documents";

type StoredSheet = { fileName: string; parsed: Awaited<ReturnType<typeof parseBoqSpreadsheet>> };

/** A stored document is on a project when it is filed on it, or carries it in its metadata (D-14). */
function documentOnProject(doc: typeof documents.$inferSelect, projectId: string): boolean {
  const meta = (doc.metadata ?? {}) as { projectId?: unknown };
  return (doc.linkedEntityType === "project" && doc.linkedEntityId === projectId) || meta.projectId === projectId;
}

/**
 * Reads a document stored for this project and parses it with the import
 * route's own parser. Link-only records (an external URL) are refused: the
 * server does not fetch an address a caller supplies.
 */
async function readStoredSheet(task: ExecutableTask, projectId: string): Promise<StoredSheet | ExecutionOutcome> {
  const doc = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.documents.findFirst({ where: and(eq(documents.id, str(task.params.documentId)!), eq(documents.orgId, task.orgId)) })
  );
  if (!doc || !documentOnProject(doc, projectId)) return notFound(task);
  const meta = (doc.metadata ?? {}) as { isExternalLink?: unknown };
  if (meta.isExternalLink === true || (doc.fileSize ?? 0) > IMPORT_MAX_BYTES) return badRequest(task);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).download(doc.fileUrl);
  if (error || !data) throw new ServiceError("Failed to read the document from storage", 500);
  try {
    const parsed = await parseBoqSpreadsheet(Buffer.from(await data.arrayBuffer()), doc.name, doc.fileType ?? "");
    return { fileName: doc.name, parsed };
  } catch (parseError) {
    if (parseError instanceof ServiceError) throw parseError;
    // A file the parser cannot read is a request the caller can fix.
    console.error(`executeTask: "${task.functionId}" could not read the document`, parseError);
    return badRequest(task);
  }
}

function isStoredSheet(value: StoredSheet | ExecutionOutcome): value is StoredSheet {
  return "parsed" in value;
}

async function executePreviewBoqImport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectRead(task, async (projectId) => {
    const sheet = await readStoredSheet(task, projectId);
    if (!isStoredSheet(sheet)) return sheet;
    const { lineItems, warnings, issues, totalRows, mapping, headers } = sheet.parsed;
    const blocking = issues.filter((i) => i.blocking);
    const preview = analyseBoqPreview(lineItems);
    const statusByIndex = new Map(preview.rows.map((r) => [r.index, r]));
    // The import route's own preview, capped at 50 rows: the summary still
    // describes the whole file.
    const rows = toPreviewRows(lineItems).slice(0, 50).map((row, i) => ({
      ...row,
      status: statusByIndex.get(i + 1)?.status ?? "ok",
      messages: statusByIndex.get(i + 1)?.messages ?? [],
    }));
    return ok({
      dryRun: true,
      fileName: sheet.fileName,
      mapping,
      headers,
      rows,
      issues,
      warnings,
      summary: {
        totalRows,
        readyLines: lineItems.length,
        rowsWithErrors: new Set(blocking.map((i) => i.row)).size,
        willImport: preview.willImport,
        totalParsed: preview.totalParsed,
      },
    });
  });
}

async function executeApplyBoqImport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return projectWrite(task, async ({ projectId, actorId }) => {
    // The import route creates a revision when a parent BOQ is named, a new BOQ
    // otherwise. A parent of another project is refused as absent (U-18).
    const parentBoqId = str(task.params.parentBoqId);
    if (parentBoqId && (await onAnotherProject(task, "boq", parentBoqId, projectId))) return notFound(task);
    const sheet = await readStoredSheet(task, projectId);
    if (!isStoredSheet(sheet)) return sheet;
    const { lineItems, warnings, totalRows } = sheet.parsed;
    if (lineItems.length === 0) return badRequest(task);
    const title = str(task.params.title) ?? sheet.fileName.replace(/\.[^.]+$/, "");
    const boq = parentBoqId
      ? await createBoqRevision({ orgId: task.orgId, userId: actorId }, parentBoqId, { title, lineItems })
      : await createBoq({ orgId: task.orgId, userId: actorId }, { projectId, title, lineItems });
    // Root lines only, as the route sums it: a sub-task's amount is a share of its parent's.
    const totalValue =
      Math.round(lineItems.filter((l) => !l.parentItemCode).reduce((sum, l) => sum + l.quantity * l.rate, 0) * 100) / 100;
    return created(boq.id, `/scope/${boq.id}`, redactProjectSideFields({ boq, importSummary: { totalRows, importedLineItems: lineItems.length, totalValue, warnings } }));
  });
}

const EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  record_work_progress: executeRecordWorkProgress,
  // R67 C-03: the timesheet write, wrapping pms-time-service.logTime.
  record_timesheet: executeRecordTimesheet,
  record_attendance: executeRecordAttendance,
  add_roster_entry: executeAddRosterEntry,
  create_meeting: executeCreateMeeting,
  // PROJEXA-BUILD-001 U-28 (BR-406): a new BOQ with its line items.
  create_boq: executeCreateBoq,
  create_boq_revision: executeCreateBoqRevision,
  create_document: executeCreateDocument,
  get_construction_project_dashboard: executeGetProjectDashboard,
  // PROJEXA-BUILD-001 U-28 part 2 (BR-407): a BOQ's line items, one page at a time.
  get_boq_line_items: executeGetBoqLineItems,
  ...Object.fromEntries(READ_ONLY_DISPATCH_FUNCTION_IDS.map((ref) => [ref, makeDispatchExecutor(ref)])),
  ...Object.fromEntries(Object.entries(READ_ONLY_ALIASES).map(([id, ref]) => [id, makeDispatchExecutor(ref)])),
  ...Object.fromEntries(READ_ONLY_ORG_SCOPED_FUNCTION_IDS.map((ref) => [ref, makeOrgScopedExecutor(ref)])),
  // PROJEXA-BUILD-001 U-38 (BR-512, BR-513): the remaining registry entries.
  list_change_orders: executeListChangeOrders,
  get_change_order: executeGetChangeOrder,
  create_change_order: executeCreateChangeOrder,
  create_site_instruction: executeCreateSiteInstruction,
  run_named_report: executeRunNamedReport,
  get_project_analysis: executeGetProjectAnalysis,
  get_manpower_cost_report: executeGetManpowerCostReport,
  get_designer_timesheet_report: executeGetDesignerTimesheetReport,
  update_line_item_budget: executeUpdateLineItemBudget,
  get_project_schedule: executeGetProjectSchedule,
  create_schedule_task: executeCreateScheduleTask,
  list_milestones: executeListMilestones,
  create_milestone: executeCreateMilestone,
  update_milestone: executeUpdateMilestone,
  list_billing_claims: executeListBillingClaims,
  get_billing_due_queue: executeGetBillingDueQueue,
  create_drawing: executeCreateDrawing,
  create_mom: executeCreateMom,
  record_material_receipt: executeRecordMaterialReceipt,
  approve_timesheet: executeApproveTimesheet,
  reject_timesheet: executeRejectTimesheet,
  recall_precedent: executeRecallPrecedent,
  capture_artifact: executeCaptureArtifact,
  create_report_share_link: executeCreateReportShareLink,
  preview_boq_import: executePreviewBoqImport,
  apply_boq_import: executeApplyBoqImport,
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
    // R67 FIX PASS -- A SERVICE'S 4xx IS NOT AN INTERNAL ERROR.
    //
    // normaliseThrownError() only recognises TRANSPORT shapes, so before this
    // branch every expected business condition a service raises collapsed to
    // INTERNAL_ERROR and the client rendered "Something went wrong on our
    // side -- nothing was saved [Retry]". That is wrong twice over for four
    // of the five writes B-04 registered: it blames us for the user's
    // request, and it offers a Retry for a duplicate ("Attendance already
    // recorded for this worker on this date", 409) that can never succeed.
    // ServiceError carries the status the service deliberately chose, so
    // branch on it FIRST -- which also removes normaliseThrownError's
    // \b5\d\d\b false positive for an ordinary business message that happens
    // to contain a three-digit number ("line 512 not found").
    //
    // >=500 deliberately falls through: a service that raises a 5xx is
    // reporting a system failure, which belongs with the transport shapes.
    if (error instanceof ServiceError && error.status < 500) {
      console.error(`executeTask: "${task.functionId}" refused with ${error.status}`, error.message);
      return {
        success: false,
        // functionId is carried for the CLIENT'S BRANCHING, never for its
        // wording: "already recorded" means something different for
        // attendance than for a BOQ revision, and projexa's dictionary picks
        // the true sentence from it without ever printing it.
        failure: pipelineFailure(codeForServiceError(error.status), [], { status: error.status, functionId: task.functionId }),
        debug: `${error.name}(${error.status}): ${error.message}`,
      };
    }
    console.error(`executeTask: unexpected error running "${task.functionId}"`, error);
    const { failure, debug } = normaliseThrownError(error);
    return { success: false, failure, debug };
  }
}
