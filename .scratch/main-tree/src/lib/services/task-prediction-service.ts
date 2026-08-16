// Wave 152 (Phase4_Implementation_Plan.md, "Prediction Engine v2").
// Generalizes construction-prediction-service.ts's proven deterministic
// velocity-based pattern to a second real domain -- NOT a new ML model,
// the same philosophy this codebase already committed to (see that file's
// own header comment). A narrow, real v1: predicts how long a pending
// task is likely to take, based on the org's own historical completed
// tasks -- not the document's full multi-domain reasoning-engine vision.
//
// tasks has no dedicated completedAt column -- updatedAt is used as a
// proxy for "when it reached its current status," which is accurate for
// completed tasks specifically (nothing else touches a task after it's
// marked completed in the current codebase; confirmed by reading
// task-service.ts's updateTask, the only writer of `status`).
import { tasks } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TaskCompletionPrediction = {
  taskId: string
  createdAt: string
  sampleSize: number
  averageDurationDays: number | null
  predictedCompletionDate: string | null
  reason?: string
  // Same tiered scheme as construction-prediction-service.ts's
  // computeConfidence, tuned for sample count instead of entry-count +
  // days-spanned (a completion-time average needs enough historical tasks
  // to be meaningful, not a time span).
  confidence?: "low" | "medium" | "high"
}

function computeConfidence(sampleSize: number): "low" | "medium" | "high" {
  if (sampleSize >= 15) return "high"
  if (sampleSize >= 5) return "medium"
  return "low"
}

export async function predictTaskCompletion(ctx: { orgId: string; userId: string }, taskId: string): Promise<TaskCompletionPrediction> {
  return withTenantContext(ctx, async (db) => {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) })
    if (!task) throw new ServiceError("Task not found", 404)

    if (task.status === "completed") {
      return {
        taskId, createdAt: task.createdAt.toISOString(), sampleSize: 0,
        averageDurationDays: null, predictedCompletionDate: task.updatedAt.toISOString().slice(0, 10),
        reason: "Task is already completed",
      }
    }

    // Deliberately scoped to the same user's own completed tasks, not the
    // whole org -- one person's typical task duration is a more honest
    // predictor of their own next task than an org-wide average across
    // very different roles/workloads.
    const completed = await db.query.tasks.findMany({
      where: and(eq(tasks.userId, ctx.userId), eq(tasks.status, "completed")),
    })

    if (completed.length === 0) {
      return {
        taskId, createdAt: task.createdAt.toISOString(), sampleSize: 0,
        averageDurationDays: null, predictedCompletionDate: null,
        reason: "No completed tasks yet to compute an average duration from",
      }
    }

    const durationsDays = completed.map((t) => Math.max(0, (t.updatedAt.getTime() - t.createdAt.getTime()) / 86400000))
    const averageDurationDays = durationsDays.reduce((sum, d) => sum + d, 0) / durationsDays.length

    const predictedDate = new Date(task.createdAt.getTime() + averageDurationDays * 86400000)
    return {
      taskId, createdAt: task.createdAt.toISOString(), sampleSize: completed.length,
      averageDurationDays: Math.round(averageDurationDays * 10) / 10,
      predictedCompletionDate: predictedDate.toISOString().slice(0, 10),
      confidence: computeConfidence(completed.length),
    }
  })
}
