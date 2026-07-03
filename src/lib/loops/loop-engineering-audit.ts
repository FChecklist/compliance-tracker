import { db, loopDefinitions, loopExecutions } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLMJson } from "@/lib/llm-client";

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
 *
 * Wave 18 (VAIOS Shared AI Resource Pool): this is the real, non-hollow
 * consumer for the meta_oa Orchestra Layer -- seeded since Wave 4, zero call
 * sites until now. "Layer 1 needs more capacity to do orchestra" is
 * literally this: the platform's own meta-loop reasoning about its own
 * health, via resolvePlatformModelConfig() (never a customer org's key,
 * structurally -- see orchestra-model-resolver.ts). Degrades gracefully
 * (logged, not thrown) if neither a platform default nor any eligible
 * pooled config exists -- the rest of this loop's real, useful SQL
 * aggregation still runs and gets recorded either way.
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

  let llmSynthesis: string | null = null;
  try {
    const modelConfig = await resolvePlatformModelConfig("meta_oa");
    if (modelConfig) {
      const result = await callLLMJson<{ synthesis: string }>(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey,
        "You are the Meta Orchestra Agent for an AI-native platform. Given per-loop health stats, write a 1-2 sentence " +
        'plain-language synthesis of overall platform health for a human operator. Respond with ONLY JSON: { "synthesis": string }',
        `Active loops checked: ${activeLoops.length}. Silent (marked active, zero executions in ${LOOKBACK_DAYS}d): ${silentLoops.length}.\n${JSON.stringify(perLoopStats)}`,
        { temperature: 0.2, maxTokens: 200 }
      );
      llmSynthesis = result.synthesis;
    }
  } catch (err) {
    console.error("Loop 1 meta_oa synthesis failed (non-fatal, rest of the audit still recorded):", err);
  }

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { perLoopStats, lookbackDays: LOOKBACK_DAYS },
    analysisResult: { activeLoopsChecked: activeLoops.length, silentActiveLoops: silentLoops.length, silentLoops, llmSynthesis },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  return { activeLoopsChecked: activeLoops.length, silentActiveLoops: silentLoops.length, executionTimeMs };
}
