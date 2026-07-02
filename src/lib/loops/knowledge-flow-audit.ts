import { db, knowledgeFlowLog, loopExecutions } from "@/lib/db";
import { and, eq, gte } from "drizzle-orm";

/**
 * Loop 4: Knowledge Management.
 *
 * Read-only audit over `knowledge_flow_log` (Wave 5's schema for tracking
 * how knowledge moves between tiers -- global/customer/client/user).
 * Specifically checks that every "up" direction flow (customer/client/user
 * knowledge propagating toward the shared global tier) is marked
 * anonymized -- an unanonymized upward flow would mean one customer's
 * specific data or patterns leaking into what other customers' agents
 * learn from, which is exactly what the master spec's "knowledge flows up
 * (anonymized) and down (improvements), never sideways" rule exists to
 * prevent. Complements Loop 12's data_separation_audit (query-level access
 * proof) with a knowledge-propagation-level check.
 *
 * Nothing writes to knowledge_flow_log yet -- no mechanism in this
 * codebase currently generates cross-tier learning propagation, so this
 * will honestly report zero flows checked until that exists. That's the
 * correct signal, not a bug in the loop: the check is ready and will start
 * doing real work the moment something starts writing to this table.
 *
 * Uses the raw `db` client deliberately -- platform-level audit across
 * every org's knowledge flows, not a single tenant's.
 */
const LOOKBACK_DAYS = 30;

export async function runKnowledgeFlowAudit(loopId: string): Promise<{
  upwardFlowsChecked: number;
  unanonymizedViolations: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const upwardFlows = await db.query.knowledgeFlowLog.findMany({
    where: and(eq(knowledgeFlowLog.direction, "up"), gte(knowledgeFlowLog.createdAt, cutoff)),
    columns: { id: true, fromTier: true, toTier: true, isAnonymized: true, orgId: true, knowledgeType: true },
  });

  const violations = upwardFlows.filter((f) => !f.isAnonymized);

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { lookbackDays: LOOKBACK_DAYS, upwardFlowsChecked: upwardFlows.length },
    analysisResult: {
      unanonymizedViolationCount: violations.length,
      violations: violations.map((v) => ({ id: v.id, fromTier: v.fromTier, toTier: v.toTier, orgId: v.orgId, knowledgeType: v.knowledgeType })),
    },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  return { upwardFlowsChecked: upwardFlows.length, unanonymizedViolations: violations.length, executionTimeMs };
}
