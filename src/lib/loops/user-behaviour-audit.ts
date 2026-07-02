import { db, auditLogs, loopExecutions } from "@/lib/db";
import { gte, sql } from "drizzle-orm";

/**
 * Loop 10: User Behaviour Management.
 *
 * Read-only observational loop: aggregates `audit_logs` from the last 30
 * days into behavior patterns -- most active users, most common action
 * types, and active-hour distribution (UTC). This is raw material for
 * personalizing assistant behavior later; this loop only observes and
 * records, it never writes to `ai_assistants.personality_config` or any
 * other customer-visible resource itself -- an auto-personalization step
 * would be a separate, explicitly-approved write action, not bundled here.
 *
 * Uses the raw `db` client deliberately -- platform-level aggregate across
 * every org's users, not a single tenant's.
 */
const LOOKBACK_DAYS = 30;
const TOP_USERS_LIMIT = 10;

export async function runUserBehaviourAudit(loopId: string): Promise<{
  activeUserCount: number;
  totalActions: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const [topUsers, actionCounts, hourDistribution] = await Promise.all([
    db
      .select({ userId: auditLogs.userId, count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, cutoff))
      .groupBy(auditLogs.userId)
      .orderBy(sql`count(*) desc`)
      .limit(TOP_USERS_LIMIT),
    db
      .select({ action: auditLogs.action, count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, cutoff))
      .groupBy(auditLogs.action)
      .orderBy(sql`count(*) desc`),
    db
      .select({ hour: sql<number>`extract(hour from ${auditLogs.createdAt})`, count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, cutoff))
      .groupBy(sql`extract(hour from ${auditLogs.createdAt})`)
      .orderBy(sql`extract(hour from ${auditLogs.createdAt})`),
  ]);

  const totalActions = actionCounts.reduce((sum, row) => sum + Number(row.count), 0);
  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { topUsers, actionCounts, hourDistribution, lookbackDays: LOOKBACK_DAYS },
    analysisResult: { activeUserCount: topUsers.length, totalActions },
    actionTaken: { personalityConfigUpdated: false },
    measurementResult: {},
    executionTimeMs,
  });

  return { activeUserCount: topUsers.length, totalActions, executionTimeMs };
}
