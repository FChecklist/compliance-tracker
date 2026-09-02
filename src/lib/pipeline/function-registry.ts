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
      { name: "itemCode", label: "BOQ line", code: "BOQ_LINE_REQUIRED", field: "boqLine" },
      { name: "percent", label: "Percent complete", code: "VALUE_REQUIRED" },
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
];

const SPECS: Readonly<Record<string, FunctionSpec>> = Object.fromEntries(SPEC_LIST.map((s) => [s.functionId, s]));

export function functionSpec(functionId: string): FunctionSpec | undefined {
  return SPECS[functionId];
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
