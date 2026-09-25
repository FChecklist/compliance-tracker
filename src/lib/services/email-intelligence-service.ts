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
//
// PROJEXA-BUILD-001 U-31 (register row BR-414, PMD-05 "email-triggered
// actions create proposals only"): a suggestion that is a BOQ line item
// (category "boq_line_item" with a usable `boqLineItem`, see
// sanitizeEmailSuggestedWorkItems) is NOT promoted to a task and is NOT
// written. promoteEmailIntelligenceItem stores it as a pipeline proposal
// instead: one compliance.submissions row through submitForVerdict() (which
// runs the existing proposeSubmission()), carrying the prepared create_boq
// params in its selectedChain. Nothing reaches construction_boq_line_items
// until a person confirms it with confirmSubmission(), which runs the
// create_boq registry entry (executor.ts) under that person. Every other
// suggestion keeps the task path below, unchanged.
import { emailIntelligenceItems, emailIntelligenceActionItems, tasks, projects } from "@/lib/db"
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
import { submitForVerdict, type SubmitVerdictResult } from "@/lib/pipeline/run-submission"
import { ServiceError } from "./compliance-service"
import type { users } from "@/lib/db"

export type EmailIntelligenceContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type SuggestedWorkItemCategory = "commitment" | "follow_up" | "approval_needed" | "deadline"
export type SuggestedWorkItem = { title: string; category: SuggestedWorkItemCategory; assignee: string | null; dueDateHint: string | null }

// U-31: one BOQ line, as a suggestion carries it. The same fields
// construction-boq-service.ts's BoqLineItemInput needs for a root line
// (description, unit, quantity, rate, optional itemCode), plus the project and
// BOQ title the proposal is for when the suggestion knows them.
export type BoqLineItemSuggestion = {
  projectId: string | null
  boqTitle: string | null
  itemCode: string | null
  description: string
  unit: string
  quantity: number
  rate: number
}
export type BoqLineItemSuggestedWorkItem = Omit<SuggestedWorkItem, "category"> & { category: "boq_line_item"; boqLineItem: BoqLineItemSuggestion }
export type EmailSuggestedWorkItem = SuggestedWorkItem | BoqLineItemSuggestedWorkItem

const VALID_CATEGORIES: SuggestedWorkItemCategory[] = ["commitment", "follow_up", "approval_needed", "deadline"]

// U-31: the words a BOQ proposal is stored under (compliance.submissions.
// raw_input). confirmSubmission() never trusts a stored function id: it
// re-derives the proposal from these words, so they must resolve to create_boq
// ("New BOQ" is that function's label in function-registry.ts). They resolve
// at Level 0 only for an organisation whose phrase_map has this phrase
// promoted to create_boq; otherwise the Level 1 lane decides, under the same
// acting-person gate as any typed request (U-49).
export const EMAIL_BOQ_PROPOSAL_PHRASE = "new boq"

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

function sanitizeBoqLineItem(raw: unknown): BoqLineItemSuggestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  const amount = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const description = text(r.description)
  const unit = text(r.unit)
  const quantity = amount(r.quantity)
  const rate = amount(r.rate)
  if (!description || !unit || quantity === null || rate === null) return null
  return { projectId: text(r.projectId), boqTitle: text(r.boqTitle), itemCode: text(r.itemCode), description, unit, quantity, rate }
}

// U-31: the email side's reading of aiSuggestedWorkItems. Entry for entry the
// same list sanitizeSuggestedWorkItems returns (same order, same skips, so a
// suggestedIndex means the same entry in both), except that an entry whose
// category is "boq_line_item" AND which carries a usable boqLineItem keeps
// both. Anything else, a "boq_line_item" without a usable line included, is
// exactly what sanitizeSuggestedWorkItems makes of it. That shared function is
// left as it was: ticket-intelligence-service.ts reuses it and has no BOQ path.
function sanitizeEmailSuggestedWorkItems(raw: unknown): EmailSuggestedWorkItem[] {
  if (!Array.isArray(raw)) return []
  const items: EmailSuggestedWorkItem[] = []
  for (const entry of raw) {
    const [base] = sanitizeSuggestedWorkItems([entry])
    if (!base) continue
    const e = entry as Record<string, unknown>
    const line = e.category === "boq_line_item" ? sanitizeBoqLineItem(e.boqLineItem) : null
    items.push(line ? { ...base, category: "boq_line_item", boqLineItem: line } : base)
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

    // U-31: the email reading, so a BOQ line item's payload is kept for promote.
    const suggestedWorkItems = sanitizeEmailSuggestedWorkItems(result.suggestedWorkItems)

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
//
// U-31 (BR-414): a BOQ line-item suggestion takes the other branch --
// proposeBoqLineItemFromEmail() below -- and writes no task and no line item.
// `projectId` names the project for that proposal when the suggestion itself
// does not; the task path ignores it.
export async function promoteEmailIntelligenceItem(
  ctx: EmailIntelligenceContext,
  itemId: string,
  input: { suggestedIndex: number; assigneeUserId?: string; dueDate?: string; projectId?: string }
) {
  if (!Number.isInteger(input.suggestedIndex) || input.suggestedIndex < 0) {
    throw new ServiceError("suggestedIndex must be a non-negative integer", 400)
  }

  const created = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const item = await db.query.emailIntelligenceItems.findFirst({ where: and(eq(emailIntelligenceItems.id, itemId), eq(emailIntelligenceItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Email intelligence item not found", 404)

    const suggestions = sanitizeEmailSuggestedWorkItems(item.aiSuggestedWorkItems)
    const suggestion = suggestions[input.suggestedIndex]
    if (!suggestion) throw new ServiceError("No suggested work item at that index", 400)

    // PMD-05: nothing is written for a BOQ line item in this transaction. The
    // proposal is stored after it closes (submitForVerdict opens its own, and
    // withTenantContext must never nest, D-06).
    if (suggestion.category === "boq_line_item") return { kind: "boq" as const, item, suggestion }

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
    return { kind: "task" as const, actionItem, task: task! }
  })

  if (created.kind === "boq") return proposeBoqLineItemFromEmail(ctx, created.item, input, created.suggestion)

  await executeTask(ctx.orgId, ctx.userId, created.task.id, created.task.title, created.task.description, null, null)
  const finalTask = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.tasks.findFirst({ where: eq(tasks.id, created.task.id) })
  )
  return { ...created.actionItem, task: finalTask ?? created.task }
}

export type EmailBoqProposal = {
  /** the compliance.submissions row confirmSubmission() takes */
  submissionId: string
  functionId: "create_boq"
  /** the params to confirm with: { projectId, title, lineItems: [one line] }, also stored in the row's selectedChain */
  params: { projectId: string; title: string; lineItems: Array<Record<string, unknown>> }
  /** true when the stored words re-derived to create_boq; false means confirmSubmission() will answer not_proposed */
  staged: boolean
  verdict: SubmitVerdictResult
}

// U-31 (BR-414, PMD-05): the BOQ branch of promote. Stores ONE proposal and
// writes nothing else: no tasks row, no email_intelligence_action_items row
// (its task_id is NOT NULL and there is no task), no BOQ, no line item.
//
// The proposal is a compliance.submissions row written by submitForVerdict(),
// the same function POST /api/v1/projexa/tasks uses for step one of a typed
// request: it stores the row, runs proposeSubmission() on it (a dry run that
// mints nothing) and records the verdict and the Level 1 telemetry on it. The
// line itself travels in the row's selectedChain as the create_boq params, so
// the person who approves it confirms exactly what the email said:
//   confirmSubmission({ submissionId, functionId: "create_boq",
//                       params: selectedChain.params, actorUserId })
// which runs create_boq through runDirectTask() and the registry executor,
// recording the BOQ under that person (executor.ts, U-28).
async function proposeBoqLineItemFromEmail(
  ctx: EmailIntelligenceContext,
  item: typeof emailIntelligenceItems.$inferSelect,
  input: { suggestedIndex: number; projectId?: string },
  suggestion: BoqLineItemSuggestedWorkItem
): Promise<{ proposal: EmailBoqProposal }> {
  const line = suggestion.boqLineItem
  const projectId = (typeof input.projectId === "string" ? input.projectId.trim() : "") || line.projectId
  if (!projectId) throw new ServiceError("projectId is required to propose a BOQ line item", 400)

  // Only a project of this organisation; another organisation's reads as absent.
  const project = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
  )
  if (!project) throw new ServiceError("Project not found", 404)

  const params: EmailBoqProposal["params"] = {
    projectId,
    title: line.boqTitle ?? `From email: ${item.subject}`,
    lineItems: [
      {
        ...(line.itemCode ? { itemCode: line.itemCode } : {}),
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        rate: line.rate,
      },
    ],
  }

  const verdict = await submitForVerdict({
    orgId: ctx.orgId,
    userId: ctx.userId,
    mode: "Projects",
    projectId,
    rawInput: EMAIL_BOQ_PROPOSAL_PHRASE,
    selectedChain: {
      source: "email_intelligence",
      emailIntelligenceItemId: item.id,
      suggestedIndex: input.suggestedIndex,
      functionId: "create_boq",
      params,
    },
    // U-49: the person who promoted, the one identity the Level 1 gate compares.
    level1PersonId: ctx.userId,
  })
  const staged = verdict.understood?.functionId === "create_boq"

  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    logActivity({
      tx: db, action: "email_intelligence.proposed", entityType: "email_intelligence_item", entityId: item.id,
      details: `Proposed BOQ line item "${line.description}" for confirmation (submission ${verdict.submissionId})${staged ? "" : "; the proposal did not resolve to New BOQ"}`,
      orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
  )

  return { proposal: { submissionId: verdict.submissionId, functionId: "create_boq", params, staged, verdict } }
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

export { ServiceError, sanitizeSuggestedWorkItems, sanitizeEmailSuggestedWorkItems }
