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
  /**
   * BUILD-002 WP-04: the most bytes a call to this function may carry, when it is more than the link's 8 KB (LIMITS.bodyMaxBytes of
   * supabase/functions/_shared/ai-link/core.ts). Read by the Edge Function through the generated JSON, so a limit is a reviewed change
   * here, never a list of function ids in the handler. At most 65536 (LIMITS.bodyMaxBytesCeiling); the generator refuses more.
   */
  bodyMaxBytes?: number
  /**
   * BUILD-002 WP-04: parameters the LINK requires although the registry does not (a retry key: the internal pipeline dedupes a confirm in
   * its own ledger, a link call is retried by the AI). Each must be declared by the registry; they are added to required_params.
   */
  linkRequiredParams?: readonly string[]
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
  // BUILD-002 WP-03, WP-04, WP-07 (register rows AW-201 to AW-205, AW-331). A BOQ is built in three calls: create_boq (empty, or with lines
  // that fit), add_boq_lines (at most 25 per call) and seal_boq (against the totals the AI read). All three take a body up to 64 KB, all are
  // drafts the person confirms (they carry rates), and seal_boq needs the manager rank because its answer states amounts. create_boq makes a
  // retry key mandatory on a link, so a repeated call is one BOQ. update_project can change the project value, VAT and retention, so it is a
  // draft too. create_activity is the one direct write: a name and a unit, no money.
  create_boq: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["title"], bodyMaxBytes: 65536, linkRequiredParams: ["idempotency_key"] },
  add_boq_lines: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: [], bodyMaxBytes: 65536 },
  seal_boq: { linkLevel: 2, moneySensitive: true, minRank: 3, textParams: [], bodyMaxBytes: 65536 },
  update_project: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["name", "description"] },
  create_activity: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["name", "unit"] },
  // BUILD-002 WP-05a wave 1 (AW-301): schedule, milestones and reports. These 10 functions already had an executor (U-38) and were on no link.
  // Each minimum rank is the rank of the route the same action has in the app (PROJEXA schedule and milestones: member to write, no read
  // gate; reports/[reportName]: no read gate except budget-vs-actual; reports/boq-analysis: manager), so an AI never has more authority than
  // its person has in the screens. The reads that show money are withheld or nulled below manager by the executor (executor.ts withholdMoney,
  // withholdCurrencyColumns); get_boq_line_items and get_project_analysis are rank 3 because the executor shows a BOQ line's contract rate
  // and amount to every reader (cost-visibility rules) while the link's boq_lines record kind hides them below rank 3, so a member link reads
  // lines through that kind, with the money hidden.
  get_boq_line_items: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  run_named_report: { linkLevel: 0, moneySensitive: true, minRank: 2, textParams: [] },
  get_project_schedule: { linkLevel: 0, moneySensitive: false, minRank: 2, textParams: [] },
  list_milestones: { linkLevel: 0, moneySensitive: false, minRank: 2, textParams: [] },
  create_milestone: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "description"] },
  update_milestone: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "description"] },
  create_schedule_task: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "description"] },
  get_manpower_cost_report: { linkLevel: 0, moneySensitive: true, minRank: 2, textParams: [] },
  get_designer_timesheet_report: { linkLevel: 0, moneySensitive: true, minRank: 2, textParams: [] },
  get_project_analysis: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  // BUILD-002 WP-05a wave 2 (AW-302): BOQ import, change orders, site instructions, line budgets and billing reads. create_boq, the eleventh
  // function of this wave, is on links since WP-04 (above). Every write here carries money or a commercial instruction, so all are drafts the
  // person confirms (level 2). A change order and a BOQ import are rank 2 like their app routes (POST change-orders and scope/import: member);
  // update_line_item_budget is rank 3 although its route allows a member, because the budget of a line is internal cost. The two billing
  // reads are rank 3: their route has no read gate, but a claim's retention and customer are commercial terms and the executor nulls them
  // below manager. preview_boq_import is rank 3 for the same reason as get_boq_line_items (its rows carry the sheet's rates).
  apply_boq_import: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["title"] },
  preview_boq_import: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  create_change_order: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["title", "description", "reason", "trade"] },
  list_change_orders: { linkLevel: 0, moneySensitive: true, minRank: 2, textParams: [] },
  get_change_order: { linkLevel: 0, moneySensitive: true, minRank: 2, textParams: [] },
  create_site_instruction: { linkLevel: 2, moneySensitive: false, minRank: 2, textParams: ["toContractor", "description", "drawingRef"] },
  update_line_item_budget: { linkLevel: 2, moneySensitive: true, minRank: 3, textParams: ["category"] },
  list_billing_claims: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  get_billing_due_queue: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  // BUILD-002 WP-05c (wave 3, AW-303): RFIs, submittals, punch list, site diary. The route floor of every one of these is member; the two
  // sign-offs (review_submittal, verify_punch_item_closed) are set to the manager rank, stricter than the route, so an AI never has more
  // authority than the person has on screen. An answer to an RFI is a formal design answer, a review and a sign-off are approval
  // decisions: all three are drafts the person confirms. Creating an RFI, a submittal, a punch list item or a diary entry, closing an RFI
  // and marking a punch list item ready record a fact and are direct writes.
  create_rfi: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["subject", "question"] },
  answer_rfi: { linkLevel: 2, moneySensitive: false, minRank: 2, textParams: ["answer"] },
  close_rfi: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: [] },
  create_submittal: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "specSection"] },
  review_submittal: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: ["comments"] },
  create_punch_list_item: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["description", "location", "trade"] },
  mark_punch_item_ready: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: [] },
  verify_punch_item_closed: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: [] },
  create_site_diary: {
    linkLevel: 1, moneySensitive: false, minRank: 2,
    textParams: ["weather", "workDone", "visitors", "issues", "instructions", "materialReceived", "remarks"],
  },
  // BUILD-002 WP-05d (wave 4, AW-304): progress, attendance, roster, materials. create_activity (above) is WP-07's. A daily rate and a unit
  // cost are money inputs, so update_roster_entry and create_material are drafts (the precedent is add_roster_entry). Voiding a receipt
  // reverses a ledger row and the cost report states costs: manager rank. update_progress_entry and record_attendance_batch are direct
  // writes with no money input, but their answers carry a contract rate or a day cost (null below the manager rank), so they are marked
  // money sensitive.
  create_progress_category: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["name"] },
  update_progress_entry: { linkLevel: 1, moneySensitive: true, minRank: 2, textParams: ["remarks"] },
  get_daily_progress_report: { linkLevel: 0, moneySensitive: false, minRank: 2, textParams: [] },
  record_attendance_batch: { linkLevel: 1, moneySensitive: true, minRank: 2, textParams: [] },
  update_roster_entry: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["name", "trade", "skillLevel"] },
  record_material_issue: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["issuedTo", "note"] },
  create_material: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["name", "unit", "spec"] },
  void_material_receipt: { linkLevel: 2, moneySensitive: true, minRank: 3, textParams: ["reason"] },
  get_material_cost_report: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  // BUILD-002 WP-05e (wave 5, register row AW-305): minutes of meeting, drawings, notes, material receipts, timesheet decisions.
  // The minutes are level 1 for what records a person's own words (a new MoM, an amendment, an action item, an outcome): no money and the
  // record is a draft until published. Publishing locks the minutes, so it is a draft the person confirms and needs the manager rank (the
  // cookie route of the same action asks for it); it also runs WITHOUT the model pass publishVeriMeeting() would start. A drawing can take over
  // the build set from the previous revision, so it is a draft. A material receipt carries a unit cost, so it is a draft (money, rank 2 like
  // add_roster_entry). An approval or a return of a timesheet entry is a decision of a manager: draft, rank 3.
  create_mom: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "minutes", "meetingType", "attendees", "agenda"] },
  update_mom_minutes: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["minutes"] },
  add_meeting_action_item: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title"] },
  add_meeting_outcome: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["notes"] },
  publish_mom: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: [] },
  create_drawing: { linkLevel: 2, moneySensitive: false, minRank: 2, textParams: ["name", "externalUrl", "drawingNo", "rev", "discipline", "kind"] },
  capture_artifact: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "text"] },
  record_material_receipt: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["materialName", "reference", "notes", "spec", "unit"] },
  approve_timesheet: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: [] },
  reject_timesheet: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: ["rejectionReason"] },
  // BUILD-002 WP-05f (wave 6, register row AW-306): exceptions, BOQ comparison, budget variance, schedule depth. The three money reads state
  // amounts, so they need the manager rank (the exceptions route asks for it too; the two others have no role gate on their routes and the
  // link asks for more, never less). The schedule reads are project data at the member rank. Freezing a baseline is the plan of record: a
  // draft, and the manager rank although the route asks for member. update_task is level 1 (no money, no approval; it never takes position,
  // archive or labels).
  get_project_exceptions: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  compare_boq_revisions: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  get_project_budget_variance: { linkLevel: 0, moneySensitive: true, minRank: 3, textParams: [] },
  get_gantt_schedule: { linkLevel: 0, moneySensitive: false, minRank: 2, textParams: [] },
  compare_schedule_baseline: { linkLevel: 0, moneySensitive: false, minRank: 2, textParams: [] },
  capture_schedule_baseline: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: ["name"] },
  update_task: { linkLevel: 1, moneySensitive: false, minRank: 2, textParams: ["title", "description"] },
  // BUILD-002 AW-312: the facts eight owner exception items detect and nothing could write. Each is a statement the person attests to (a drawing
  // confirmed, a dispute, a complaint, the customer's approval), so each is a draft. A dispute carries an amount (money, rank 2 like
  // add_roster_entry); the customer's approval needs the manager rank and a stored evidence document.
  set_progress_drawing: { linkLevel: 2, moneySensitive: false, minRank: 2, textParams: [] },
  record_vendor_dispute: { linkLevel: 2, moneySensitive: true, minRank: 2, textParams: ["description"] },
  record_customer_complaint: { linkLevel: 2, moneySensitive: false, minRank: 2, textParams: ["description", "category"] },
  record_customer_approval: { linkLevel: 2, moneySensitive: false, minRank: 3, textParams: [] },
}

/** Why each of the 17 functions the spec excludes is on no link (spec 9.1). */
export const EXCLUDED_REASONS: Readonly<Record<string, string>> = {
  create_project: "A link is bound to one project, so it cannot make another one: the New project with my AI flow and the internal pipeline do.",
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
  // BUILD-002 AW-312 (owner exception item 21): the function exists for the internal pipeline (a manager links a roster row to an employee) but a link
  // cannot run it, because the employee id is not project data and so cannot be checked against the link's project.
  link_roster_employee: "An employee id is an organisation-wide HR record (personal data), not project data, so it cannot be checked against the link's project (spec 9.10, F-3). The internal pipeline runs it for a manager.",
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
// drizzle/0625_build001_awl_read_functions.sql (the first 13) and, as amended, drizzle/0643_build002_record_kinds.sql (which adds 20
// kinds, three columns to boq_lines, a curated metadata column to documents and project_role to people); the money columns are the
// spec's table, plus rate_contract (a contract rate is money).
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
      // BUILD-002 WP-06: the cost breakdown behind the rate (drizzle/0643)
      "vendor_id", "overhead_percent", "profit_percent",
    ],
    fields: {
      boq_id: TEXT_EQ_IN,
      item_code: TEXT_EQ_IN,
      category: TEXT_EQ_IN,
      quantity: { type: "numeric", ops: RANGE },
      rate: { type: "numeric", ops: RANGE },
      amount: { type: "numeric", ops: RANGE },
      budget_percentage: { type: "numeric", ops: RANGE },
      breakdown_percentage: { type: "numeric", ops: RANGE },
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

  // ---- BUILD-002 WP-06 (drizzle/0643_build002_record_kinds.sql): the Tier-1 kinds a project manager reads besides the 13 above. ----
  // The table, the scope and the column list of each are in that migration. A money column is NULL below rank 3 and can be neither
  // filtered nor sorted for such a role; a sort field is a NOT NULL column (the keyset cursor compares it as a row).
  {
    kind: "rfis",
    moneyColumns: [],
    fields: {
      status: TEXT_EQ_IN,
      ball_in_court: TEXT_EQ_IN,
      assigned_to_id: TEXT_EQ_IN,
      due_date: { type: "date", ops: RANGE },
      number: { type: "numeric", ops: RANGE },
    },
    sort: ["number", "created_at"],
  },
  {
    kind: "submittals",
    moneyColumns: [],
    fields: {
      status: TEXT_EQ_IN,
      type: TEXT_EQ_IN,
      due_date: { type: "date", ops: RANGE },
      number: { type: "numeric", ops: RANGE },
    },
    sort: ["number", "created_at"],
  },
  {
    kind: "punch_list",
    moneyColumns: [],
    fields: {
      status: TEXT_EQ_IN,
      priority: TEXT_EQ_IN,
      trade: TEXT_EQ_IN,
      assigned_to_id: TEXT_EQ_IN,
      due_date: { type: "date", ops: RANGE },
      number: { type: "numeric", ops: RANGE },
    },
    sort: ["number", "created_at"],
  },
  {
    kind: "change_orders",
    moneyColumns: ["cost_impact"],
    fields: {
      status: TEXT_EQ_IN,
      trade: TEXT_EQ_IN,
      number: { type: "numeric", ops: RANGE },
      cost_impact: { type: "numeric", ops: RANGE },
      schedule_impact_days: { type: "numeric", ops: RANGE },
    },
    sort: ["number", "created_at", "cost_impact", "schedule_impact_days"],
  },
  {
    kind: "site_diaries",
    moneyColumns: [],
    fields: { diary_date: { type: "date", ops: RANGE } },
    sort: ["diary_date", "created_at"],
  },
  {
    kind: "site_instructions",
    moneyColumns: [],
    fields: {
      issue_date: { type: "date", ops: RANGE },
      si_number: { type: "numeric", ops: RANGE },
      cost_impact: { type: "boolean", ops: ["eq"] },
      time_impact: { type: "boolean", ops: ["eq"] },
    },
    sort: ["si_number", "issue_date", "created_at"],
  },
  {
    kind: "milestones",
    moneyColumns: [],
    fields: { status: TEXT_EQ_IN, target_date: { type: "date", ops: RANGE } },
    sort: ["name", "created_at"],
  },
  {
    kind: "progress_claims",
    moneyColumns: ["retention_percent", "customer_id", "interim_bill_id"],
    fields: {
      status: TEXT_EQ_IN,
      boq_id: TEXT_EQ_IN,
      scheduled_date: { type: "date", ops: RANGE },
      retention_percent: { type: "numeric", ops: RANGE },
      customer_id: TEXT_EQ_IN,
    },
    sort: ["scheduled_date", "created_at", "retention_percent"],
  },
  {
    kind: "interim_bills",
    moneyColumns: ["retention_percent", "gross_amount", "retention_amount", "net_payable", "retention_released_amount", "sales_invoice_id"],
    fields: {
      boq_id: TEXT_EQ_IN,
      bill_number: { type: "numeric", ops: RANGE },
      bill_date: { type: "date", ops: RANGE },
      gross_amount: { type: "numeric", ops: RANGE },
      net_payable: { type: "numeric", ops: RANGE },
    },
    sort: ["bill_number", "bill_date", "created_at", "gross_amount", "net_payable"],
  },
  {
    kind: "materials",
    moneyColumns: ["unit_cost"],
    fields: {
      name: { type: "text", ops: ["eq"] },
      is_active: { type: "boolean", ops: ["eq"] },
      unit_cost: { type: "numeric", ops: RANGE },
    },
    sort: ["name", "created_at", "unit_cost"],
  },
  {
    kind: "material_receipts",
    moneyColumns: ["unit_cost", "vendor_id"],
    fields: {
      material_id: TEXT_EQ_IN,
      received_date: { type: "date", ops: RANGE },
      quantity: { type: "numeric", ops: RANGE },
      unit_cost: { type: "numeric", ops: RANGE },
      vendor_id: TEXT_EQ_IN,
    },
    sort: ["received_date", "created_at", "quantity"],
  },
  {
    kind: "material_issues",
    moneyColumns: [],
    fields: {
      material_id: TEXT_EQ_IN,
      boq_line_item_id: TEXT_EQ_IN,
      issued_date: { type: "date", ops: RANGE },
      quantity: { type: "numeric", ops: RANGE },
    },
    sort: ["issued_date", "created_at", "quantity"],
  },
  {
    kind: "kpi_entries",
    moneyColumns: ["target_value", "actual_value"],
    fields: {
      kpi_definition_id: TEXT_EQ_IN,
      metric_name: TEXT_EQ_IN,
      period: TEXT_EQ_IN,
      approval_status: TEXT_EQ_IN,
      actual_value: { type: "numeric", ops: RANGE },
    },
    sort: ["created_at", "period", "actual_value"],
  },
  {
    kind: "expenses",
    moneyColumns: ["amount", "description"],
    fields: {
      expense_head: TEXT_EQ_IN,
      expense_date: { type: "date", ops: RANGE },
      is_rework: { type: "boolean", ops: ["eq"] },
      amount: { type: "numeric", ops: RANGE },
    },
    sort: ["expense_date", "created_at", "amount"],
  },
  {
    kind: "drawings",
    moneyColumns: [],
    fields: {
      drawing_no: TEXT_EQ_IN,
      revision: TEXT_EQ_IN,
      drawing_status: TEXT_EQ_IN,
      discipline: TEXT_EQ_IN,
      category: TEXT_EQ_IN,
    },
    sort: ["name", "created_at", "version_number"],
  },
  {
    kind: "permits",
    moneyColumns: [],
    fields: {
      permit_number: TEXT_EQ_IN,
      permit_authority: TEXT_EQ_IN,
      expiry_date: { type: "timestamptz", ops: ["gt", "lt"] },
    },
    sort: ["name", "created_at"],
  },
  {
    kind: "meeting_minutes",
    moneyColumns: [],
    fields: {
      status: TEXT_EQ_IN,
      meeting_type: TEXT_EQ_IN,
      scheduled_at: { type: "timestamptz", ops: ["gt", "lt"] },
    },
    sort: ["scheduled_at", "created_at"],
  },
  {
    kind: "wiki_pages",
    moneyColumns: [],
    fields: { slug: TEXT_EQ_IN, title: { type: "text", ops: ["eq"] } },
    sort: ["slug", "title", "updated_at"],
  },
  {
    kind: "ffe_items",
    moneyColumns: ["unit_cost", "unit_price", "vendor_id"],
    fields: {
      status: TEXT_EQ_IN,
      category: TEXT_EQ_IN,
      room_or_area: TEXT_EQ_IN,
      unit_cost: { type: "numeric", ops: RANGE },
      unit_price: { type: "numeric", ops: RANGE },
      vendor_id: TEXT_EQ_IN,
    },
    sort: ["item_name", "created_at", "unit_cost", "unit_price"],
  },
  {
    kind: "schedule_baselines",
    moneyColumns: [],
    fields: { name: { type: "text", ops: ["eq"] } },
    sort: ["name", "created_at"],
  },
]
