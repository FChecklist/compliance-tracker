// Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS). A user records/uploads a
// short voice memo -- a quick note, or captured during/after a meeting --
// it is transcribed via OpenAI Whisper (whisper-client.ts) and turned into
// real tasks rows, mirroring veri-meeting-service.ts's own
// generateMeetingIntelligence()/addMeetingActionItem() shape rather than
// inventing a parallel extraction pipeline:
//   resolveModelConfig -> resolvePromptTemplate -> enforcePolicy ->
//   callLLMJson -> recordOrchestraExecution -> persist suggestions ->
//   human explicitly promotes a suggestion to a real task.
//
// Design note on meeting-attached memos: rather than writing the raw
// transcript into that meeting's own minutes field (which would either
// fight veriMeetings' publish/lock invariant -- assertEditable blocks
// minutes edits once published -- or silently blend machine transcript
// text into a human-curated minutes record), a meeting-attached memo runs
// its own extraction pass exactly like a standalone memo, and differs only
// at "promote suggestion to task" time: addVoiceMemoTicket() delegates
// straight to veri-meeting-service.ts's addMeetingActionItem() when
// meetingId is set (zero duplicated task-creation logic, and the resulting
// task shows up on that meeting's own action items / VERI Chat's Meetings
// tab, same as any other meeting action item), and only falls back to this
// file's own addVoiceMemoActionItem() (a deliberate, minimal mirror of
// addMeetingActionItem() against voiceMemoActionItems instead of
// veriMeetingActionItems) when there is no parent meeting row to attach to.
import { voiceMemos, voiceMemoActionItems, veriMeetings, tasks } from "@/lib/db"
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
import { transcribeAudio } from "@/lib/whisper-client"
import { addMeetingActionItem, ServiceError } from "./veri-meeting-service"
export { ServiceError }

export type VoiceTicketContext = { orgId: string; userId: string; dbUser: unknown }

export type SuggestedActionItem = { title: string; assignee: string | null; dueDateHint: string | null }

// Pure, DB-free -- validates/normalizes the LLM's JSON output into the
// shape this table (and veriMeetings.aiSuggestedActionItems) expects,
// tolerating a model that omits a field or returns the wrong type instead
// of throwing the whole extraction away. Exported so it's directly
// unit-testable (see voice-ticket-service.test.ts) without a DB.
export function normalizeSuggestedActionItems(raw: unknown): SuggestedActionItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: typeof item.title === "string" ? item.title.trim() : "",
      assignee: typeof item.assignee === "string" && item.assignee.trim() ? item.assignee.trim() : null,
      dueDateHint: typeof item.dueDateHint === "string" && item.dueDateHint.trim() ? item.dueDateHint.trim() : null,
    }))
    .filter((item) => item.title.length > 0)
}

export async function listVoiceMemos(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.voiceMemos.findMany({ where: eq(voiceMemos.orgId, ctx.orgId), orderBy: desc(voiceMemos.createdAt) })
  )
}

export async function getVoiceMemo(ctx: { orgId: string }, memoId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const memo = await db.query.voiceMemos.findFirst({ where: and(eq(voiceMemos.id, memoId), eq(voiceMemos.orgId, ctx.orgId)) })
    if (!memo) throw new ServiceError("Voice memo not found", 404)
    const actionItems = await db.query.voiceMemoActionItems.findMany({
      where: eq(voiceMemoActionItems.voiceMemoId, memoId),
      with: { task: true },
    })
    return { ...memo, actionItems }
  })
}

// Creates the voice_memos row once the audio file's bytes are already
// safely in the private Storage bucket (the caller, the upload API route,
// does that write -- this function is DB-only, matching documents.ts's own
// split between "upload bytes to Storage" and "insert the row", except here
// both happen in the same route rather than a shared service helper, since
// there is exactly one call site).
export async function createVoiceMemo(
  ctx: VoiceTicketContext,
  input: { meetingId?: string | null; audioStoragePath: string; audioMimeType?: string | null; durationSeconds?: number | null }
) {
  if (!input.audioStoragePath) throw new ServiceError("audioStoragePath is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    if (input.meetingId) {
      const meeting = await db.query.veriMeetings.findFirst({ where: and(eq(veriMeetings.id, input.meetingId), eq(veriMeetings.orgId, ctx.orgId)) })
      if (!meeting) throw new ServiceError("Meeting not found", 404)
    }

    const [memo] = await db.insert(voiceMemos).values({
      orgId: ctx.orgId, userId: ctx.userId, meetingId: input.meetingId || null,
      audioStoragePath: input.audioStoragePath, audioMimeType: input.audioMimeType || null,
      durationSeconds: input.durationSeconds || null, status: "uploaded",
    }).returning()

    await logActivity({
      tx: db, action: "voice_memo.created", entityType: "voice_memo", entityId: memo!.id,
      details: input.meetingId ? "Voice memo recorded for meeting " + input.meetingId : "Voice memo recorded",
      orgId: ctx.orgId, dbUser: ctx.dbUser as never,
    })
    return memo
  })
}

// Fire-and-forget from the upload route via after() -- receives the audio
// bytes directly (already read once for the Storage upload) rather than
// re-downloading from Storage, the same "reuse bytes already in memory"
// discipline documents/route.ts uses for its own fire-and-forget vision
// extraction. Every real failure is still recorded on the row itself
// (status='failed' + errorMessage), never silently dropped -- the caller's
// own after() wrapper should still .catch() this too, per this codebase's
// own after()-must-not-swallow-errors-silently lesson from
// veri-meeting-service.ts's publishVeriMeeting bug fix.
export async function transcribeAndExtractVoiceMemo(
  ctx: VoiceTicketContext,
  memoId: string,
  audioBytes: Uint8Array,
  filename: string,
  mimeType: string
) {
  const markFailed = async (message: string) => {
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(voiceMemos).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(eq(voiceMemos.id, memoId))
    )
  }

  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.update(voiceMemos).set({ status: "transcribing", updatedAt: new Date() }).where(eq(voiceMemos.id, memoId))
  )

  let transcript: string
  try {
    const result = await transcribeAudio(audioBytes, filename, mimeType)
    transcript = result.text
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed"
    await markFailed(message)
    throw err
  }

  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.update(voiceMemos).set({ transcript, transcribedAt: new Date(), status: "extracting", updatedAt: new Date() }).where(eq(voiceMemos.id, memoId))
  )

  if (!transcript.trim()) {
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(voiceMemos).set({ status: "completed", updatedAt: new Date() }).where(eq(voiceMemos.id, memoId)).returning()
      return updated
    })
  }

  try {
    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const systemPrompt = await resolvePromptTemplate("voice_ticket.extract")

    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "voice_ticket.extract" },
      transcript
    )
    if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 400)

    const startedAt = Date.now()
    const { data: result, usage } = await callLLMJson<{ summary: string; suggestedActionItems: unknown }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, transcript,
      { temperature: 0.2, maxTokens: 500 }, modelConfig.fallback
    )

    const suggestions = normalizeSuggestedActionItems(result.suggestedActionItems)

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "voice_ticket.extract",
      input: { memoId }, output: { suggestedActionItemCount: suggestions.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(voiceMemos).set({
        aiSummary: result.summary, aiSuggestedActionItems: suggestions, aiGeneratedAt: new Date(),
        status: "completed", updatedAt: new Date(),
      }).where(eq(voiceMemos.id, memoId)).returning()

      await logActivity({
        tx: db, action: "voice_memo.ai_extraction_completed", entityType: "voice_memo", entityId: memoId,
        details: "Transcribed and extracted " + suggestions.length + " suggested action item(s)", orgId: ctx.orgId, dbUser: ctx.dbUser as never,
      })
      return updated
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI extraction failed"
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(voiceMemos).set({ status: "transcribed", errorMessage: message, updatedAt: new Date() }).where(eq(voiceMemos.id, memoId))
    )
    throw err
  }
}

// Promotes one suggested (or freely typed) action item into a real tasks
// row. Delegates straight to addMeetingActionItem() when this memo is
// attached to a meeting -- zero duplicated task-creation logic, and the
// task then shows up wherever meeting action items already surface
// (getVeriMeeting, listMyMeetingActionItems / VERI Chat's Meetings tab).
export async function addVoiceMemoTicket(
  ctx: VoiceTicketContext & { dbUser: Parameters<typeof addMeetingActionItem>[0]["dbUser"] },
  memoId: string,
  input: { title: string; assigneeUserId?: string; dueDate?: string }
) {
  const memo = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.voiceMemos.findFirst({ where: and(eq(voiceMemos.id, memoId), eq(voiceMemos.orgId, ctx.orgId)) })
  )
  if (!memo) throw new ServiceError("Voice memo not found", 404)

  if (memo.meetingId) {
    return addMeetingActionItem(ctx, memo.meetingId, input)
  }
  return addVoiceMemoActionItem(ctx, memoId, input)
}

// Standalone-memo path only -- mirrors addMeetingActionItem() against
// voiceMemoActionItems instead of veriMeetingActionItems (the minimal
// duplication actually required, since there is no parent meeting row here).
async function addVoiceMemoActionItem(
  ctx: VoiceTicketContext,
  memoId: string,
  input: { title: string; assigneeUserId?: string; dueDate?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const memo = await db.query.voiceMemos.findFirst({ where: and(eq(voiceMemos.id, memoId), eq(voiceMemos.orgId, ctx.orgId)) })
    if (!memo) throw new ServiceError("Voice memo not found", 404)

    const description = "Action item from voice memo"
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ctx.userId, assignedById: ctx.userId,
      title, description, status: "in_progress",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    }).returning()

    const [actionItem] = await db.insert(voiceMemoActionItems).values({ voiceMemoId: memoId, taskId: task!.id }).returning()

    await logActivity({
      tx: db, action: "voice_memo.action_item_added", entityType: "voice_memo", entityId: memoId,
      details: "Action item added: " + JSON.stringify(title), orgId: ctx.orgId, dbUser: ctx.dbUser as never,
    })
    return { actionItem, task: task! }
  })

  await executeTask(ctx.orgId, ctx.userId, created.task.id, created.task.title, created.task.description, null, null)
  const finalTask = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.tasks.findFirst({ where: eq(tasks.id, created.task.id) })
  )
  return { ...created.actionItem, task: finalTask ?? created.task }
}

// Cross-memo "assigned to me" view -- mirrors listMyMeetingActionItems()
// exactly, for the VERI Chat Voice tab aggregator. Only covers standalone
// memos' own join table -- meeting-attached memo action items already
// surface via listMyMeetingActionItems() itself, since they were created
// through addMeetingActionItem().
export async function listMyVoiceTickets(ctx: { orgId: string; userId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.voiceMemoActionItems.findMany({ with: { voiceMemo: true, task: true } })
    return rows
      .filter((r) => r.voiceMemo?.orgId === ctx.orgId && r.task?.userId === ctx.userId && r.task?.status !== "completed" && r.task?.status !== "cancelled")
      .map((r) => ({ id: r.id, voiceMemoId: r.voiceMemoId, task: r.task! }))
  })
}
