// Wave 34 (VERI Minutes of Meetings, PLATFORM_STRATEGY.md §16). Genuinely
// new, general-purpose -- board_meetings (Wave 8, governance-only) and
// pms_meetings (Wave 28, PMS-project-scoped) are both real but scope-locked.
// minutesHistory mirrors board_meetings' own amend-don't-overwrite
// precedent verbatim. Action items become real `tasks` rows (which VERI
// To Do already surfaces) via veri_meeting_action_items, not a parallel
// tracking mechanism.
//
// Wave 44 (PLATFORM_STRATEGY.md §25): publish/lock workflow + share links +
// audit trail, merged in from evaluating FChecklist/MeetTrack + meettrack-v2.
// Once published, meeting-level fields (title/type/scheduledAt/attendees/
// agenda/minutes) are immutable -- enforced here, not just a disabled UI
// input. Linked `tasks` rows stay independently editable via VERI To Do;
// freezing a task's status because the *meeting* was finalized would break
// the task lifecycle, which meettrack-v2 never had to reason about since its
// "action items" were never real cross-module rows.
import { createId } from "@paralleldrive/cuid2"
import { veriMeetings, veriMeetingActionItems, veriMeetingShareLinks, tasks, auditLogs, db } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { eq, and, desc } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type VeriMeetingContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

function generateSystemId(): string {
  const year = new Date().getFullYear()
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `MOM-${year}-${suffix}`
}

function assertEditable(meeting: { status: string }) {
  if (meeting.status === "published") {
    throw new ServiceError("This meeting is published and locked -- its details cannot be edited", 409)
  }
}

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
      systemId: generateSystemId(),
      createdById: ctx.userId,
    }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.created", entityType: "veri_meeting", entityId: meeting!.id,
      details: `Created meeting "${title}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return meeting
  })
}

// New in Wave 44 -- editing title/type/scheduledAt/attendees/agenda after
// creation had no route at all before this wave; needed for the publish/lock
// workflow to mean anything.
export async function updateVeriMeetingDetails(
  ctx: VeriMeetingContext,
  meetingId: string,
  input: { title?: string; meetingType?: string; scheduledAt?: string; attendees?: string[]; agenda?: string[] }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Meeting not found", 404)
    assertEditable(existing)

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.meetingType !== undefined) patch.meetingType = input.meetingType
    if (input.scheduledAt !== undefined) patch.scheduledAt = new Date(input.scheduledAt)
    if (input.attendees !== undefined) patch.attendees = input.attendees
    if (input.agenda !== undefined) patch.agenda = input.agenda

    const [updated] = await db.update(veriMeetings).set(patch).where(eq(veriMeetings.id, meetingId)).returning()

    const changedFields = Object.keys(patch).filter((k) => k !== "updatedAt")
    await logActivity({
      tx: db, action: "veri_meeting.details_updated", entityType: "veri_meeting", entityId: meetingId,
      details: `Updated: ${changedFields.join(", ")}`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

export async function updateMeetingMinutes(ctx: VeriMeetingContext, meetingId: string, minutes: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Meeting not found", 404)
    assertEditable(existing)

    const history = Array.isArray(existing.minutesHistory) ? existing.minutesHistory : []
    const amendment = { date: new Date().toISOString(), amendedBy: ctx.userId, text: minutes }

    const [updated] = await db.update(veriMeetings)
      .set({ minutes, minutesHistory: [...history, amendment], updatedAt: new Date() })
      .where(eq(veriMeetings.id, meetingId)).returning()

    await logActivity({
      tx: db, action: "veri_meeting.minutes_updated", entityType: "veri_meeting", entityId: meetingId,
      details: "Minutes updated", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

// Publish/lock -- the core auditability feature adopted from meettrack-v2,
// enforced server-side (assertEditable), not just a disabled UI input.
export async function publishVeriMeeting(ctx: VeriMeetingContext, meetingId: string) {
  const updated = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Meeting not found", 404)
    if (existing.status === "published") throw new ServiceError("Meeting is already published", 409)

    const [row] = await db.update(veriMeetings)
      .set({ status: "published", publishedAt: new Date(), publishedById: ctx.userId, updatedAt: new Date() })
      .where(eq(veriMeetings.id, meetingId)).returning()

    await logActivity({
      tx: db, action: "veri_meeting.published", entityType: "veri_meeting", entityId: meetingId,
      details: "Meeting published and locked", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return row
  })

  // Wave 74 (Meeting Intelligence): best-effort, non-blocking -- publishing
  // must succeed and return regardless of whether AI extraction works. Only
  // attempted when there's real minutes text to analyze.
  if (updated?.minutes?.trim()) {
    generateMeetingIntelligence(ctx, meetingId).catch((err) => {
      console.error("Meeting intelligence generation failed (non-fatal, meeting still published):", err)
    })
  }

  return updated
}

// Wave 74 (Meeting Intelligence, AI_OS_CERTIFICATION.md §3.2 NOT_BUILT).
// Read-only over `minutes` -- never mutates meeting-level fields, so it's
// safe to call on a published (locked) meeting and safe to re-run any
// number of times (overwrites its own prior AI columns only). Suggested
// action items are exactly that -- suggestions a human reviews and
// explicitly promotes via the existing addMeetingActionItem(), never
// auto-created as real `tasks` rows.
export async function generateMeetingIntelligence(ctx: VeriMeetingContext, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)
    if (!meeting.minutes?.trim()) throw new ServiceError("Meeting has no minutes to analyze", 400)

    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const systemPrompt = await resolvePromptTemplate("meeting_intelligence.extract")
    const userMessage = `Meeting: "${meeting.title}"\n\nMinutes:\n${meeting.minutes}`

    const startedAt = Date.now()
    const { data: result, usage } = await callLLMJson<{
      summary: string
      keyDecisions: string[]
      suggestedActionItems: { title: string; assignee: string | null; dueDateHint: string | null }[]
    }>(modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 700 }, modelConfig.fallback)

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "meeting_intelligence.extract",
      input: { meetingId }, output: { keyDecisionCount: result.keyDecisions?.length ?? 0, actionItemCount: result.suggestedActionItems?.length ?? 0 },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    const [updated] = await db.update(veriMeetings).set({
      aiSummary: result.summary,
      aiKeyDecisions: result.keyDecisions ?? [],
      aiSuggestedActionItems: result.suggestedActionItems ?? [],
      aiGeneratedAt: new Date(),
    }).where(eq(veriMeetings.id, meetingId)).returning()

    await logActivity({
      tx: db, action: "veri_meeting.ai_intelligence_generated", entityType: "veri_meeting", entityId: meetingId,
      details: "AI summary/decisions/suggested action items generated", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

// Action item becomes a real `tasks` row -- VERI To Do's listVeriTodos()
// already surfaces it, no separate tracking table. Deliberately NOT gated by
// meeting.status -- ongoing task work must continue after the meeting record
// itself is published/locked.
export async function addMeetingActionItem(
  ctx: VeriMeetingContext,
  meetingId: string,
  input: { title: string; assigneeUserId?: string; dueDate?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)

    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ctx.userId, assignedById: ctx.userId,
      title, description: `Action item from meeting: ${meeting.title}`, status: "pending",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    }).returning()

    const [actionItem] = await db.insert(veriMeetingActionItems).values({ meetingId, taskId: task!.id }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.action_item_added", entityType: "veri_meeting", entityId: meetingId,
      details: `Action item added: "${title}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return { ...actionItem, task }
  })
}

// Field-level change history -- reuses the platform's real audit_logs table
// (13+ other modules already write to it) rather than a parallel
// meeting_history table like meettrack-v2 built.
export async function listMeetingAuditLog(ctx: { orgId: string }, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.auditLogs.findMany({
      where: and(eq(auditLogs.entityType, "veri_meeting"), eq(auditLogs.entityId, meetingId), eq(auditLogs.orgId, ctx.orgId)),
      orderBy: desc(auditLogs.createdAt),
      limit: 50,
    })
  )
}

// ─── Share links (Wave 44) -- mirrors conversationShareLinks (Wave 36) ────
// exactly: tokenized, time-limited, individually revocable. Deliberately NOT
// meettrack-v2's own is_published=true=world-readable-forever RLS policy.
export async function createMeetingShareLink(ctx: VeriMeetingContext, meetingId: string, expiresInHours = 168) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)
    if (meeting.status !== "published") throw new ServiceError("Only published meetings can be shared", 409)

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await db.insert(veriMeetingShareLinks).values({
      meetingId, token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.share_link_created", entityType: "veri_meeting", entityId: meetingId,
      details: "Share link created", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return link
  })
}

export async function listMeetingShareLinks(ctx: { orgId: string }, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.veriMeetingShareLinks.findMany({
      where: eq(veriMeetingShareLinks.meetingId, meetingId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function revokeMeetingShareLink(ctx: VeriMeetingContext, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const link = await db.query.veriMeetingShareLinks.findFirst({ where: eq(veriMeetingShareLinks.id, linkId) })
    if (!link) throw new ServiceError("Share link not found", 404)
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, link.meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Share link not found", 404)

    const [updated] = await db.update(veriMeetingShareLinks).set({ revokedAt: new Date() }).where(eq(veriMeetingShareLinks.id, linkId)).returning()
    return updated
  })
}

// Public route (no auth) -- resolves a token to a read-only meeting view.
// Expired/revoked tokens 404 rather than distinguish "expired" from "never
// existed" (same reasoning as getSharedConversation in veri-chat-service.ts).
// Uses the raw `db` export since there's no session/org context for a public
// link to run withTenantContext against.
export async function getMeetingByShareToken(token: string) {
  const link = await db.query.veriMeetingShareLinks.findFirst({ where: eq(veriMeetingShareLinks.token, token) })
  if (!link || link.revokedAt || link.expiresAt < new Date()) throw new ServiceError("This share link is invalid or has expired", 404)

  const meeting = await db.query.veriMeetings.findFirst({ where: eq(veriMeetings.id, link.meetingId) })
  if (!meeting) throw new ServiceError("This share link is invalid or has expired", 404)

  const actionItems = await db.query.veriMeetingActionItems.findMany({
    where: eq(veriMeetingActionItems.meetingId, meeting.id),
    with: { task: true },
  })
  return { ...meeting, actionItems }
}
