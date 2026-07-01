import { db, organisations, complianceItems, dataSeparationAudit, loopExecutions } from "@/lib/db";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { asc } from "drizzle-orm";

const MAX_ORGS_PER_RUN = 10;

/**
 * Loop 12: Hierarchy & Secrecy Management.
 *
 * Continuously re-verifies the thing Wave 1 exists to guarantee: that
 * querying compliance_items scoped to org A via the real app_runtime path
 * (withTenantContext) never returns a row belonging to any other org. This
 * is the exact scenario proven manually once during Wave 1 (#18 in the
 * change log) -- this loop re-runs an equivalent check on a schedule so a
 * future regression (a dropped policy, a bad migration) gets caught
 * automatically instead of relying on that one-time manual proof forever.
 *
 * Deliberately samples up to MAX_ORGS_PER_RUN orgs rather than all of them,
 * to keep each run cheap -- correctness only needs to be sampled
 * continuously, not exhaustively checked on every invocation.
 */
export async function runDataSeparationAudit(loopId: string): Promise<{
  orgsTested: number;
  contaminationDetected: boolean;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();

  const orgs = await db.query.organisations.findMany({
    columns: { id: true },
    orderBy: asc(organisations.createdAt),
    limit: MAX_ORGS_PER_RUN,
  });

  let contaminationDetected = false;

  for (const org of orgs) {
    const items = await withTenantContext({ orgId: org.id }, (tx) =>
      tx.query.complianceItems.findMany({
        columns: { id: true, orgId: true },
        limit: 200,
      })
    );

    const leaked = items.filter((item) => item.orgId !== org.id);
    const thisOrgContaminated = leaked.length > 0;
    if (thisOrgContaminated) contaminationDetected = true;

    await db.insert(dataSeparationAudit).values({
      auditType: "cross_contamination_test",
      orgId: org.id,
      crossContaminationDetected: thisOrgContaminated,
      details: {
        rowsChecked: items.length,
        leakedRowCount: leaked.length,
        leakedRowIds: leaked.map((r) => r.id),
        tableChecked: "compliance_items",
      },
    });
  }

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: { orgsTested: orgs.length, orgIds: orgs.map((o) => o.id) },
    analysisResult: { contaminationDetected },
    actionTaken: { autoRemediated: false },
    measurementResult: {},
    executionTimeMs,
  });

  return { orgsTested: orgs.length, contaminationDetected, executionTimeMs };
}
