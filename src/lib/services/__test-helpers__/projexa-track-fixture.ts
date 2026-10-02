// PROJEXA SYNC: what the version / change-feed tests need to write to EVERY tracked table (tests:F08). The tracked tables are listed once here (kind, table,
// what links a row to its project), and a minimal valid row for any of them is built FROM THE CATALOG (every NOT NULL column without a default gets a value of
// its type; an enum gets its first label), so a test can insert, update and delete a fresh row of each of the 37 tables without a hand-written fixture per table.
import type { PGlite } from "@electric-sql/pglite"

export type Val = string | number | boolean | null
export type Tracked = { kind: string; table: string; org: boolean; link: (project: string) => Record<string, Val> }

const P = (project: string) => ({ project_id: project })
/** The 28 project kinds (0679 + 0683) and the 9 organisation kinds (0684), with the columns that put a row in a project. */
export const TRACKED: Tracked[] = [
  { kind: "project", table: "projects", org: false, link: () => ({}) },
  { kind: "tasks", table: "pms_issues", org: false, link: P },
  { kind: "boqs", table: "construction_boqs", org: false, link: P },
  { kind: "boq_lines", table: "construction_boq_line_items", org: false, link: () => ({ boq_id: "trk-boq" }) },
  { kind: "activities", table: "construction_activities", org: false, link: P },
  { kind: "progress", table: "construction_work_progress_entries", org: false, link: (p) => ({ ...P(p), entry_basis: "DELTA" }) },
  { kind: "rfis", table: "construction_rfis", org: false, link: P },
  { kind: "submittals", table: "construction_submittals", org: false, link: P },
  { kind: "punch_list", table: "construction_punch_list_items", org: false, link: P },
  { kind: "change_orders", table: "construction_change_orders", org: false, link: P },
  { kind: "milestones", table: "pms_milestones", org: false, link: P },
  { kind: "materials", table: "construction_materials", org: false, link: P },
  { kind: "documents", table: "documents", org: false, link: (p) => ({ linked_entity_type: "project", linked_entity_id: p, uploaded_by_id: "u-mem" }) },
  { kind: "roster", table: "construction_labour_roster", org: false, link: P },
  { kind: "attendance", table: "construction_attendance", org: false, link: P },
  { kind: "timesheets", table: "pms_time_entries", org: false, link: () => ({ issue_id: "trk-iss", user_id: "u-mem" }) },
  { kind: "meetings", table: "pms_meetings", org: false, link: P },
  { kind: "meeting_minutes", table: "veri_meetings", org: false, link: (p) => ({ context_entity_type: "project", context_entity_id: p }) },
  { kind: "site_diaries", table: "construction_site_diaries", org: false, link: P },
  { kind: "site_instructions", table: "construction_site_instructions", org: false, link: P },
  { kind: "progress_claims", table: "construction_progress_claims", org: false, link: P },
  { kind: "interim_bills", table: "construction_interim_bills", org: false, link: P },
  { kind: "material_receipts", table: "construction_material_receipts", org: false, link: (p) => ({ ...P(p), material_id: "trk-mat" }) },
  { kind: "material_issues", table: "construction_material_issues", org: false, link: (p) => ({ ...P(p), material_id: "trk-mat" }) },
  { kind: "expenses", table: "construction_expense_entries", org: false, link: P },
  { kind: "schedule_baselines", table: "pms_schedule_baselines", org: false, link: P },
  { kind: "ffe_items", table: "interior_ffe_items", org: false, link: P },
  { kind: "wiki_pages", table: "pms_wiki_pages", org: false, link: (p) => ({ ...P(p), is_archived: false }) },
  { kind: "vendors", table: "erp_suppliers", org: true, link: () => ({}) },
  { kind: "customers", table: "erp_customers", org: true, link: () => ({}) },
  { kind: "companies", table: "erp_companies", org: true, link: () => ({}) },
  { kind: "boq_categories", table: "construction_boq_categories", org: true, link: () => ({}) },
  { kind: "currencies", table: "erp_currencies", org: true, link: () => ({}) },
  { kind: "exchange_rates", table: "erp_exchange_rates", org: true, link: () => ({}) },
  { kind: "departments", table: "departments", org: true, link: () => ({}) },
  { kind: "org_people", table: "users", org: true, link: () => ({}) },
  { kind: "cost_visibility", table: "cost_visibility_config", org: true, link: () => ({ role: "viewer", can_see_cost: true }) },
]

const lit = (v: Val): string => (v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
let counter = 1000

/** A minimal valid row of compliance.<table>: `fixed` first, then a value for every other NOT NULL column without a default. */
export async function minimalRow(db: PGlite, table: string, fixed: Record<string, Val>): Promise<Record<string, Val>> {
  const cols = (await db.query<{ attname: string; typname: string; typtype: string; typcategory: string; first_label: string | null }>(
    `select a.attname, t.typname, t.typtype, t.typcategory,
            (select e.enumlabel from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder limit 1) first_label
     from pg_attribute a join pg_type t on t.oid = a.atttypid
     where a.attrelid = ('compliance.' || $1)::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef
       and a.attidentity = '' and a.attgenerated = ''`, [table])).rows
  const row: Record<string, Val> = { ...fixed }
  for (const c of cols) {
    if (c.attname in row) continue
    counter += 1
    if (c.typtype === "e") row[c.attname] = c.first_label
    else if (c.typcategory === "N") row[c.attname] = counter
    else if (c.typcategory === "B") row[c.attname] = false
    else if (c.typname === "date") row[c.attname] = "2026-09-01"
    else if (c.typcategory === "D") row[c.attname] = "2026-09-01T00:00:00Z"
    else if (c.typname === "json" || c.typname === "jsonb") row[c.attname] = "{}"
    else if (c.typcategory === "A") row[c.attname] = "{}"
    else if (c.typname === "uuid") row[c.attname] = crypto.randomUUID()
    else row[c.attname] = `${String(fixed.id ?? "x")}-${c.attname}-${counter}`
  }
  return row
}

export function insertSql(table: string, row: Record<string, Val>): string {
  const keys = Object.keys(row)
  return `insert into compliance.${table} (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map((k) => lit(row[k])).join(", ")})`
}

/** A text column of the table that a test may overwrite to make a REAL change (not the id, the organisation or anything that links the row). */
export async function editableColumn(db: PGlite, table: string): Promise<string> {
  const skip = ["id", "org_id", "project_id", "boq_id", "issue_id", "material_id", "user_id", "linked_entity_type", "linked_entity_id", "context_entity_type", "context_entity_id",
    "uploaded_by_id", "role", "email", "auth_user_id", "password_hash", "passcode_hash", "head_id", "status", "entry_basis", "updated_at", "search_vector"]
  const r = (await db.query<{ attname: string }>(
    `select a.attname from pg_attribute a join pg_type t on t.oid = a.atttypid
     where a.attrelid = ('compliance.' || $1)::regclass and a.attnum > 0 and not a.attisdropped and t.typname in ('text', 'varchar')
       and a.attgenerated = '' and not (a.attname = any($2::text[])) order by a.attnotnull desc, a.attnum limit 1`, [table, skip])).rows[0]
  if (!r) throw new Error(`no editable text column on ${table}`)
  return r.attname
}
