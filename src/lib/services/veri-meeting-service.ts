// Wave 34 (VERI Minutes of Meetings, PLATFORM_STRATEGY.md §16). Genuinely
// new, general-purpose -- board_meetings (Wave 8, governance-only) and
// pms_meetings (Wave 28, PMS-project-scoped) are both real but scope-locked.
// minutesHistory mirrors board_meetings' own amend-don't-overwrite
// precedent verbatim. Action items become real `tasks` rows (which VERI
// To Do already surfaces) via veri_meeting_action_items, not a parallel
// tracking mechanism.
import { veriMeetings, veriMeetingActionItems, tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, desc } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type VeriMeetingContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function listVeriMeetings(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.veriMeetings.findMany({ where: eq(veriMeetings.orgId, ctx.orgId), orderBy: desc(veriMeetings.scheduledAt) })
  )
}

export async function getVeriMeeting(ctx: { orgId: string }, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)
    const actionItems = await db.query.veriMeetingActionItems.findMany({
      where: eq(veriMeetingActionItems.meetingId, meetingId),
      with: { task: true },
    })
    return { ...meeting, actionItems }
  })
}

export async function createVeriMeeting(
  ctx: VeriMeetingContext,
  input: { title: string; meetingType?: string; scheduledAt: string; attendees?: string[]; agenda?: string[]; contextEntityType?: string; contextEntityId?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.scheduledAt) throw new ServiceError("scheduledAt is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [meeting] = await db.insert(veriMeetings).values({
      orgId: ctx.orgId, title, meetingType: input.meetingType || "team", scheduledAt: new Date(input.scheduledAt),
      attendees: input.attendees || [], agenda: input.agenda || [],
      contextEntityType: input.contextEntityType || null, contextEntityId: input.contextEntityId || null,
      createdById: ctx.userId,
    }).returning()
    return meeting
  })
}

export async function updateMeetingMinutes(ctx: VeriMeetingContext, meetingId: string, minutes: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Meeting not found", 404)

    const history = Array.isArray(existing.minutesHistory) ? existing.minutesHistory : []
    const amendment = { date: new Date().toISOString(), amendedBy: ctx.userId, text: minutes }

    const [updated] = await db.update(veriMeetings)
      .set({ minutes, minutesHistory: [...history, amendment], updatedAt: new Date() })
      .where(eq(veriMeetings.id, meetingId)).returning()
    return updated
  })
}

// Action item becomes a real `tasks` row -- VERI To Do's listVeriTodos()
// already surfaces it, no separate tracking table.
export async function addMeetingActionItem(
  ctx: VeriMeetingContext,
  meetingId: string,
  input: { title: string; assigneeUserId?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)

    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ctx.userId, assignedById: ctx.userId,
      title, description: `Action item from meeting: ${meeting.title}`, status: "pending",
    }).returning()

    const [actionItem] = await db.insert(veriMeetingActionItems).values({ meetingId, taskId: task.id }).returning()
    return { ...actionItem, task }
  })
}
