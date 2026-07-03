import { db, instructionCommitments, instructionMismatchDetections, tasks, auditLogs } from "@/lib/db"
import { eq, and, lt, gte } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"

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
        columns: { title: true, status: true },
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
        ...assigneeTasks.map((t) => `Task: "${t.title}" (${t.status})`),
        ...assigneeAuditLogs.map((a) => `${a.action} on ${a.entityType}`),
      ].join("\n") || "(no recorded activity since the instruction was given)"

    const systemPrompt =
      "You judge whether a person's actual recorded activity matches an instruction they were given. " +
      'Respond with ONLY JSON matching: { "matches": boolean, "summary": string }. ' +
      "`summary` is 1-2 sentences explaining your judgment, written for the person who gave the instruction."
    const userMessage =
      `Instruction given: "${commitment.describedAction}"\n` +
      (commitment.dueDate ? `Due: ${commitment.dueDate.toISOString()}\n` : "") +
      `\nAssignee's recorded activity since the instruction was given:\n${activitySummary}`

    try {
      const result = await callLLMJson<{ matches: boolean; summary: string }>(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
        { temperature: 0.2, maxTokens: 300 }
      )

      if (result.matches) {
        await db.update(instructionCommitments).set({ status: "done_as_asked", updatedAt: new Date() }).where(eq(instructionCommitments.id, commitment.id))
        markedDone++
      } else {
        await db.update(instructionCommitments).set({ status: "drifted", updatedAt: new Date() }).where(eq(instructionCommitments.id, commitment.id))
        await db.insert(instructionMismatchDetections).values({
          commitmentId: commitment.id,
          comparisonSummary: result.summary,
        })
        markedDrifted++
      }
    } catch (err) {
      console.error(`Instruction mismatch audit failed for commitment ${commitment.id}:`, err)
    }
  }

  return { checked: pending.length, markedDone, markedDrifted, skippedNoModel }
}
