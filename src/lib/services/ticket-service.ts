// Wave 39 (VERIDIAN Ticketing, PLATFORM_STRATEGY.md §21). Peppermint/
// Trudesk/FlowInquiry evaluated and rejected as software. Deliberately does
// NOT build a second messaging system: every ticket wraps an existing
// `conversations` row (Wave 12), so replies, guest messages (Wave 36),
// markdown rendering (Wave 37), and attachments (Wave 32) all work for
// free. External guest participation reuses veri-chat-service.ts's
// createGuestAccess() directly rather than a parallel implementation.
import { db, tickets, conversations, conversationParticipants, notifications } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, lt, notInArray } from "drizzle-orm"
import { createGuestAccess } from "./veri-chat-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TicketContext = { orgId: string; userId: string }

async function assertParticipant(db: Parameters<Parameters<typeof withTenantContext>[1]>[0], conversationId: string, userId: string) {
  const membership = await db.query.conversationParticipants.findFirst({
    where: and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)),
  })
  if (!membership) throw new ServiceError("Ticket not found", 404)
}

export async function listTickets(ctx: { orgId: string }, filters?: { status?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.tickets.findMany({
      where: filters?.status
        ? and(eq(tickets.orgId, ctx.orgId), eq(tickets.status, filters.status))
        : eq(tickets.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function getTicket(ctx: TicketContext, ticketId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("Ticket not found", 404)
    await assertParticipant(db, ticket.conversationId, ctx.userId)
    return ticket
  })
}

export async function createTicket(
  ctx: TicketContext,
  input: { subject: string; category?: string; priority?: string; clientId?: string; requesterUserId?: string; assigneeId?: string; slaHours?: number }
) {
  const subject = input.subject?.trim()
  if (!subject) throw new ServiceError("subject is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const participantIds = new Set([ctx.userId])
    if (input.assigneeId) participantIds.add(input.assigneeId)
    if (input.requesterUserId) participantIds.add(input.requesterUserId)

    const [convo] = await db.insert(conversations).values({
      orgId: ctx.orgId, type: participantIds.size > 2 ? "group" : "direct", title: subject,
    }).returning()
    await db.insert(conversationParticipants).values([...participantIds].map((userId) => ({ conversationId: convo.id, userId })))

    const slaDeadline = input.slaHours ? new Date(Date.now() + input.slaHours * 60 * 60 * 1000) : null
    const [ticket] = await db.insert(tickets).values({
      orgId: ctx.orgId, clientId: input.clientId || null, conversationId: convo.id, subject,
      category: input.category || null, priority: (input.priority as "low" | "medium" | "high" | "critical") || "medium",
      assigneeId: input.assigneeId || null, requesterUserId: input.requesterUserId || null,
      slaDeadline, createdById: ctx.userId,
    }).returning()
    return ticket
  })
}

export async function updateTicket(
  ctx: TicketContext,
  ticketId: string,
  patch: Partial<{ status: string; priority: string; assigneeId: string | null; category: string | null }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("Ticket not found", 404)
    await assertParticipant(db, ticket.conversationId, ctx.userId)

    const resolvedAt = patch.status && (patch.status === "resolved" || patch.status === "closed") ? new Date() : ticket.resolvedAt
    const [updated] = await db.update(tickets)
      .set({ ...patch, resolvedAt, updatedAt: new Date() } as never)
      .where(eq(tickets.id, ticketId)).returning()

    // Newly assigned to someone not yet in the conversation -- add them so
    // they can actually see/reply to it, same "assignee must be a
    // participant" invariant chat-service.ts enforces elsewhere.
    if (patch.assigneeId) {
      const existing = await db.query.conversationParticipants.findFirst({
        where: and(eq(conversationParticipants.conversationId, ticket.conversationId), eq(conversationParticipants.userId, patch.assigneeId)),
      })
      if (!existing) await db.insert(conversationParticipants).values({ conversationId: ticket.conversationId, userId: patch.assigneeId })
    }
    return updated
  })
}

// Reuses veri-chat-service.ts's createGuestAccess() directly -- a ticket's
// external requester is just a guest on the ticket's underlying
// conversation, the exact same mechanism Wave 36 already built and proved.
export async function inviteGuestToTicket(ctx: TicketContext, ticketId: string, input: { guestName: string; guestEmail?: string }) {
  const ticket = await getTicket(ctx, ticketId)
  return createGuestAccess(ctx, ticket.conversationId, input)
}

// SLA breach check -- called from the same daily cron as Wave 38's metric
// alerts (/api/internal/metric-alerts/run), not a second cron job. Uses the
// raw `db` client since a scheduled job has no single request-scoped org,
// same posture as instruction-mismatch-audit.ts. Re-notifies once per run
// until the ticket is resolved/closed -- matching Grafana's own default
// re-alert-until-resolved behavior rather than a fire-once flag.
export async function checkTicketSlaBreaches(): Promise<{ breached: number }> {
  const now = new Date()
  const overdue = await db.query.tickets.findMany({
    where: and(lt(tickets.slaDeadline, now), notInArray(tickets.status, ["resolved", "closed"])),
  })

  for (const ticket of overdue) {
    const notifyIds = new Set([ticket.assigneeId, ticket.createdById].filter((id): id is string => Boolean(id)))
    for (const userId of notifyIds) {
      await db.insert(notifications).values({
        userId,
        title: `SLA breached: ${ticket.subject}`,
        message: `Ticket "${ticket.subject}" missed its SLA deadline (${ticket.slaDeadline?.toISOString()}) and is still ${ticket.status}.`,
        type: "system",
        metadata: { ticketId: ticket.id, conversationId: ticket.conversationId },
      })
    }
  }

  return { breached: overdue.length }
}
