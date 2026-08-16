import { db, loopExecutions } from "@/lib/db";
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer";

/**
 * Loop 13: Data/Process Separation.
 *
 * Distinct from Loop 12 (Hierarchy & Secrecy Management), which does
 * live query-level access proof -- "can org A actually read org B's data
 * through the real app_runtime/RLS path?" This loop instead checks the
 * *data model's own structural integrity* for the tier system that Loop 12
 * depends on: every `worker_agents` row's tier must match its scoping
 * columns exactly (global = no org/client/user id at all; customer =
 * org_id set, client_id and user_id null; client = client_id set; user =
 * user_id set). A row with tier='global' but a leftover org_id, or
 * tier='customer' with no org_id, would silently break the separation
 * Loop 12 is verifying -- this catches that class of drift before it
 * causes a real leak, not after.
 *
 * Uses the raw `db` client deliberately -- platform-level structural audit
 * across every org's agents, not a single tenant's.
 */
export async function runTierIntegrityAudit(loopId: string): Promise<{
  agentsChecked: number;
  malformedCount: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();

  const agents = await db.query.workerAgents.findMany({
    columns: { id: true, name: true, tier: true, orgId: true, clientId: true, userId: true },
  });

  const malformed = agents.filter((a) => {
    switch (a.tier) {
      case "global":
        return a.orgId !== null || a.clientId !== null || a.userId !== null;
      case "customer":
        return a.orgId === null || a.clientId !== null || a.userId !== null;
      case "client":
        return a.clientId === null;
      case "user":
        return a.userId === null;
      default:
        return true; // unknown tier value is itself a violation
    }
  });

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { agentsChecked: agents.length },
    analysisResult: {
      malformedCount: malformed.length,
      malformedAgents: malformed.map((a) => ({ id: a.id, name: a.name, tier: a.tier, orgId: a.orgId, clientId: a.clientId, userId: a.userId })),
    },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  // Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2): CLEE
  // capture->apply gap. afterState is deliberately null, not a guessed
  // fix -- for some violation types (e.g. tier='customer' with no orgId)
  // there's no way to safely infer the correct value from the malformed
  // row alone; proposing a specific wrong fix would be worse than
  // proposing "this needs human review." Still human-gated either way.
  for (const agent of malformed) {
    await proposeLoopImprovement({
      loopId,
      improvementType: "fix_tier_scoping_mismatch",
      targetType: "worker_agent",
      targetId: agent.id,
      beforeState: { tier: agent.tier, orgId: agent.orgId, clientId: agent.clientId, userId: agent.userId, name: agent.name },
      afterState: null,
    })
  }

  return { agentsChecked: agents.length, malformedCount: malformed.length, executionTimeMs };
}
