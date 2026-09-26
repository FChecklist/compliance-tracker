// PROJEXA-BUILD-001 U-46 step 1 (BR-581): the reviewed facts that scripts/gen-ai-link-registry.ts adds to
// src/lib/pipeline/function-registry.ts. The spec calls this "a small override file" (UNIVERSAL_AI_WORK_LINK_SPEC.md 9.1): the
// registry says what a function is; this file says what a link may do with it.
//
// HOW A FUNCTION GETS ON LINKS. Only by being named in LINK_FUNCTIONS below. The generator reads the registry when it runs and selects
// by name, so a function that someone adds to the registry later (another unit adds 26 now) is on no link until a person reviews it
// and adds it here (on links) or to EXCLUDED_REASONS (on no link, with the reason). Until then it has no row in the outputs at all, so
// a merge of another unit's registry entries changes none of them; `bun scripts/gen-ai-link-registry.ts --unreviewed` lists them.
//
// The 10 functions and their levels are spec 9.1 (decided as written by PMD-24 OD-5). The minimum role rank is the rank at and above
// which a person gets the function on their link; ranks are ROLE_RANK of src/lib/supabase/role-rank.ts (member 2, manager 3).

export type LinkFunctionPolicy = {
  /** 0 = read, 1 = a write a link may run directly (effective level 1), 2 = a write that is always a draft. */
  linkLevel: 0 | 1 | 2
  /** Shows or acts on money, so the read is withheld below manager. Informational: the ranks below are what is enforced. */
  moneySensitive: boolean
  minRank: number
  /** Free-text parameters (spec 9.11): capped at 2,000 characters and cleaned at write time. Must be declared by the registry. */
  textParams: readonly string[]
}

export const LINK_FUNCTIONS: Readonly<Record<string, LinkFunctionPolicy>> = {
  // reads
  get_construction_project_dashboard: { linkLevel: 0, moneySensitive: true, minRank: 1, textParams: [] },
  get_construction_budget_status: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  get_construction_kpi_status: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  // writes a link may run directly once writes are switched on
  record_work_progress: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["remarks"] },
  record_attendance: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: [] },
  record_timesheet: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["task", "activityType"] },
  create_meeting: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title"] },
  create_document: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["name", "category"] },
  // writes that always wait for the person's own confirmation (a daily rate, a commercial baseline)
  add_roster_entry: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["name", "trade", "employeeCode"] },
  create_boq_revision: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["title"] },
}

/** Why each of the 17 functions the spec excludes is on no link (spec 9.1). */
export const EXCLUDED_REASONS: Readonly<Record<string, string>> = {
  review_budget: "An alias that duplicates get_construction_budget_status.",
  generate_construction_progress_summary: "Calls a server-side model (F-2): the internal AI never runs on link traffic.",
  detect_construction_budget_schedule_risk: "Calls a server-side model (F-2): the internal AI never runs on link traffic.",
  list_delayed_activities: "Reads the whole organisation, not one project (F-3).",
  list_over_budget_projects: "Reads the whole organisation, not one project (F-3).",
  get_compliance_stats: "Organisation-scoped read, not project data (F-3).",
  get_overdue_items: "Organisation-scoped read, not project data (F-3).",
  list_departments: "Organisation-scoped read, not project data (F-3).",
  list_compliance_items: "Organisation-scoped read, not project data (F-3).",
  list_notices: "Organisation-scoped read, not project data (F-3).",
  list_gst_import_batches: "Organisation-scoped read, not project data (F-3).",
  list_gst_returns: "Organisation-scoped read, not project data (F-3).",
  list_customers: "Organisation-scoped read, not project data (F-3).",
  list_sales_orders: "Organisation-scoped read, not project data (F-3).",
  list_leads: "Organisation-scoped read, not project data (F-3).",
  list_opportunities: "Organisation-scoped read, not project data (F-3).",
  get_sales_pipeline_overview: "Organisation-scoped read, not project data (F-3).",
}

export type FilterOp = "eq" | "gt" | "lt" | "in"
export type FilterFieldType = "text" | "numeric" | "date" | "timestamptz" | "boolean"
export type FilterField = { type: FilterFieldType; ops: readonly FilterOp[] }

export type RecordKindDef = {
  kind: string
  /** Hidden (NULL, or left out when listed in omitWhenHidden) below rank 3. Every one must be a column the SQL function selects. */
  moneyColumns: readonly string[]
  /** Columns a request may filter on (spec 6.6). */
  fields: Readonly<Record<string, FilterField>>
  /** Columns a request may sort by. Only NOT NULL columns: the keyset cursor compares them as a row. */
  sort: readonly string[]
  omitWhenHidden?: readonly string[]
}

const EQ_IN: readonly FilterOp[] = ["eq", "in"]
const RANGE: readonly FilterOp[] = ["eq", "gt", "lt"]
const TEXT_EQ_IN: FilterField = { type: "text", ops: EQ_IN }

// The Tier-1 record kinds of spec 6.2. The table, the scope and the column list of each kind are in
// drizzle/0625_build001_awl_read_functions.sql; the money columns are the spec's table, plus rate_contract (a contract rate is money).
export const RECORD_KINDS: readonly RecordKindDef[] = [
  { kind: "project", moneyColumns: ["project_value", "vat_rate_percent", "retention_percent"], fields: {}, sort: [] },
  {
    kind: "boqs",
    moneyColumns: ["contract_value_override"],
    fields: { status: TEXT_EQ_IN, version: { type: "numeric", ops: RANGE } },
    sort: ["version", "created_at"],
  },
  {
    kind: "boq_lines",
    moneyColumns: [
      "rate", "amount", "material_cost", "labour_cost", "equipment_cost", "budget_percentage",
      "vendor_amount", "material_amount", "manpower_amount", "rate_project", "rate_contract",
    ],
    fields: {
      boq_id: TEXT_EQ_IN,
      item_code: TEXT_EQ_IN,
      category: TEXT_EQ_IN,
      quantity: { type: "numeric", ops: RANGE },
      rate: { type: "numeric", ops: RANGE },
      amount: { type: "numeric", ops: RANGE },
      budget_percentage: { type: "numeric", ops: RANGE },
    },
    sort: ["created_at", "quantity", "rate", "amount", "budget_percentage"],
  },
  {
    kind: "activities",
    moneyColumns: [],
    fields: { category_id: TEXT_EQ_IN, name: { type: "text", ops: ["eq"] } },
    sort: ["name", "created_at"],
  },
  {
    kind: "progress",
    moneyColumns: [],
    fields: {
      entry_date: { type: "date", ops: RANGE },
      activity_id: TEXT_EQ_IN,
      boq_line_item_id: TEXT_EQ_IN,
      percent_complete: { type: "numeric", ops: RANGE },
    },
    sort: ["entry_date", "percent_complete", "created_at"],
  },
  {
    kind: "tasks",
    moneyColumns: [],
    fields: {
      status_id: TEXT_EQ_IN,
      priority: TEXT_EQ_IN,
      assignee_id: TEXT_EQ_IN,
      number: { type: "numeric", ops: RANGE },
      due_date: { type: "date", ops: RANGE },
      completion_percentage: { type: "numeric", ops: RANGE },
      is_archived: { type: "boolean", ops: ["eq"] },
    },
    sort: ["number", "priority", "completion_percentage", "created_at", "updated_at"],
  },
  {
    kind: "meetings",
    moneyColumns: [],
    fields: { scheduled_at: { type: "timestamptz", ops: ["gt", "lt"] } },
    sort: ["scheduled_at", "created_at"],
  },
  {
    kind: "documents",
    moneyColumns: [],
    fields: { category: TEXT_EQ_IN, name: { type: "text", ops: ["eq"] } },
    sort: ["name", "created_at", "version_number"],
  },
  {
    kind: "roster",
    moneyColumns: ["daily_rate"],
    fields: {
      trade: TEXT_EQ_IN,
      is_active: { type: "boolean", ops: ["eq"] },
      daily_rate: { type: "numeric", ops: RANGE },
    },
    sort: ["name", "created_at", "daily_rate"],
  },
  {
    kind: "attendance",
    moneyColumns: ["daily_cost"],
    fields: {
      attendance_date: { type: "date", ops: RANGE },
      roster_id: TEXT_EQ_IN,
      status: TEXT_EQ_IN,
      daily_cost: { type: "numeric", ops: RANGE },
    },
    sort: ["attendance_date", "created_at", "daily_cost"],
  },
  {
    kind: "timesheets",
    moneyColumns: ["hourly_rate_snapshot", "invoice_item_id"],
    fields: {
      spent_on: { type: "date", ops: RANGE },
      issue_id: TEXT_EQ_IN,
      user_id: TEXT_EQ_IN,
      activity_type: TEXT_EQ_IN,
      hours: { type: "numeric", ops: RANGE },
      hourly_rate_snapshot: { type: "numeric", ops: RANGE },
    },
    sort: ["spent_on", "hours", "created_at"],
  },
  {
    kind: "pipeline_tasks",
    moneyColumns: ["params", "result"],
    fields: {
      function_id: TEXT_EQ_IN,
      status: TEXT_EQ_IN,
      created_at: { type: "timestamptz", ops: ["gt", "lt"] },
    },
    sort: ["created_at", "sequence", "status"],
    // params and result can carry a daily rate: below rank 3 they are left out of the row, not shown as null (spec 6.2)
    omitWhenHidden: ["params", "result"],
  },
  { kind: "people", moneyColumns: [], fields: { role: TEXT_EQ_IN }, sort: ["name"] },
]
