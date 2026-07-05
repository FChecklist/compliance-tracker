import { db, instructionCommitments, instructionMismatchDetections, tasks, auditLogs, messages, notifications } from "@/lib/db"
import { eq, and, lt, gte } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"

/**
 * Wave 12: instruction-mismatch audit. A deliberately standalone cron job,
 * NOT folded into the Wave 5 loop_definitions/loop_executions taxonomy --
 * that taxonomy is a fixed, spec'd list of 15 platform-improvement loops;
 * this is a product feature (comparing what someone was asked to do against
 * what they actually did), not a self-improvement loop about the platform
 * itself.
 *
 * For every `pending` instruction commitment whose due date has passed,
 * pulls the assignee's real task/audit-log activity since the instruction
 * was given and asks the org's configured task_oa model to judge whether it
 * matches. A match marks the commitment `done_as_asked` (no mismatch row --
 * nothing to surface). A mismatch marks it `drifted` and writes a new
 * `instruction_mismatch_detections` row, visible only to the assigner (see
 * the RLS policy in the Wave 12 migration).
 *
 * Uses the raw `db` client deliberately -- this iterates commitments across
 * every org, same platform-level posture as automation-progress-audit.ts.
 * Never touches `tasks` itself -- VERIDIAN judges and surfaces, it never
 * auto-corrects the underlying work.
 */
export async function runInstructionMismatchAudit(): Promise<{
  checked: number
  markedDone: number
  markedDrifted: number
  skippedNoModel: number
}> {
  const now = new Date()
  const pending = await db.query.instructionCommitments.findMany({
    where: and(eq(instructionCommitments.status, "pending"), lt(instructionCommitments.dueDate, now)),
  })

  let markedDone = 0
  let markedDrifted = 0
  let skippedNoModel = 0

  for (const commitment of pending) {
    const modelConfig = await resolveModelConfig(commitment.orgId, "task_oa")
    if (!modelConfig) {
      skippedNoModel++
      continue
    }

    const [assigneeTasks, assigneeAuditLogs] = await Promise.all([
      db.query.tasks.findMany({
        where: and(eq(tasks.orgId, commitment.orgId), eq(tasks.userId, commitment.assigneeId), gte(tasks.createdAt, commitment.createdAt)),
        columns: { id: true, title: true, status: true },
        limit: 20,
      }),
      db.query.auditLogs.findMany({
        where: and(eq(auditLogs.orgId, commitment.orgId), eq(auditLogs.userId, commitment.assigneeId), gte(auditLogs.createdAt, commitment.createdAt)),
        columns: { action: true, entityType: true },
        limit: 30,
      }),
    ])

    const activitySummary =
      [
        ...assigneeTasks.map((t, i) => `[${i}] Task: "${t.title}" (${t.status})`),
        ...assigneeAuditLogs.map((a) => `${a.action} on ${a.entityType}`),
      ].join("\n") || "(no recorded activity since the instruction was given)"

    const systemPrompt = await resolvePromptTemplate("instruction_mismatch.judgment")
    const userMessage =
      `Instruction given: "${commitment.describedAction}"\n` +
      (commitment.dueDate ? `Due: ${commitment.dueDate.toISOString()}\n` : "") +
      `\nAssignee's recorded activity since the instruction was given:\n${activitySummary}`

    const judgmentStartedAt = Date.now()
    try {
      const { data: result, usage } = await callLLMJson<{ matches: boolean; summary: string; relatedTaskIndex: number | null }>(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
        { temperature: 0.2, maxTokens: 300 }, modelConfig.fallback
      )
      recordOrchestraExecution({
        orgId: commitment.orgId, layerKey: "user_assistant_oa", eventType: "instruction_mismatch.judgment",
        input: { commitmentId: commitment.id }, output: { matches: result.matches },
        status: "completed", durationMs: Date.now() - judgmentStartedAt,
        provider: modelConfig.provider, model: modelConfig.model, usage,
      })

      if (result.matches) {
        await db.update(instructionCommitments).set({ status: "done_as_asked", updatedAt: new Date() }).where(eq(instructionCommitments.id, commitment.id))
        markedDone++
      } else {
        await db.update(instructionCommitments).set({ status: "drifted", updatedAt: new Date() }).where(eq(instructionCommitments.id, commitment.id))
        const relatedTask =
          typeof result.relatedTaskIndex === "number" && assigneeTasks[result.relatedTaskIndex]
            ? assigneeTasks[result.relatedTaskIndex]
            : null
        const [mismatch] = await db.insert(instructionMismatchDetections).values({
          commitmentId: commitment.id,
          comparisonSummary: result.summary,
          relatedTaskId: relatedTask?.id ?? null,
        }).returning()

        // Wave 14: surface this proactively rather than making the assigner
        // go looking for it. `metadata` carries what the topbar's
        // click-through needs to open the exact chat thread.
        const originalMessage = await db.query.messages.findFirst({ where: eq(messages.id, commitment.messageId) })
        if (originalMessage) {
          await db.insert(notifications).values({
            userId: commitment.assignerId,
            title: "Possible instruction mismatch",
            message: result.summary,
            type: "instruction_mismatch",
            metadata: { conversationId: originalMessage.conversationId, mismatchId: mismatch.id },
          })
        }
        markedDrifted++
      }
    } catch (err) {
      console.error(`Instruction mismatch audit failed for commitment ${commitment.id}:`, err)
      recordOrchestraExecution({
        orgId: commitment.orgId, layerKey: "user_assistant_oa", eventType: "instruction_mismatch.judgment",
        input: { commitmentId: commitment.id }, status: "failed", durationMs: Date.now() - judgmentStartedAt,
        output: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  return { checked: pending.length, markedDone, markedDrifted, skippedNoModel }
}
