// Wave 28 (VERIDIAN AI PMS) service layer -- project meetings, agenda
// items, outcomes/minutes, participants (OpenProject's unique
// contribution among the 3 studied tools). Callers must have already
// passed requirePmsEnabled() (enforced at the route layer).
import {
  pmsMeetings, pmsMeetingAgendaItems, pmsMeetingOutcomes, pmsMeetingParticipants, projects,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

// dbUser is optional/nullable: createMeeting() below only reads
// ctx.orgId/ctx.userId, never ctx.dbUser -- the type used to require it
// unconditionally. Wave 141 (PROJEXA Meetings/MOM, /api/v1/projexa/meetings)
// needs to call createMeeting() from an API-key-only request context
// (requireAuthOrApiKey(), no real session/dbUser), unlike the existing
// session-only /api/v1/pms/meetings route. Narrowing the type to match
// actual usage avoids forcing a fake dbUser object at that call site.
export type PmsContext = { orgId: string; userId: string; dbUser?: typeof users.$inferSelect | null }

export async function listMeetings(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmsMeetings.findMany({ where: and(eq(pmsMeetings.orgId, ctx.orgId), eq(pmsMeetings.projectId, projectId)), orderBy: (t, { desc }) => desc(t.scheduledAt) })
  )
}

export async function getMeeting(ctx: { orgId: string }, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const meeting = await db.query.pmsMeetings.findFirst({ where: and(eq(pmsMeetings.id, meetingId), eq(pmsMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)
    const agendaItems = await db.query.pmsMeetingAgendaItems.findMany({ where: eq(pmsMeetingAgendaItems.meetingId, meetingId), orderBy: (t, { asc }) => asc(t.position) })
    const outcomes = await db.query.pmsMeetingOutcomes.findMany({ where: eq(pmsMeetingOutcomes.meetingId, meetingId), orderBy: (t, { desc }) => desc(t.createdAt) })
    const participants = await db.query.pmsMeetingParticipants.findMany({ where: eq(pmsMeetingParticipants.meetingId, meetingId) })
    return { ...meeting, agendaItems, outcomes, participants }
  })
}

export async function createMeeting(
  ctx: PmsContext,
  projectId: string,
  input: { title: string; scheduledAt: string; durationMinutes?: number; agendaItems?: string[]; participantUserIds?: string[] }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.scheduledAt) throw new ServiceError("scheduledAt is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [meeting] = await db.insert(pmsMeetings).values({
      orgId: ctx.orgId, projectId, title, scheduledAt: new Date(input.scheduledAt), durationMinutes: input.durationMinutes || null,
    }).returning()

    if (input.agendaItems?.length) {
      await db.insert(pmsMeetingAgendaItems).values(
        input.agendaItems.map((agendaTitle, i) => ({ meetingId: meeting.id, position: i, title: agendaTitle }))
      )
    }
    if (input.participantUserIds?.length) {
      await db.insert(pmsMeetingParticipants).values(
        input.participantUserIds.map((userId) => ({ meetingId: meeting.id, userId, responseStatus: "pending" }))
      )
    }

    return meeting
  })
}

export async function addMeetingOutcome(ctx: { orgId: string }, meetingId: string, notes: string) {
  if (!notes?.trim()) throw new ServiceError("notes is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const meeting = await db.query.pmsMeetings.findFirst({ where: and(eq(pmsMeetings.id, meetingId), eq(pmsMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)

    const [row] = await db.insert(pmsMeetingOutcomes).values({ meetingId, notes }).returning()
    return row
  })
}
