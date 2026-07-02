import { db, customerModelConfig, orchestraExecutions, loopExecutions } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Loop 14: BYO AI Model Loop.
 *
 * Read-only observational loop: for every active customer_model_config row,
 * checks whether it's actually being exercised (any orchestra_executions
 * logged against that org+layer in the last 7 days) and aggregates
 * provider distribution across all configured orgs. Flags configs that look
 * misconfigured (a key was set but never used) so a human can investigate --
 * doesn't touch or disable anything itself.
 *
 * Uses the raw `db` client deliberately -- like Loop 9, this is a
 * platform-level audit that has to see every org's BYO configs, not a
 * single tenant's.
 */
const STALE_UNUSED_DAYS = 7;

export async function runByoModelAudit(loopId: string): Promise<{
  configsChecked: number;
  unusedConfigCount: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - STALE_UNUSED_DAYS * 86400000);

  const configs = await db.query.customerModelConfig.findMany({
    where: eq(customerModelConfig.isActive, true),
    columns: { id: true, orgId: true, orchestraLayerId: true, provider: true, modelName: true },
  });

  const unused: typeof configs = [];
  for (const config of configs) {
    const recentExecutions = await db.query.orchestraExecutions.findFirst({
      where: and(
        eq(orchestraExecutions.orgId, config.orgId),
        config.orchestraLayerId ? eq(orchestraExecutions.orchestraLayerId, config.orchestraLayerId) : undefined,
        gte(orchestraExecutions.createdAt, cutoff)
      ),
    });
    if (!recentExecutions) unused.push(config);
  }

  const providerCounts = await db
    .select({ provider: customerModelConfig.provider, count: sql<number>`count(*)` })
    .from(customerModelConfig)
    .where(eq(customerModelConfig.isActive, true))
    .groupBy(customerModelConfig.provider);

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: {
      configsChecked: configs.length,
      providerDistribution: providerCounts,
    },
    analysisResult: {
      unusedConfigCount: unused.length,
      unusedConfigIds: unused.map((c) => ({ id: c.id, orgId: c.orgId, provider: c.provider, modelName: c.modelName })),
    },
    actionTaken: { autoDisabled: false },
    measurementResult: {},
    executionTimeMs,
  });

  return { configsChecked: configs.length, unusedConfigCount: unused.length, executionTimeMs };
}
