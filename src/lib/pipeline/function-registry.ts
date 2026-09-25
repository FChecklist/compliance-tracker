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
  readSpec("get_boq_line_items", "View BOQ line items", "scope", true),
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
  readSpec("list_change_orders", "View change orders", "change_orders", true),
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
        { key: "reason", label: "Reason", type: "text", required: false },
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
  readSpecNeeding("run_named_report", "View a named report", "reports", true, [
    { name: "reportSlug", label: "Report", code: "VALUE_REQUIRED", field: "value" },
  ]),
  readSpec("get_project_analysis", "View project analysis", "reports", false),
  readSpec("get_manpower_cost_report", "View manpower cost", "manpower", true),
  readSpec("get_designer_timesheet_report", "View designer timesheet report", "timesheets", true),

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
  readSpec("get_project_schedule", "View the schedule", "schedule", true),
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
    card: {
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "externalUrl", label: "Link", type: "text", required: true },
        { key: "drawingNo", label: "Drawing No.", type: "text", required: false },
        { key: "rev", label: "Revision", type: "text", required: false },
        { key: "status", label: "Status", type: "select", required: false, default: "for_approval" },
        { key: "discipline", label: "Discipline", type: "text", required: false },
      ],
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
    card: {
      fields: [
        { key: "title", label: "Title", type: "text", required: true },
        { key: "scheduledAt", label: "Date and time", type: "date", required: true },
        { key: "minutes", label: "Minutes", type: "text", required: false },
      ],
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
    card: {
      fields: [
        { key: "materialId", label: "Material", type: "select", required: true, picker: "material" },
        { key: "quantity", label: "Quantity", type: "number", required: true },
        { key: "receivedDate", label: "Date", type: "date", required: false },
        { key: "unitCost", label: "Unit cost", type: "number", required: false },
        { key: "reference", label: "Reference", type: "text", required: false },
      ],
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
    card: {
      fields: [
        { key: "documentId", label: "Document", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: false },
      ],
      primaryLabel: "Import BOQ",
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
