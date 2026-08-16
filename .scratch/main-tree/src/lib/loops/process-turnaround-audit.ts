import { db, complianceItems, departments, loopExecutions } from "@/lib/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

/**
 * Loop 5: Process Management.
 *
 * Read-only observational loop: measures how long compliance items actually
 * take from creation to completion, grouped by department, over the last
 * 30 days -- a genuine workflow/process signal, distinct from Loop 7 (data
 * completeness) and Loop 11 (task, not compliance-item, completion rate).
 * Flags departments whose average turnaround is more than 2x the platform-
 * wide average as worth a human look. Doesn't change any assignment,
 * priority, or deadline itself.
 *
 * Uses the raw `db` client deliberately -- platform-level aggregate across
 * every org's departments, not a single tenant's.
 */
const LOOKBACK_DAYS = 30;
const SLOW_MULTIPLIER = 2;

export async function runProcessTurnaroundAudit(loopId: string): Promise<{
  departmentsChecked: number;
  slowDepartments: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const rows = await db
    .select({
      departmentId: complianceItems.departmentId,
      departmentName: departments.name,
      orgId: complianceItems.orgId,
      avgTurnaroundHours: sql<number>`avg(extract(epoch from (${complianceItems.completedAt} - ${complianceItems.createdAt})) / 3600)`,
      itemCount: sql<number>`count(*)`,
    })
    .from(complianceItems)
    .innerJoin(departments, eq(departments.id, complianceItems.departmentId))
    .where(and(eq(complianceItems.status, "completed"), isNotNull(complianceItems.completedAt), gte(complianceItems.completedAt, cutoff)))
    .groupBy(complianceItems.departmentId, departments.name, complianceItems.orgId);

  const withTurnaround = rows.filter((r) => r.avgTurnaroundHours !== null);
  const platformAvg =
    withTurnaround.length > 0
      ? withTurnaround.reduce((sum, r) => sum + Number(r.avgTurnaroundHours), 0) / withTurnaround.length
      : 0;

  const slow = withTurnaround.filter((r) => platformAvg > 0 && Number(r.avgTurnaroundHours) > platformAvg * SLOW_MULTIPLIER);

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: {
      lookbackDays: LOOKBACK_DAYS,
      platformAvgTurnaroundHours: Math.round(platformAvg * 10) / 10,
      departments: withTurnaround.map((r) => ({
        departmentId: r.departmentId,
        departmentName: r.departmentName,
        orgId: r.orgId,
        avgTurnaroundHours: Math.round(Number(r.avgTurnaroundHours) * 10) / 10,
        itemCount: Number(r.itemCount),
      })),
    },
    analysisResult: {
      slowDepartmentCount: slow.length,
      slowDepartments: slow.map((r) => ({ departmentId: r.departmentId, departmentName: r.departmentName, orgId: r.orgId })),
    },
    actionTaken: {},
    measurementResult: {},
    executionTimeMs,
  });

  return { departmentsChecked: withTurnaround.length, slowDepartments: slow.length, executionTimeMs };
}
