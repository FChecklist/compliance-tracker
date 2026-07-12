// Wave 39 (VERIDIAN Ticketing, PLATFORM_STRATEGY.md §21). Peppermint/
// Trudesk/FlowInquiry evaluated and rejected as software. Deliberately does
// NOT build a second messaging system: every ticket wraps an existing
// `conversations` row (Wave 12), so replies, guest messages (Wave 36),
// markdown rendering (Wave 37), and attachments (Wave 32) all work for
// free. External guest participation reuses veri-chat-service.ts's
// createGuestAccess() directly rather than a parallel implementation.
import {
  db, tickets, conversations, conversationParticipants, notifications, users,
  installedProducts, ticketSatisfactionSurveys, fieldServiceDispatches, problemRecords, problemTickets,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, lt, notInArray, desc, inArray } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { createGuestAccess, resolveActiveGuestAccess } from "./veri-chat-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { recordAuditTrigger } from "@/lib/audit-event-triggers"

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

    // No .returning() on the conversations insert -- see chat-service.ts's
    // ensureAiThread() comment: RETURNING is filtered through the SELECT
    // policy, which for conversations requires an already-existing
    // participant row that can't exist until the next statement.
    const conversationId = createId()
    await db.insert(conversations).values({
      id: conversationId, orgId: ctx.orgId, type: participantIds.size > 2 ? "group" : "direct", title: subject,
    })
    await db.insert(conversationParticipants).values([...participantIds].map((userId) => ({ conversationId, userId })))

    const slaDeadline = input.slaHours ? new Date(Date.now() + input.slaHours * 60 * 60 * 1000) : null
    const [ticket] = await db.insert(tickets).values({
      orgId: ctx.orgId, clientId: input.clientId || null, conversationId, subject,
      category: input.category || null, priority: (input.priority as "low" | "medium" | "high" | "critical") || "medium",
      assigneeId: input.assigneeId || null, requesterUserId: input.requesterUserId || null,
      slaDeadline, createdById: ctx.userId,
    }).returning()

    // D15.B2.S1 named event #7, "Customer Complaint -> Exception Audit" --
    // every new ticket is the general-purpose "customer complaint/support"
    // entity in this codebase (poshComplaints is the narrower,
    // harassment-specific case, not this one). TicketContext carries only
    // userId, not a full dbUser row (unlike ErpContext/KbContext), so the
    // acting user is looked up here, inside the same transaction, for
    // logActivity()'s required actor -- best-effort, never blocks ticket
    // creation if the lookup or the log write fails.
    const creator = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) })
    if (creator) {
      await recordAuditTrigger({
        tx: db, event: "customer_complaint", entityType: "ticket", entityId: ticket.id, orgId: ctx.orgId,
        dbUser: creator, details: `Ticket "${subject}" opened${input.category ? ` (category: ${input.category})` : ""}.`,
      }).catch((err) => console.error(`[audit-trigger] failed to record customer_complaint for ticket ${ticket.id}:`, err))
    }

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

// ─── Wave 81 (Customer Service enhancements, COMPARISON_CSV_GAP_ANALYSIS.md
// backlog #2) ────────────────────────────────────────────────────────────

// Installed-product / warranty tracking.
export async function listInstalledProducts(ctx: { orgId: string }, clientId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.installedProducts.findMany({
      where: clientId ? and(eq(installedProducts.orgId, ctx.orgId), eq(installedProducts.clientId, clientId)) : eq(installedProducts.orgId, ctx.orgId),
      orderBy: desc(installedProducts.createdAt),
    })
  )
}

export async function createInstalledProduct(
  ctx: TicketContext,
  input: { productName: string; clientId?: string; serialNumber?: string; installedAt?: string; warrantyExpiresAt?: string; notes?: string }
) {
  const productName = input.productName?.trim()
  if (!productName) throw new ServiceError("productName is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [product] = await db.insert(installedProducts).values({
      orgId: ctx.orgId, clientId: input.clientId || null, productName,
      serialNumber: input.serialNumber || null, installedAt: input.installedAt || null,
      warrantyExpiresAt: input.warrantyExpiresAt || null, notes: input.notes || null, createdById: ctx.userId,
    }).returning()
    return product
  })
}

// Attaches an installed product to a ticket (which unit the ticket is about).
export async function setTicketInstalledProduct(ctx: TicketContext, ticketId: string, installedProductId: string | null) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("Ticket not found", 404)
    const [updated] = await db.update(tickets).set({ installedProductId, updatedAt: new Date() }).where(eq(tickets.id, ticketId)).returning()
    return updated
  })
}

// CSAT/NPS survey -- submitted by the customer via the same guest-chat
// token their ticket already uses (Wave 36/39), not a new token mechanism.
// Only allowed once the ticket is resolved/closed, matching real helpdesk
// survey-trigger conventions (Zendesk/Freshdesk send the survey on resolution).
export async function submitTicketSurveyByToken(token: string, input: { csatScore?: number; npsScore?: number; comment?: string }) {
  const access = await resolveActiveGuestAccess(token)
  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.conversationId, access.conversationId) })
  if (!ticket) throw new ServiceError("This guest link is not attached to a ticket", 404)
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new ServiceError("This ticket hasn't been resolved yet -- the survey opens once it is", 400)
  }
  if (input.csatScore == null && input.npsScore == null) throw new ServiceError("Provide at least a CSAT or NPS score", 400)

  const [survey] = await db.insert(ticketSatisfactionSurveys).values({
    orgId: ticket.orgId, ticketId: ticket.id,
    csatScore: input.csatScore ?? null, npsScore: input.npsScore ?? null, comment: input.comment?.trim() || null,
  }).returning()
  return survey
}

export async function listTicketSurveys(ctx: { orgId: string }, ticketId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.ticketSatisfactionSurveys.findMany({
      where: ticketId ? and(eq(ticketSatisfactionSurveys.orgId, ctx.orgId), eq(ticketSatisfactionSurveys.ticketId, ticketId)) : eq(ticketSatisfactionSurveys.orgId, ctx.orgId),
      orderBy: desc(ticketSatisfactionSurveys.createdAt),
    })
  )
}

// Field-service dispatch.
export async function createFieldServiceDispatch(
  ctx: TicketContext,
  ticketId: string,
  input: { technicianUserId?: string; scheduledAt: string; addressText?: string; notes?: string }
) {
  if (!input.scheduledAt) throw new ServiceError("scheduledAt is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("Ticket not found", 404)

    const [dispatch] = await db.insert(fieldServiceDispatches).values({
      orgId: ctx.orgId, ticketId, technicianUserId: input.technicianUserId || null,
      scheduledAt: new Date(input.scheduledAt), addressText: input.addressText || null, notes: input.notes || null,
      createdById: ctx.userId,
    }).returning()
    return dispatch
  })
}

export async function listFieldServiceDispatches(ctx: { orgId: string }, ticketId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.fieldServiceDispatches.findMany({
      where: ticketId ? and(eq(fieldServiceDispatches.orgId, ctx.orgId), eq(fieldServiceDispatches.ticketId, ticketId)) : eq(fieldServiceDispatches.orgId, ctx.orgId),
      orderBy: desc(fieldServiceDispatches.scheduledAt),
    })
  )
}

export async function updateFieldServiceDispatch(
  ctx: TicketContext,
  dispatchId: string,
  patch: Partial<{ status: string; notes: string }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.fieldServiceDispatches.findFirst({ where: and(eq(fieldServiceDispatches.id, dispatchId), eq(fieldServiceDispatches.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Dispatch not found", 404)
    const completedAt = patch.status === "completed" ? new Date() : existing.completedAt
    const [updated] = await db.update(fieldServiceDispatches).set({ ...patch, completedAt }).where(eq(fieldServiceDispatches.id, dispatchId)).returning()
    return updated
  })
}

// Problem management / RCA grouping (ITIL-style) -- a single underlying
// root cause that may manifest as several separate tickets.
export async function createProblemRecord(ctx: TicketContext, input: { title: string; rootCause?: string }) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [problem] = await db.insert(problemRecords).values({ orgId: ctx.orgId, title, rootCause: input.rootCause || null, createdById: ctx.userId }).returning()
    return problem
  })
}

export async function listProblemRecords(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.problemRecords.findMany({ where: eq(problemRecords.orgId, ctx.orgId), orderBy: desc(problemRecords.createdAt) })
  )
}

export async function updateProblemRecord(ctx: TicketContext, problemId: string, patch: Partial<{ status: string; rootCause: string }>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.problemRecords.findFirst({ where: and(eq(problemRecords.id, problemId), eq(problemRecords.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Problem record not found", 404)
    const resolvedAt = patch.status === "resolved" ? new Date() : existing.resolvedAt
    const [updated] = await db.update(problemRecords).set({ ...patch, resolvedAt, updatedAt: new Date() }).where(eq(problemRecords.id, problemId)).returning()
    return updated
  })
}

export async function linkTicketToProblem(ctx: TicketContext, problemId: string, ticketId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const problem = await db.query.problemRecords.findFirst({ where: and(eq(problemRecords.id, problemId), eq(problemRecords.orgId, ctx.orgId)) })
    if (!problem) throw new ServiceError("Problem record not found", 404)
    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("Ticket not found", 404)

    const existing = await db.query.problemTickets.findFirst({ where: and(eq(problemTickets.problemId, problemId), eq(problemTickets.ticketId, ticketId)) })
    if (existing) return existing

    const [link] = await db.insert(problemTickets).values({ problemId, ticketId }).returning()
    return link
  })
}

export async function listTicketsForProblem(ctx: { orgId: string }, problemId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const links = await db.query.problemTickets.findMany({ where: eq(problemTickets.problemId, problemId) })
    const ticketIds = links.map((l) => l.ticketId)
    if (ticketIds.length === 0) return []
    return db.query.tickets.findMany({ where: and(eq(tickets.orgId, ctx.orgId), inArray(tickets.id, ticketIds)) })
  })
}
