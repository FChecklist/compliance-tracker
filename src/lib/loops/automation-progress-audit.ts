import { db, tasks, loopExecutions } from "@/lib/db";
import { gte, sql } from "drizzle-orm";

/**
 * Loop 11: Full Automation Loop.
 *
 * Read-only observational loop: tracks what fraction of tasks created in
 * the last 30 days reached `completed` vs. `failed`/`cancelled`/stuck in
 * `pending`/`in_progress` -- a proxy metric for "how much of the work
 * created here actually gets finished." There's no task execution engine
 * yet (a later wave), so today this will mostly show tasks sitting in
 * `pending` forever; that's the honest signal this loop exists to produce,
 * not a bug in the loop itself. Doesn't act on anything, purely measures.
 *
 * Uses the raw `db` client deliberately -- platform-level aggregate across
 * every org's tasks, not a single tenant's.
 */
const LOOKBACK_DAYS = 30;

export async function runAutomationProgressAudit(loopId: string): Promise<{
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const statusCounts = await db
    .select({ status: tasks.status, count: sql<number>`count(*)` })
    .from(tasks)
    .where(gte(tasks.createdAt, cutoff))
    .groupBy(tasks.status);

  const totalTasks = statusCounts.reduce((sum, row) => sum + Number(row.count), 0);
  const completedTasks = Number(statusCounts.find((r) => r.status === "completed")?.count ?? 0);
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { statusCounts, lookbackDays: LOOKBACK_DAYS },
    analysisResult: { totalTasks, completedTasks, completionRate },
    actionTaken: {},
    measurementResult: { completionRate },
    improvementDelta: null,
    executionTimeMs,
  });

  return { totalTasks, completedTasks, completionRate, executionTimeMs };
}
