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

/**
 * Pure. The next sequence after the highest generated code an org already
 * holds. Deliberately ignores customer-assigned codes that are not in this
 * generated shape ("EMP-001", "12", "Ali's badge"): those are the customer's
 * own labels, and letting one of them set the counter would either crash on a
 * non-numeric suffix or jump the sequence to an arbitrary number.
 */
export function nextEmployeeCodeSequence(existingCodes: (string | null | undefined)[]): number {
  let highest = 0
  for (const code of existingCodes) {
    const match = code?.trim().match(/^W-(\d+)$/)
    if (!match) continue
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > highest) highest = value
  }
  return highest + 1
}

/**
 * The generated-code branch, run INSIDE the caller's transaction so the max and
 * the insert see the same snapshot.
 *
 * Honest limitation: employee_code carries no unique constraint (by design --
 * see schema.ts), so two creates racing in READ COMMITTED could both read the
 * same max and produce the same code. That is a duplicate LABEL, not a
 * duplicate row or a lost worker, and it is strictly better than today's
 * behaviour, which is that neither row gets a code at all. Adding a unique
 * index is NOT safe as a blind migration: real orgs already hold hand-typed
 * codes that may legitimately repeat.
 */
async function generateEmployeeCode(db: TenantDb, orgId: string): Promise<string> {
  const [row] = await db
    .select({
      maxSequence: sql<number>`coalesce(max((substring(${constructionLabourRoster.employeeCode} from 3))::int), 0)`,
    })
    .from(constructionLabourRoster)
    .where(and(
      eq(constructionLabourRoster.orgId, orgId),
      isNotNull(constructionLabourRoster.employeeCode),
      // Only the generated shape, for the same reason
      // nextEmployeeCodeSequence ignores everything else.
      sql`${constructionLabourRoster.employeeCode} ~ '^W-[0-9]+$'`,
    ))
  return formatEmployeeCode(Number(row?.maxSequence ?? 0) + 1)
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
