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
import { after } from "next/server"
import { veriMeetings, veriMeetingActionItems, veriMeetingShareLinks, tasks, auditLogs, projects, db } from "@/lib/db"
import { MEETING_DELETED_STATUS } from "@/lib/db/schema"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { eq, and, desc, inArray, ne, notInArray, sql } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { executeTask } from "@/lib/task-execution-engine"
import { runMeetingIntelligenceGenerationMonitor } from "@/lib/monitors/meeting-intelligence-generation-monitor"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import type { ServiceActor } from "./context"

// Wave 143 (PROJEXA Minutes of Meetings wiring): widened from a hardcoded
// `dbUser: typeof users.$inferSelect` to the same dbUser|apiKey
// discriminated union `ServiceActor` already used elsewhere in this
// codebase for exactly this reason (see context.ts's own header) -- every
// pre-existing caller (VeriChatPanel, voice/ticket/email intelligence,
// mother-router) still just passes `{ orgId, userId, dbUser }`, which
// satisfies the `dbUser` branch unchanged. New callers reachable only via a
// Bearer API key (PROJEXA's callVeridian(), no cookie session) now have a
// real `{ orgId, userId, apiKey }` option instead of needing a fabricated
// dbUser.
// R39/R-C04: userId is nullable -- see veriMeetings.createdById's schema.ts
// comment. Callers pass ctx.dbUser?.id ?? null, never ctx.apiKey?.id.
export type VeriMeetingContext = { orgId: string; userId: string | null } & ServiceActor

// logActivity()/runMeetingIntelligenceGenerationMonitor() both require the
// same discriminated dbUser XOR apiKey actor shape -- this is the one place
// that ternary gets written, instead of at each of this file's ~9 call sites.
function actorOf(ctx: VeriMeetingContext): ServiceActor {
  return ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }
}

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

// ─── Soft delete (R67 D-17) ───────────────────────────────────────────────
// Deliberately a THIRD value of the existing free-text `status` column rather
// than a new deleted_at column: veri_meetings.status was already a checked-in
// string convention ('draft' | 'published', see schema.ts), every read path in
// this file already goes through the two functions below, and a soft delete
// that only ever applies to a DRAFT (never to a published, audit-relevant
// record) carries no information a timestamp column would add. That keeps this
// item migration-free, which is what the programme item asserts.
//
// The literal lives in schema.ts, beside the column it is a value of, so the
// table's OTHER readers (adoption-metrics-service, report-engine-service's
// TABLE_REGISTRY) can filter it out without importing this service and the
// LLM/task-execution graph behind it. Re-exported here under the name every
// caller in this file and its routes already uses.
export { MEETING_DELETED_STATUS }

// The exact sentence the PROJEXA UI renders beside a disabled Delete, kept
// here so the server's refusal and the client's disabled-reason cannot drift.
export const MEETING_DELETE_BLOCKED_REASON = "Published meetings cannot be deleted"

/**
 * Pure -- no DB access -- so it is unit-tested directly, matching this
 * codebase's convention of not exercising withTenantContext from a .test.ts
 * (see hr-service.ts's validateEmployeeProfileInput and its own note).
 * Only a draft is deletable; a published meeting is the locked, shareable
 * record publishVeriMeeting() exists to protect, and an already-deleted row
 * is not deletable twice.
 */
export function canDeleteMeeting(status: string): boolean {
  return status === "draft"
}

// ─── R67 D-16: the two aggregates the MoM LIST screen needs ──────────────
// PROJEXA's MoM list renders Meeting | Date & time | Attendees | Open
// actions | Status | Action. "Attendees" and "Open actions" were the two
// columns it could not draw: the list DTO carried neither, and the only way
// to get them was one GET /api/moms/{id} per row (getVeriMeeting loads the
// action items) -- an N+1 the list would have paid on every render. Both are
// therefore computed here, in the list, and returned as additive fields.
//
// "Open" is defined exactly as listMyMeetingActionItems() below already
// defines it -- a linked `tasks` row whose status is neither completed nor
// cancelled -- rather than a second, drifting definition.
export const CLOSED_ACTION_ITEM_STATUSES = ["completed", "cancelled"] as const

/**
 * Pure: how many attendees a meeting row carries.
 *
 * `veri_meetings.attendees` is jsonb, declared `string[]` (names, not FKs --
 * external attendees may not be app users) and defaulted to `[]`, so the
 * Drizzle-inferred type is `unknown`. Anything that is not an array is 0 --
 * a malformed row must not crash a list of 50 meetings. Blank strings are
 * not attendees; a non-string entry is counted because it is still a real
 * element the object page would render, and silently reporting fewer
 * attendees than the meeting has would be the same "confident wrong number"
 * this programme exists to remove.
 */
export function countAttendees(attendees: unknown): number {
  if (!Array.isArray(attendees)) return 0
  return attendees.filter((a) => (typeof a === "string" ? a.trim().length > 0 : a !== null && a !== undefined)).length
}

/**
 * Pure: joins the grouped open-action-item counts onto the meeting rows and
 * computes attendeesCount. A meeting with no matching group row has zero
 * open action items -- the grouped query returns no row at all for it, which
 * is not the same as "unknown", because the query covered every id in the
 * list.
 */
export function attachMeetingListAggregates<T extends { id: string; attendees: unknown }>(
  meetings: T[],
  openActionItemCounts: { meetingId: string; openCount: number }[]
): (T & { attendeesCount: number; openActionItems: number })[] {
  const openByMeeting = new Map(openActionItemCounts.map((r) => [r.meetingId, Number(r.openCount) || 0]))
  return meetings.map((m) => ({
    ...m,
    attendeesCount: countAttendees(m.attendees),
    openActionItems: openByMeeting.get(m.id) ?? 0,
  }))
}

// Wave 143: contextEntityId scoping added -- PROJEXA's MoM screen is
// per-project, so it needs "meetings for this project" rather than the
// full org-wide feed every existing internal caller (VeriChatPanel's
// Meetings tab) wants.
//
// R67 D-20: the org-wide branch (contextEntityId omitted) is what PROJEXA's
// new "All projects" list mode queries -- it already existed and needed no
// change, so the client can stop pretending a project was chosen.
//
// R67 D-16: every row now also carries attendeesCount and openActionItems.
// ONE extra grouped query for the whole page, inside the same tenant
// transaction, not one per row.
export async function listVeriMeetings(ctx: { orgId: string }, contextEntityId?: string) {
  // R67 D-17: soft-deleted drafts never appear in a list again -- the row is
  // kept only so the audit_logs entry deleteVeriMeeting() writes still points
  // at something real.
  const notDeleted = ne(veriMeetings.status, MEETING_DELETED_STATUS)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const meetings = await db.query.veriMeetings.findMany({
      where: contextEntityId
        ? and(eq(veriMeetings.orgId, ctx.orgId), eq(veriMeetings.contextEntityId, contextEntityId), notDeleted)
        : and(eq(veriMeetings.orgId, ctx.orgId), notDeleted),
      orderBy: desc(veriMeetings.scheduledAt),
    })
    if (meetings.length === 0) return attachMeetingListAggregates(meetings, [])

    const openActionItemCounts = await db
      .select({ meetingId: veriMeetingActionItems.meetingId, openCount: sql<number>`count(*)::int` })
      .from(veriMeetingActionItems)
      .innerJoin(tasks, eq(tasks.id, veriMeetingActionItems.taskId))
      .where(and(
        inArray(veriMeetingActionItems.meetingId, meetings.map((m) => m.id)),
        eq(tasks.orgId, ctx.orgId),
        notInArray(tasks.status, [...CLOSED_ACTION_ITEM_STATUSES]),
      ))
      .groupBy(veriMeetingActionItems.meetingId)

    return attachMeetingListAggregates(meetings, openActionItemCounts)
  })
}

export async function getVeriMeeting(ctx: { orgId: string }, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    // R67 D-17: a soft-deleted meeting is indistinguishable from one that
    // never existed, so a stale bookmark 404s rather than rendering a ghost.
    if (!meeting || meeting.status === MEETING_DELETED_STATUS) throw new ServiceError("Meeting not found", 404)
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

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const [meeting] = await db.insert(veriMeetings).values({
      orgId: ctx.orgId, title, meetingType: input.meetingType || "team", scheduledAt: new Date(input.scheduledAt),
      attendees: input.attendees || [], agenda: input.agenda || [],
      contextEntityType: input.contextEntityType || null, contextEntityId: input.contextEntityId || null,
      systemId: generateSystemId(),
      createdById: ctx.userId,
    }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.created", entityType: "veri_meeting", entityId: meeting!.id,
      details: `Created meeting "${title}"`, orgId: ctx.orgId, ...actorOf(ctx),
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
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
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
      details: `Updated: ${changedFields.join(", ")}`, orgId: ctx.orgId, ...actorOf(ctx),
    })
    return updated
  })
}

export async function updateMeetingMinutes(ctx: VeriMeetingContext, meetingId: string, minutes: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
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
      details: "Minutes updated", orgId: ctx.orgId, ...actorOf(ctx),
    })
    return updated
  })
}

// Publish/lock -- the core auditability feature adopted from meettrack-v2,
// enforced server-side (assertEditable), not just a disabled UI input.
export async function publishVeriMeeting(ctx: VeriMeetingContext, meetingId: string) {
  const updated = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Meeting not found", 404)
    if (existing.status === "published") throw new ServiceError("Meeting is already published", 409)

    const [row] = await db.update(veriMeetings)
      .set({ status: "published", publishedAt: new Date(), publishedById: ctx.userId, updatedAt: new Date() })
      .where(eq(veriMeetings.id, meetingId)).returning()

    await logActivity({
      tx: db, action: "veri_meeting.published", entityType: "veri_meeting", entityId: meetingId,
      details: "Meeting published and locked", orgId: ctx.orgId, ...actorOf(ctx),
    })
    return row
  })

  // Wave 74 (Meeting Intelligence): best-effort, non-blocking -- publishing
  // must succeed and return regardless of whether AI extraction works. Only
  // attempted when there's real minutes text to analyze.
  //
  // Bug fix (2026-07-06, found during the Demo Company E2E pass): this was a
  // bare un-awaited .catch() with no after()/waitUntil() wrapper. On Vercel's
  // serverless runtime the function environment can be frozen the instant the
  // HTTP response is sent, killing this promise before generateMeetingIntelligence
  // ever ran -- confirmed via orchestra_executions showing zero
  // meeting_intelligence.extract rows after a real publish. after() keeps the
  // invocation alive until this callback settles.
  if (updated?.minutes?.trim()) {
    after(() => generateMeetingIntelligence(ctx, meetingId).catch((err) => {
      console.error("Meeting intelligence generation failed (non-fatal, meeting still published):", err)
    }))
  }

  return updated
}

// R67 D-17: Delete, gated on the SAME rule the UI renders as a disabled
// reason. Soft (status -> 'deleted'), draft-only, and audit-logged like every
// other state transition in this file -- a published meeting is the locked
// record the whole publish/lock workflow exists to protect, so it refuses with
// the exact sentence the button shows rather than 500ing after the click.
export async function deleteVeriMeeting(ctx: VeriMeetingContext, meetingId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const existing = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!existing || existing.status === MEETING_DELETED_STATUS) throw new ServiceError("Meeting not found", 404)
    if (!canDeleteMeeting(existing.status)) throw new ServiceError(MEETING_DELETE_BLOCKED_REASON, 409)

    const [updated] = await db.update(veriMeetings)
      .set({ status: MEETING_DELETED_STATUS, updatedAt: new Date() })
      .where(eq(veriMeetings.id, meetingId)).returning()

    await logActivity({
      tx: db, action: "veri_meeting.deleted", entityType: "veri_meeting", entityId: meetingId,
      details: `Deleted meeting "${existing.title}"`, orgId: ctx.orgId, ...actorOf(ctx),
    })
    return updated
  })
}

// Wave 74 (Meeting Intelligence, AI_OS_CERTIFICATION.md §3.2 NOT_BUILT).
// Read-only over `minutes` -- never mutates meeting-level fields, so it's
// safe to call on a published (locked) meeting and safe to re-run any
// number of times (overwrites its own prior AI columns only). Suggested
// action items are exactly that -- suggestions a human reviews and
// explicitly promotes via the existing addMeetingActionItem(), never
// auto-created as real `tasks` rows.
export async function generateMeetingIntelligence(ctx: VeriMeetingContext, meetingId: string) {
  // Split from the generation attempt itself (RES-02 Phase 1,
  // PLATFORM_STRATEGY.md 29.3): "meeting not found"/"no minutes to analyze"
  // are input-validation failures, never a real generation attempt, so they
  // must never trigger meeting-intelligence-generation-monitor.ts's
  // COO escalation -- only a genuine attempt (model config resolved, LLM
  // call made) that then fails counts as a MOM_GENERATED rule violation.
  const meeting = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
  )
  if (!meeting) throw new ServiceError("Meeting not found", 404)
  if (!meeting.minutes?.trim()) throw new ServiceError("Meeting has no minutes to analyze", 400)

  try {
    return await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
      const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
      if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

      const systemPrompt = await resolvePromptTemplate("meeting_intelligence.extract")
      const userMessage = `Meeting: "${meeting.title}"\n\nMinutes:\n${meeting.minutes}`

      // Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Agent Framework section):
      // minutes are human-typed free text, the same risk shape as any chat
      // surface -- this call had no Constitution gate despite that.
      const policyDecision = enforcePolicy(
        { orgId: ctx.orgId, userId: ctx.userId ?? undefined, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "meeting_intelligence.extract" },
        userMessage
      )
      if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 400)

      const startedAt = Date.now()
      const { data: result, usage } = await callLLMJson<{
        summary: string
        keyDecisions: string[]
        suggestedActionItems: { title: string; assignee: string | null; dueDateHint: string | null }[]
      }>(modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage, { temperature: 0.2, maxTokens: 700 }, modelConfig.fallback)

      recordOrchestraExecution({
        orgId: ctx.orgId, userId: ctx.userId ?? undefined, layerKey: "task_oa", eventType: "meeting_intelligence.extract",
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
        details: "AI summary/decisions/suggested action items generated", orgId: ctx.orgId, ...actorOf(ctx),
      })

      await runMeetingIntelligenceGenerationMonitor(db, ctx.orgId, actorOf(ctx), {
        meetingId, title: meeting.title, succeeded: true,
      })

      return updated
    })
  } catch (err) {
    // The transaction above rolled back on throw, so a monitor row logged
    // inside it would have rolled back too -- a fresh transaction is the
    // only way the escalate report actually persists, same "separate
    // read/write transactions" posture dispatch-completion-monitor.ts's own
    // runDispatchCompletionSweep already uses.
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, (db) =>
      runMeetingIntelligenceGenerationMonitor(db, ctx.orgId, actorOf(ctx), {
        meetingId, title: meeting.title, succeeded: false, failureReason: err instanceof Error ? err.message : String(err),
      })
    )
    throw err
  }
}

// Action item becomes a real `tasks` row -- VERI To Do's listVeriTodos()
// already surfaces it, no separate tracking table. Deliberately NOT gated by
// meeting.status -- ongoing task work must continue after the meeting record
// itself is published/locked.
//
// Wave 78 (Multi-Agent Chaining, AI_OS_CERTIFICATION.md §2.2 NOT_BUILT): the
// task this creates now runs through executeTask() -- the same real AI
// planning/dispatch pass (plus Wave 77's memory read-back) every other task
// gets, instead of sitting as a bare `pending` row nothing ever processes.
// Meeting Intelligence's structured output (the suggested action item text
// a human is choosing to promote here) becomes literal input to a second,
// independent AI call. Still human-gated by this function's own explicit
// invocation -- no unattended write action, matching task-execution-engine's
// own doctrine.
//
// R-C04-GAP-01 (2026-08-25, latency/duplicate-row gap closure): this used to
// `await executeTask(...)` inline before returning -- confirmed via real
// orchestra_executions rows for task_execution.planning calls attached to
// meeting action items (compliance.orchestra_executions, task_id in
// veri_meeting_action_items.task_id): avg 12.1s, p50 8.85s, max 37.1s,
// n=8, all real LLM planning latency sitting on the synchronous request
// path. Real fallout of that: compliance.veri_meeting_action_items /
// tasks show 6 duplicate "Order replacement rebar batch" rows on meeting
// afng5r4rloi9egehpenznrg0 created 18:02:59-18:06:18 on 2026-08-24 -- the
// exact signature of a client retrying a timed-out request. Two changes:
// (1) DEDUPE_WINDOW_MS below -- a matching action item (same meeting, same
// trimmed title) inserted in the last window is treated as the same
// logical request and returned as-is instead of inserting a second row,
// so even a retry that reaches this function again cannot create a
// duplicate. (2) executeTask() is now dispatched via after() (the same
// pattern publishVeriMeeting() already uses for
// generateMeetingIntelligence, see its own header above) instead of being
// awaited inline, so the response returns as soon as the task+action-item
// rows exist -- the DB-only cost of this function -- instead of blocking
// on a multi-second-to-37-second AI planning call. Best-effort/
// non-blocking: a failure here still leaves a real task row (status stays
// "in_progress"), it just doesn't get the AI-planned dispatch.
const DEDUPE_WINDOW_MS = 30_000

export async function addMeetingActionItem(
  ctx: VeriMeetingContext,
  meetingId: string,
  input: { title: string; assigneeUserId?: string; dueDate?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)

    const dedupeWindowStart = new Date(Date.now() - DEDUPE_WINDOW_MS)
    const recentItems = await db.query.veriMeetingActionItems.findMany({
      where: eq(veriMeetingActionItems.meetingId, meetingId),
      with: { task: true },
      orderBy: desc(veriMeetingActionItems.createdAt),
      limit: 5,
    })
    const duplicate = recentItems.find((r) => r.task?.title === title && r.createdAt >= dedupeWindowStart)
    if (duplicate) return { actionItem: duplicate, task: duplicate.task!, deduped: true as const }

    const description = `Action item from meeting: ${meeting.title}`
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ctx.userId, assignedById: ctx.userId,
      title, description, status: "in_progress",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    }).returning()

    const [actionItem] = await db.insert(veriMeetingActionItems).values({ meetingId, taskId: task!.id }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.action_item_added", entityType: "veri_meeting", entityId: meetingId,
      details: `Action item added: "${title}"`, orgId: ctx.orgId, ...actorOf(ctx),
    })
    return { actionItem, task: task!, deduped: false as const }
  })

  if (created.deduped) return { ...created.actionItem, task: created.task }

  // R39/R-C04: executeTask needs a real actor -- prefer the task's own
  // resolved assignee (real whenever assigneeUserId was supplied, which the
  // route requires for API-key callers with no dbUser) over ctx.userId.
  const executorId = created.task.userId ?? ctx.userId
  if (!executorId) throw new ServiceError("A real user (assigneeUserId, or a session actor) is required to execute this action item", 400)
  after(() =>
    executeTask(ctx.orgId, executorId, created.task.id, created.task.title, created.task.description, null, null).catch((err) => {
      console.error("addMeetingActionItem: executeTask failed (non-fatal, action item still created):", err)
    })
  )
  return { ...created.actionItem, task: created.task }
}

// Priority 18a (VERI Chat second-screen unification): the panel's Meetings
// tab needs "action items assigned to me" across every meeting, not just one
// meeting's own detail (getVeriMeeting already does that). Reuses the same
// veriMeetingActionItems->task relation, filtered to tasks assigned to this
// user and not yet completed, with the parent meeting's title carried along
// so the panel can render "Follow up with vendor -- from Q3 Planning" without
// a second round-trip per item.
export async function listMyMeetingActionItems(ctx: { orgId: string; userId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.veriMeetingActionItems.findMany({
      with: { meeting: true, task: true },
    })
    return rows
      .filter((r) => r.meeting?.orgId === ctx.orgId && r.task?.userId === ctx.userId && r.task?.status !== "completed" && r.task?.status !== "cancelled")
      .map((r) => ({ id: r.id, meetingId: r.meetingId, meetingTitle: r.meeting!.title, task: r.task! }))
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
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
    const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
    if (!meeting) throw new ServiceError("Meeting not found", 404)
    if (meeting.status !== "published") throw new ServiceError("Only published meetings can be shared", 409)

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await db.insert(veriMeetingShareLinks).values({
      meetingId, token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()

    await logActivity({
      tx: db, action: "veri_meeting.share_link_created", entityType: "veri_meeting", entityId: meetingId,
      details: "Share link created", orgId: ctx.orgId, ...actorOf(ctx),
    })

    // R67 D-21: the route composes a per-brand message that names the meeting,
    // its date and its project, so those three facts travel back with the
    // token rather than costing the route a second round trip. Additive keys
    // only -- every pre-existing caller reads `token`/`expiresAt` off the same
    // object exactly as before.
    const project = meeting.contextEntityType === "project" && meeting.contextEntityId
      ? await db.query.projects.findFirst({
          where: and(eq(projects.id, meeting.contextEntityId), eq(projects.orgId, ctx.orgId)),
          columns: { name: true },
        })
      : null

    return {
      ...link!,
      meetingTitle: meeting.title,
      meetingScheduledAt: meeting.scheduledAt,
      projectName: project?.name ?? null,
    }
  })
}

// ─── Share-link addressing + message (R67 D-21) ───────────────────────────
// The share POST route used to compose its own link and text inline:
//   `${request.nextUrl.origin}/shared/meeting/${token}` and
//   "View these VERIDIAN AI meeting minutes: <link>".
// Both were wrong for a PROJEXA customer. The ORIGIN was whichever host the
// caller happened to reach (PROJEXA's own server calls this API server-to-
// server, so nextUrl.origin is VERIDIAN's deployment host, not the product
// domain the recipient must open); the BRAND named a product the recipient
// has never heard of. This is now one pure function so the composed link and
// the composed sentence can be asserted in a unit test instead of only being
// observable by sending a real WhatsApp message.
export type ShareBrand = "veridian" | "projexa"

// Per brand: where the public read-only page lives, and how the message reads.
const SHARE_PATH_PREFIX: Record<ShareBrand, string> = {
  veridian: "/shared/meeting",
  projexa: "/shared/mom",
}

export function normaliseShareBrand(brand: unknown): ShareBrand {
  return brand === "projexa" ? "projexa" : "veridian"
}

/**
 * Pure. Returns the origin to build the share URL from: the caller-supplied
 * shareOrigin when it is a real absolute http(s) origin, otherwise the
 * fallback (the request's own origin, i.e. the pre-D-21 behaviour) so a caller
 * that sends nothing is no worse off than before.
 */
export function resolveShareOrigin(shareOrigin: unknown, fallbackOrigin: string): string {
  if (typeof shareOrigin === "string" && shareOrigin.trim()) {
    try {
      const url = new URL(shareOrigin.trim())
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin
    } catch {
      // fall through to the fallback -- never throw on a caller's bad env var
    }
  }
  return fallbackOrigin
}

/** Pure. The date as the recipient reads it, pinned to UTC so it is stable. */
export function formatShareDate(scheduledAt: Date | string, locale = "en-GB"): string {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt)
  if (Number.isNaN(date.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date)
  }
}

export type MeetingShareTargetInput = {
  token: string
  title: string
  scheduledAt: Date | string
  projectName?: string | null
  brand?: unknown
  shareOrigin?: unknown
  fallbackOrigin: string
  locale?: string
}

export type MeetingShareTarget = {
  brand: ShareBrand
  shareUrl: string
  message: string
  whatsappHref: string
  telegramHref: string
}

/** Pure. Everything the share-link route returns to the client, composed. */
export function composeMeetingShareTarget(input: MeetingShareTargetInput): MeetingShareTarget {
  const brand = normaliseShareBrand(input.brand)
  const origin = resolveShareOrigin(input.shareOrigin, input.fallbackOrigin)
  const shareUrl = `${origin}${SHARE_PATH_PREFIX[brand]}/${encodeURIComponent(input.token)}`

  let message: string
  if (brand === "projexa") {
    // The item's exact template: "Minutes of Meeting - <title>, <date in org
    // locale>, <project name>: <link>". The project clause is dropped rather
    // than filled with a placeholder when the meeting is not project-scoped.
    const parts = [input.title, formatShareDate(input.scheduledAt, input.locale)].filter(Boolean)
    if (input.projectName?.trim()) parts.push(input.projectName.trim())
    message = `Minutes of Meeting - ${parts.join(", ")}: ${shareUrl}`
  } else {
    message = `View these VERIDIAN AI meeting minutes: ${shareUrl}`
  }

  return {
    brand,
    shareUrl,
    message,
    whatsappHref: `https://wa.me/?text=${encodeURIComponent(message)}`,
    telegramHref: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(message)}`,
  }
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
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (db) => {
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
  // R67 D-17/D-21: a soft-deleted meeting behind a live token is treated
  // exactly like an expired one -- same 404, same public copy.
  if (!meeting || meeting.status === MEETING_DELETED_STATUS) throw new ServiceError("This share link is invalid or has expired", 404)

  const actionItems = await db.query.veriMeetingActionItems.findMany({
    where: eq(veriMeetingActionItems.meetingId, meeting.id),
    with: { task: true },
  })
  // R67 D-21: the public PROJEXA page heads with the project, so resolve it
  // here rather than making the unauthenticated page guess or omit it.
  const project = meeting.contextEntityType === "project" && meeting.contextEntityId
    ? await db.query.projects.findFirst({
        where: and(eq(projects.id, meeting.contextEntityId), eq(projects.orgId, meeting.orgId)),
        columns: { name: true },
      })
    : null
  return { ...meeting, actionItems, projectName: project?.name ?? null, expiresAt: link.expiresAt }
}
