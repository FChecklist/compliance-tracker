// Wave 107 (VERI FM & CS AI OS) -- PPM (Planned Preventive Maintenance)
// schedule + occurrence engine. The genuinely novel piece versus
// compliance_items' recurrenceType model: one asset can have MULTIPLE
// simultaneous active fmPpmSchedules rows (weekly AND monthly AND
// quarterly AND yearly, all live at once -- confirmed real data), and
// occurrence generation is cron-driven on a rolling window rather than
// the compliance module's manual-trigger-one-item-at-a-time model. See
// generateDueOccurrences() below for the full reasoning.
import { db, fmPpmSchedules, fmPpmOccurrences, fmPpmOccurrenceItemResults, fmChecklistTemplates } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, lte, or, isNull } from "drizzle-orm"
import { addDays, addWeeks, addMonths } from "date-fns"
import { requireFmEnabled } from "./fm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmPpmContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// Rolling lookahead window for occurrence generation -- deliberately NOT
// "generate every future occurrence forever" (see generateDueOccurrences'
// own comment for why) and NOT lazy/on-view (ground staff must see today's
// due tasks without anyone pressing a button).
const GENERATION_LOOKAHEAD_DAYS = 14

function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}
function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function advanceDueDate(currentDateStr: string, frequency: string): string {
  const current = parseDateOnly(currentDateStr)
  switch (frequency) {
    case "daily": return formatDateOnly(addDays(current, 1))
    case "weekly": return formatDateOnly(addWeeks(current, 1))
    case "fortnightly": return formatDateOnly(addWeeks(current, 2))
    case "monthly": return formatDateOnly(addMonths(current, 1))
    case "quarterly": return formatDateOnly(addMonths(current, 3))
    case "half_yearly": return formatDateOnly(addMonths(current, 6))
    case "annually": return formatDateOnly(addMonths(current, 12))
    default: throw new ServiceError(`Unknown PPM frequency: ${frequency}`, 500)
  }
}

// Inserts one occurrence for a schedule at its current nextDueDate, then
// advances the schedule's nextDueDate by the template's frequency. Shared
// by both the synchronous first-occurrence path (schedule creation) and
// the cron's batch generation, so the two never drift out of sync.
async function generateOneOccurrence(db: TenantDb, schedule: typeof fmPpmSchedules.$inferSelect, frequency: string) {
  const [occurrence] = await db.insert(fmPpmOccurrences).values({
    orgId: schedule.orgId,
    scheduleId: schedule.id,
    assetId: schedule.assetId,
    dueDate: schedule.nextDueDate,
    assigneeId: schedule.defaultAssigneeId,
  }).returning()

  await db.update(fmPpmSchedules).set({
    nextDueDate: advanceDueDate(schedule.nextDueDate, frequency),
    lastGeneratedOccurrenceId: occurrence.id,
    updatedAt: new Date(),
  }).where(eq(fmPpmSchedules.id, schedule.id))

  return occurrence
}

export type FmPpmScheduleInput = {
  assetId: string
  checklistTemplateId: string
  nextDueDate: string
  defaultAssigneeId?: string | null
}

export async function createPpmSchedule(ctx: FmPpmContext, input: FmPpmScheduleInput) {
  await requireFmEnabled(ctx.orgId)
  if (!input.nextDueDate) throw new ServiceError("nextDueDate is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const template = await db.query.fmChecklistTemplates.findFirst({
      where: and(eq(fmChecklistTemplates.id, input.checklistTemplateId), or(isNull(fmChecklistTemplates.orgId), eq(fmChecklistTemplates.orgId, ctx.orgId))),
    })
    if (!template) throw new ServiceError("Checklist template not found", 404)

    const [schedule] = await db.insert(fmPpmSchedules).values({
      orgId: ctx.orgId,
      assetId: input.assetId,
      checklistTemplateId: input.checklistTemplateId,
      nextDueDate: input.nextDueDate,
      defaultAssigneeId: input.defaultAssigneeId ?? null,
      createdById: ctx.userId,
    }).returning()

    // Deliberate exception to "cron-only" generation: a newly created
    // schedule due within the lookahead window generates its first
    // occurrence synchronously, in the same request, so ground staff see
    // it immediately rather than waiting for tonight's cron run.
    const dueWithinWindow = parseDateOnly(input.nextDueDate).getTime() <= addDays(new Date(), GENERATION_LOOKAHEAD_DAYS).getTime()
    if (dueWithinWindow) {
      await generateOneOccurrence(db, schedule, template.frequency)
    }

    return schedule
  })
}

export async function listPpmSchedulesForAsset(ctx: { orgId: string }, assetId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmPpmSchedules.findMany({
      where: and(eq(fmPpmSchedules.assetId, assetId), eq(fmPpmSchedules.orgId, ctx.orgId)),
      orderBy: (t, { asc }) => asc(t.nextDueDate),
    })
  })
}

export async function listDueOccurrences(ctx: { orgId: string }, filters?: { assigneeId?: string; status?: string }) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(fmPpmOccurrences.orgId, ctx.orgId)]
    if (filters?.assigneeId) conditions.push(eq(fmPpmOccurrences.assigneeId, filters.assigneeId))
    if (filters?.status) conditions.push(eq(fmPpmOccurrences.status, filters.status as typeof fmPpmOccurrences.$inferSelect["status"]))
    return db.query.fmPpmOccurrences.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => asc(t.dueDate),
    })
  })
}

export type FmOccurrenceItemResultInput = {
  templateItemId: string
  isChecked?: boolean
  numericValue?: number | null
  textNote?: string | null
}

export async function completeOccurrence(ctx: FmPpmContext, occurrenceId: string, itemResults: FmOccurrenceItemResultInput[], completionNotes?: string | null) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const occurrence = await db.query.fmPpmOccurrences.findFirst({
      where: and(eq(fmPpmOccurrences.id, occurrenceId), eq(fmPpmOccurrences.orgId, ctx.orgId)),
    })
    if (!occurrence) throw new ServiceError("PPM occurrence not found", 404)
    if (occurrence.status === "completed") throw new ServiceError("This occurrence is already completed", 409)

    const now = new Date()
    if (itemResults.length > 0) {
      await db.insert(fmPpmOccurrenceItemResults).values(
        itemResults.map((r) => ({
          occurrenceId,
          templateItemId: r.templateItemId,
          isChecked: r.isChecked ?? false,
          numericValue: r.numericValue != null ? String(r.numericValue) : null,
          textNote: r.textNote ?? null,
          orgId: ctx.orgId,
          completedAt: now,
        }))
      )
    }

    const [updated] = await db.update(fmPpmOccurrences).set({
      status: "completed",
      completedAt: now,
      completedById: ctx.userId,
      completionNotes: completionNotes ?? null,
      updatedAt: now,
    }).where(eq(fmPpmOccurrences.id, occurrenceId)).returning()

    return updated
  })
}

// Cron entrypoint (see src/app/api/internal/fm-ppm/generate-occurrences/route.ts).
// Runs across every org, not scoped to one -- the cron itself has no
// single org context. Two responsibilities:
//   1. Generate the next occurrence for every active schedule whose
//      nextDueDate falls within the rolling lookahead window and has no
//      occurrence yet at that date.
//   2. Mark any still-'due' occurrence whose dueDate has passed as
//      'overdue' (once, via overdueNotifiedAt, so a cron running daily
//      doesn't re-notify the same occurrence every run).
// Rolling-window (not eager-forever) generation is deliberate: editing a
// schedule (pause, reassign, change frequency) takes effect on the NEXT
// run rather than needing to unwind thousands of already-generated future
// rows, unlike an eager-forever approach would require.
export async function generateDueOccurrences(): Promise<{ generated: number; markedOverdue: number }> {
  const cutoff = formatDateOnly(addDays(new Date(), GENERATION_LOOKAHEAD_DAYS))
  const today = formatDateOnly(new Date())

  const dueSchedules = await db.query.fmPpmSchedules.findMany({
    where: and(eq(fmPpmSchedules.isActive, true), lte(fmPpmSchedules.nextDueDate, cutoff)),
  })

  // Inlined rather than reusing generateOneOccurrence() above: that helper
  // is typed against TenantDb (the withTenantContext transaction object),
  // while this cron intentionally runs cross-org against the raw `db`
  // export (no single org context exists for a cron run) -- same
  // raw-db-for-cross-org-scan convention metric-alert-service.ts's own
  // cron entrypoint already uses. Sharing one helper across both would
  // require a type-unsafe cast; duplicating this ~6-line body is the
  // honest choice instead.
  let generated = 0
  for (const schedule of dueSchedules) {
    const template = await db.query.fmChecklistTemplates.findFirst({ where: eq(fmChecklistTemplates.id, schedule.checklistTemplateId) })
    if (!template) continue // orphaned schedule (template deleted) -- skip, don't crash the whole cron run
    const existingOccurrence = await db.query.fmPpmOccurrences.findFirst({
      where: and(eq(fmPpmOccurrences.scheduleId, schedule.id), eq(fmPpmOccurrences.dueDate, schedule.nextDueDate)),
    })
    if (existingOccurrence) continue // already generated this occurrence (idempotent re-run safety)

    const [occurrence] = await db.insert(fmPpmOccurrences).values({
      orgId: schedule.orgId,
      scheduleId: schedule.id,
      assetId: schedule.assetId,
      dueDate: schedule.nextDueDate,
      assigneeId: schedule.defaultAssigneeId,
    }).returning()
    await db.update(fmPpmSchedules).set({
      nextDueDate: advanceDueDate(schedule.nextDueDate, template.frequency),
      lastGeneratedOccurrenceId: occurrence.id,
      updatedAt: new Date(),
    }).where(eq(fmPpmSchedules.id, schedule.id))
    generated++
  }

  const overdueOccurrences = await db.query.fmPpmOccurrences.findMany({
    where: and(eq(fmPpmOccurrences.status, "due"), lte(fmPpmOccurrences.dueDate, today)),
  })
  let markedOverdue = 0
  for (const occ of overdueOccurrences) {
    if (occ.overdueNotifiedAt) continue
    await db.update(fmPpmOccurrences).set({ status: "overdue", overdueNotifiedAt: new Date(), updatedAt: new Date() }).where(eq(fmPpmOccurrences.id, occ.id))
    markedOverdue++
  }

  return { generated, markedOverdue }
}
