import { db, mcpAccessCodes, apiKeys, loopExecutions } from "@/lib/db";
import { and, eq, or, isNull, lt } from "drizzle-orm";
import { proposeLoopImprovement } from "@/lib/loop-improvement-proposer";

/**
 * Loop 9: API/Token/URL Management.
 *
 * Read-only audit -- flags mcp_access_codes/api_keys that are active but
 * stale (unused for a long time, or never used since creation). Does NOT
 * auto-revoke anything; that would be an autonomous write action, which is
 * explicitly out of scope until this loop has a track record (see
 * orchestra_changes.md Wave 5).
 *
 * Uses the raw `db` client deliberately -- this audit is platform-level and
 * cross-tenant by design (it has to see every org's tokens to find stale
 * ones), unlike every customer-facing route which is scoped via app_runtime.
 */
const STALE_UNUSED_DAYS = 90;
const STALE_NEVER_USED_DAYS = 30;

export async function runApiTokenAudit(loopId: string): Promise<{
  staleMcpCodes: number;
  staleApiKeys: number;
  executionTimeMs: number;
}> {
  const startedAt = Date.now();
  const staleCutoff = new Date(Date.now() - STALE_UNUSED_DAYS * 86400000);
  const neverUsedCutoff = new Date(Date.now() - STALE_NEVER_USED_DAYS * 86400000);

  const staleMcp = await db.query.mcpAccessCodes.findMany({
    where: and(
      eq(mcpAccessCodes.isActive, true),
      or(
        lt(mcpAccessCodes.lastUsedAt, staleCutoff),
        and(isNull(mcpAccessCodes.lastUsedAt), lt(mcpAccessCodes.createdAt, neverUsedCutoff))
      )
    ),
    columns: { id: true, orgId: true, name: true, lastUsedAt: true, createdAt: true },
  });

  const staleKeys = await db.query.apiKeys.findMany({
    where: and(
      eq(apiKeys.isActive, true),
      or(
        lt(apiKeys.lastUsedAt, staleCutoff),
        and(isNull(apiKeys.lastUsedAt), lt(apiKeys.createdAt, neverUsedCutoff))
      )
    ),
    columns: { id: true, orgId: true, name: true, scopes: true, lastUsedAt: true, createdAt: true },
  });

  const executionTimeMs = Date.now() - startedAt;

  await db.insert(loopExecutions).values({
    loopId,
    triggeredBy: "scheduled",
    observationData: {
      staleMcpCodes: staleMcp.map((c) => ({ id: c.id, orgId: c.orgId, name: c.name, lastUsedAt: c.lastUsedAt })),
      staleApiKeys: staleKeys.map((k) => ({ id: k.id, orgId: k.orgId, name: k.name, scopes: k.scopes, lastUsedAt: k.lastUsedAt })),
    },
    analysisResult: {
      staleMcpCodeCount: staleMcp.length,
      staleApiKeyCount: staleKeys.length,
      writeScopedStaleKeyCount: staleKeys.filter((k) => k.scopes?.includes("write")).length,
    },
    actionTaken: { autoRevoked: false, reason: "read-only audit, no auto-revocation until this loop has a track record" },
    measurementResult: {},
    executionTimeMs,
  });

  // Wave 146 (VERIDIAN.docx joint implementation plan, Phase 2): CLEE
  // capture->apply gap -- turn what this loop already observed into
  // structured, reviewable improvement proposals (loopImprovements), not
  // just an observation that sits in loopExecutions forever. Still
  // human-gated (isDeployed always false, see loop-improvement-proposer.ts)
  // -- this does NOT revoke anything, same as before.
  for (const key of staleKeys) {
    await proposeLoopImprovement({
      loopId,
      improvementType: "revoke_stale_api_key",
      targetType: "api_key",
      targetId: key.id,
      beforeState: { isActive: true, orgId: key.orgId, name: key.name, scopes: key.scopes, lastUsedAt: key.lastUsedAt },
      afterState: { isActive: false },
    })
  }
  for (const code of staleMcp) {
    await proposeLoopImprovement({
      loopId,
      improvementType: "revoke_stale_mcp_code",
      targetType: "mcp_access_code",
      targetId: code.id,
      beforeState: { isActive: true, orgId: code.orgId, name: code.name, lastUsedAt: code.lastUsedAt },
      afterState: { isActive: false },
    })
  }

  return { staleMcpCodes: staleMcp.length, staleApiKeys: staleKeys.length, executionTimeMs };
}
