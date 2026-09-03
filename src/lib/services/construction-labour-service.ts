// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, erpSuppliers, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type RosterInput = {
  projectId: string
  name: string
  employeeCode?: string
  trade?: string
  skillLevel?: string
  vendorId?: string
  dailyRate: number
}

// ---------------------------------------------------------------------------
// R67 D-34 (R-085/R-091): the roster is where every trade-wise number
// downstream comes from, and it was the weakest form in the product.
//
// employee_code was "customer-assigned free-text, not a key, not unique-
// enforced, not auto-generated" (see schema.ts's own comment) and the create
// form marked it optional -- so most workers landed on the list with an ID cell
// reading "—", and the success line could not name what it had just made.
// A blank code now gets one, generated per org.
export const EMPLOYEE_CODE_PREFIX = "W-"
const EMPLOYEE_CODE_PAD = 4

/** Pure. "W-0042". Four digits is the zero-padding the acceptance pins; a bigger number simply gets longer rather than wrapping. */
export function formatEmployeeCode(sequence: number): string {
  return `${EMPLOYEE_CODE_PREFIX}${String(sequence).padStart(EMPLOYEE_CODE_PAD, "0")}`
}

// NOTE: an earlier draft of this file also exported a pure
// nextEmployeeCodeSequence(existingCodes) helper. It is gone deliberately: its
// only caller was the max(employee_code)+1 read-then-write that
// generateEmployeeCode below no longer does, and the rule it encoded ("ignore
// customer-assigned codes that are not in the W-nnnn shape") now lives where it
// belongs -- in drizzle/0529_r67_i02's seeding of
// construction_employee_code_counters, which is the only place that has to
// decide it. An exported pure helper nothing calls is a second copy of a rule
// waiting to drift from the one the database applies.

/**
 * The generated-code branch. THIS IS THE CALLER schema.ts's comment on
 * compliance.construction_employee_code_counters names as its contract, and it
 * follows that contract literally: claim the next number with ONE atomic
 * statement, inside the same transaction as the roster insert, never
 * read-then-write.
 *
 * WHY NOT max(employee_code)+1 (which an earlier draft of this function used):
 * R67 lane I's drizzle/0529_r67_i02 created a PARTIAL UNIQUE INDEX
 * construction_labour_roster_org_employee_code_unique on
 * (org_id, employee_code) where the code is non-blank. Under a read-then-write
 * two concurrent creates read the same max, both format the same "W-0007", and
 * the second INSERT raises a unique violation -- a 500 for a user who did
 * nothing wrong. The counter row serialises the claim instead: the second
 * transaction blocks on the ON CONFLICT DO UPDATE until the first commits, then
 * reads the incremented value.
 *
 * The counter is per org (not a Postgres SEQUENCE) because a sequence is a
 * single global object and one-per-org would mean runtime DDL, which the
 * app_runtime role must never do. 0529 seeds each org's counter from the
 * highest 'W-nnnn' already on its roster, so a generated number can never
 * collide with a code someone typed by hand.
 */
async function generateEmployeeCode(db: TenantDb, orgId: string): Promise<string> {
  const claimed = await db.execute(sql`
    INSERT INTO compliance.construction_employee_code_counters (org_id, last_number)
    VALUES (${orgId}, 1)
    ON CONFLICT (org_id) DO UPDATE
      SET last_number = construction_employee_code_counters.last_number + 1,
          updated_at = now()
    RETURNING last_number
  `)
  // drizzle's execute() returns the driver's own result shape; postgres-js
  // yields the rows array directly, node-postgres wraps them in `.rows`.
  const rows = (Array.isArray(claimed) ? claimed : (claimed as { rows?: unknown[] }).rows) ?? []
  const lastNumber = Number((rows[0] as { last_number?: number | string } | undefined)?.last_number)
  if (!Number.isFinite(lastNumber) || lastNumber < 1) {
    throw new ServiceError("Could not allocate a worker ID", 500)
  }
  return formatEmployeeCode(lastNumber)
}

/**
 * The trades the create/edit form offers. Seeded so a brand-new org is not
 * asked to invent a vocabulary, merged with whatever the org has actually used
 * so an existing free-text trade never disappears from the picker the day it
 * becomes a Select.
 */
export const SEED_TRADES = ["Mason", "Carpenter", "Electrician", "Plumber", "Painter", "Helper", "Supervisor"] as const

/** Pure. Case-insensitive merge, seeds first (in their given order), then anything else the org has used, alphabetically. */
export function mergeTrades(existing: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const seed of SEED_TRADES) seen.set(seed.toLowerCase(), seed)
  const extra: string[] = []
  for (const value of existing) {
    const trade = value?.trim()
    if (!trade) continue
    const key = trade.toLowerCase()
    if (seen.has(key)) continue
    seen.set(key, trade)
    extra.push(trade)
  }
  return [...SEED_TRADES, ...extra.sort((a, b) => a.localeCompare(b))]
}

export async function listRosterTrades(ctx: { orgId: string }): Promise<string[]> {
  const used = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.selectDistinct({ trade: constructionLabourRoster.trade })
      .from(constructionLabourRoster)
      .where(and(eq(constructionLabourRoster.orgId, ctx.orgId), isNotNull(constructionLabourRoster.trade)))
  )
  return mergeTrades(used.map((r) => r.trade))
}

// R67 F-13 (R-193/R-217): each row carries its vendor's NAME, resolved by ONE
// batched read on the transaction this function already holds (never one per
// row, and skipped entirely when no row is subcontracted).
//
// Why it belongs here: every consumer of this list that wants to show "who the
// worker belongs to" had to fetch the whole vendor master separately and join
// it in the browser -- PROJEXA's Work Progress Report did exactly that as one
// of its six VERIDIAN calls, purely to turn a vendorId into a name. vendorId is
// kept alongside it, so nothing that keys on the id has to change.
//
// A vendor row that has been deleted reports null, never the raw id: the caller
// decides how to say "unknown", the same convention
// construction-progress-service.ts uses for its own label resolution.
export async function listRoster(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter((id): id is string => !!id))]
    const vendors = vendorIds.length === 0
      ? []
      : await db.query.erpSuppliers.findMany({
          where: and(eq(erpSuppliers.orgId, ctx.orgId), inArray(erpSuppliers.id, vendorIds)),
          columns: { id: true, supplierName: true },
        })
    const nameById = new Map(vendors.map((v) => [v.id, v.supplierName]))
    return rows.map((r) => ({ ...r, vendorName: r.vendorId ? (nameById.get(r.vendorId) ?? null) : null }))
  })
}

// R67 F-30 (audit recommendation R-274) -- THE MANPOWER LANDING, IN ONE HOP.
//
// THE MEASURED PROBLEM. /labour took about 6 s to a usable screen for SQL the
// audit measured as trivial. F-18 removed the serial /dashboard +
// /screen-definitions chain in front of it and F-25 stopped the screen
// fetching the whole undated attendance log it was not showing. What was left
// is the shape of the landing itself: the page wants the roster AND the "how
// did today go" summary, and asking for them one after the other is two
// network hops to VERIDIAN and two transactions on a five-connection pool for
// one screen.
//
// So a single call answers both, inside ONE withTenantContext. The summary is
// a grouped aggregate over ONE DAY -- not the whole log -- so it uses the
// (project_id, attendance_date) index migration 0529 added and stays a
// constant-size answer however long the project runs.

export type AttendanceSummary = {
  /** The day this summary is about, YYYY-MM-DD. */
  date: string
  /** How many attendance rows exist for that day. */
  recorded: number
  present: number
  halfDay: number
  absent: number
  /** Σ daily_cost for that day. */
  totalCost: number
}

const EMPTY_STATUS_COUNTS = { present: 0, halfDay: 0, absent: 0 }

/**
 * One day's attendance, grouped by status, in ONE statement.
 *
 * A day with no rows is a real answer -- "nobody has marked attendance yet" --
 * and returns zeroes, never null, so the caller does not have to decide
 * whether an absent object means "none" or "we could not find out". The
 * failure case is a thrown error, which is a different thing entirely.
 */
async function loadAttendanceSummary(
  db: TenantDb,
  orgId: string,
  projectId: string,
  date: string
): Promise<AttendanceSummary> {
  const rows = (await db.execute(sql`
    SELECT status,
           count(*)::int AS entries,
           coalesce(sum(daily_cost), 0)::float AS cost
    FROM compliance.construction_attendance
    WHERE org_id = ${orgId} AND project_id = ${projectId} AND attendance_date = ${date}
    GROUP BY status
  `)) as { status: string; entries: number; cost: number }[]

  const counts = { ...EMPTY_STATUS_COUNTS }
  let recorded = 0
  let totalCost = 0
  for (const row of rows) {
    const entries = Number(row.entries ?? 0)
    recorded += entries
    totalCost += Number(row.cost ?? 0)
    if (row.status === "present") counts.present += entries
    else if (row.status === "half_day") counts.halfDay += entries
    else if (row.status === "absent") counts.absent += entries
    // An unrecognised status still counts toward `recorded` and the cost --
    // silently dropping a row would understate the day.
  }
  return { date, recorded, ...counts, totalCost }
}

/**
 * The whole /labour landing: the roster, and one day's attendance summary,
 * in ONE transaction and ONE round trip.
 *
 * `date` is the day the summary is about. The caller supplies it -- the
 * server's own "today" is not the site's today, and a foreman in Mumbai
 * looking at a summary computed in UTC would be looking at the wrong day for
 * five and a half hours of every one of them.
 */
export async function getLabourLanding(
  ctx: { orgId: string },
  projectId: string,
  options: { attendanceDate?: string } = {}
): Promise<{ roster: (typeof constructionLabourRoster.$inferSelect)[]; attendanceSummary: AttendanceSummary | null }> {
  if (!projectId) throw new ServiceError("projectId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const roster = await db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
    const attendanceSummary = options.attendanceDate
      ? await loadAttendanceSummary(db, ctx.orgId, projectId, options.attendanceDate)
      : null
    return { roster, attendanceSummary }
  })
}

export async function createRosterEntry(ctx: { orgId: string }, input: RosterInput) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  // R67 D-34: a rate that is not a number used to be stringified straight into
  // a numeric column ("NaN"), and a negative one was stored as-is -- both then
  // corrupt every trade-wise cost figure downstream. Refused BY NAME, before a
  // transaction is opened. Left optional (defaulting to 0, as before) so no
  // existing caller changes behaviour.
  if (input.dailyRate !== undefined && input.dailyRate !== null) {
    if (!Number.isFinite(input.dailyRate) || input.dailyRate < 0) {
      throw new ServiceError("dailyRate must be a number of 0 or more", 400)
    }
  }

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    // R67 D-34: a blank code is FILLED, not stored as null. The caller's own
    // code, when it supplies one, is still stored verbatim -- this generates,
    // it never overrides.
    const employeeCode = input.employeeCode?.trim() || (await generateEmployeeCode(db, ctx.orgId))

    const [row] = await db.insert(constructionLabourRoster).values({
      orgId: ctx.orgId, projectId: input.projectId, name,
      employeeCode,
      trade: input.trade || null, skillLevel: input.skillLevel || null, vendorId: input.vendorId || null,
      dailyRate: String(input.dailyRate ?? 0),
    }).returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): single-entry lookup + real update for
// the Roster Object Page -- listRoster/createRosterEntry existed since Wave
// 116 with no way to view or edit one entry (rate corrections, reassigning
// a subcontractor, retiring a worker) short of re-creating it.
export async function getRosterEntry(ctx: { orgId: string }, rosterId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const entry = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!entry) throw new ServiceError("Roster entry not found", 404)
    return entry
  })
}

export async function updateRosterEntry(
  ctx: { orgId: string },
  rosterId: string,
  patch: Partial<{ name: string; employeeCode: string | null; trade: string | null; skillLevel: string | null; vendorId: string | null; dailyRate: number; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Roster entry not found", 404)
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("name cannot be empty", 400)

    const [row] = await db.update(constructionLabourRoster)
      .set({ ...patch, dailyRate: patch.dailyRate !== undefined ? String(patch.dailyRate) : undefined })
      .where(eq(constructionLabourRoster.id, rosterId)).returning()
    return row
  })
}

// R67 F-25 (audit recommendation R-241) x F-06 (R-088/R-094) -- ATTENDANCE IS A
// DATED QUESTION. Two lanes found the same fault and it is folded here under
// D-11: F-25's filter shape is canonical, F-06's validation is folded in.
//
// THE MEASURED PROBLEM. PROJEXA's Manpower screen fetched THE WHOLE ATTENDANCE
// LOG on every landing, with no date filter at all, even though the screen
// opens on the Roster tab and never shows a row of it until the user switches.
// A site with 40 workers produces 40 rows a day, so the payload grows as
// workers x days -- a project a year old answers this call with roughly 10,000
// rows nobody looks at -- and the one date a foreman actually wants, today, is
// buried in it.
//
// `date` (one day) and `from`/`to` (a range, both inclusive, attendance_date is
// a plain date column) are the filters that were missing. `attendanceDate` is
// KEPT as an alias for `date` so every existing caller and every existing
// ?attendanceDate= query string keeps working unchanged; passing both is not an
// error, they mean the same thing and `date` wins.
export type AttendanceFilters = {
  projectId?: string
  rosterId?: string
  /** One exact day, YYYY-MM-DD. */
  date?: string
  /** Back-compat alias for `date` -- the original parameter name. */
  attendanceDate?: string
  /** Inclusive range start, YYYY-MM-DD. Ignored when `date` is set. */
  from?: string
  /** Inclusive range end, YYYY-MM-DD. Ignored when `date` is set. */
  to?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * R67 F-06. Validates the optional [from, to] attendance window.
 *
 * Deliberately strict: `attendance_date` is a Postgres DATE compared as text
 * here, so a malformed bound would not error, it would silently match nothing
 * and be read as "this worker was never on site". A caller that sends a bad
 * date is told so (400) rather than shown a confidently empty log.
 */
export function normaliseAttendanceRange(filters: { from?: string; to?: string }): { from?: string; to?: string } {
  const from = filters.from?.trim() || undefined
  const to = filters.to?.trim() || undefined
  if (from && !ISO_DATE.test(from)) throw new ServiceError("from must be a date in YYYY-MM-DD format", 400)
  if (to && !ISO_DATE.test(to)) throw new ServiceError("to must be a date in YYYY-MM-DD format", 400)
  if (from && to && from > to) throw new ServiceError("from must not be later than to", 400)
  return { from, to }
}

export async function listAttendance(ctx: { orgId: string }, filters: AttendanceFilters) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  const exactDate = filters.date ?? filters.attendanceDate
  const { from, to } = normaliseAttendanceRange(filters)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    // A single day is an equality, not a degenerate range -- it can use the
    // (project_id, attendance_date) index directly.
    if (exactDate) {
      conditions.push(eq(constructionAttendance.attendanceDate, exactDate))
    } else {
      if (from) conditions.push(gte(constructionAttendance.attendanceDate, from))
      if (to) conditions.push(lte(constructionAttendance.attendanceDate, to))
    }
    return db.query.constructionAttendance.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.attendanceDate) })
  })
}

const COST_MULTIPLIER: Record<string, number> = { present: 1, half_day: 0.5, absent: 0 }

export async function recordAttendance(
  ctx: { orgId: string },
  input: { projectId: string; rosterId: string; attendanceDate: string; status?: string; hoursWorked?: number }
) {
  if (!input.rosterId) throw new ServiceError("rosterId is required", 400)
  if (!input.attendanceDate) throw new ServiceError("attendanceDate is required", 400)
  const status = input.status || "present"

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const roster = await db.query.constructionLabourRoster.findFirst({ where: and(eq(constructionLabourRoster.id, input.rosterId), eq(constructionLabourRoster.orgId, ctx.orgId)) })
    if (!roster) throw new ServiceError("Roster entry not found", 404)

    const existing = await db.query.constructionAttendance.findFirst({
      where: and(eq(constructionAttendance.rosterId, input.rosterId), eq(constructionAttendance.attendanceDate, input.attendanceDate)),
    })
    if (existing) throw new ServiceError("Attendance already recorded for this worker on this date", 409)

    const dailyCost = Number(roster.dailyRate) * (COST_MULTIPLIER[status] ?? 1)

    const [row] = await db.insert(constructionAttendance).values({
      orgId: ctx.orgId, projectId: input.projectId, rosterId: input.rosterId, attendanceDate: input.attendanceDate,
      status: status as typeof constructionAttendance.$inferInsert.status,
      hoursWorked: input.hoursWorked !== undefined ? String(input.hoursWorked) : null,
      dailyCost: String(dailyCost),
    }).returning()
    return row
  }).then((row) => {
    // Wave 126: fire-and-forget automation trigger.
    if (row.status === "absent") {
      void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
        evaluateAndRunRules({ orgId: ctx.orgId }, "construction_attendance.worker_absent", {
          rosterId: row.rosterId, projectId: row.projectId, attendanceDate: row.attendanceDate,
        })
      )
    }
    return row
  })
}
