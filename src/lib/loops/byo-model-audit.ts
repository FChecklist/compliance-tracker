import { db, customerModelConfig, orchestraExecutions, loopExecutions } from "@/lib/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer";

// VERIDIAN Review Framework remediation (AI Model Routing gap, 2026-07-18):
// "escalation triggers are regex/keyword-based, can miss cases" -- there was
// no periodic audit sampling responses that should have escalated but
// didn't, only the reactive per-call signals themselves. This section adds
// exactly that sample, reusing data this loop already reads (no new table).
export type ChatReplyRow = {
  id: string
  orgId: string
  conversationId: string | null
  escalated: boolean
  signals: string[]
}

export type MissedEscalation = { id: string; orgId: string; conversationId: string; nextReplySignals: string[] }
export type MissedEscalationAuditResult = { eligiblePairs: number; missed: MissedEscalation[] }

/**
 * Pure: `replies` must already be ordered by conversationId then createdAt
 * ascending (matching the DB query below's ORDER BY) -- this walks adjacent
 * pairs rather than re-grouping, so an unsorted input silently produces
 * wrong pairings, not an error.
 *
 * Flags every non-escalated reply immediately followed, within the SAME
 * conversation, by a reply whose OWN pre-call escalation fired on
 * "reask_correction" (floor-tier-escalation.ts's detectReaskOrCorrection --
 * the user re-asked or corrected VERI's prior answer). If the prior reply
 * was never escalated, the user's own next message is a concrete,
 * deterministic proxy for "this floor-tier reply should have escalated but
 * didn't" -- the regex/keyword signals evidently missed it at the time.
 *
 * Naturally scoped to floor-tier conversations only, with no extra
 * isCustomerConfigured filtering needed: chat-service.ts only ever
 * populates a non-empty `signals` array for `!isCustomerConfigured` calls
 * (checkPreCallEscalation's own gate skips BYO orgs entirely) -- a BYO
 * org's replies always carry `signals: []` on both sides of every pair, so
 * they can never match the `next.signals.includes(...)` check below.
 */
export function detectMissedEscalations(replies: ChatReplyRow[]): MissedEscalationAuditResult {
  const missed: MissedEscalation[] = []
  let eligiblePairs = 0
  for (let i = 0; i < replies.length - 1; i++) {
    const current = replies[i]
    const next = replies[i + 1]
    if (!current.conversationId || current.conversationId !== next.conversationId) continue
    if (current.escalated) continue // already escalated -- not a miss
    eligiblePairs++
    if (next.signals.includes("reask_correction")) {
      missed.push({ id: current.id, orgId: current.orgId, conversationId: current.conversationId, nextReplySignals: next.signals })
    }
  }
  return { eligiblePairs, missed }
}

const MIN_PAIRS_FOR_MISSED_ESCALATION_SIGNAL = 10; // below this, a missed-escalation rate is noise, same discipline as MIN_CALLS_FOR_ESCALATION_SIGNAL below
const MISSED_ESCALATION_RATE_THRESHOLD = 0.15;

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
  missedEscalationCount: number;
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

  // Missed-escalation sample (see detectMissedEscalations() above for the
  // full reasoning). Same window as the escalation-rate analysis above --
  // one query, ordered so adjacent rows are exactly the (reply, next reply
  // in the same conversation) pairs the pure function needs, rather than
  // re-grouping client-side.
  const chatReplyRows = await db
    .select({
      id: orchestraExecutions.id,
      orgId: orchestraExecutions.orgId,
      conversationId: sql<string | null>`${orchestraExecutions.input}->>'conversationId'`,
      escalated: sql<boolean>`coalesce((${orchestraExecutions.input}->'escalation'->>'escalated')::boolean, false)`,
      signals: sql<string[]>`coalesce(${orchestraExecutions.input}->'escalation'->'signals', '[]'::jsonb)`,
    })
    .from(orchestraExecutions)
    .where(and(
      eq(orchestraExecutions.eventType, "chat.ai_thread_reply"),
      eq(orchestraExecutions.status, "completed"),
      gte(orchestraExecutions.createdAt, escalationCutoff)
    ))
    .orderBy(sql`${orchestraExecutions.input}->>'conversationId'`, orchestraExecutions.createdAt);

  const missedEscalationAudit = detectMissedEscalations(chatReplyRows);
  const missedEscalationRate = missedEscalationAudit.eligiblePairs > 0
    ? missedEscalationAudit.missed.length / missedEscalationAudit.eligiblePairs
    : 0;

  // One proposal for the WHOLE sample, not per-org: unlike raise_floor_tier_
  // default above (an org-specific config change), a high missed-escalation
  // rate points at floor-tier-escalation.ts's own deterministic phrase
  // lists potentially missing real correction phrasing -- a platform-level
  // code review, not something any single org's admin can act on.
  if (missedEscalationAudit.eligiblePairs >= MIN_PAIRS_FOR_MISSED_ESCALATION_SIGNAL && missedEscalationRate >= MISSED_ESCALATION_RATE_THRESHOLD) {
    await proposeLoopImprovement({
      loopId,
      improvementType: "review_escalation_signal_coverage",
      targetType: "platform",
      targetId: "floor-tier-escalation.ts",
      beforeState: { missedEscalationRate, eligiblePairs: missedEscalationAudit.eligiblePairs, missedCount: missedEscalationAudit.missed.length, windowDays: ESCALATION_WINDOW_DAYS },
      // No single concrete afterState -- this is a signal to review the
      // CORRECTION_PHRASES/LOW_CONFIDENCE_PHRASES lists against the actual
      // sampled conversations (sample rows are in the returned
      // `missedEscalationAudit.missed` -- see this loop's own
      // loop_executions.analysisResult), not an auto-derived fix.
      afterState: null,
      improvementDelta: missedEscalationRate,
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
      missedEscalationPairsSampled: missedEscalationAudit.eligiblePairs,
    },
    analysisResult: {
      unusedConfigCount: unused.length,
      unusedConfigIds: unused.map((c) => ({ id: c.id, orgId: c.orgId, provider: c.provider, modelName: c.modelName })),
      highEscalationOrgs: highEscalationOrgs.map((o) => ({ orgId: o.orgId, escalationRate: o.escalatedCalls / o.totalCalls, totalCalls: o.totalCalls })),
      missedEscalationRate,
      missedEscalations: missedEscalationAudit.missed,
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
    missedEscalationCount: missedEscalationAudit.missed.length,
    executionTimeMs,
  };
}
