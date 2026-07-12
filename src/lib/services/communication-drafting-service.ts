// Priority 2 item 4 (tree4-unified/50-completion-plan/07-priority2-tracker.yaml
// num:4 d10_communication_governance), closing GAP-06
// (tree4-unified/30-gap-backlog.yaml) / U-D10.B2.S1+B3.S1
// (tree4-unified/10-merged-governance-layer.yaml): "an AI-drafted
// communication, held for user approval before send" -- composing 3
// existing mechanisms per the gap's own workflow, not inventing new
// drafting or approval machinery:
//   1. AI-drafting: an org-aware LLM call (resolveModelConfig +
//      callLLMJson), the SAME pattern generateMeetingIntelligence/
//      documents-extract already use for customer-facing AI generation.
//   2. Hold: persist the draft in drafted_communications with
//      status='pending_approval'.
//   3. Approval: GOV-14's approval-preference-service.ts
//      (checkApprovalPreference/saveApprovalPreference) for the
//      always_approve/always_reject shortcut, exactly as task-service.ts's
//      high-impact-action confirmation flow already does.
//   4. Send: email.ts's sendEmail(), gated by communication-guardrails.ts's
//      deterministic checks (U-D10.B4.S1's 7-rule guardrail, the checkable
//      half of it).
//
// DEVIATION FROM THE TREE'S LITERAL RECOMMENDATION, documented rather than
// silently made: U-D10.B3.S1's `instruction` field says "reuse GOV-06's
// runRole() for drafting." Direct inspection of GOV-06
// (src/lib/ai-team/team-service.ts) shows runRole() is scoped to the AI
// Dev Team that BUILDS Veridian itself -- its own header comment: "This
// module never touches a customer org's customer_model_config -- the AI
// Dev Team builds VERIDIAN, it doesn't run inside it," it is
// veridian_admin-gated end-to-end, and it spends the PLATFORM's own
// OpenRouter key, never an org's BYOK config. API-08's own tree evidence
// independently confirms the same read: "ai/team/dispatch ... governs the
// AI Dev Team itself ... not a customer-facing feature." Using it to draft
// a customer org's outbound business communications would cross that
// boundary. This service uses the correct customer-facing equivalent
// instead -- functionally the identical "AI drafts, human approves" shape,
// just resolveModelConfig()/callLLMJson() (an org's own BYOK-or-platform
// model) rather than the internal dev-team dispatcher.
import { draftedCommunications } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { logActivity } from "@/lib/audit"
import { eq, and, desc } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { checkApprovalPreference, saveApprovalPreference, type ApprovalDecision } from "@/lib/approval-preference-service"
import { evaluateGuardrails } from "@/lib/guardrail-engine"
import { registerAllGuardrails, COMMUNICATION_DRAFT_SEND_LEAF } from "@/lib/guardrail-registrations"
import { sendEmail, emailTemplate } from "@/lib/email"
import { ServiceError } from "./compliance-service"
import type { users } from "@/lib/db"

registerAllGuardrails()

export type CommunicationDraftingContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export type CommunicationTriggerType = "manual" | "detected_commitment" | "detected_follow_up" | "detected_deadline" | "detected_approval_needed"
export type CommunicationTriggerRefType = "email_intelligence_item" | "task" | "veri_meeting"

const VALID_TRIGGER_TYPES: CommunicationTriggerType[] = ["manual", "detected_commitment", "detected_follow_up", "detected_deadline", "detected_approval_needed"]
const VALID_TRIGGER_REF_TYPES: CommunicationTriggerRefType[] = ["email_intelligence_item", "task", "veri_meeting"]

export async function listDraftedCommunications(ctx: { orgId: string }, filters?: { status?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.draftedCommunications.findMany({
      where: filters?.status
        ? and(eq(draftedCommunications.orgId, ctx.orgId), eq(draftedCommunications.status, filters.status))
        : eq(draftedCommunications.orgId, ctx.orgId),
      orderBy: desc(draftedCommunications.createdAt),
    })
  )
}

export async function getDraftedCommunication(ctx: { orgId: string }, draftId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const draft = await db.query.draftedCommunications.findFirst({ where: and(eq(draftedCommunications.id, draftId), eq(draftedCommunications.orgId, ctx.orgId)) })
    if (!draft) throw new ServiceError("Drafted communication not found", 404)
    return draft
  })
}

/**
 * Step 1+2 of GAP-06's workflow: draft the communication via an org-aware
 * LLM call, then persist it in a pending-approval state. Step 2 also checks
 * for an existing always_approve/always_reject preference -- if one exists,
 * this function itself completes the hold->approve(or reject)->send
 * pipeline (still fully audit-logged with autoApprovedViaPreference: true),
 * exactly mirroring the "preference === always_approve: fall through" logic
 * task-service.ts already uses for high-impact-action confirmation. If no
 * shortcut exists, the draft is left in 'pending_approval' for an explicit
 * approveCommunication()/rejectCommunication() call (step 3).
 *
 * Honest limitation: triggerRefId/triggerRefType are stored for audit
 * traceability but not verified to reference a real row of that type in
 * this org -- callers are all internal (email-intelligence-service.ts's
 * promote flow or an authenticated user's own request), so a spoofed
 * triggerRefId cannot expose another org's data (RLS still applies to any
 * later lookup by that id), but it could log a misleading trigger reason.
 * Worth tightening if a third-party/API-key caller is added later.
 */
export async function draftCommunication(
  ctx: CommunicationDraftingContext,
  input: {
    communicationType: string
    triggerType: CommunicationTriggerType
    triggerRefType?: CommunicationTriggerRefType
    triggerRefId?: string
    recipientEmails: string[]
    context: string // freeform description of what to draft (e.g. "weekly status update for the ABC Corp GST filing" or the detected commitment's text)
  }
) {
  const communicationType = input.communicationType?.trim()
  if (!communicationType) throw new ServiceError("communicationType is required", 400)
  if (!VALID_TRIGGER_TYPES.includes(input.triggerType)) throw new ServiceError(`triggerType must be one of: ${VALID_TRIGGER_TYPES.join(", ")}`, 400)
  if (input.triggerRefType && !VALID_TRIGGER_REF_TYPES.includes(input.triggerRefType)) throw new ServiceError(`triggerRefType must be one of: ${VALID_TRIGGER_REF_TYPES.join(", ")}`, 400)
  if (!Array.isArray(input.recipientEmails) || input.recipientEmails.length === 0) throw new ServiceError("recipientEmails must be a non-empty array", 400)
  const context = input.context?.trim()
  if (!context) throw new ServiceError("context is required", 400)

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) throw new ServiceError("No AI provider configured for this organisation", 503)

  const systemPrompt = await resolvePromptTemplate("communication_drafting.draft")
  const userMessage = `Communication type: ${communicationType}\nTrigger: ${input.triggerType}\nRecipients: ${input.recipientEmails.join(", ")}\n\nContext:\n${context}`

  // The freeform `context` may be a detected commitment's text (from an
  // external email) or a user's own instruction -- same untrusted-free-text
  // risk shape as every other enforcePolicy() call site in this codebase.
  const policyDecision = enforcePolicy(
    { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "communication_drafting.draft" },
    userMessage
  )
  if (!policyDecision.allowed) throw new ServiceError(refusalMessageFor(policyDecision), 400)

  const startedAt = Date.now()
  const { data: result, usage } = await callLLMJson<{ subject: string; body: string; attachmentsRecommendation: string[] }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
    { temperature: 0.3, maxTokens: 900 }, modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "communication_drafting.draft",
    input: { communicationType, triggerType: input.triggerType }, output: { subjectLength: result.subject?.length ?? 0, bodyLength: result.body?.length ?? 0 },
    status: "completed", durationMs: Date.now() - startedAt,
    provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  const draft = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(draftedCommunications).values({
      orgId: ctx.orgId, userId: ctx.userId,
      communicationType, triggerType: input.triggerType,
      triggerRefType: input.triggerRefType ?? null, triggerRefId: input.triggerRefId ?? null,
      recipientEmails: input.recipientEmails,
      subject: result.subject ?? "", body: result.body ?? "",
      attachmentsRecommendation: Array.isArray(result.attachmentsRecommendation) ? result.attachmentsRecommendation : [],
      status: "pending_approval",
    }).returning()

    await logActivity({
      tx: db, action: "drafted_communication.drafted", entityType: "drafted_communication", entityId: row!.id,
      details: `AI drafted a "${communicationType}" communication to ${input.recipientEmails.join(", ")}, held for approval`,
      orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return row!
  })

  // Step 3's shortcut, checked here per GAP-06's own workflow step 2 --
  // most-specific-scope-wins lookup, "communication_type" scope, keyed by
  // this draft's communicationType (the same scopeType task-service.ts
  // already uses for high-impact-action preferences).
  const preference = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    checkApprovalPreference(db, ctx.orgId, ctx.userId, communicationType, "communication_type")
  )

  if (preference === "always_approve") {
    return approveCommunication(ctx, draft.id, { autoApprovedViaPreference: true })
  }
  if (preference === "always_reject") {
    return rejectCommunication(ctx, draft.id, { reason: "Auto-rejected: a saved always-reject preference exists for this communication type.", autoRejectedViaPreference: true })
  }
  return draft
}

/**
 * Step 3+4: approve a pending draft and send it. Runs the deterministic
 * guardrail gate (U-D10.B4.S1) immediately before sendEmail() -- whether a
 * human clicked approve or an always_approve preference fired this call,
 * the exact same check runs, so a saved shortcut can never bypass the
 * guardrail a manual approval would have to pass.
 */
export async function approveCommunication(
  ctx: CommunicationDraftingContext,
  draftId: string,
  options?: { savePreference?: ApprovalDecision; autoApprovedViaPreference?: boolean }
) {
  const draft = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.draftedCommunications.findFirst({ where: and(eq(draftedCommunications.id, draftId), eq(draftedCommunications.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Drafted communication not found", 404)
    if (existing.status !== "pending_approval") throw new ServiceError(`Cannot approve a communication with status "${existing.status}"`, 409)
    return existing
  })

  const guardrailResult = evaluateGuardrails(COMMUNICATION_DRAFT_SEND_LEAF, "input", {
    recipientEmails: draft.recipientEmails, subject: draft.subject, body: draft.body,
  })
  if (!guardrailResult.passed) {
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      await db.update(draftedCommunications).set({ status: "send_failed", updatedAt: new Date() }).where(eq(draftedCommunications.id, draftId))
      await logActivity({
        tx: db, action: "drafted_communication.guardrail_blocked", entityType: "drafted_communication", entityId: draftId,
        details: `Blocked before send: ${guardrailResult.reason} -- ${guardrailResult.guidance}`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
    })
    throw new ServiceError(guardrailResult.guidance, 422)
  }

  const approved = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.update(draftedCommunications).set({
      status: "approved", approvedById: ctx.userId, approvedAt: new Date(),
      autoApprovedViaPreference: options?.autoApprovedViaPreference ?? false,
      updatedAt: new Date(),
    }).where(eq(draftedCommunications.id, draftId)).returning()

    await logActivity({
      tx: db, action: "drafted_communication.approved", entityType: "drafted_communication", entityId: draftId,
      details: options?.autoApprovedViaPreference
        ? "Auto-approved via a saved always-approve preference"
        : "Approved by user", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })

    if (options?.savePreference) {
      await saveApprovalPreference(db, ctx.orgId, ctx.userId, draft.communicationType, "communication_type", undefined, options.savePreference)
      await logActivity({
        tx: db, action: "drafted_communication.preference_saved", entityType: "drafted_communication", entityId: draftId,
        details: `Saved "${options.savePreference}" preference for communication_type="${draft.communicationType}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
    }
    return row!
  })

  try {
    const html = emailTemplate(approved.subject, approved.body.replace(/\n/g, "<br>"))
    for (const recipient of approved.recipientEmails as string[]) {
      await sendEmail({ to: recipient, subject: approved.subject, html })
    }
    return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      const [sent] = await db.update(draftedCommunications).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(draftedCommunications.id, draftId)).returning()
      await logActivity({
        tx: db, action: "drafted_communication.sent", entityType: "drafted_communication", entityId: draftId,
        details: `Sent to ${(approved.recipientEmails as string[]).join(", ")}`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
      return sent!
    })
  } catch (error) {
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      await db.update(draftedCommunications).set({ status: "send_failed", updatedAt: new Date() }).where(eq(draftedCommunications.id, draftId))
      await logActivity({
        tx: db, action: "drafted_communication.send_failed", entityType: "drafted_communication", entityId: draftId,
        details: error instanceof Error ? error.message : "Unknown send error", orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
    })
    throw error
  }
}

export async function rejectCommunication(
  ctx: CommunicationDraftingContext,
  draftId: string,
  input: { reason: string; savePreference?: ApprovalDecision; autoRejectedViaPreference?: boolean }
) {
  const reason = input.reason?.trim()
  if (!reason) throw new ServiceError("reason is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.draftedCommunications.findFirst({ where: and(eq(draftedCommunications.id, draftId), eq(draftedCommunications.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Drafted communication not found", 404)
    if (existing.status !== "pending_approval") throw new ServiceError(`Cannot reject a communication with status "${existing.status}"`, 409)

    const [row] = await db.update(draftedCommunications).set({
      status: "rejected", rejectedById: ctx.userId, rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date(),
    }).where(eq(draftedCommunications.id, draftId)).returning()

    await logActivity({
      tx: db, action: "drafted_communication.rejected", entityType: "drafted_communication", entityId: draftId,
      details: input.autoRejectedViaPreference ? `Auto-rejected via saved preference: ${reason}` : `Rejected: ${reason}`,
      orgId: ctx.orgId, dbUser: ctx.dbUser,
    })

    if (input.savePreference) {
      await saveApprovalPreference(db, ctx.orgId, ctx.userId, existing.communicationType, "communication_type", undefined, input.savePreference)
      await logActivity({
        tx: db, action: "drafted_communication.preference_saved", entityType: "drafted_communication", entityId: draftId,
        details: `Saved "${input.savePreference}" preference for communication_type="${existing.communicationType}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
      })
    }
    return row!
  })
}

export { ServiceError }
