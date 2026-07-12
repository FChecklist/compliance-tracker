// Priority 2 item 4 (tree4-unified/50-completion-plan/07-priority2-tracker.yaml
// num:4 d21_intelligent_work_detection), closing U-D21.B4.S1
// (tree4-unified/10-merged-governance-layer.yaml): "For received email:
// understand context, identify commitments, detect follow-up/approval/
// deadline actions -- same detect-then-propose pattern as MoM/Document
// intelligence, applied to email." The tree's own note calls this
// explicitly the SAME pattern already proven for meeting minutes
// (veri-meeting-service.ts's generateMeetingIntelligence, Wave 74) and
// documents (documents/extract) -- this file mirrors
// generateMeetingIntelligence's shape line-for-line where the concepts
// carry over: enforcePolicy -> resolveModelConfig -> resolvePromptTemplate
// -> callLLMJson -> recordOrchestraExecution -> persist AI output as
// SUGGESTIONS ONLY -> logActivity. A suggestion only becomes a real `tasks`
// row via an explicit promoteEmailIntelligenceItem() call, mirroring
// addMeetingActionItem() -- never auto-created, matching this domain's own
// "No object created without approval" requirement (U-D21.B1.S1).
//
// Honest scope note: no inbound-email-ingestion trigger exists anywhere in
// this codebase today (confirmed by direct search -- only outbound send via
// email.ts). analyzeInboundEmail() is therefore a callable function/API
// route that TAKES an email's already-extracted content as input (subject/
// sender/body/receivedAt), not a live "email arrives" listener. It's the
// real wiring point a future inbox-sync feature (or a manual "paste this
// email" action) would call into -- not a simulation of one.
import { emailIntelligenceItems, emailIntelligenceActionItems, tasks } from "@/lib/db"
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
import { ServiceError } from "./compliance-service"
import type { users } from "@/lib/db"

export type EmailIntelligenceContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type SuggestedWorkItemCategory = "commitment" | "follow_up" | "approval_needed" | "deadline"
export type SuggestedWorkItem = { title: string; category: SuggestedWorkItemCategory; assignee: string | null; dueDateHint: string | null }

const VALID_CATEGORIES: SuggestedWorkItemCategory[] = ["commitment", "follow_up", "approval_needed", "deadline"]

function sanitizeSuggestedWorkItems(raw: unknown): SuggestedWorkItem[] {
  if (!Array.isArray(raw)) return []
  const items: SuggestedWorkItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const title = typeof e.title === "string" ? e.title.trim() : ""
    if (!title) continue
    const category = VALID_CATEGORIES.includes(e.category as SuggestedWorkItemCategory) ? (e.category as SuggestedWorkItemCategory) : "follow_up"
    items.push({
      title,
      category,
      assignee: typeof e.assignee === "string" && e.assignee.trim() ? e.assignee.trim() : null,
      dueDateHint: typeof e.dueDateHint === "string" && e.dueDateHint.trim() ? e.dueDateHint.trim() : null,
    })
  }
  return items
}

export async function listEmailIntelligenceItems(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.emailIntelligenceItems.findMany({ where: eq(emailIntelligenceItems.orgId, ctx.orgId), orderBy: desc(emailIntelligenceItems.createdAt) })
  )
}

export async function getEmailIntelligenceItem(ctx: { orgId: string }, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const item = await db.query.emailIntelligenceItems.findFirst({ where: and(eq(emailIntelligenceItems.id, itemId), eq(emailIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Email intelligence item not found", 404)
    const actionItems = await db.query.emailIntelligenceActionItems.findMany({
      where: eq(emailIntelligenceActionItems.emailIntelligenceItemId, itemId),
      with: { task: true },
    })
    return { ...item, actionItems }
  })
}

// The real build: given an email's content, detect commitments/follow-ups/
// approvals-needed/deadlines and propose Work Object candidates. Persists
// the raw email alongside the AI's suggestions in one call (unlike
// generateMeetingIntelligence, which analyzes an already-persisted
// veri_meetings row) since there's no separate "create the email record"
// step upstream of this in today's codebase.
export async function analyzeInboundEmail(
  ctx: EmailIntelligenceContext,
  input: { subject: string; body: string; senderEmail?: string; receivedAt?: string }
) {
  const subject = input.subject?.trim()
  const body = input.body?.trim()
  if (!subject) throw new ServiceError("subject is required", 400)
  if (!body) throw new ServiceError("body is required", 400)

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [item] = await db.insert(emailIntelligenceItems).values({
      orgId: ctx.orgId,
      submittedById: ctx.userId,
      subject,
      body,
      senderEmail: input.senderEmail?.trim() || null,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
      status: "analyzing",
    }).returning()

    await logActivity({
      tx: db, action: "email_intelligence.submitted", entityType: "email_intelligence_item", entityId: item!.id,
      details: `Submitted email for analysis: "${subject}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return item!
  })

  try {
    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

    const systemPrompt = await resolvePromptTemplate("email_intelligence.detect")
    const userMessage = `Subject: ${subject}\nFrom: ${input.senderEmail ?? "unknown"}\n\nBody:\n${body}`

    // Same posture as generateMeetingIntelligence's Constitution gate --
    // email body is free text from an external, potentially untrusted
    // sender, at least as much risk as human-typed chat/minutes.
    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "email_intelligence.detect" },
      userMessage
    )
    if (!policyDecision.allowed) {
      await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
        db.update(emailIntelligenceItems).set({ status: "analysis_failed", updatedAt: new Date() }).where(eq(emailIntelligenceItems.id, created.id))
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
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "email_intelligence.detect",
      input: { emailIntelligenceItemId: created.id }, output: { suggestedWorkItemCount: suggestedWorkItems.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [updated] = await db.update(emailIntelligenceItems).set({
        status: "proposed",
        aiSummary: result.summary ?? null,
        aiSuggestedWorkItems: suggestedWorkItems,
        aiGeneratedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(emailIntelligenceItems.id, created.id)).returning()

      await logActivity({
        tx: db, action: "email_intelligence.analyzed", entityType: "email_intelligence_item", entityId: created.id,
        details: `AI detected ${suggestedWorkItems.length} candidate work item(s)`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
      return updated
    })
  } catch (error) {
    if (error instanceof ServiceError) throw error
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.update(emailIntelligenceItems).set({ status: "analysis_failed", updatedAt: new Date() }).where(eq(emailIntelligenceItems.id, created.id))
    )
    throw error
  }
}

// Promotes exactly one suggested item into a real `tasks` row -- mirrors
// addMeetingActionItem() exactly. Human-gated by construction: this only
// runs because a user explicitly picked a suggestedIndex, never
// automatically from analyzeInboundEmail() itself.
export async function promoteEmailIntelligenceItem(
  ctx: EmailIntelligenceContext,
  itemId: string,
  input: { suggestedIndex: number; assigneeUserId?: string; dueDate?: string }
) {
  if (!Number.isInteger(input.suggestedIndex) || input.suggestedIndex < 0) {
    throw new ServiceError("suggestedIndex must be a non-negative integer", 400)
  }

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.emailIntelligenceItems.findFirst({ where: and(eq(emailIntelligenceItems.id, itemId), eq(emailIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Email intelligence item not found", 404)

    const suggestions = sanitizeSuggestedWorkItems(item.aiSuggestedWorkItems)
    const suggestion = suggestions[input.suggestedIndex]
    if (!suggestion) throw new ServiceError("No suggested work item at that index", 400)

    const description = `Detected from email "${item.subject}"${item.senderEmail ? ` (from ${item.senderEmail})` : ""}: ${suggestion.category.replace("_", " ")}`
    const [task] = await db.insert(tasks).values({
      orgId: ctx.orgId, userId: input.assigneeUserId || ctx.userId, assignedById: ctx.userId,
      title: suggestion.title, description, status: "in_progress",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    }).returning()

    const [actionItem] = await db.insert(emailIntelligenceActionItems).values({
      emailIntelligenceItemId: itemId, suggestedIndex: input.suggestedIndex, taskId: task!.id,
    }).returning()

    await logActivity({
      tx: db, action: "email_intelligence.promoted", entityType: "email_intelligence_item", entityId: itemId,
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

export async function dismissEmailIntelligenceItem(ctx: EmailIntelligenceContext, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.emailIntelligenceItems.findFirst({ where: and(eq(emailIntelligenceItems.id, itemId), eq(emailIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Email intelligence item not found", 404)

    const [updated] = await db.update(emailIntelligenceItems).set({ status: "dismissed", updatedAt: new Date() }).where(eq(emailIntelligenceItems.id, itemId)).returning()

    await logActivity({
      tx: db, action: "email_intelligence.dismissed", entityType: "email_intelligence_item", entityId: itemId,
      details: "Dismissed -- no work item promoted", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

export { ServiceError, sanitizeSuggestedWorkItems }
