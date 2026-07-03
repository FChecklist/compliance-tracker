// Wave 12 service layer: Chat + instruction tracking. Session-only feature
// (no API-key surface -- Chat is internal, per the plan), so this uses a
// lighter context than compliance/tasks/notices' ServiceContext (which
// exists to support the dual session/API-key actor shape those don't need).
import {
  conversations, conversationParticipants, messages,
  instructionCommitments, instructionMismatchDetections, users, taskExecutionPlan,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, desc, asc, gt, isNull, ne } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLM } from "@/lib/llm-client"
import { buildPurposeClause, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { recordWorkerAgentLearning } from "./worker-agent-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ChatContext = { orgId: string; userId: string }

async function ensureAiThread(ctx: ChatContext): Promise<string> {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const participantRows = await db.query.conversationParticipants.findMany({
      where: eq(conversationParticipants.userId, ctx.userId),
    })
    if (participantRows.length > 0) {
      const convoIds = participantRows.map((p) => p.conversationId)
      const aiConvo = await db.query.conversations.findFirst({
        where: and(inArray(conversations.id, convoIds), eq(conversations.isAiThread, true)),
      })
      if (aiConvo) return aiConvo.id
    }

    const [created] = await db.insert(conversations).values({
      orgId: ctx.orgId, type: "ai", isAiThread: true, title: "VERIDIAN AI",
    }).returning()
    await db.insert(conversationParticipants).values({ conversationId: created.id, userId: ctx.userId })
    return created.id
  })
}

export async function listConversations(ctx: ChatContext) {
  const aiThreadId = await ensureAiThread(ctx)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const myParticipation = await db.query.conversationParticipants.findMany({
      where: eq(conversationParticipants.userId, ctx.userId),
    })
    const convoIds = myParticipation.map((p) => p.conversationId)
    const lastReadByConvo = new Map(myParticipation.map((p) => [p.conversationId, p.lastReadAt]))

    const convos = await db.query.conversations.findMany({
      where: inArray(conversations.id, convoIds),
      orderBy: desc(conversations.updatedAt),
    })

    const result: {
      id: string
      type: string
      isAiThread: boolean
      title: string | null
      otherParticipants: { id: string; name: string }[]
      lastMessage: { content: string; createdAt: string; senderId: string | null } | null
      unreadCount: number
      updatedAt: string
    }[] = []
    for (const convo of convos) {
      const [lastMessage] = await db.query.messages.findMany({
        where: eq(messages.conversationId, convo.id),
        orderBy: desc(messages.createdAt),
        limit: 1,
      })
      const lastReadAt = lastReadByConvo.get(convo.id) ?? null
      const unreadWhere = lastReadAt
        ? and(eq(messages.conversationId, convo.id), gt(messages.createdAt, lastReadAt), ne(messages.senderId, ctx.userId))
        : and(eq(messages.conversationId, convo.id), ne(messages.senderId, ctx.userId))
      const unread = await db.query.messages.findMany({ where: unreadWhere, columns: { id: true } })

      const otherParticipants = convo.isAiThread
        ? []
        : await db.query.conversationParticipants.findMany({
            where: and(eq(conversationParticipants.conversationId, convo.id), ne(conversationParticipants.userId, ctx.userId)),
            with: { user: { columns: { id: true, name: true } } },
          })

      result.push({
        id: convo.id,
        type: convo.type,
        isAiThread: convo.isAiThread,
        title: convo.title,
        otherParticipants: otherParticipants.map((p) => ({ id: p.user.id, name: p.user.name })),
        lastMessage: lastMessage ? { content: lastMessage.content, createdAt: lastMessage.createdAt.toISOString(), senderId: lastMessage.senderId } : null,
        unreadCount: unread.length,
        updatedAt: convo.updatedAt.toISOString(),
      })
    }

    // Pinned AI thread always first, regardless of recency.
    result.sort((a, b) => {
      if (a.id === aiThreadId) return -1
      if (b.id === aiThreadId) return 1
      return 0
    })
    return { conversations: result }
  })
}

export async function createConversation(ctx: ChatContext, input: { participantUserIds: string[]; title?: string }) {
  const participantIds = Array.from(new Set([ctx.userId, ...(input.participantUserIds ?? [])]))
  if (participantIds.length < 2) throw new ServiceError("A conversation needs at least one other participant", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const validUsers = await db.query.users.findMany({ where: inArray(users.id, participantIds) })
    if (validUsers.length !== participantIds.length) throw new ServiceError("One or more participants not found", 400)

    const [convo] = await db.insert(conversations).values({
      orgId: ctx.orgId,
      type: participantIds.length > 2 ? "group" : "direct",
      title: input.title?.trim() || null,
    }).returning()

    await db.insert(conversationParticipants).values(participantIds.map((userId) => ({ conversationId: convo.id, userId })))

    return { id: convo.id, type: convo.type, title: convo.title, createdAt: convo.createdAt.toISOString() }
  })
}

async function assertParticipant(db: TenantDb, conversationId: string, userId: string) {
  const membership = await db.query.conversationParticipants.findFirst({
    where: and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)),
  })
  if (!membership) throw new ServiceError("Conversation not found", 404)
}

export async function getMessages(ctx: ChatContext, conversationId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertParticipant(db, conversationId, ctx.userId)
    const rows = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: asc(messages.createdAt),
    })
    const messageIds = rows.map((m) => m.id)
    const commitmentRows = messageIds.length
      ? await db.query.instructionCommitments.findMany({ where: inArray(instructionCommitments.messageId, messageIds) })
      : []
    const commitmentByMessage = new Map(commitmentRows.map((c) => [c.messageId, c]))

    // RLS already restricts instruction_mismatch_detections to the assigner
    // -- a non-assigner querying this simply gets zero rows back, the same
    // guarantee the DB itself enforces, not just this extra explicit check.
    const commitmentIds = commitmentRows.map((c) => c.id)
    const mismatchRows = commitmentIds.length
      ? await db.query.instructionMismatchDetections.findMany({ where: inArray(instructionMismatchDetections.commitmentId, commitmentIds) })
      : []
    const mismatchByCommitment = new Map(mismatchRows.map((m) => [m.commitmentId, m]))

    return {
      messages: rows.map((m) => {
        const commitment = commitmentByMessage.get(m.id)
        const mismatch = commitment ? mismatchByCommitment.get(commitment.id) : undefined
        return {
          id: m.id,
          senderId: m.senderId,
          content: m.content,
          isInstruction: m.isInstruction,
          createdAt: m.createdAt.toISOString(),
          commitment: commitment
            ? { status: commitment.status, assigneeId: commitment.assigneeId, dueDate: commitment.dueDate?.toISOString() ?? null }
            : null,
          mismatch: mismatch
            ? { id: mismatch.id, comparisonSummary: mismatch.comparisonSummary, resolution: mismatch.resolution, detectedAt: mismatch.detectedAt.toISOString() }
            : null,
        }
      }),
    }
  })
}

async function generateAiReply(orgId: string, userId: string, conversationId: string, userMessage: string) {
  // Wave 12: the first real call site for the User Assistant OA layer --
  // seeded since Wave 4 but dormant until now (no code path invoked it).
  // `userId` here is the human participant, not the AI -- is_conversation_
  // participant() checks the CALLER's membership, not who a message is
  // attributed to (senderId), so it must be a real participant for this
  // INSERT to pass the messages table's RLS check at all.
  const modelConfig = await resolveModelConfig(orgId, "user_assistant_oa")
  if (!modelConfig) {
    return withTenantContext({ orgId, userId }, (db) =>
      db.insert(messages).values({
        conversationId, senderId: null,
        content: "No AI model is configured for this organisation yet. Set one up in Settings -> AI Configuration to chat with VERIDIAN AI.",
      }).returning()
    )
  }
  const startedAt = Date.now()
  try {
    const systemPromptTemplate = await resolvePromptTemplate("chat.ai_thread_system")
    const systemPrompt = systemPromptTemplate.replace("{{PURPOSE_CLAUSE}}", buildPurposeClause(DEFAULT_DOMAIN))
    const { content: reply, usage } = await callLLM(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey,
      systemPrompt,
      userMessage,
      { temperature: 0.4, maxTokens: 500 }
    )
    recordOrchestraExecution({
      orgId, userId, layerKey: "user_assistant_oa", eventType: "chat.ai_thread_reply",
      input: { conversationId }, output: { replyLength: reply.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })
    return withTenantContext({ orgId, userId }, (db) =>
      db.insert(messages).values({ conversationId, senderId: null, content: reply }).returning()
    )
  } catch (err) {
    console.error("AI thread reply failed:", err)
    recordOrchestraExecution({
      orgId, userId, layerKey: "user_assistant_oa", eventType: "chat.ai_thread_reply",
      input: { conversationId }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    })
    return withTenantContext({ orgId, userId }, (db) =>
      db.insert(messages).values({
        conversationId, senderId: null,
        content: "Something went wrong generating a reply. Please try again in a moment.",
      }).returning()
    )
  }
}

export async function sendMessage(
  ctx: ChatContext,
  conversationId: string,
  input: { content: string; isInstruction?: boolean; assigneeId?: string; dueDate?: string }
) {
  const content = input.content?.trim()
  if (!content) throw new ServiceError("content is required", 400)

  const result = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertParticipant(db, conversationId, ctx.userId)
    const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
    if (!convo) throw new ServiceError("Conversation not found", 404)

    const isInstruction = Boolean(input.isInstruction) && !convo.isAiThread // can't "instruct" the AI thread
    let assigneeId: string | null = null

    if (isInstruction) {
      const otherParticipants = await db.query.conversationParticipants.findMany({
        where: and(eq(conversationParticipants.conversationId, conversationId), ne(conversationParticipants.userId, ctx.userId)),
      })
      assigneeId = input.assigneeId ?? otherParticipants[0]?.userId ?? null
      if (!assigneeId || !otherParticipants.some((p) => p.userId === assigneeId)) {
        throw new ServiceError("assigneeId must be a participant of this conversation", 400)
      }
    }

    const [message] = await db.insert(messages).values({
      conversationId, senderId: ctx.userId, content, isInstruction,
    }).returning()

    if (isInstruction && assigneeId) {
      await db.insert(instructionCommitments).values({
        orgId: ctx.orgId,
        clientId: convo.clientId,
        messageId: message.id,
        assignerId: ctx.userId,
        assigneeId,
        describedAction: content,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      })
    }

    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId))

    return { message, isAiThread: convo.isAiThread }
  })

  const response: { message: unknown; aiReply?: unknown } = {
    message: {
      id: result.message.id, senderId: result.message.senderId, content: result.message.content,
      isInstruction: result.message.isInstruction, createdAt: result.message.createdAt.toISOString(),
    },
  }

  if (result.isAiThread) {
    const [aiMessage] = await generateAiReply(ctx.orgId, ctx.userId, conversationId, content)
    response.aiReply = { id: aiMessage.id, senderId: aiMessage.senderId, content: aiMessage.content, createdAt: aiMessage.createdAt.toISOString() }
  }

  return response
}

export async function markConversationRead(ctx: ChatContext, conversationId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertParticipant(db, conversationId, ctx.userId)
    await db.update(conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, ctx.userId)))
    return { ok: true }
  })
}

// ─── Instruction mismatches ──────────────────────────────────────────────

export async function listMyInstructionMismatches(ctx: ChatContext) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // RLS already restricts this to assigner-only rows; the explicit filter
    // below is defense in depth, not the sole guarantee.
    const commitmentRows = await db.query.instructionCommitments.findMany({
      where: and(eq(instructionCommitments.orgId, ctx.orgId), eq(instructionCommitments.assignerId, ctx.userId)),
    })
    const commitmentIds = commitmentRows.map((c) => c.id)
    if (commitmentIds.length === 0) return { mismatches: [] }

    const mismatchRows = await db.query.instructionMismatchDetections.findMany({
      where: inArray(instructionMismatchDetections.commitmentId, commitmentIds),
      orderBy: desc(instructionMismatchDetections.detectedAt),
    })
    const commitmentById = new Map(commitmentRows.map((c) => [c.id, c]))

    return {
      mismatches: mismatchRows.map((m) => {
        const commitment = commitmentById.get(m.commitmentId)!
        return {
          id: m.id,
          commitmentId: m.commitmentId,
          conversationMessageId: commitment.messageId,
          describedAction: commitment.describedAction,
          assigneeId: commitment.assigneeId,
          comparisonSummary: m.comparisonSummary,
          resolution: m.resolution,
          detectedAt: m.detectedAt.toISOString(),
          resolvedAt: m.resolvedAt?.toISOString() ?? null,
        }
      }),
    }
  })
}

export async function resolveInstructionMismatch(ctx: ChatContext, mismatchId: string, action: "nudge" | "confirm_fine") {
  if (action !== "nudge" && action !== "confirm_fine") throw new ServiceError("action must be 'nudge' or 'confirm_fine'", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const mismatch = await db.query.instructionMismatchDetections.findFirst({ where: eq(instructionMismatchDetections.id, mismatchId) })
    if (!mismatch) throw new ServiceError("Mismatch not found", 404)
    const commitment = await db.query.instructionCommitments.findFirst({ where: eq(instructionCommitments.id, mismatch.commitmentId) })
    if (!commitment || commitment.assignerId !== ctx.userId) throw new ServiceError("Mismatch not found", 404)

    const resolution = action === "nudge" ? "nudged" : "confirmed_fine"
    const [updated] = await db.update(instructionMismatchDetections)
      .set({ resolution, resolvedAt: new Date(), resolvedByUserId: ctx.userId })
      .where(eq(instructionMismatchDetections.id, mismatchId))
      .returning()

    // Nudging posts a system-authored message into the original thread --
    // this never touches the underlying task itself, by construction:
    // VERIDIAN never auto-corrects, it only ever surfaces a reminder.
    if (action === "nudge") {
      const originalMessage = await db.query.messages.findFirst({ where: eq(messages.id, commitment.messageId) })
      if (originalMessage) {
        const assigner = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) })
        await db.insert(messages).values({
          conversationId: originalMessage.conversationId,
          senderId: null,
          content: `Reminder from ${assigner?.name ?? "the assigner"}: checking in on "${commitment.describedAction}"`,
        })
      }
    }

    // Wave 16: the Worker Agent Learning Loop's real write site (constitution
    // refinement #5/#6) -- this is the one "a human validated an AI's work
    // and it needed correcting" event already in this codebase. If the
    // mismatch is tied to a task whose plan actually dispatched a worker
    // agent, that agent's future executions should benefit from the
    // correction -- fire-and-forget, never blocks the resolve response.
    if (mismatch.relatedTaskId) {
      const stepsWithAgent = await db.query.taskExecutionPlan.findMany({
        where: eq(taskExecutionPlan.taskId, mismatch.relatedTaskId),
      })
      const agentIds = [...new Set(stepsWithAgent.map((s) => s.workerAgentId).filter((id): id is string => !!id))]
      for (const workerAgentId of agentIds) {
        await recordWorkerAgentLearning(workerAgentId, mismatch.comparisonSummary, {
          commitmentId: commitment.id, resolution: action === "nudge" ? "nudged" : "confirmed_fine",
        }).catch((err) => console.error("Failed to record worker agent learning:", err))
      }
    }

    return { id: updated.id, resolution: updated.resolution, resolvedAt: updated.resolvedAt?.toISOString() ?? null }
  })
}
