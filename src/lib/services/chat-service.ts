// Wave 12 service layer: Chat + instruction tracking. Session-only feature
// (no API-key surface -- Chat is internal, per the plan), so this uses a
// lighter context than compliance/tasks/notices' ServiceContext (which
// exists to support the dual session/API-key actor shape those don't need).
import {
  conversations, conversationParticipants, messages, messageAttachments, documents, conversationGuestAccess,
  instructionCommitments, instructionMismatchDetections, users, taskExecutionPlan,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, desc, asc, gt, isNull, ne } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { after } from "next/server"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLM, type ChatTurn } from "@/lib/llm-client"
import { buildPurposeClause, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { normalizeForLlm } from "@/lib/prompt-normalizer"
import { recordWorkerAgentLearning } from "./worker-agent-service"
import { submitFdeRequest } from "./fde-service"
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

    // Wave 46 testing pass: deliberately NOT .returning() here. Confirmed
    // live (via a temporary diagnostic route) that RETURNING on this INSERT
    // fails even with the INSERT policy's WITH CHECK relaxed to `true` --
    // Postgres filters RETURNING output through the table's SELECT policy
    // (app_runtime_select_participant, which requires is_conversation_
    // participant()), and that can never be true for a row whose only
    // participant is added in the NEXT statement. Generating the id here
    // instead of reading it back from RETURNING sidesteps that entirely.
    const newConversationId = createId()
    await db.insert(conversations).values({
      id: newConversationId, orgId: ctx.orgId, type: "ai", isAiThread: true, title: "VERIDIAN AI",
    })
    await db.insert(conversationParticipants).values({ conversationId: newConversationId, userId: ctx.userId })

    // First-minute experience (2026-07-06): the landing page promises "every
    // employee gets an assistant" -- so the assistant speaks FIRST. Seed a
    // real, persisted welcome message (senderId null = VERI AI, same shape as
    // every AI reply) the moment a user's thread is born, so their very first
    // screen is their new assistant reporting for duty rather than an empty
    // chat. Runs exactly once per user (only on the thread-create path).
    const me = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) })
    const first = me?.name?.trim().split(/\s+/)[0]
    await db.insert(messages).values({
      conversationId: newConversationId,
      senderId: null,
      content:
        `Hi${first ? ` ${first}` : ""} — I'm **VERIDIAN**, your new assistant, reporting for work. 👋\n\n` +
        `Your workspace is set up and all your modules are switched on — finance, sales, CRM, HR, operations, compliance. From today, you tell me what you need in plain words, and I do it.\n\n` +
        `Three easy ways to start:\n` +
        `1. **Give me a task** — "raise an invoice", "add my first customer", "set up payroll".\n` +
        `2. **Ask me anything** about running your business.\n` +
        `3. **Tell me one thing you do every week** that you'd love to never do again — I'll take it over.\n\n` +
        `Nothing important happens without your yes — you approve, I do. What shall I take off your plate first?`,
    })
    return newConversationId
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

    // No .returning() -- see ensureAiThread()'s comment: RETURNING on this
    // INSERT is filtered through the SELECT policy, which requires an
    // already-existing participant row that can't exist until the next
    // statement below.
    const id = createId()
    const createdAt = new Date()
    const type = participantIds.length > 2 ? "group" : "direct"
    const title = input.title?.trim() || null
    await db.insert(conversations).values({ id, orgId: ctx.orgId, type, title, createdAt })

    await db.insert(conversationParticipants).values(participantIds.map((userId) => ({ conversationId: id, userId })))

    return { id, type, title, createdAt: createdAt.toISOString() }
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

    // Wave 37: a guest-authored message (Wave 36) also has senderId === null
    // (the same convention used for "the AI replied") -- without this, an
    // internal participant viewing a conversation a guest replied in would
    // see the guest's message mislabeled as VERIDIAN AI. guestAccessId is
    // what actually distinguishes the two.
    const guestAccessIds = [...new Set(rows.map((m) => m.guestAccessId).filter((id): id is string => Boolean(id)))]
    const guestAccessRows = guestAccessIds.length
      ? await db.query.conversationGuestAccess.findMany({ where: inArray(conversationGuestAccess.id, guestAccessIds) })
      : []
    const guestNameByAccessId = new Map(guestAccessRows.map((g) => [g.id, g.guestName]))

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
          isGuestMessage: Boolean(m.guestAccessId),
          guestName: m.guestAccessId ? (guestNameByAccessId.get(m.guestAccessId) ?? "Guest") : null,
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

// Wave 37 (VERI Chat Intelligence Engine, PLATFORM_STRATEGY.md §18): closes
// a confirmed gap where generateAiReply() only ever saw the single latest
// message -- no conversation history reached the LLM at all. Also inlines
// each historical message's attached document's vision-extracted content
// (documents.extractedData, Wave 35) -- messageAttachments (Wave 32) and
// extractedData both already existed but were never connected to a chat
// reply until now.
const HISTORY_LIMIT = 20
// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Token Utilization
// Engineering section): HISTORY_LIMIT bounds turn *count*, not content
// *size* -- a message can carry any number of attachments, and while each
// attachment's extracted text is capped at 2000 chars, nothing capped the
// aggregate across a whole history window. A document-heavy conversation
// could still send a very large prompt on every reply with no visibility
// into how large until a provider's context-window error. Same lesson
// already learned from a separate, already-fixed unbounded-history-growth
// incident elsewhere in this codebase's AI-workforce tooling, applied here
// before it becomes a real incident rather than after.
const HISTORY_CHAR_BUDGET = 12000

async function buildConversationHistory(
  orgId: string, userId: string, conversationId: string, excludeMessageId: string
): Promise<ChatTurn[]> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const prior = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    })
    const turns = prior.filter((m) => m.id !== excludeMessageId).slice(-HISTORY_LIMIT)
    if (turns.length === 0) return []

    const attachmentRows = await db.query.messageAttachments.findMany({
      where: inArray(messageAttachments.messageId, turns.map((t) => t.id)),
      with: { document: true },
    })
    const attachmentsByMessage = new Map<string, typeof attachmentRows>()
    for (const row of attachmentRows) {
      const list = attachmentsByMessage.get(row.messageId) ?? []
      list.push(row)
      attachmentsByMessage.set(row.messageId, list)
    }

    const history: ChatTurn[] = turns.map((m) => {
      const attached = attachmentsByMessage.get(m.id) ?? []
      const attachmentContext = attached
        .map((a) => {
          if (!a.document) return null
          const extracted = a.document.extractedData
          return `[Attached document: ${a.document.name}]${extracted ? `\n${JSON.stringify(extracted).slice(0, 2000)}` : " (not yet processed)"}`
        })
        .filter((s): s is string => Boolean(s))
        .join("\n")
      return {
        role: m.senderId === null ? ("assistant" as const) : ("user" as const),
        content: attachmentContext ? `${m.content}\n${attachmentContext}` : m.content,
      }
    })

    // Aggregate character budget, oldest-first trim -- see HISTORY_CHAR_BUDGET
    // comment above. Always keeps at least the single most recent turn, even
    // if it alone exceeds the budget (better to send one long turn than none).
    let totalChars = history.reduce((sum, t) => sum + t.content.length, 0)
    let start = 0
    while (totalChars > HISTORY_CHAR_BUDGET && start < history.length - 1) {
      totalChars -= history[start].content.length
      start++
    }
    return start > 0 ? history.slice(start) : history
  })
}

async function generateAiReply(orgId: string, userId: string, conversationId: string, triggerMessageId: string, userMessage: string) {
  // Wave 12: the first real call site for the User Assistant OA layer --
  // seeded since Wave 4 but dormant until now (no code path invoked it).
  // `userId` here is the human participant, not the AI -- is_conversation_
  // participant() checks the CALLER's membership, not who a message is
  // attributed to (senderId), so it must be a real participant for this
  // INSERT to pass the messages table's RLS check at all.
  // Wave 46 (VERIDIAN AI Constitution, Policy Enforcement Engine): the hard
  // pre-call gate -- a denied request never reaches resolveModelConfig or
  // any provider at all.
  const policyDecision = enforcePolicy(
    { orgId, userId, domain: DEFAULT_DOMAIN, layerKey: "user_assistant_oa", eventType: "chat.ai_thread_reply" },
    userMessage
  )
  if (!policyDecision.allowed) {
    return withTenantContext({ orgId, userId }, (db) =>
      db.insert(messages).values({ conversationId, senderId: null, content: refusalMessageFor(policyDecision) }).returning()
    )
  }

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
    const history = await buildConversationHistory(orgId, userId, conversationId, triggerMessageId)
    // VERIDIAN.docx Study 1 Level 2 / Joint_Implementation_Plan.md Phase 2
    // (z.ai-owned item): normalize the user's message before it reaches the
    // LLM -- strip conversational filler (greetings, hedges, politeness,
    // AI-addresses, meta-phrases) so fewer tokens leave the tenant on every
    // call. The ORIGINAL `userMessage` is still what the caller persisted
    // and what `enforcePolicy` above saw (policy/injection checks must see
    // the real text); only the copy handed to callLLM is normalized. The
    // same normalized copy is what gets logged to orchestra_executions,
    // matching Wave 144's stated intent for that field ("prove what was
    // actually asked of the LLM").
    const normalizedMessage = normalizeForLlm(userMessage)
    const { content: reply, usage } = await callLLM(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey,
      systemPrompt,
      normalizedMessage,
      { temperature: 0.4, maxTokens: 800, history },
      modelConfig.fallback
    )
    // Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1 item 3):
    // both independent studies flagged that orchestra_executions could prove
    // *cost/model* per LLM call but not *what was actually asked/answered* --
    // a real gap for any future explainability work. systemPrompt/userMessage/
    // reply are now stored in full (this table is already tenant-scoped/RLS-
    // protected like every other table in this schema); no redaction applied
    // since none was requested and building one is its own design task.
    recordOrchestraExecution({
      orgId, userId, layerKey: "user_assistant_oa", eventType: "chat.ai_thread_reply",
      input: { conversationId, systemPrompt, userMessage: normalizedMessage, historyTurnCount: history.length },
      output: { reply, replyLength: reply.length },
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
    const [aiMessage] = await generateAiReply(ctx.orgId, ctx.userId, conversationId, result.message.id, content)
    response.aiReply = { id: aiMessage.id, senderId: aiMessage.senderId, content: aiMessage.content, createdAt: aiMessage.createdAt.toISOString() }

    // Inline VERI FDE evaluation (fire-and-forget, non-blocking, PASSIVE).
    // VERI FDE's own embedding-based capability check
    // (findSimilarCapabilities in fde-service.ts) already short-circuits
    // with ZERO LLM cost on a high-confidence match (>= HIGH_CONFIDENCE_
    // THRESHOLD), so running the SAME user message text through that
    // check in parallel with every AI-thread chat turn is cheap and lets
    // the product "evolve" from real user requests without the user
    // having to explicitly click away to /fde (per the Founder's own
    // framing). This runs AFTER the visible reply is already generated
    // and saved, so it never blocks or slows the chat response; every
    // error is caught internally and never surfaces to the user.
    //
    // Real bug found + fixed 2026-07-08: the first version of this call
    // omitted `{ passive: true }`, so it fell through to
    // submitFdeRequest's full LLM-evaluation-and-propose-new-agent path
    // for every message that wasn't a high-confidence match -- meaning
    // ordinary chat ("thanks", "ok") silently triggered a SECOND LLM call
    // on top of the visible reply's own, and could auto-propose garbage
    // Worker Agent proposals from casual conversation. `passive: true`
    // stops at the free embedding check; only a confident match still
    // auto-answers/auto-dispatches. The explicit /fde page ("Request a
    // capability" button) still calls submitFdeRequest WITHOUT passive,
    // so a user who deliberately asks for something gets the full
    // evaluate-and-propose pipeline exactly as before.
    after(async () => {
      try {
        const dbUser = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
          db.query.users.findFirst({ where: eq(users.id, ctx.userId) })
        )
        if (!dbUser) return
        await submitFdeRequest({ orgId: ctx.orgId, userId: ctx.userId, dbUser }, { requestText: content }, { passive: true })
      } catch (err) {
        console.error("Background FDE evaluation failed:", err)
      }
    })
  }

  return response
}

// Wave 37: regenerate the AI thread's last reply -- deletes it and re-runs
// generateAiReply() against the same trigger message. Safe to hard-delete
// (unlike human messages elsewhere in this codebase, which are never
// deleted): the AI thread never carries instructionCommitments (see the
// `!convo.isAiThread` guard above), so there is no audit/legal record tied
// to an AI-authored message's immutability.
export async function regenerateAiReply(ctx: ChatContext, conversationId: string) {
  const { triggerMessageId, triggerContent } = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    await assertParticipant(db, conversationId, ctx.userId)
    const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
    if (!convo?.isAiThread) throw new ServiceError("Regenerate is only available in the VERI AI thread", 400)

    const all = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: (t, { asc }) => asc(t.createdAt),
    })
    const lastAiIndex = [...all].reverse().findIndex((m) => m.senderId === null)
    if (lastAiIndex === -1) throw new ServiceError("No AI reply to regenerate yet", 400)
    const lastAiMessage = all[all.length - 1 - lastAiIndex]
    const trigger = all.slice(0, all.length - 1 - lastAiIndex).reverse().find((m) => m.senderId !== null)
    if (!trigger) throw new ServiceError("No prior message to regenerate a reply for", 400)

    await db.delete(messages).where(eq(messages.id, lastAiMessage.id))
    return { triggerMessageId: trigger.id, triggerContent: trigger.content }
  })

  const [aiMessage] = await generateAiReply(ctx.orgId, ctx.userId, conversationId, triggerMessageId, triggerContent)
  return { id: aiMessage.id, senderId: aiMessage.senderId, content: aiMessage.content, createdAt: aiMessage.createdAt.toISOString() }
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
