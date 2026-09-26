// R67 lane B (B-01 / B-02 / B-03 / B-04) -- THE DECLARATIVE FACTS ABOUT
// EACH FUNCTION THE PIPELINE CAN RUN.
//
// executor.ts already owns "how do I run this"; this file owns everything a
// caller needs to know BEFORE running it:
//   - the human label ("Record progress"), so no surface ever prints
//     "Record record_work_progress" or a bare function id;
//   - whether it WRITES (classify.ts's TASK/CHAT split reads this through
//     executor.ts's functionWrites());
//   - whether it needs a project (B-02: so validate() can fall back to the
//     submission's own projectId instead of blocking);
//   - its required parameters AND the closed-vocabulary code each missing
//     one produces (B-04: so validate() rejects before a service throws
//     "attendanceDate is required" as prose);
//   - its card schema, so the client renders a confirmation card from the
//     server's own field list rather than hard-coding field names.
//
// PURE DATA. No DB, no imports beyond the code vocabulary, so it can be read
// from validate.ts (pure), executor.ts (DB-backed) and chain-options-service
// .ts without a cycle.
import type { PipelineErrorCode } from "./error-codes";

export type CardFieldType = "text" | "number" | "percent" | "date" | "select" | "file" | "time";

export type CardField = {
  key: string;
  label: string;
  type: CardFieldType;
  unit?: string;
  required: boolean;
  default?: string | number;
  /** which chain-options picker fills this field, when it is a pick not a type */
  picker?: string;
};

export type CardFact = { label: string; value: string; editable: boolean };

export type CardSchema = {
  fields: CardField[];
  facts?: CardFact[];
  attachments?: boolean;
  /** The exact words on the confirm button. Never "Submit". */
  primaryLabel: string;
};

export type RequiredParam = {
  name: string;
  /** the label the client shows when this one is what's missing */
  label: string;
  code: PipelineErrorCode;
  /**
   * R67 B-09/B-10 -- the D-03 VOCABULARY KEY this parameter answers to
   * (project | boqLine | value | worker | material | task | date |
   * boqVersion). `missing` reports this, not the parameter name, so the one
   * rule the whole programme states -- "the client never sees a camelCase
   * parameter name" -- holds even for a client that renders `missing`
   * directly instead of going through its dictionary. Absent means the
   * parameter's own name is already vocabulary enough.
   */
  field?: string;
  /**
   * R67 B-07 -- OTHER PARAMETERS THAT ANSWER THE SAME QUESTION.
   *
   * The classifier extracts a human item CODE out of what the user typed
   * ("EX-01"), but the verdict offers the project's real BOQ lines as chips,
   * so what comes back on confirm is a line item ID. Both are "the BOQ line",
   * and executeRecordWorkProgress resolves either against this project's own
   * BOQ. Without this, a user who picked the chip the server itself offered
   * would be asked for the BOQ line again, for ever.
   */
  alsoSatisfiedBy?: string[];
};

/** B-05: the verb family, which decides what a submission's answer looks like. */
export type FunctionKind = "write" | "ask" | "run";

export type FunctionSpec = {
  functionId: string;
  /** Human label. THE ONLY name any user-facing surface may print. */
  label: string;
  /** The module this function belongs to -- chain-options' first level. */
  module: string;
  kind: FunctionKind;
  writes: boolean;
  requiresProject: boolean;
  requiredParams: RequiredParam[];
  /**
   * BUILD-002 WP-03/WP-04 -- parameters the function accepts that are neither
   * required nor a card field: a list (`lineItems`, `lines`), an id that is
   * only sometimes needed (`sourceChangeOrderId`, `clientId`), a retry key.
   * A card field has no list type, and the AI work link only accepts the
   * parameter names the registry declares, so before this list a list-valued
   * parameter that the executor read was dropped on the link (GAP_A 0.5).
   * scripts/gen-ai-link-registry.ts adds these names to `declared_params`.
   */
  optionalParams?: readonly string[];
  card?: CardSchema;
  /**
   * Only for kind "run" (a COMMAND verb: Run / Export / Share). A command
   * does not execute anything server-side -- it opens the screen that already
   * does the thing, with its parameters attached.
   */
  route?: string;
};

function readSpec(functionId: string, label: string, module: string, requiresProject: boolean): FunctionSpec {
  return { functionId, label, module, kind: "ask", writes: false, requiresProject, requiredParams: [] };
}

/**
 * A read that takes optional parameters (BUILD-002 WP-05a): a filter, a date, a page cursor, an id. readSpec() declares none, and
 * the AI work link only accepts the names the registry declares (execute-read.ts, scripts/gen-ai-link-registry.ts), so before
 * this a report's week or trade, or a schedule filter, was dropped on a link (GAP_A 0.5).
 */
function readSpecWith(
  functionId: string,
  label: string,
  module: string,
  requiresProject: boolean,
  optionalParams: readonly string[]
): FunctionSpec {
  return { ...readSpec(functionId, label, module, requiresProject), optionalParams };
}

/** A read that cannot answer without one named record or value (U-38). */
function readSpecNeeding(
  functionId: string,
  label: string,
  module: string,
  requiresProject: boolean,
  requiredParams: RequiredParam[]
): FunctionSpec {
  return { ...readSpec(functionId, label, module, requiresProject), requiredParams };
}

const SPEC_LIST: readonly FunctionSpec[] = [
  // ---- the one write the pipeline has always had -----------------------
  {
    functionId: "record_work_progress",
    label: "Record progress",
    module: "work_progress",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "itemCode", label: "BOQ line", code: "BOQ_LINE_REQUIRED", field: "boqLine", alsoSatisfiedBy: ["boqLineItemId"] },
      // R67 B-11: a QUANTITY in the line's own unit answers "how much is
      // done" exactly as well as a percent does -- "record 2 nos done today"
      // is how the work is actually described on site, and it is the value
      // chip chain-options offers beside "40 %". executeRecordWorkProgress
      // converts it against the line's own total quantity, so both spellings
      // reach the same column.
      { name: "percent", label: "Percent complete", code: "VALUE_REQUIRED", alsoSatisfiedBy: ["quantityDone"] },
    ],
    card: {
      fields: [
        { key: "itemCode", label: "BOQ line", type: "select", required: true, picker: "boq-line" },
        { key: "percent", label: "Percent complete", type: "percent", unit: "%", required: true },
        { key: "entryDate", label: "Date", type: "date", required: false },
        { key: "remarks", label: "Remarks", type: "text", required: false },
      ],
      primaryLabel: "Save progress",
    },
  },

  // ---- R67 B-04: Sumeet's daily writes -----------------------------------
  // Each one wraps the SAME service function PROJEXA's own create route
  // already calls. No new SQL, no second write path, no duplicated
  // validation -- the only new thing is that the composer can now reach them.
  {
    functionId: "record_attendance",
    label: "Mark attendance",
    module: "manpower",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "rosterId", label: "Worker", code: "WORKER_REQUIRED" },
      { name: "date", label: "Date", code: "DATE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "rosterId", label: "Worker", type: "select", required: true, picker: "worker" },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "status", label: "Status", type: "select", required: false, default: "present" },
        { key: "hours", label: "Hours worked", type: "number", unit: "h", required: false },
      ],
      primaryLabel: "Save attendance",
    },
  },
  {
    functionId: "add_roster_entry",
    label: "Add a worker",
    module: "manpower",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "WORKER_REQUIRED" },
      { name: "dailyRate", label: "Daily rate", code: "VALUE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "dailyRate", label: "Daily rate", type: "number", required: true },
        { key: "trade", label: "Trade", type: "text", required: false },
        { key: "employeeCode", label: "ID", type: "text", required: false },
      ],
      primaryLabel: "Save worker",
    },
  },
  {
    functionId: "create_meeting",
    label: "New meeting",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
      { name: "scheduledAt", label: "Date and time", code: "DATE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "scheduledAt", label: "Date and time", type: "date", required: true },
        { key: "durationMinutes", label: "Duration", type: "number", unit: "min", required: false },
      ],
      primaryLabel: "Save meeting",
    },
  },
  // PROJEXA-BUILD-001 U-28 (BR-406): a new BOQ, wrapping createBoq() -- the
  // service POST /api/v1/construction/boq calls. lineItems is a list and is
  // deliberately not a required parameter: R-03 lets a BOQ be created with a
  // title and no lines, and the service is the one place that decides whether
  // each line is acceptable (validateLineItemInputs). A card field has no list
  // type, so the card shows the title and the lines travel in params.
  {
    functionId: "create_boq",
    label: "New BOQ",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
    ],
    // BUILD-002 WP-04: lineItems is declared so a link keeps it (a title-only BOQ is still
    // allowed, R-03). idempotency_key makes a retry of the same call one BOQ, not two; the
    // link makes it mandatory (gen-ai-link-registry.data.ts), the internal pipeline does not
    // need one because its own submission ledger already dedupes a confirm.
    optionalParams: ["lineItems", "idempotency_key"],
    card: {
      fields: [{ key: "title", label: "Title", type: "text", required: true }],
      primaryLabel: "Save BOQ",
    },
  },
  // U-28 (BR-408): lineItems, allowScopeReductionOverride and
  // sourceChangeOrderId are optional and now reach createBoqRevision() (see
  // executeCreateBoqRevision); without lineItems the parent's lines are copied.
  {
    functionId: "create_boq_revision",
    label: "New BOQ revision",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED" },
    ],
    // BUILD-002 WP-04: the three optional parameters executeCreateBoqRevision already forwards
    // (BR-408) are declared, so a link keeps them instead of dropping them.
    optionalParams: ["lineItems", "sourceChangeOrderId", "allowScopeReductionOverride"],
    card: {
      fields: [
        { key: "boqId", label: "From version", type: "select", required: true, picker: "boq-version" },
        { key: "title", label: "Title", type: "text", required: false },
      ],
      primaryLabel: "Save revision",
    },
  },
  {
    functionId: "create_document",
    label: "Add a document link",
    module: "documents",
    kind: "write",
    writes: true,
    // A document record is org-scoped; a project link is optional metadata.
    requiresProject: false,
    requiredParams: [
      { name: "name", label: "Name", code: "TITLE_REQUIRED" },
      { name: "category", label: "Category", code: "CATEGORY_REQUIRED" },
      { name: "externalUrl", label: "Link", code: "LINK_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "category", label: "Category", type: "text", required: true },
        { key: "externalUrl", label: "Link", type: "text", required: true },
        { key: "expiryDate", label: "Expires", type: "date", required: false },
      ],
      primaryLabel: "Save document",
    },
  },

  // ---- R67 C-03: the timesheet write -------------------------------------
  //
  // FIX PASS, decision D-11: lane C declared these same facts in its own
  // src/lib/pipeline/function-slots.ts, written before lane B's registry
  // existed. Two competing declarations of "what a write cannot run without"
  // is exactly the drift D-03 exists to remove, so function-slots.ts is
  // deleted and its one function that main did not carry -- record_timesheet
  // -- is folded in here, in the registry's own vocabulary.
  //
  // `task` is what a person says ("joinery shop drawings"); `issueId` is what
  // the composer has once a chip has been picked. Either satisfies the slot,
  // which is why executeRecordTimesheet fuzzy-matches the words against THIS
  // PROJECT's own issue titles and refuses an ambiguous match rather than
  // guessing between two tasks.
  {
    functionId: "record_timesheet",
    label: "Log time",
    module: "schedule",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "task", label: "Task", code: "TASK_REQUIRED", field: "task", alsoSatisfiedBy: ["issueId"] },
      { name: "hours", label: "Hours", code: "HOURS_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "task", label: "Task", type: "select", required: true, picker: "task" },
        { key: "hours", label: "Hours", type: "number", unit: "h", required: true },
        { key: "spentOn", label: "Date", type: "date", required: false },
        { key: "activityType", label: "Category", type: "text", required: false },
      ],
      primaryLabel: "Save time log",
    },
  },

  // ---- COMMAND verbs: they open a screen, they do not execute ----------
  {
    functionId: "run_work_progress_report",
    label: "Run the Work Progress Report",
    module: "reports",
    kind: "run",
    writes: false,
    requiresProject: true,
    requiredParams: [{ name: "projectId", label: "Project", code: "PROJECT_REQUIRED" }],
    // D-02: ONE Work Progress Report, at /work-progress?tab=report, with its
    // parameters in the URL so it runs on arrival.
    route: "/work-progress?tab=report",
  },

  // ---- project-scoped reads --------------------------------------------
  readSpec("get_construction_project_dashboard", "View project dashboard", "dashboard", true),
  // PROJEXA-BUILD-001 U-28 part 2 (BR-407): one page (at most 50) of one BOQ's
  // line items, through the U-27 keyset reader. A READ, so never in
  // WRITE_FUNCTION_IDS. boqId, cursor and limit are all optional (no boqId is
  // the project's current BOQ), so it declares no required parameter. Placed
  // after the dashboard so an unmatched `ask` on the MCP link still offers the
  // dashboard first (candidates keep registry order).
  readSpecWith("get_boq_line_items", "View BOQ line items", "scope", true, ["boqId", "cursor", "limit"]),
  readSpec("get_construction_budget_status", "View budget status", "budget", true),
  // R67 B-02: the catalogue's own id for PROJEXA's Budget card (Sumeet order
  // 9). A READ -- it resolves to the same real backing action the budget pill
  // already uses -- so it is registered here and in the read-only dispatch
  // aliases, never in WRITE_FUNCTION_IDS.
  readSpec("review_budget", "Review Budget", "budget", true),
  readSpec("get_construction_kpi_status", "View KPIs", "reports", true),
  readSpec("generate_construction_progress_summary", "View progress summary", "reports", true),
  readSpec("detect_construction_budget_schedule_risk", "Check budget and schedule risk", "reports", true),

  // ---- org-scoped reads (no project needed) ----------------------------
  readSpec("list_delayed_activities", "View delayed activities", "schedule", false),
  readSpec("list_over_budget_projects", "View over-budget projects", "budget", false),
  readSpec("get_compliance_stats", "View compliance stats", "compliance", false),
  readSpec("get_overdue_items", "View overdue items", "compliance", false),
  readSpec("list_departments", "View departments", "department", false),
  readSpec("list_compliance_items", "View compliance items", "compliance", false),
  readSpec("list_notices", "View notices", "compliance", false),
  readSpec("list_gst_import_batches", "View GST import batches", "compliance", false),
  readSpec("list_gst_returns", "View GST returns", "compliance", false),
  readSpec("list_customers", "View customers", "customers", false),
  readSpec("list_sales_orders", "View sales orders", "sales", false),
  readSpec("list_leads", "View leads", "customers", false),
  readSpec("list_opportunities", "View opportunities", "customers", false),
  readSpec("get_sales_pipeline_overview", "View the sales pipeline", "customers", false),

  // ---- PROJEXA-BUILD-001 U-38 (BR-512, BR-513): the remaining registry entries ----
  //
  // Each entry wraps the service function the matching PROJEXA route already
  // calls (PROJEXA_BUILD_SPEC section 5). Appended after every earlier entry so
  // the order the AI link offers candidates in (registry order on a tie) does
  // not move for a text that matched before.
  //
  // Reads first, then writes. A write is only ever proposed until a person
  // confirms it (PMD-05), and the executor refuses a write whose caller names
  // no person (PMD-34), as the U-28 entries do. There is no billing-claim write
  // here on purpose: R-95 (may an AI write a billing claim) is held for the
  // owner, so billing has the two reads and nothing else.

  // -- change orders (R-97) --
  readSpecWith("list_change_orders", "View change orders", "change_orders", true, ["status"]),
  readSpecNeeding("get_change_order", "View a change order", "change_orders", true, [
    { name: "changeOrderId", label: "Change order", code: "VALUE_REQUIRED", field: "value" },
  ]),
  {
    functionId: "create_change_order",
    label: "New change order",
    module: "change_orders",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "reason", label: "Reason", type: "text", required: false },
        { key: "trade", label: "Trade", type: "text", required: false },
        { key: "costImpact", label: "Cost impact", type: "number", required: false },
        { key: "scheduleImpactDays", label: "Schedule impact", type: "number", unit: "days", required: false },
      ],
      primaryLabel: "Save change order",
    },
  },

  // -- site instructions (R-C14) --
  {
    functionId: "create_site_instruction",
    label: "New site instruction",
    module: "site_instructions",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "issueDate", label: "Issue date", code: "DATE_REQUIRED", field: "date" },
      { name: "toContractor", label: "To contractor", code: "VALUE_REQUIRED", field: "value" },
      { name: "description", label: "Instruction", code: "VALUE_REQUIRED" },
    ],
    // costImpact and timeImpact are yes/no flags (the instruction changes cost or time), not amounts; boqId names the BOQ it varies.
    optionalParams: ["costImpact", "timeImpact", "boqId"],
    card: {
      fields: [
        { key: "issueDate", label: "Issue date", type: "date", required: true },
        { key: "toContractor", label: "To contractor", type: "text", required: true },
        { key: "description", label: "Instruction", type: "text", required: true },
        { key: "drawingRef", label: "Drawing reference", type: "text", required: false },
      ],
      primaryLabel: "Save instruction",
    },
  },

  // -- reports and analysis (R-33, R-41..R-45, R-52, R-99, R-100, R-C07, R-C11, R-C12) --
  {
    ...readSpecNeeding("run_named_report", "View a named report", "reports", true, [
      { name: "reportSlug", label: "Report", code: "VALUE_REQUIRED", field: "value" },
    ]),
    // The filters the [reportName] route reads from its query string (executor.ts runReport maps them the same way).
    optionalParams: ["weekStart", "date", "trade", "category", "groupBy", "vendorId", "boqId"],
  },
  readSpec("get_project_analysis", "View project analysis", "reports", false),
  readSpecWith("get_manpower_cost_report", "View manpower cost", "manpower", true, ["date", "trade", "dateFrom", "dateTo"]),
  readSpecWith("get_designer_timesheet_report", "View designer timesheet report", "timesheets", true, ["from", "to"]),

  // -- line budget (R-C09) --
  {
    functionId: "update_line_item_budget",
    label: "Set a line budget",
    module: "budget",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqLineItemId", label: "BOQ line", code: "BOQ_LINE_REQUIRED", field: "boqLine" },
    ],
    optionalParams: ["vendorId"],
    card: {
      fields: [
        { key: "boqLineItemId", label: "BOQ line", type: "select", required: true, picker: "boq-line" },
        { key: "budgetPercentage", label: "Budget share", type: "percent", unit: "%", required: false },
        { key: "vendorAmount", label: "Vendor amount", type: "number", required: false },
        { key: "materialAmount", label: "Material amount", type: "number", required: false },
        { key: "manpowerAmount", label: "Manpower amount", type: "number", required: false },
        { key: "category", label: "Category", type: "text", required: false },
      ],
      primaryLabel: "Save line budget",
    },
  },

  // -- schedule and milestones (R-C10, R-94) --
  readSpecWith("get_project_schedule", "View the schedule", "schedule", true, ["statusId", "assigneeId"]),
  {
    functionId: "create_schedule_task",
    label: "New schedule task",
    module: "schedule",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
      { name: "startDate", label: "Start date", code: "DATE_REQUIRED", field: "date" },
    ],
    optionalParams: ["priority", "predecessorId", "boqLineItemId", "assigneeIds", "typeId"],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "startDate", label: "Start date", type: "date", required: true },
        { key: "dueDate", label: "Finish date", type: "date", required: false },
        { key: "durationDays", label: "Duration", type: "number", unit: "days", required: false },
        { key: "description", label: "Description", type: "text", required: false },
      ],
      primaryLabel: "Save task",
    },
  },
  readSpec("list_milestones", "View milestones", "milestones", true),
  {
    functionId: "create_milestone",
    label: "New milestone",
    module: "milestones",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "targetDate", label: "Target date", type: "date", required: false },
        { key: "description", label: "Description", type: "text", required: false },
      ],
      primaryLabel: "Save milestone",
    },
  },
  {
    functionId: "update_milestone",
    label: "Update a milestone",
    module: "milestones",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "milestoneId", label: "Milestone", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "milestoneId", label: "Milestone", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: false },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "targetDate", label: "Target date", type: "date", required: false },
        { key: "status", label: "Status", type: "text", required: false },
      ],
      primaryLabel: "Save milestone",
    },
  },

  // -- billing claims (R-95): READ ONLY, no write id is registered --
  readSpec("list_billing_claims", "View billing claims", "billing", true),
  readSpec("get_billing_due_queue", "View the billing due list", "billing", false),

  // -- drawings and minutes (R-C02, R-C04) --
  //
  // create_drawing is its own entry and not create_document with a drawing
  // category: create_document calls createDocumentRecord(), which never
  // supersedes the previous current revision, so a second revision of the same
  // Drawing No. would leave two rows current with no error. create_drawing
  // calls createDrawingRecord(), which supersedes it in the same transaction.
  //
  // create_mom calls createVeriMeeting() (minutes, action items, publish, PDF,
  // share link), not the older pms-meeting-service createMeeting() that
  // create_meeting above wraps.
  {
    functionId: "create_drawing",
    label: "Add a drawing",
    module: "drawings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "TITLE_REQUIRED" },
      { name: "externalUrl", label: "Link", code: "LINK_REQUIRED" },
    ],
    optionalParams: ["kind"],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "externalUrl", label: "Link", type: "text", required: true },
        { key: "drawingNo", label: "Drawing No.", type: "text", required: false },
        { key: "rev", label: "Revision", type: "text", required: false },
        { key: "status", label: "Status", type: "select", required: false, default: "for_approval" },
        { key: "discipline", label: "Discipline", type: "text", required: false },
      ],
      // BUILD-002 WP-05e: the side effect is named on the card the person confirms.
      facts: [{ label: "Effect", value: "A drawing set to current takes over the build set from the previous current revision of the same Drawing No.", editable: false }],
      primaryLabel: "Save drawing",
    },
  },
  {
    functionId: "create_mom",
    label: "New minutes of meeting",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
      { name: "scheduledAt", label: "Date and time", code: "DATE_REQUIRED" },
    ],
    // BUILD-002 WP-05e: what the executor reads besides the card. Lists and an id are not card fields, and the AI link accepts only declared names.
    optionalParams: ["meetingType", "attendees", "agenda", "actionItems"],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "scheduledAt", label: "Date and time", type: "date", required: true },
        { key: "minutes", label: "Minutes", type: "text", required: false },
      ],
      facts: [{ label: "Effect", value: "Each action item with an owner becomes a task for that person.", editable: false }],
      primaryLabel: "Save minutes",
    },
  },

  // -- material receipts (R-C08) --
  {
    functionId: "record_material_receipt",
    label: "Record a material receipt",
    module: "materials",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "materialId", label: "Material", code: "MATERIAL_REQUIRED", field: "material", alsoSatisfiedBy: ["materialName"] },
      { name: "quantity", label: "Quantity", code: "QUANTITY_REQUIRED", field: "value" },
    ],
    // BUILD-002 WP-05e: `unit` and `spec` let a receipt name a new material, `notes` is free text. vendorId is left out on purpose: a supplier is an
    // organisation record, not a project record, so a link cannot name one (the internal pipeline still can).
    optionalParams: ["unit", "spec", "notes"],
    card: {
      fields: [
        { key: "materialId", label: "Material", type: "select", required: true, picker: "material" },
        { key: "quantity", label: "Quantity", type: "number", required: true },
        { key: "receivedDate", label: "Date", type: "date", required: false },
        { key: "unitCost", label: "Unit cost", type: "number", required: false },
        { key: "reference", label: "Reference", type: "text", required: false },
      ],
      facts: [{ label: "Effect", value: "A material named in words that the project does not have yet is created with this receipt.", editable: false }],
      primaryLabel: "Save receipt",
    },
  },

  // -- timesheet approval (R-C12) --
  {
    functionId: "approve_timesheet",
    label: "Approve a timesheet entry",
    module: "timesheets",
    kind: "write",
    writes: true,
    requiresProject: false,
    requiredParams: [{ name: "timeEntryId", label: "Time entry", code: "VALUE_REQUIRED", field: "value" }],
    card: {
      fields: [{ key: "timeEntryId", label: "Time entry", type: "text", required: true }],
      facts: [{ label: "Effect", value: "The entry is approved and your review task for it is closed.", editable: false }],
      primaryLabel: "Approve entry",
    },
  },
  {
    functionId: "reject_timesheet",
    label: "Return a timesheet entry",
    module: "timesheets",
    kind: "write",
    writes: true,
    requiresProject: false,
    requiredParams: [
      { name: "timeEntryId", label: "Time entry", code: "VALUE_REQUIRED", field: "value" },
      { name: "rejectionReason", label: "Reason", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "timeEntryId", label: "Time entry", type: "text", required: true },
        { key: "rejectionReason", label: "Reason", type: "text", required: true },
      ],
      facts: [{ label: "Effect", value: "The entry goes back to its author, who gets a task to correct it.", editable: false }],
      primaryLabel: "Return entry",
    },
  },

  // -- institutional memory and sharing (R-C16, R-C15) --
  readSpecNeeding("recall_precedent", "Recall a precedent", "memory", false, [
    { name: "query", label: "What to recall", code: "VALUE_REQUIRED" },
  ]),
  {
    functionId: "capture_artifact",
    label: "Save a note",
    module: "memory",
    kind: "write",
    writes: true,
    requiresProject: false,
    requiredParams: [
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
      { name: "text", label: "Text", code: "VALUE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "text", label: "Text", type: "text", required: true },
      ],
      primaryLabel: "Save note",
    },
  },
  {
    functionId: "create_report_share_link",
    label: "Share a report",
    module: "reports",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "reportType", label: "Report", code: "VALUE_REQUIRED", field: "value" },
      { name: "from", label: "From", code: "DATE_REQUIRED", field: "date" },
      { name: "to", label: "To", code: "DATE_REQUIRED", field: "date" },
    ],
    card: {
      fields: [
        { key: "reportType", label: "Report", type: "text", required: true },
        { key: "from", label: "From", type: "date", required: true },
        { key: "to", label: "To", type: "date", required: true },
        { key: "expiresInHours", label: "Link lasts", type: "number", unit: "h", required: false },
      ],
      primaryLabel: "Create link",
    },
  },

  // -- BOQ import from a stored document (R-70..R-72) --
  //
  // Link-based, not bytes: a task carries JSON, so the sheet is named by the id
  // of a document already stored for this project (uploaded on Documents). The
  // preview is a read; the import is a write and goes through the same
  // createBoq() / createBoqRevision() the import route calls.
  readSpecNeeding("preview_boq_import", "Preview a BOQ import", "scope", true, [
    { name: "documentId", label: "Document", code: "VALUE_REQUIRED", field: "value" },
  ]),
  {
    functionId: "apply_boq_import",
    label: "Import a BOQ",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "documentId", label: "Document", code: "VALUE_REQUIRED", field: "value" },
    ],
    // parentBoqId makes the import a revision of that BOQ (executor.ts executeApplyBoqImport), not a new BOQ.
    optionalParams: ["parentBoqId"],
    card: {
      fields: [
        { key: "documentId", label: "Document", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: false },
      ],
      primaryLabel: "Import BOQ",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-03: a project an AI can create and rename ---------------------
  //
  // create_project wraps createProject(), the service POST /api/v1/projexa/projects calls, and
  // update_project wraps updateProjectDetails() next to updateProjectValue(). Neither is a read.
  // create_project needs no project (it makes one) and is on no link: a link is bound to one
  // project. With `shell: true` and no name it creates the placeholder project the "New project
  // with my AI" flow hands to an AI (src/lib/project-shell.ts).
  {
    functionId: "create_project",
    label: "New project",
    module: "projects",
    kind: "write",
    writes: true,
    requiresProject: false,
    // A project needs a name, or `shell: true` (the placeholder name): either answers the requirement.
    requiredParams: [{ name: "name", label: "Name", code: "TITLE_REQUIRED", alsoSatisfiedBy: ["shell"] }],
    optionalParams: ["shell", "productId", "clientId"],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "startDate", label: "Start date", type: "date", required: false },
        { key: "targetDate", label: "Target date", type: "date", required: false },
      ],
      primaryLabel: "Save project",
    },
  },
  {
    functionId: "update_project",
    label: "Update the project",
    module: "projects",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [{ name: "projectId", label: "Project", code: "PROJECT_REQUIRED" }],
    optionalParams: ["clientId"],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: false },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "startDate", label: "Start date", type: "date", required: false },
        { key: "targetDate", label: "Target date", type: "date", required: false },
        { key: "projectValue", label: "Project value", type: "number", required: false },
        { key: "vatRatePercent", label: "VAT", type: "percent", unit: "%", required: false },
        { key: "retentionPercent", label: "Retention", type: "percent", unit: "%", required: false },
      ],
      primaryLabel: "Save project",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-04: a BOQ built in batches, then sealed -----------------------
  //
  // create_boq (above) makes the empty BOQ, add_boq_lines appends at most 25 lines per call and
  // seal_boq closes it against the totals the AI read from the sheet. See
  // src/lib/services/construction-boq-payload-service.ts for the rules.
  {
    functionId: "add_boq_lines",
    label: "Add BOQ lines",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED" },
      { name: "batchNo", label: "Batch number", code: "VALUE_REQUIRED", field: "value" },
      { name: "lines", label: "Lines", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "boqId", label: "BOQ version", type: "select", required: true, picker: "boq-version" },
        { key: "batchNo", label: "Batch number", type: "number", required: true },
      ],
      primaryLabel: "Add lines",
    },
  },
  {
    functionId: "seal_boq",
    label: "Seal the BOQ",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED" },
      { name: "controlTotals", label: "Control totals", code: "VALUE_REQUIRED", field: "value" },
      { name: "expectedLineCount", label: "Line count", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "boqId", label: "BOQ version", type: "select", required: true, picker: "boq-version" },
        { key: "expectedLineCount", label: "Line count", type: "number", required: true },
      ],
      primaryLabel: "Seal BOQ",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-07: the activity a progress entry needs ----------------------
  //
  // record_work_progress writes against an activity, and a new project has none. create_activity
  // wraps createActivity(); without a categoryId it uses the project's "General" category,
  // creating it when it is missing (the same default record_work_progress uses).
  {
    functionId: "create_activity",
    label: "New activity",
    module: "work_progress",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "TITLE_REQUIRED" },
    ],
    optionalParams: ["categoryId"],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "unit", label: "Unit", type: "text", required: false },
        { key: "plannedQuantity", label: "Planned quantity", type: "number", required: false },
      ],
      primaryLabel: "Save activity",
    },
  },
  // PROJEXA-BUILD-002 WP-02 (AW-115 family): a NEW project and its BOQ from an uploaded workbook, through the same service the
  // from-document route uses (document-extraction-service.ts createProjectFromDocument). It needs no project (it makes one), so it
  // is on NO project link: a link is bound to one project (executors/extraction.ts says why). It is a write with a money baseline, so
  // the pipeline treats it as a proposal a person confirms (level 2); a job with open questions answers with them instead of creating.
  {
    functionId: "create_project_from_document",
    label: "New project from a workbook",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: false,
    requiredParams: [
      { name: "documentId", label: "Document", code: "VALUE_REQUIRED", field: "value" },
      { name: "productId", label: "Product", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "documentId", label: "Document", type: "text", required: true },
        { key: "productId", label: "Product", type: "text", required: true },
        { key: "name", label: "Project name", type: "text", required: false },
      ],
      primaryLabel: "Create project",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-05c (wave 3): RFIs, submittals, punch list, site diary ---------
  //
  // Each entry wraps the service function the matching PROJEXA route calls
  // (construction-field-workflow-service.ts, construction-site-diary-service.ts); the executors are in
  // src/lib/pipeline/executors/field-records.ts and site-diary.ts. An id parameter (rfiId, submittalId,
  // itemId, assignedToId) is declared as a required or optional parameter and not as a card field, so a
  // link declares it and the executor holds it to the task's own project.
  {
    functionId: "create_rfi",
    label: "New RFI",
    module: "rfis",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "subject", label: "Subject", code: "TITLE_REQUIRED", field: "value" },
      { name: "question", label: "Question", code: "VALUE_REQUIRED", field: "value" },
    ],
    optionalParams: ["assignedToId"],
    card: {
      fields: [
        { key: "subject", label: "Subject", type: "text", required: true },
        { key: "question", label: "Question", type: "text", required: true },
        { key: "dueDate", label: "Due date", type: "date", required: false },
        { key: "ballInCourt", label: "With", type: "select", required: false, default: "architect" },
      ],
      primaryLabel: "Save RFI",
    },
  },
  {
    functionId: "answer_rfi",
    label: "Answer an RFI",
    module: "rfis",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "rfiId", label: "RFI", code: "VALUE_REQUIRED", field: "value" },
      { name: "answer", label: "Answer", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [{ key: "answer", label: "Answer", type: "text", required: true }],
      primaryLabel: "Save answer",
    },
  },
  {
    functionId: "close_rfi",
    label: "Close an RFI",
    module: "rfis",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "rfiId", label: "RFI", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: { fields: [], primaryLabel: "Close RFI" },
  },
  {
    functionId: "create_submittal",
    label: "New submittal",
    module: "submittals",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "specSection", label: "Spec section", type: "text", required: false },
        { key: "type", label: "Type", type: "select", required: false, default: "shop_drawing" },
        { key: "dueDate", label: "Due date", type: "date", required: false },
      ],
      primaryLabel: "Save submittal",
    },
  },
  {
    functionId: "review_submittal",
    label: "Review a submittal",
    module: "submittals",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "submittalId", label: "Submittal", code: "VALUE_REQUIRED", field: "value" },
      { name: "status", label: "Decision", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "status", label: "Decision", type: "text", required: true },
        { key: "comments", label: "Comments", type: "text", required: false },
      ],
      primaryLabel: "Save review",
    },
  },
  {
    functionId: "create_punch_list_item",
    label: "New punch list item",
    module: "punch_list",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "description", label: "Description", code: "VALUE_REQUIRED", field: "value" },
    ],
    optionalParams: ["assignedToId"],
    card: {
      fields: [
        { key: "description", label: "Description", type: "text", required: true },
        { key: "location", label: "Location", type: "text", required: false },
        { key: "trade", label: "Trade", type: "text", required: false },
        { key: "priority", label: "Priority", type: "select", required: false, default: "medium" },
        { key: "dueDate", label: "Due date", type: "date", required: false },
      ],
      primaryLabel: "Save punch list item",
    },
  },
  {
    functionId: "mark_punch_item_ready",
    label: "Mark a punch list item ready",
    module: "punch_list",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "itemId", label: "Punch list item", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: { fields: [], primaryLabel: "Mark ready" },
  },
  {
    functionId: "verify_punch_item_closed",
    label: "Verify a punch list item closed",
    module: "punch_list",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "itemId", label: "Punch list item", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: { fields: [], primaryLabel: "Verify closed" },
  },
  {
    functionId: "create_site_diary",
    label: "New site diary entry",
    module: "site_diary",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "diaryDate", label: "Diary date", code: "DATE_REQUIRED", field: "date" },
    ],
    card: {
      fields: [
        { key: "diaryDate", label: "Diary date", type: "date", required: true },
        { key: "weather", label: "Weather", type: "text", required: false },
        { key: "workDone", label: "Work done", type: "text", required: false },
        { key: "visitors", label: "Visitors", type: "text", required: false },
        { key: "issues", label: "Issues", type: "text", required: false },
        { key: "instructions", label: "Instructions", type: "text", required: false },
        { key: "materialReceived", label: "Material received", type: "text", required: false },
        { key: "labourCount", label: "Labour count", type: "number", required: false },
        { key: "remarks", label: "Remarks", type: "text", required: false },
      ],
      primaryLabel: "Save diary entry",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-05d (wave 4): progress, attendance, roster, materials --------------
  //
  // The executors are in src/lib/pipeline/executors/progress.ts, labour.ts and materials.ts. create_activity
  // (wave 4 in the coverage list) is WP-07's and is above; it is not repeated here.
  {
    functionId: "create_progress_category",
    label: "New work category",
    module: "work_progress",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "TITLE_REQUIRED" },
    ],
    optionalParams: ["parentCategoryId"],
    card: {
      fields: [{ key: "name", label: "Name", type: "text", required: true }],
      primaryLabel: "Save category",
    },
  },
  {
    functionId: "update_progress_entry",
    label: "Correct a progress entry",
    module: "work_progress",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "entryId", label: "Progress entry", code: "VALUE_REQUIRED", field: "value" },
    ],
    optionalParams: ["activityId", "boqLineItemId"],
    card: {
      fields: [
        { key: "quantityDone", label: "Quantity done", type: "number", required: false },
        { key: "percentComplete", label: "Percent complete", type: "percent", unit: "%", required: false },
        { key: "entryDate", label: "Date", type: "date", required: false },
        { key: "remarks", label: "Remarks", type: "text", required: false },
      ],
      primaryLabel: "Save correction",
    },
  },
  readSpecNeeding("get_daily_progress_report", "View the daily progress report", "work_progress", true, [
    { name: "date", label: "Date", code: "DATE_REQUIRED", field: "date" },
  ]),
  {
    functionId: "record_attendance_batch",
    label: "Mark attendance for a sheet",
    module: "manpower",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "date", label: "Date", code: "DATE_REQUIRED" },
      { name: "entries", label: "Workers", code: "WORKER_REQUIRED", field: "worker" },
    ],
    card: {
      fields: [{ key: "date", label: "Date", type: "date", required: true }],
      primaryLabel: "Save attendance sheet",
    },
  },
  {
    functionId: "update_roster_entry",
    label: "Change a worker",
    module: "manpower",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "rosterId", label: "Worker", code: "WORKER_REQUIRED", field: "worker" },
    ],
    optionalParams: ["isActive"],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: false },
        { key: "trade", label: "Trade", type: "text", required: false },
        { key: "dailyRate", label: "Daily rate", type: "number", required: false },
        { key: "skillLevel", label: "Skill level", type: "text", required: false },
      ],
      primaryLabel: "Save worker",
    },
  },
  {
    functionId: "record_material_issue",
    label: "Issue material from site stock",
    module: "materials",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "materialId", label: "Material", code: "MATERIAL_REQUIRED", field: "material" },
      { name: "quantity", label: "Quantity", code: "QUANTITY_REQUIRED", field: "value" },
      { name: "issuedDate", label: "Issue date", code: "DATE_REQUIRED", field: "date" },
    ],
    optionalParams: ["boqLineItemId"],
    card: {
      fields: [
        { key: "materialId", label: "Material", type: "select", required: true, picker: "material" },
        { key: "quantity", label: "Quantity", type: "number", required: true },
        { key: "issuedDate", label: "Date", type: "date", required: true },
        { key: "issuedTo", label: "Issued to", type: "text", required: false },
        { key: "note", label: "Note", type: "text", required: false },
      ],
      primaryLabel: "Save issue",
    },
  },
  {
    functionId: "create_material",
    label: "New material",
    module: "materials",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "TITLE_REQUIRED" },
      { name: "unit", label: "Unit", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "unit", label: "Unit", type: "text", required: true },
        { key: "spec", label: "Specification", type: "text", required: false },
        { key: "unitCost", label: "Unit cost", type: "number", required: false },
        { key: "reorderLevel", label: "Reorder level", type: "number", required: false },
      ],
      primaryLabel: "Save material",
    },
  },
  {
    functionId: "void_material_receipt",
    label: "Void a material receipt",
    module: "materials",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "receiptId", label: "Receipt", code: "VALUE_REQUIRED", field: "value" },
      { name: "reason", label: "Reason", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [{ key: "reason", label: "Reason", type: "text", required: true }],
      primaryLabel: "Void receipt",
    },
  },
  { ...readSpec("get_material_cost_report", "View the material cost report", "materials", true), optionalParams: ["from", "to", "groupBy"] },

  // ---- PROJEXA-BUILD-002 WP-05e (wave 5): minutes of meeting, beyond create_mom ---------------
  //
  // Each wraps the service the matching PROJEXA route calls: veri-meeting-service.ts (the minutes, their action
  // items, the publish lock) and pms-meeting-service.ts (a project meeting's outcome). The executors are in
  // executors/meetings.ts.
  {
    functionId: "update_mom_minutes",
    label: "Amend the minutes",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "meetingId", label: "Meeting", code: "VALUE_REQUIRED", field: "value" },
      { name: "minutes", label: "Minutes", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "meetingId", label: "Meeting", type: "text", required: true },
        { key: "minutes", label: "Minutes", type: "text", required: true },
      ],
      primaryLabel: "Save minutes",
    },
  },
  {
    functionId: "add_meeting_action_item",
    label: "Add an action item",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "meetingId", label: "Meeting", code: "VALUE_REQUIRED", field: "value" },
      { name: "title", label: "Action", code: "TITLE_REQUIRED" },
    ],
    card: {
      fields: [
        { key: "meetingId", label: "Meeting", type: "text", required: true },
        { key: "title", label: "Action", type: "text", required: true },
        { key: "assigneeUserId", label: "Owner", type: "text", required: false },
        { key: "dueDate", label: "Due", type: "date", required: false },
      ],
      facts: [{ label: "Effect", value: "The owner gets a task for it (yours when no owner is named).", editable: false }],
      primaryLabel: "Save action item",
    },
  },
  {
    functionId: "add_meeting_outcome",
    label: "Record a meeting outcome",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "meetingId", label: "Meeting", code: "VALUE_REQUIRED", field: "value" },
      { name: "notes", label: "Outcome", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "meetingId", label: "Meeting", type: "text", required: true },
        { key: "notes", label: "Outcome", type: "text", required: true },
      ],
      primaryLabel: "Save outcome",
    },
  },
  {
    functionId: "publish_mom",
    label: "Publish the minutes",
    module: "meetings",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "meetingId", label: "Meeting", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [{ key: "meetingId", label: "Meeting", type: "text", required: true }],
      facts: [{ label: "Effect", value: "The minutes are locked: they cannot be edited after this.", editable: false }],
      primaryLabel: "Publish minutes",
    },
  },

  // ---- PROJEXA-BUILD-002 WP-05f (wave 6): exceptions, BOQ comparison, budget variance, schedule depth ----
  //
  // Reads first. The executors are in executors/analysis.ts and executors/schedule.ts.
  readSpec("get_project_exceptions", "View project exceptions", "reports", true),
  {
    ...readSpecNeeding("compare_boq_revisions", "Compare BOQ revisions", "scope", true, [
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED", field: "boqVersion" },
    ]),
    // `againstBoqId` is the other revision to compare with; without it the BOQ is compared with its own parent.
    optionalParams: ["againstBoqId"],
  },
  {
    ...readSpecNeeding("get_project_budget_variance", "View budget against actual", "budget", true, [
      { name: "budgetId", label: "Budget", code: "VALUE_REQUIRED", field: "value" },
    ]),
    optionalParams: ["asOfDate"],
  },
  readSpec("get_gantt_schedule", "View the Gantt schedule", "schedule", true),
  readSpecNeeding("compare_schedule_baseline", "Compare with a schedule baseline", "schedule", true, [
    { name: "baselineId", label: "Baseline", code: "VALUE_REQUIRED", field: "value" },
  ]),
  {
    functionId: "capture_schedule_baseline",
    label: "Freeze the schedule baseline",
    module: "schedule",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Baseline name", code: "TITLE_REQUIRED" },
    ],
    card: {
      fields: [{ key: "name", label: "Baseline name", type: "text", required: true }],
      facts: [{ label: "Effect", value: "Every task's start and due date is copied as the plan of record.", editable: false }],
      primaryLabel: "Save baseline",
    },
  },
  {
    functionId: "update_task",
    label: "Update a task",
    module: "schedule",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "issueId", label: "Task", code: "TASK_REQUIRED", field: "task" },
    ],
    // The people on the task are a list, and a card field has no list type.
    optionalParams: ["assigneeIds"],
    card: {
      fields: [
        { key: "issueId", label: "Task", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: false },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "statusId", label: "Status", type: "text", required: false },
        { key: "priority", label: "Priority", type: "select", required: false },
        { key: "startDate", label: "Start", type: "date", required: false },
        { key: "dueDate", label: "Due", type: "date", required: false },
        { key: "completionPercentage", label: "Complete", type: "percent", required: false },
        { key: "milestoneId", label: "Milestone", type: "text", required: false },
      ],
      primaryLabel: "Save task",
    },
  },

  // ---- PROJEXA-BUILD-002 AW-312: the facts eight owner exception items detect and nothing could write ----
  //
  // Each wraps a function of construction-exception-capture-service.ts; the executors are in executors/exception-capture.ts. vendorId,
  // customerId and employeeId are organisation records, not project records: they are read from the task by the executor but are not
  // declared here, so an AI work link cannot name one.
  {
    functionId: "set_progress_drawing",
    label: "Record the drawing a progress entry was built from",
    module: "work_progress",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "progressEntryId", label: "Progress entry", code: "VALUE_REQUIRED", field: "value" },
      { name: "drawingDocumentId", label: "Drawing", code: "VALUE_REQUIRED", field: "value" },
    ],
    // false records the drawing without confirming it; the default confirms it under the person.
    optionalParams: ["confirmed"],
    card: {
      fields: [
        { key: "progressEntryId", label: "Progress entry", type: "text", required: true },
        { key: "drawingDocumentId", label: "Drawing", type: "text", required: true },
      ],
      facts: [{ label: "Effect", value: "You confirm the site builds from this drawing.", editable: false }],
      primaryLabel: "Confirm drawing",
    },
  },
  {
    functionId: "record_vendor_dispute",
    label: "Record a vendor dispute",
    module: "disputes",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "description", label: "What is disputed", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "description", label: "What is disputed", type: "text", required: true },
        { key: "amountDisputed", label: "Amount disputed", type: "number", required: false },
        { key: "boqLineItemId", label: "BOQ line", type: "text", required: false },
      ],
      primaryLabel: "Save dispute",
    },
  },
  {
    functionId: "record_customer_complaint",
    label: "Record a customer complaint",
    module: "disputes",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "description", label: "Complaint", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "description", label: "Complaint", type: "text", required: true },
        { key: "category", label: "Kind", type: "text", required: false, default: "general" },
        { key: "severity", label: "Severity", type: "select", required: false, default: "medium" },
      ],
      primaryLabel: "Save complaint",
    },
  },
  {
    functionId: "record_customer_approval",
    label: "Record the customer's approval of a BOQ",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED", field: "boqVersion" },
      { name: "evidenceDocumentId", label: "Evidence document", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "boqId", label: "BOQ version", type: "text", required: true },
        { key: "evidenceDocumentId", label: "Evidence document", type: "text", required: true },
        { key: "approvedOn", label: "Approved on", type: "date", required: false },
      ],
      facts: [{ label: "Effect", value: "You record that the customer approved this BOQ, on the evidence named.", editable: false }],
      primaryLabel: "Record approval",
    },
  },
  {
    functionId: "link_roster_employee",
    label: "Link a roster entry to an employee",
    module: "manpower",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "rosterId", label: "Worker", code: "WORKER_REQUIRED", field: "worker" },
      { name: "employeeId", label: "Employee", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "rosterId", label: "Worker", type: "text", required: true },
        { key: "employeeId", label: "Employee", type: "text", required: true },
      ],
      primaryLabel: "Link employee",
    },
  },
  // ---- PROJEXA-BUILD-002 WP-05g and WP-05h (waves 7, 8 and 9): claims, approvals, KPIs, permits, wiki, interior design ------------
  //
  // Each entry wraps the service the matching PROJEXA route calls; the executors are in src/lib/pipeline/executors/ (claims.ts, approvals.ts,
  // documents-wiki.ts, interior.ts). An id parameter is a required or optional parameter and not a card field where it does not belong on
  // the confirmation card, so a link declares it and the executor holds it to the task's own project. Wave 7 (claims, submit for approval,
  // KPIs) is level-2 drafts only (PMD-41): the card of each says what confirming does.
  {
    functionId: "create_progress_claim",
    label: "Draft a progress claim",
    module: "billing",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED", field: "boqVersion" },
      { name: "customerId", label: "Customer", code: "VALUE_REQUIRED", field: "value" },
      { name: "milestoneDescription", label: "Milestone", code: "TITLE_REQUIRED", field: "value" },
      { name: "scheduledDate", label: "Billing date", code: "DATE_REQUIRED", field: "date" },
    ],
    card: {
      fields: [
        { key: "milestoneDescription", label: "Milestone", type: "text", required: true },
        { key: "scheduledDate", label: "Billing date", type: "date", required: true },
        { key: "retentionPercent", label: "Retention", type: "percent", unit: "%", required: false },
      ],
      facts: [{ label: "Effect", value: "A billing claim is recorded as milestone achieved. Nothing is invoiced and nothing is sent to the customer.", editable: false }],
      primaryLabel: "Save claim",
    },
  },
  {
    functionId: "draft_progress_claim",
    label: "Mark a claim drafted",
    module: "billing",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "claimId", label: "Claim", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [],
      facts: [{ label: "Effect", value: "The claim moves from milestone achieved to drafted.", editable: false }],
      primaryLabel: "Mark drafted",
    },
  },
  {
    functionId: "submit_progress_claim",
    label: "Mark a claim submitted",
    module: "billing",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "claimId", label: "Claim", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [],
      facts: [{ label: "Effect", value: "The claim moves from drafted to submitted, so it counts as sent to the customer. This step sends nothing.", editable: false }],
      primaryLabel: "Mark submitted",
    },
  },
  {
    functionId: "reject_progress_claim",
    label: "Record a claim as queried",
    module: "billing",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "claimId", label: "Claim", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [{ key: "rejectionReason", label: "Reason", type: "text", required: false }],
      facts: [{ label: "Effect", value: "You record that the customer queried this submitted claim. It can be redrafted.", editable: false }],
      primaryLabel: "Record as queried",
    },
  },
  {
    functionId: "submit_change_order_for_approval",
    label: "Send a change order for approval",
    module: "change_orders",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "changeOrderId", label: "Change order", code: "VALUE_REQUIRED", field: "value" },
      { name: "signers", label: "Signers", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [],
      facts: [
        { label: "Effect", value: "An e-signature request is created for the people listed, who are outside your team; their names and e-mail addresses are stored. The change order goes to pending approval.", editable: false },
      ],
      primaryLabel: "Send for approval",
    },
  },
  {
    functionId: "submit_boq_for_approval",
    label: "Submit a BOQ for approval",
    module: "scope",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "boqId", label: "BOQ version", code: "BOQ_VERSION_REQUIRED", field: "boqVersion" },
    ],
    card: {
      fields: [],
      facts: [{ label: "Effect", value: "A draft BOQ moves to submitted. A revision is compared with the BOQ before it, and an automation rule for a revision of finished scope may run.", editable: false }],
      primaryLabel: "Submit BOQ",
    },
  },
  {
    functionId: "submit_kpi_entry",
    label: "Submit a KPI value",
    module: "kpis",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "kpiDefinitionId", label: "KPI", code: "VALUE_REQUIRED", field: "value" },
      { name: "period", label: "Period", code: "VALUE_REQUIRED", field: "value" },
      { name: "actualValue", label: "Value", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "period", label: "Period", type: "text", required: true },
        { key: "actualValue", label: "Value", type: "number", required: true },
      ],
      facts: [{ label: "Effect", value: "The value is submitted for a manager to approve. It is not approved by this step.", editable: false }],
      primaryLabel: "Submit value",
    },
  },
  {
    functionId: "approve_kpi_entry",
    label: "Approve a KPI value",
    module: "kpis",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "entryId", label: "KPI value", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [],
      facts: [{ label: "Effect", value: "The submitted value is approved in your name. The person who submitted it cannot approve it.", editable: false }],
      primaryLabel: "Approve value",
    },
  },
  {
    functionId: "create_permit",
    label: "Record a permit",
    module: "permits",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Permit name", code: "TITLE_REQUIRED", field: "value" },
      { name: "externalUrl", label: "Link", code: "LINK_REQUIRED" },
      { name: "permitNumber", label: "Permit number", code: "VALUE_REQUIRED", field: "value" },
      { name: "permitAuthority", label: "Authority", code: "VALUE_REQUIRED", field: "value" },
      { name: "expiryDate", label: "End date", code: "DATE_REQUIRED", field: "date" },
    ],
    card: {
      fields: [
        { key: "name", label: "Permit name", type: "text", required: true },
        { key: "externalUrl", label: "Link", type: "text", required: true },
        { key: "permitNumber", label: "Permit number", type: "text", required: true },
        { key: "permitAuthority", label: "Authority", type: "text", required: true },
        { key: "expiryDate", label: "End date", type: "date", required: true },
        { key: "issueDate", label: "Issue date", type: "date", required: false },
      ],
      facts: [{ label: "Effect", value: "The permit is stored as a link to the address given; the file itself is not uploaded.", editable: false }],
      primaryLabel: "Save permit",
    },
  },
  {
    functionId: "update_document_metadata",
    label: "Edit a document's details",
    module: "documents",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "documentId", label: "Document", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: false },
        { key: "category", label: "Category", type: "text", required: false },
        { key: "expiryDate", label: "Expiry date", type: "date", required: false },
      ],
      primaryLabel: "Save details",
    },
  },
  {
    functionId: "create_wiki_page",
    label: "New wiki page",
    module: "wiki",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED", field: "value" },
    ],
    optionalParams: ["parentPageId"],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "content", label: "Text", type: "text", required: false },
      ],
      primaryLabel: "Save page",
    },
  },
  {
    functionId: "update_wiki_page",
    label: "Edit a wiki page",
    module: "wiki",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "pageId", label: "Page", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: false },
        { key: "content", label: "Text", type: "text", required: false },
      ],
      facts: [{ label: "Effect", value: "The page's text is replaced and its version number goes up by one.", editable: false }],
      primaryLabel: "Save page",
    },
  },
  {
    functionId: "create_mood_board",
    label: "New mood board",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "title", label: "Title", code: "TITLE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "roomOrArea", label: "Room or area", type: "text", required: false },
        { key: "description", label: "Description", type: "text", required: false },
      ],
      primaryLabel: "Save mood board",
    },
  },
  {
    functionId: "add_mood_board_item",
    label: "Add to a mood board",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "moodBoardId", label: "Mood board", code: "VALUE_REQUIRED", field: "value" },
    ],
    optionalParams: ["documentId"],
    card: {
      fields: [
        { key: "label", label: "Label", type: "text", required: false },
        { key: "notes", label: "Notes", type: "text", required: false },
      ],
      primaryLabel: "Add item",
    },
  },
  {
    functionId: "create_ffe_item",
    label: "New FF&E item",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "itemName", label: "Item", code: "TITLE_REQUIRED", field: "value" },
    ],
    optionalParams: ["documentId"],
    card: {
      fields: [
        { key: "itemName", label: "Item", type: "text", required: true },
        { key: "roomOrArea", label: "Room or area", type: "text", required: false },
        { key: "category", label: "Category", type: "select", required: false, default: "furniture" },
        { key: "description", label: "Description", type: "text", required: false },
        { key: "sku", label: "SKU", type: "text", required: false },
        { key: "quantity", label: "Quantity", type: "number", required: false, default: 1 },
        { key: "unitCost", label: "Trade cost", type: "number", required: false },
        { key: "unitPrice", label: "Client price", type: "number", required: false },
        { key: "leadTimeDays", label: "Lead time", type: "number", unit: "days", required: false },
        { key: "widthCm", label: "Width", type: "number", unit: "cm", required: false },
        { key: "depthCm", label: "Depth", type: "number", unit: "cm", required: false },
        { key: "heightCm", label: "Height", type: "number", unit: "cm", required: false },
      ],
      facts: [{ label: "Effect", value: "The trade cost and the client price feed the project's margin summary.", editable: false }],
      primaryLabel: "Save item",
    },
  },
  {
    functionId: "update_ffe_status",
    label: "Change an FF&E item's status",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "itemId", label: "FF&E item", code: "VALUE_REQUIRED", field: "value" },
      { name: "status", label: "Status", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      // A closed list (specified, ordered, received, installed), not a pick from records, so no picker; the status is still a required parameter above.
      fields: [{ key: "status", label: "Status", type: "select", required: false, default: "specified" }],
      facts: [{ label: "Effect", value: "Ordered, received and installed record that the item was bought, delivered or fitted.", editable: false }],
      primaryLabel: "Save status",
    },
  },
  readSpec("get_ffe_margin_summary", "View the FF&E margin summary", "interior", true),
  {
    functionId: "create_floor_plan",
    label: "New floor plan",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "name", label: "Name", code: "TITLE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "floorLevel", label: "Floor", type: "text", required: false },
      ],
      primaryLabel: "Save floor plan",
    },
  },
  {
    functionId: "add_room",
    label: "Add a room to a floor plan",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "floorPlanId", label: "Floor plan", code: "VALUE_REQUIRED", field: "value" },
      { name: "name", label: "Room", code: "TITLE_REQUIRED", field: "value" },
      { name: "polygon", label: "Outline", code: "VALUE_REQUIRED", field: "value" },
    ],
    card: {
      fields: [
        { key: "name", label: "Room", type: "text", required: true },
        { key: "ceilingHeightCm", label: "Ceiling height", type: "number", unit: "cm", required: false, default: 270 },
      ],
      primaryLabel: "Save room",
    },
  },
  {
    functionId: "place_furniture",
    label: "Place furniture on a floor plan",
    module: "interior",
    kind: "write",
    writes: true,
    requiresProject: true,
    requiredParams: [
      { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
      { name: "floorPlanId", label: "Floor plan", code: "VALUE_REQUIRED", field: "value" },
      { name: "ffeItemId", label: "FF&E item", code: "VALUE_REQUIRED", field: "value" },
    ],
    optionalParams: ["roomId"],
    card: {
      fields: [
        { key: "x", label: "Across", type: "number", unit: "cm", required: false, default: 0 },
        { key: "y", label: "Down", type: "number", unit: "cm", required: false, default: 0 },
        { key: "rotationDeg", label: "Rotation", type: "number", unit: "deg", required: false, default: 0 },
      ],
      primaryLabel: "Place item",
    },
  },

];

const SPECS: Readonly<Record<string, FunctionSpec>> = Object.fromEntries(SPEC_LIST.map((s) => [s.functionId, s]));

export function functionSpec(functionId: string): FunctionSpec | undefined {
  return SPECS[functionId];
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
}

/**
 * R67 B-07 -- IS THIS REQUIRED PARAMETER ANSWERED?
 *
 * The one place that question is decided, so validate(), the executor's
 * server-side re-check and the dry run's `missing` list can never disagree
 * about whether a BOQ line picked from the server's own chips counts.
 * `projectId` is special only in that it can also arrive on the submission
 * rather than in the params, which each caller resolves its own way and
 * passes in here as `fallback`.
 */
export function requiredParamSatisfied(
  required: RequiredParam,
  params: Record<string, unknown>,
  fallback?: unknown
): boolean {
  if (!blank(params[required.name])) return true;
  for (const alias of required.alsoSatisfiedBy ?? []) {
    if (!blank(params[alias])) return true;
  }
  return !blank(fallback);
}

/**
 * The human label for a function id. Falls back to the id decomposed the same
 * way derive-chain.ts's tier 3 does, so an unregistered id still reads as
 * words -- never "Record record_work_progress".
 */
export function functionLabel(functionId: string): string {
  const spec = SPECS[functionId];
  if (spec) return spec.label;
  const words = functionId.split("_").filter(Boolean);
  if (words.length === 0) return functionId;
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

export function functionKind(functionId: string): FunctionKind {
  return SPECS[functionId]?.kind ?? "ask";
}

/**
 * R67 B-04 -- THE SINGLE SOURCE OF "does this write". executor.ts's
 * WRITE_FUNCTION_IDS is derived from this so the registry and the
 * TASK/CHAT split (classify.ts) can never drift apart.
 */
export const WRITE_FUNCTION_IDS: ReadonlySet<string> = new Set(SPEC_LIST.filter((s) => s.writes).map((s) => s.functionId));

export const FUNCTION_SPECS = SPECS;
export const ALL_FUNCTION_SPECS = SPEC_LIST;
