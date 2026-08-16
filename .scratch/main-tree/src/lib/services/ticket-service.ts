// Wave 39 (VERIDIAN Ticketing, PLATFORM_STRATEGY.md §21). Peppermint/
// Trudesk/FlowInquiry evaluated and rejected as software. Deliberately does
// NOT build a second messaging system: every ticket wraps an existing
// `conversations` row (Wave 12), so replies, guest messages (Wave 36),
// markdown rendering (Wave 37), and attachments (Wave 32) all work for
// free. External guest participation reuses veri-chat-service.ts's
// createGuestAccess() directly rather than a parallel implementation.
import {
  db, tickets, conversations, conversationParticipants, notifications, users, messages,
  installedProducts, ticketSatisfactionSurveys, fieldServiceDispatches, problemRecords, problemTickets,
  ticketTeams, slaPolicies, escalationRules, ticketEscalationEvents, businessHoursSchedules, emailIntelligenceItems,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, lt, notInArray, desc, inArray, isNotNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { createGuestAccess, resolveActiveGuestAccess } from "./veri-chat-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { recordAuditTrigger } from "@/lib/audit-event-triggers"

export type TicketContext = { orgId: string; userId: string }

// ─── Tiered SLA policy resolution (Helpdesk gap-closure, Phase 0,
// 2026-07-27) ───────────────────────────────────────────────────────────
// Pure, DB-free scoring/computation -- kept separate from resolveSlaPolicy
// below so they're directly unit-testable without a live Postgres
// connection, same house convention as sanitizeSuggestedWorkItems in
// email-intelligence-service.ts.
export type SlaPolicyLike = { id: string; teamId: string | null; priority: string | null; category: string | null; isActive: boolean }
export type SlaPolicyMatchCriteria = { teamId: string | null; priority: string; category: string | null }

/** Returns a specificity score (higher = more specific) if `policy` matches `criteria`, or null if it doesn't apply at all. */
export function scoreSlaPolicyMatch(policy: SlaPolicyLike, criteria: SlaPolicyMatchCriteria): number | null {
  if (!policy.isActive) return null
  if (policy.teamId && policy.teamId !== criteria.teamId) return null
  if (policy.priority && policy.priority !== criteria.priority) return null
  if (policy.category && policy.category !== criteria.category) return null
  return (policy.teamId ? 1 : 0) + (policy.priority ? 1 : 0) + (policy.category ? 1 : 0)
}

/** Picks the most specific matching policy (most non-null matched fields wins); null if none match. */
export function pickBestSlaPolicy<T extends SlaPolicyLike>(policies: T[], criteria: SlaPolicyMatchCriteria): T | null {
  let best: T | null = null
  let bestScore = -1
  for (const policy of policies) {
    const score = scoreSlaPolicyMatch(policy, criteria)
    if (score !== null && score > bestScore) {
      best = policy
      bestScore = score
    }
  }
  return best
}

export type WeeklyHours = Record<string, Array<[number, number]>>

/**
 * Business-hours-aware SLA deadline. Walks forward day by day, consuming
 * only the minutes inside each day's configured window(s), until `hours`
 * of coverage is used up. Deliberately keeps day-of-week/minute-of-day
 * matching in UTC rather than converting through the schedule's IANA
 * `timezone` (that field is stored for display/documentation only) --
 * this codebase has no timezone-conversion library as a dependency, and a
 * hand-rolled DST-aware converter would be a real correctness risk for a
 * feature whose whole point is precise deadline math. Org admins in a
 * non-UTC timezone author `weeklyHours` in UTC-shifted terms; a real
 * IANA-aware conversion is future work if that proves too awkward.
 * Falls back to plain calendar-time math when no schedule is supplied
 * (preserves the pre-existing non-business-hours behavior exactly).
 */
export function computeSlaDeadline(startAt: Date, hours: number, weeklyHours?: WeeklyHours | null): Date {
  if (!weeklyHours || Object.keys(weeklyHours).length === 0) {
    return new Date(startAt.getTime() + hours * 60 * 60 * 1000)
  }

  let remainingMinutes = hours * 60
  const MAX_DAYS = 90 // safety cap so a schedule with zero open windows can't loop forever
  for (let dayOffset = 0; dayOffset < MAX_DAYS; dayOffset++) {
    const dayStart = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate() + dayOffset))
    const windows = weeklyHours[String(dayStart.getUTCDay())] || []
    const flooredCursorMinute = dayOffset === 0 ? startAt.getUTCHours() * 60 + startAt.getUTCMinutes() : 0

    for (const [winStart, winEnd] of windows) {
      const usableStart = Math.max(winStart, flooredCursorMinute)
      if (usableStart >= winEnd) continue
      const available = winEnd - usableStart
      if (remainingMinutes <= available) {
        return new Date(dayStart.getTime() + (usableStart + remainingMinutes) * 60 * 1000)
      }
      remainingMinutes -= available
    }
  }

  // Degenerate schedule (no capacity found within MAX_DAYS) -- fall back to
  // plain calendar time from now rather than returning something wrong.
  return new Date(Date.now() + remainingMinutes * 60 * 1000)
}

async function resolveSlaPolicy(tx: TenantDb, orgId: string, criteria: SlaPolicyMatchCriteria) {
  const policies = await tx.query.slaPolicies.findMany({ where: and(eq(slaPolicies.orgId, orgId), eq(slaPolicies.isActive, true)) })
  return pickBestSlaPolicy(policies, criteria)
}

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
  input: {
    subject: string; category?: string; priority?: string; clientId?: string;
    requesterUserId?: string; requesterEmail?: string; assigneeId?: string;
    teamId?: string; slaHours?: number
  }
) {
  const subject = input.subject?.trim()
  if (!subject) throw new ServiceError("subject is required", 400)
  const priority = (input.priority as "low" | "medium" | "high" | "critical") || "medium"

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const participantIds = new Set([ctx.userId])
    if (input.assigneeId) participantIds.add(input.assigneeId)
    if (input.requesterUserId) participantIds.add(input.requesterUserId)

    // Team routing (Helpdesk gap-closure, Phase 0 2026-07-27): adding the
    // team's lead as a participant means a ticket routed to a team is
    // never RLS-invisible to every real staff member -- important for the
    // public self-service path (public-portal-service.ts), which has no
    // authenticated actor of its own to seed participants with.
    const teamId = input.teamId || null
    if (teamId) {
      const team = await db.query.ticketTeams.findFirst({ where: and(eq(ticketTeams.id, teamId), eq(ticketTeams.orgId, ctx.orgId)) })
      if (!team) throw new ServiceError("Team not found", 404)
      if (team.leadUserId) participantIds.add(team.leadUserId)
    }

    // No .returning() on the conversations insert -- see chat-service.ts's
    // ensureAiThread() comment: RETURNING is filtered through the SELECT
    // policy, which for conversations requires an already-existing
    // participant row that can't exist until the next statement.
    const conversationId = createId()
    await db.insert(conversations).values({
      id: conversationId, orgId: ctx.orgId, type: participantIds.size > 2 ? "group" : "direct", title: subject,
    })
    await db.insert(conversationParticipants).values([...participantIds].map((userId) => ({ conversationId, userId })))

    // SLA resolution: an explicit slaHours override always wins (preserves
    // the pre-existing manual path exactly, byte-for-byte); otherwise
    // resolve the most specific matching active policy for this
    // team/priority/category and derive the deadline from it (business-hours-
    // aware if the policy asks for that). No matching policy -> slaDeadline
    // stays null, same as today when slaHours is omitted.
    let slaDeadline: Date | null = null
    let slaPolicyId: string | null = null
    if (input.slaHours) {
      slaDeadline = new Date(Date.now() + input.slaHours * 60 * 60 * 1000)
    } else {
      const policy = await resolveSlaPolicy(db, ctx.orgId, { teamId, priority, category: input.category ?? null })
      if (policy) {
        slaPolicyId = policy.id
        let weeklyHours: WeeklyHours | null = null
        if (policy.businessHoursOnly && policy.businessHoursScheduleId) {
          const schedule = await db.query.businessHoursSchedules.findFirst({ where: eq(businessHoursSchedules.id, policy.businessHoursScheduleId) })
          weeklyHours = (schedule?.weeklyHours as WeeklyHours | undefined) ?? null
        }
        slaDeadline = computeSlaDeadline(new Date(), policy.resolutionHours, weeklyHours)
      }
    }

    const [ticket] = await db.insert(tickets).values({
      orgId: ctx.orgId, clientId: input.clientId || null, conversationId, subject,
      category: input.category || null, priority,
      assigneeId: input.assigneeId || null, requesterUserId: input.requesterUserId || null,
      requesterEmail: input.requesterEmail?.trim() || null,
      teamId, slaPolicyId, slaDeadline, createdById: ctx.userId,
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

// Escalation cron (Helpdesk gap-closure, Phase 0 2026-07-27) -- called from
// the same daily cron as checkTicketSlaBreaches, not a second cron job.
// Fires each matching escalation_rules step at most once per ticket
// (idempotent via ticket_escalation_events, checked before acting) for any
// open/in-progress ticket whose slaDeadline came from a real slaPolicyId --
// tickets still on the legacy manual slaHours override have no policy to
// look up thresholds from, so they're only covered by
// checkTicketSlaBreaches' own re-notify-until-resolved behavior. Uses the
// raw `db` client, same posture as checkTicketSlaBreaches.
export async function checkTicketEscalations(): Promise<{ escalated: number }> {
  const now = new Date()
  const openTickets = await db.query.tickets.findMany({
    where: and(notInArray(tickets.status, ["resolved", "closed"]), isNotNull(tickets.slaPolicyId), isNotNull(tickets.slaDeadline)),
  })

  let escalated = 0
  for (const ticket of openTickets) {
    const policy = await db.query.slaPolicies.findFirst({ where: eq(slaPolicies.id, ticket.slaPolicyId!) })
    if (!policy) continue

    const totalMs = policy.resolutionHours * 60 * 60 * 1000
    if (totalMs <= 0) continue
    const deadlineMs = ticket.slaDeadline!.getTime()
    const startMs = deadlineMs - totalMs
    const elapsedPercent = ((now.getTime() - startMs) / totalMs) * 100

    const rules = await db.query.escalationRules.findMany({ where: eq(escalationRules.slaPolicyId, policy.id) })
    for (const rule of rules) {
      if (elapsedPercent < rule.thresholdPercent) continue

      const alreadyFired = await db.query.ticketEscalationEvents.findFirst({
        where: and(eq(ticketEscalationEvents.ticketId, ticket.id), eq(ticketEscalationEvents.escalationRuleId, rule.id)),
      })
      if (alreadyFired) continue

      const updates: Partial<{ teamId: string; assigneeId: string }> = {}
      if (rule.escalateToTeamId) updates.teamId = rule.escalateToTeamId
      if (rule.escalateToUserId) updates.assigneeId = rule.escalateToUserId
      if (Object.keys(updates).length > 0) {
        await db.update(tickets).set({ ...updates, updatedAt: now }).where(eq(tickets.id, ticket.id))
      }

      const notifyIds = new Set(
        [rule.escalateToUserId, ...(Array.isArray(rule.notifyUserIds) ? (rule.notifyUserIds as unknown[]) : [])]
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
      for (const userId of notifyIds) {
        await db.insert(notifications).values({
          userId,
          title: `Ticket escalated: ${ticket.subject}`,
          message: `Ticket "${ticket.subject}" reached ${rule.thresholdPercent}% of its SLA window and was escalated.`,
          type: "system",
          metadata: { ticketId: ticket.id, conversationId: ticket.conversationId, escalationRuleId: rule.id },
        })
      }

      await db.insert(ticketEscalationEvents).values({ ticketId: ticket.id, escalationRuleId: rule.id })
      escalated++
    }
  }

  return { escalated }
}

// ─── Team / SLA-policy / escalation-rule / business-hours admin CRUD
// (Helpdesk gap-closure, Phase 0 2026-07-27) ──────────────────────────────

export async function listTicketTeams(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.ticketTeams.findMany({ where: eq(ticketTeams.orgId, ctx.orgId), orderBy: desc(ticketTeams.createdAt) })
  )
}

export async function createTicketTeam(
  ctx: TicketContext,
  input: { name: string; description?: string; leadUserId?: string; isDefault?: boolean }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // Only one default team per org -- clear any existing default first.
    if (input.isDefault) await db.update(ticketTeams).set({ isDefault: false }).where(eq(ticketTeams.orgId, ctx.orgId))
    const [team] = await db.insert(ticketTeams).values({
      orgId: ctx.orgId, name, description: input.description || null,
      leadUserId: input.leadUserId || null, isDefault: input.isDefault ?? false,
    }).returning()
    return team
  })
}

export async function updateTicketTeam(
  ctx: TicketContext,
  teamId: string,
  patch: Partial<{ name: string; description: string | null; leadUserId: string | null; isDefault: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.ticketTeams.findFirst({ where: and(eq(ticketTeams.id, teamId), eq(ticketTeams.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Team not found", 404)
    if (patch.isDefault) await db.update(ticketTeams).set({ isDefault: false }).where(eq(ticketTeams.orgId, ctx.orgId))
    const [updated] = await db.update(ticketTeams).set({ ...patch, updatedAt: new Date() }).where(eq(ticketTeams.id, teamId)).returning()
    return updated
  })
}

export async function listBusinessHoursSchedules(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.businessHoursSchedules.findMany({ where: eq(businessHoursSchedules.orgId, ctx.orgId), orderBy: desc(businessHoursSchedules.createdAt) })
  )
}

export async function createBusinessHoursSchedule(
  ctx: TicketContext,
  input: { name: string; timezone?: string; weeklyHours: WeeklyHours }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.weeklyHours || typeof input.weeklyHours !== "object") throw new ServiceError("weeklyHours is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [schedule] = await db.insert(businessHoursSchedules).values({
      orgId: ctx.orgId, name, timezone: input.timezone || "UTC", weeklyHours: input.weeklyHours,
    }).returning()
    return schedule
  })
}

export async function listSlaPolicies(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.slaPolicies.findMany({ where: eq(slaPolicies.orgId, ctx.orgId), orderBy: desc(slaPolicies.createdAt) })
  )
}

export async function createSlaPolicy(
  ctx: TicketContext,
  input: {
    name: string; teamId?: string; priority?: string; category?: string;
    firstResponseHours?: number; resolutionHours: number;
    businessHoursOnly?: boolean; businessHoursScheduleId?: string; isActive?: boolean
  }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.resolutionHours || input.resolutionHours <= 0) throw new ServiceError("resolutionHours must be a positive number", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [policy] = await db.insert(slaPolicies).values({
      orgId: ctx.orgId, name, teamId: input.teamId || null,
      priority: (input.priority as "low" | "medium" | "high" | "critical" | undefined) || null,
      category: input.category || null, firstResponseHours: input.firstResponseHours ?? null,
      resolutionHours: input.resolutionHours, businessHoursOnly: input.businessHoursOnly ?? false,
      businessHoursScheduleId: input.businessHoursScheduleId || null, isActive: input.isActive ?? true,
    }).returning()
    return policy
  })
}

export async function updateSlaPolicy(
  ctx: TicketContext,
  policyId: string,
  patch: Partial<{ name: string; isActive: boolean; resolutionHours: number; firstResponseHours: number | null }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.slaPolicies.findFirst({ where: and(eq(slaPolicies.id, policyId), eq(slaPolicies.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("SLA policy not found", 404)
    const [updated] = await db.update(slaPolicies).set({ ...patch, updatedAt: new Date() }).where(eq(slaPolicies.id, policyId)).returning()
    return updated
  })
}

export async function listEscalationRules(ctx: { orgId: string }, slaPolicyId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.escalationRules.findMany({
      where: slaPolicyId ? and(eq(escalationRules.orgId, ctx.orgId), eq(escalationRules.slaPolicyId, slaPolicyId)) : eq(escalationRules.orgId, ctx.orgId),
      orderBy: (r, { asc }) => asc(r.stepOrder),
    })
  )
}

export async function createEscalationRule(
  ctx: TicketContext,
  input: { slaPolicyId: string; thresholdPercent: number; escalateToTeamId?: string; escalateToUserId?: string; notifyUserIds?: string[]; stepOrder?: number }
) {
  if (!input.slaPolicyId) throw new ServiceError("slaPolicyId is required", 400)
  if (!Number.isFinite(input.thresholdPercent) || input.thresholdPercent <= 0) throw new ServiceError("thresholdPercent must be a positive number", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const policy = await db.query.slaPolicies.findFirst({ where: and(eq(slaPolicies.id, input.slaPolicyId), eq(slaPolicies.orgId, ctx.orgId)) })
    if (!policy) throw new ServiceError("SLA policy not found", 404)

    const [rule] = await db.insert(escalationRules).values({
      orgId: ctx.orgId, slaPolicyId: input.slaPolicyId, thresholdPercent: input.thresholdPercent,
      escalateToTeamId: input.escalateToTeamId || null, escalateToUserId: input.escalateToUserId || null,
      notifyUserIds: input.notifyUserIds || [], stepOrder: input.stepOrder ?? 1,
    }).returning()
    return rule
  })
}

// Email-to-ticket promotion (Helpdesk gap-closure, Phase 0 2026-07-27) --
// reuses email_intelligence_items (the existing email-ingestion record;
// see email-intelligence-service.ts's own header for why there's still no
// live inbound trigger) rather than building a second inbound-email
// pipeline. Whole email -> one ticket, unlike promoteEmailIntelligenceItem's
// per-suggested-work-item -> task promotion -- there's no per-item
// selection here, the email itself IS the ticket. Not nested inside
// createTicket's own withTenantContext (tenant-scoped.ts: a fresh
// db.transaction() call from inside another transaction's callback opens
// an independent connection, not a savepoint) -- calls it as a separate
// top-level step, same pattern inviteGuestToTicket already uses (getTicket
// then createGuestAccess as two separate calls).
export async function createTicketFromEmailIntelligenceItem(
  ctx: TicketContext,
  emailItemId: string,
  input?: { category?: string; priority?: string; teamId?: string }
) {
  const item = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.emailIntelligenceItems.findFirst({ where: and(eq(emailIntelligenceItems.id, emailItemId), eq(emailIntelligenceItems.orgId, ctx.orgId)) })
  )
  if (!item) throw new ServiceError("Email intelligence item not found", 404)
  if (item.promotedTicketId) throw new ServiceError("This email has already been promoted to a ticket", 400)

  const ticket = await createTicket(ctx, {
    subject: item.subject,
    category: input?.category,
    priority: input?.priority,
    requesterEmail: item.senderEmail ?? undefined,
    teamId: input?.teamId,
  })

  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // senderId null alone means "VERIDIAN AI" elsewhere in this table
    // (messages.senderId's own comment) -- prefixing the content is how
    // this codebase already disambiguates an email-sourced body from an AI
    // reply when there's no guestAccessId to attach (see
    // promoteEmailIntelligenceItem's identical "Detected from email ..."
    // prefix convention on the task description it creates).
    const attribution = item.senderEmail ? `[Email from ${item.senderEmail}]` : "[Email]"
    await db.insert(messages).values({ conversationId: ticket.conversationId, senderId: null, content: `${attribution}\n\n${item.body}` })
    await db.update(emailIntelligenceItems)
      .set({ promotedTicketId: ticket.id, status: "promoted_to_ticket", updatedAt: new Date() })
      .where(eq(emailIntelligenceItems.id, emailItemId))
  })

  return ticket
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
