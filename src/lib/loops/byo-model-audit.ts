import { db, customerModelConfig, orchestraExecutions, loopExecutions } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer";

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
 *
 * Extended 2026-07-10 (founder directive): also analyzes the opposite end
 * of the same "which model is this org actually running on" question --
 * orgs with NO BYO config, running on the platform-default floor tier
 * (orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL, GPT-OSS-120B via
 * Groq), whose chat calls keep tripping floor-tier-escalation.ts's
 * deterministic signals (chat-service.ts logs `input.escalation` on every
 * chat.ai_thread_reply execution). A high escalation rate is a real signal
 * that org's default should be raised, not something to leave buried
 * per-call in orchestra_executions -- same "captured but never applied"
 * gap this loop's own proposeLoopImprovement() calls exist to close. Still
 * read-only / human-gated: proposeLoopImprovement() hardcodes
 * isDeployed: false, this loop never changes anyone's model itself.
 */
const STALE_UNUSED_DAYS = 7;
const ESCALATION_WINDOW_DAYS = 7;
// Below this many calls, an escalation rate is noise, not a pattern -- a
// single correction or high-impact message in a quiet org shouldn't trigger
// a proposal.
const MIN_CALLS_FOR_ESCALATION_SIGNAL = 5;
const ESCALATION_RATE_THRESHOLD = 0.2;

export async function runByoModelAudit(loopId: string): Promise<{
  configsChecked: number;
  unusedConfigCount: number;
  floorTierOrgsAnalyzed: number;
  highEscalationOrgCount: number;
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

  // Floor-tier escalation pattern analysis. Orgs with a BYO config never
  // hit chat-service.ts's escalation branch at all (guarded by
  // `!modelConfig.isCustomerConfigured`), so their rows always log
  // escalated: false and self-exclude from highEscalationOrgs below --
  // no need to join against customerModelConfig to filter them out here.
  const escalationCutoff = new Date(Date.now() - ESCALATION_WINDOW_DAYS * 86400000);
  const escalationStats = await db
    .select({
      orgId: orchestraExecutions.orgId,
      totalCalls: sql<number>`count(*)`,
      escalatedCalls: sql<number>`count(*) filter (where (${orchestraExecutions.input}->'escalation'->>'escalated')::boolean = true)`,
    })
    .from(orchestraExecutions)
    .where(and(
      eq(orchestraExecutions.eventType, "chat.ai_thread_reply"),
      gte(orchestraExecutions.createdAt, escalationCutoff)
    ))
    .groupBy(orchestraExecutions.orgId);

  const highEscalationOrgs = escalationStats.filter(
    (s) => s.totalCalls >= MIN_CALLS_FOR_ESCALATION_SIGNAL && s.escalatedCalls / s.totalCalls >= ESCALATION_RATE_THRESHOLD
  );

  for (const org of highEscalationOrgs) {
    const escalationRate = org.escalatedCalls / org.totalCalls;
    await proposeLoopImprovement({
      loopId,
      improvementType: "raise_floor_tier_default",
      targetType: "org",
      targetId: org.orgId,
      beforeState: { provider: "groq", model: "openai/gpt-oss-120b", escalationRate, totalCalls: org.totalCalls, windowDays: ESCALATION_WINDOW_DAYS },
      // afterState names the concrete target (matches
      // orchestra-model-resolver.ts's escalatedPlatformConfig()) rather than
      // leaving it null -- unlike tier-integrity-audit.ts's malformed-tier
      // case, there IS one clear, safe answer here: the same model this
      // org's own calls already escalate to per-request.
      afterState: { provider: "openrouter", model: "z-ai/glm-5.2" },
      improvementDelta: escalationRate,
    });
  }

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: {
      configsChecked: configs.length,
      providerDistribution: providerCounts,
      floorTierOrgsAnalyzed: escalationStats.length,
    },
    analysisResult: {
      unusedConfigCount: unused.length,
      unusedConfigIds: unused.map((c) => ({ id: c.id, orgId: c.orgId, provider: c.provider, modelName: c.modelName })),
      highEscalationOrgs: highEscalationOrgs.map((o) => ({ orgId: o.orgId, escalationRate: o.escalatedCalls / o.totalCalls, totalCalls: o.totalCalls })),
    },
    actionTaken: { autoDisabled: false, autoEscalatedDefault: false },
    measurementResult: {},
    executionTimeMs,
  });

  return {
    configsChecked: configs.length,
    unusedConfigCount: unused.length,
    floorTierOrgsAnalyzed: escalationStats.length,
    highEscalationOrgCount: highEscalationOrgs.length,
    executionTimeMs,
  };
}
