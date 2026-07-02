import { db, loopDefinitions, loopExecutions } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Loop 1: Loop Engineering.
 *
 * The meta-loop that observes the other loops. Only became buildable once
 * there was real loop_executions data to observe (6 active loops as of the
 * commit that added this). For every loop marked is_active, checks whether
 * it actually produced any executions in the last 7 days -- catching the
 * exact class of bug found manually earlier this session (Loop 10 was
 * marked active for a full migration cycle with zero execution code wired
 * to run it). Also reports average execution time per loop as a basic
 * health signal. Read-only, same posture as every other active loop --
 * flags, does not auto-fix.
 */
const LOOKBACK_DAYS = 7;

export async function runLoopEngineeringAudit(loopId: string): Promise<{
  activeLoopsChecked: number;
  silentActiveLoops: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const activeLoops = await db.query.loopDefinitions.findMany({
    where: eq(loopDefinitions.isActive, true),
    columns: { id: true, loopNumber: true, loopName: true },
  });

  const perLoopStats: { loopNumber: number; loopName: string; executionCount: number; avgExecutionTimeMs: number | null }[] = [];
  const silentLoops: { loopNumber: number; loopName: string }[] = [];

  for (const loop of activeLoops) {
    const [stats] = await db
      .select({
        count: sql<number>`count(*)`,
        avgMs: sql<number | null>`avg(${loopExecutions.executionTimeMs})`,
      })
      .from(loopExecutions)
      .where(and(eq(loopExecutions.loopId, loop.id), gte(loopExecutions.createdAt, cutoff)));

    const executionCount = Number(stats?.count ?? 0);
    perLoopStats.push({
      loopNumber: loop.loopNumber,
      loopName: loop.loopName,
      executionCount,
      avgExecutionTimeMs: stats?.avgMs !== null && stats?.avgMs !== undefined ? Number(stats.avgMs) : null,
    });

    // Loop 1 itself won't have a prior execution to find on its very first
    // run, so it can never flag itself as silent -- that's expected, not a bug.
    if (executionCount === 0 && loop.loopNumber !== 1) {
      silentLoops.push({ loopNumber: loop.loopNumber, loopName: loop.loopName });
    }
  }

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { perLoopStats, lookbackDays: LOOKBACK_DAYS },
    analysisResult: { activeLoopsChecked: activeLoops.length, silentActiveLoops: silentLoops.length, silentLoops },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  return { activeLoopsChecked: activeLoops.length, silentActiveLoops: silentLoops.length, executionTimeMs };
}
