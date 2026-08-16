import { db, complianceItems, notices, loopExecutions } from "@/lib/db";
import { and, eq, isNull, gte } from "drizzle-orm";

/**
 * Loop 7: Input Management.
 *
 * Read-only data-quality audit over the last 30 days of input: compliance
 * items marked `completed` with no acknowledgement/registration number on
 * file (a filing with no proof of filing is an input gap, not a status
 * problem -- deliberately not the same signal as Loop 11's completion-rate
 * tracking), and notices missing their notice number or issuing authority
 * (the two fields every notice needs to be identifiable/searchable later).
 * Flags for a human to fix; doesn't backfill or guess values itself.
 *
 * Uses the raw `db` client deliberately -- platform-level audit across
 * every org's input data, not a single tenant's.
 */
const LOOKBACK_DAYS = 30;

export async function runInputQualityAudit(loopId: string): Promise<{
  incompleteFilingsCount: number;
  incompleteNoticesCount: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const incompleteFilings = await db.query.complianceItems.findMany({
    where: and(
      eq(complianceItems.status, "completed"),
      isNull(complianceItems.acknowledgementNumber),
      isNull(complianceItems.registrationNumber),
      gte(complianceItems.completedAt, cutoff)
    ),
    columns: { id: true, orgId: true, title: true, complianceType: true },
  });

  const incompleteNoticesByNumber = await db.query.notices.findMany({
    where: and(isNull(notices.noticeNumber), gte(notices.createdAt, cutoff)),
    columns: { id: true, orgId: true },
  });
  const incompleteNoticesByAuthority = await db.query.notices.findMany({
    where: and(isNull(notices.authority), gte(notices.createdAt, cutoff)),
    columns: { id: true, orgId: true },
  });
  const incompleteNoticeIds = new Set([
    ...incompleteNoticesByNumber.map((n) => n.id),
    ...incompleteNoticesByAuthority.map((n) => n.id),
  ]);

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { lookbackDays: LOOKBACK_DAYS },
    analysisResult: {
      incompleteFilingsCount: incompleteFilings.length,
      incompleteFilings: incompleteFilings.map((f) => ({ id: f.id, orgId: f.orgId, title: f.title, complianceType: f.complianceType })),
      incompleteNoticesCount: incompleteNoticeIds.size,
    },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  return { incompleteFilingsCount: incompleteFilings.length, incompleteNoticesCount: incompleteNoticeIds.size, executionTimeMs };
}
