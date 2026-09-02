// Wave 116 (PROJEXA foundation) service layer -- Manpower roster + daily
// attendance. dailyCost is computed here at write time from
// roster.dailyRate (half_day = half rate), not a DB generated column,
// matching this codebase's convention elsewhere (e.g. documents.isLatestVersion).
import { constructionLabourRoster, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, isNotNull, sql } from "drizzle-orm"
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

export async function listRoster(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
    })
  )
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

export async function listAttendance(ctx: { orgId: string }, filters: { projectId?: string; rosterId?: string; attendanceDate?: string }) {
  if (!filters.projectId && !filters.rosterId) throw new ServiceError("projectId or rosterId is required", 400)
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (filters.projectId) conditions.push(eq(constructionAttendance.projectId, filters.projectId))
    if (filters.rosterId) conditions.push(eq(constructionAttendance.rosterId, filters.rosterId))
    if (filters.attendanceDate) conditions.push(eq(constructionAttendance.attendanceDate, filters.attendanceDate))
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
