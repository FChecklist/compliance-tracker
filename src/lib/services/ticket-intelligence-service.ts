// Priority 2 item 4 follow-up (D21.B1.S1 tree note, closed follow-up to
// email-intelligence-service.ts): "For a support ticket: understand
// context, identify commitments, detect follow-up/approval/deadline
// actions -- same detect-then-propose pattern as MoM/Document/Email
// intelligence, applied to tickets." The tree's own note calls the general
// principle proven for MoM (veri-meeting-service.ts's
// generateMeetingIntelligence) and Documents (documents/extract), then
// closed the Email gap first (email-intelligence-service.ts) leaving
// tickets as one of the 2 remaining named source types (the other,
// voice/transcription, is owner-blocked on a speech-to-text provider
// decision and out of scope here).
//
// This file mirrors email-intelligence-service.ts's shape line-for-line:
// enforcePolicy -> resolveModelConfig -> resolvePromptTemplate ->
// callLLMJson -> recordOrchestraExecution -> persist AI output as
// SUGGESTIONS ONLY -> logActivity. sanitizeSuggestedWorkItems and its
// category vocabulary ('commitment'|'follow_up'|'approval_needed'|
// 'deadline') are reused DIRECTLY from email-intelligence-service.ts
// rather than reimplemented -- same "reuse an existing mechanism instead
// of a parallel implementation" posture ticket-service.ts's own header
// already establishes for this file (createGuestAccess/
// resolveActiveGuestAccess from veri-chat-service.ts). A suggestion only
// becomes a real `tasks` row via an explicit promoteTicketIntelligenceItem()
// call, mirroring promoteEmailIntelligenceItem() -- never auto-created,
// matching this domain's own "No object created without approval"
// requirement (U-D21.B1.S1).
//
// The one real architectural difference from email: a ticket already
// exists as its own entity (created via ticket-service.ts's createTicket)
// with a real conversation behind it (Wave 12/39), unlike email which has
// no persistent pre-analysis record at all. So analyzeTicket() takes an
// existing ticketId, reuses getTicket() for the existence + participant-
// access check, and pulls the REAL conversation transcript (the `messages`
// table, via `ticket.conversationId`) rather than requiring content to be
// re-pasted into the call the way analyzeInboundEmail() must.
import { tickets, tasks, messages, ticketIntelligenceItems, ticketIntelligenceActionItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { eq, and, desc } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { getTicket, ServiceError } from "./ticket-service"
import { sanitizeSuggestedWorkItems } from "./email-intelligence-service"
import type { users } from "@/lib/db"

export type TicketIntelligenceContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type TicketTranscriptMessage = { senderId: string | null; content: string }

const MAX_TRANSCRIPT_MESSAGES = 50
const MAX_TRANSCRIPT_CHARS = 6000

// Pure, DB-free formatting of a ticket's conversation into LLM-ready text.
// Keeps only the most recent MAX_TRANSCRIPT_MESSAGES (oldest-first order
// preserved) and hard-caps total length -- a long-running ticket's
// conversation can grow arbitrarily large, and this is the one place that
// growth is bounded before it ever reaches a prompt. Kept separate from
// analyzeTicket() specifically so it's unit-testable without a live DB,
// matching this repo's established "test the pure detect/classify logic,
// not the DB-touching parts" convention (see email-intelligence-
// service.test.ts / task-service.test.ts's own notes on this).
export function buildTicketTranscript(rows: TicketTranscriptMessage[]): string {
  if (rows.length === 0) return "(no messages yet)"

  const recent = rows.slice(-MAX_TRANSCRIPT_MESSAGES)
  const lines = recent.map((m) => {
    const speaker = m.senderId ? "Participant" : "VERIDIAN AI"
    return `${speaker}: ${m.content.trim()}`
  })

  let transcript = lines.join("\n")
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the TAIL (most recent content) when truncating -- the freshest
    // messages are the most likely to carry an unresolved commitment/
    // follow-up/deadline, same "recency matters most" assumption
    // buildTicketTranscript's own message-count cap already makes.
    transcript = `...(earlier messages truncated)...\n${transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)}`
  }
  return transcript
}

export async function listTicketIntelligenceItems(ctx: { orgId: string }, ticketId?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.ticketIntelligenceItems.findMany({
      where: ticketId
        ? and(eq(ticketIntelligenceItems.orgId, ctx.orgId), eq(ticketIntelligenceItems.ticketId, ticketId))
        : eq(ticketIntelligenceItems.orgId, ctx.orgId),
      orderBy: desc(ticketIntelligenceItems.createdAt),
    })
  )
}

export async function getTicketIntelligenceItem(ctx: { orgId: string }, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const item = await db.query.ticketIntelligenceItems.findFirst({ where: and(eq(ticketIntelligenceItems.id, itemId), eq(ticketIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Ticket intelligence item not found", 404)
    const actionItems = await db.query.ticketIntelligenceActionItems.findMany({
      where: eq(ticketIntelligenceActionItems.ticketIntelligenceItemId, itemId),
      with: { task: true },
    })
    return { ...item, actionItems }
  })
}

// The real build: given an existing ticket, pull its real conversation
// transcript and detect commitments/follow-ups/approvals-needed/deadlines,
// proposing Work Object candidates -- same shape as
// analyzeInboundEmail(), applied to a ticket's real content instead of a
// caller-supplied email body.
export async function analyzeTicket(ctx: TicketIntelligenceContext, ticketId: string) {
  // getTicket() does the existence + participant-access check (throws 404
  // for either) -- reused directly rather than duplicating
  // assertParticipant()'s logic here.
  const ticket = await getTicket({ orgId: ctx.orgId, userId: ctx.userId }, ticketId)

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [item] = await db.insert(ticketIntelligenceItems).values({
      orgId: ctx.orgId, ticketId: ticket.id, requestedById: ctx.userId, status: "analyzing",
    }).returning()

    await logActivity({
      tx: db, action: "ticket_intelligence.submitted", entityType: "ticket_intelligence_item", entityId: item!.id,
      details: `Submitted ticket for analysis: "${ticket.subject}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return item!
  })

  try {
    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const messageRows = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.query.messages.findMany({
        where: eq(messages.conversationId, ticket.conversationId),
        orderBy: (t, { asc }) => asc(t.createdAt),
      })
    )
    const transcript = buildTicketTranscript(messageRows.map((m) => ({ senderId: m.senderId, content: m.content })))

    const systemPrompt = await resolvePromptTemplate("ticket_intelligence.detect")
    const userMessage = `Ticket subject: ${ticket.subject}\nCategory: ${ticket.category ?? "unspecified"}\nPriority: ${ticket.priority}\n\nConversation:\n${transcript}`

    // Same posture as analyzeInboundEmail's Constitution gate -- a
    // ticket's conversation includes external/guest-authored messages
    // (Wave 36), at least as much risk as human-typed chat/minutes.
    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "ticket_intelligence.detect" },
      userMessage
    )
    if (!policyDecision.allowed) {
      await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
        db.update(ticketIntelligenceItems).set({ status: "analysis_failed", updatedAt: new Date() }).where(eq(ticketIntelligenceItems.id, created.id))
      )
      throw new ServiceError(refusalMessageFor(policyDecision), 400)
    }

    const startedAt = Date.now()
    const { data: result, usage } = await callLLMJson<{ summary: string; suggestedWorkItems: unknown }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.2, maxTokens: 700 }, modelConfig.fallback
    )

    const suggestedWorkItems = sanitizeSuggestedWorkItems(result.suggestedWorkItems)

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "ticket_intelligence.detect",
      input: { ticketIntelligenceItemId: created.id }, output: { suggestedWorkItemCount: suggestedWorkItems.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(ticketIntelligenceItems).set({
        status: "proposed",
        aiSummary: result.summary ?? null,
        aiSuggestedWorkItems: suggestedWorkItems,
        aiGeneratedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(ticketIntelligenceItems.id, created.id)).returning()

      await logActivity({
        tx: db, action: "ticket_intelligence.analyzed", entityType: "ticket_intelligence_item", entityId: created.id,
        details: `AI detected ${suggestedWorkItems.length} candidate work item(s)`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
      return updated
    })
  } catch (error) {
    if (error instanceof ServiceError) throw error
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(ticketIntelligenceItems).set({ status: "analysis_failed", updatedAt: new Date() }).where(eq(ticketIntelligenceItems.id, created.id))
    )
    throw error
  }
}

// Promotes exactly one suggested item into a real `tasks` row -- mirrors
// promoteEmailIntelligenceItem() exactly. Human-gated by construction: this
// only runs because a user explicitly picked a suggestedIndex, never
// automatically from analyzeTicket() itself. Defaults the new task's
// assignee to the ticket's own assignee (a natural default a bare email
// doesn't have, since email has no persistent assignee field) when the
// caller doesn't specify one explicitly.
export async function promoteTicketIntelligenceItem(
  ctx: TicketIntelligenceContext,
  itemId: string,
  input: { suggestedIndex: number; assigneeUserId?: string; dueDate?: string }
) {
  if (!Number.isInteger(input.suggestedIndex) || input.suggestedIndex < 0) {
    throw new ServiceError("suggestedIndex must be a non-negative integer", 400)
  }

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.ticketIntelligenceItems.findFirst({ where: and(eq(ticketIntelligenceItems.id, itemId), eq(ticketIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Ticket intelligence item not found", 404)

    const ticket = await db.query.tickets.findFirst({ where: and(eq(tickets.id, item.ticketId), eq(tickets.orgId, ctx.orgId)) })
    if (!ticket) throw new ServiceError("The ticket this analysis belongs to no longer exists", 404)

    const suggestions = sanitizeSuggestedWorkItems(item.aiSuggestedWorkItems)
    const suggestion = suggestions[input.suggestedIndex]
    if (!suggestion) throw new ServiceError("No suggested work item at that index", 400)

    const description = `Detected from ticket "${ticket.subject}": ${suggestion.category.replace("_", " ")}`
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ticket.assigneeId || ctx.userId, assignedById: ctx.userId,
      title: suggestion.title, description, status: "in_progress",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    }).returning()

    const [actionItem] = await db.insert(ticketIntelligenceActionItems).values({
      ticketIntelligenceItemId: itemId, suggestedIndex: input.suggestedIndex, taskId: task!.id,
    }).returning()

    await logActivity({
      tx: db, action: "ticket_intelligence.promoted", entityType: "ticket_intelligence_item", entityId: itemId,
      details: `Promoted suggested item to task: "${suggestion.title}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return { actionItem, task: task! }
  })

  await executeTask(ctx.orgId, ctx.userId, created.task.id, created.task.title, created.task.description, null, null)
  const finalTask = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.tasks.findFirst({ where: eq(tasks.id, created.task.id) })
  )
  return { ...created.actionItem, task: finalTask ?? created.task }
}

export async function dismissTicketIntelligenceItem(ctx: TicketIntelligenceContext, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.ticketIntelligenceItems.findFirst({ where: and(eq(ticketIntelligenceItems.id, itemId), eq(ticketIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Ticket intelligence item not found", 404)

    const [updated] = await db.update(ticketIntelligenceItems).set({ status: "dismissed", updatedAt: new Date() }).where(eq(ticketIntelligenceItems.id, itemId)).returning()

    await logActivity({
      tx: db, action: "ticket_intelligence.dismissed", entityType: "ticket_intelligence_item", entityId: itemId,
      details: "Dismissed -- no work item promoted", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

export { ServiceError }
