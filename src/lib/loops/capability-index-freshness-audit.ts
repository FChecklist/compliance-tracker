import { db, workerAgents, moduleRegistry, embeddings } from "@/lib/db"
import { eq, inArray } from "drizzle-orm"
import { indexCapability, buildCapabilityContent } from "@/lib/services/capability-registry-service"
import { PLATFORM_SCOPE_ORG_ID } from "@/lib/embeddings"

/**
 * Gap-closure fix, 2026-07-09 (AUDIT_2026-07-09.md, Memory Architecture
 * section). A deliberately standalone cron job, NOT folded into the Wave 5
 * loop_definitions/loop_executions taxonomy -- same reasoning as
 * instruction-mismatch-audit.ts: that taxonomy is a fixed, spec'd list of
 * 15 platform-improvement loops, and this is infrastructure hygiene for the
 * Capability Registry (Wave 43), not one of them.
 *
 * The live audit found the Registry silently stale: 13 of 27 worker agents
 * and 38 of 99 modules had no capability embedding, mostly because
 * migration/seed-created rows (all `tier='global'` worker agents, and every
 * moduleRegistry row -- both are migration-only writes per this codebase's
 * own governance rules) never pass through proposeWorkerAgent()'s existing
 * indexing hook, which only fires for app-created rows. This closes that
 * gap on an ongoing basis rather than depending on someone remembering to
 * click the admin-triggered backfill (capability-backfill-service.ts,
 * which still exists and is still the right tool for a first-time or
 * post-incident catch-up -- this loop is the *recurring* half).
 *
 * Uses the raw `db` client deliberately -- this is a platform-level sweep
 * across every org's and every platform-wide row, not a single tenant's
 * data.
 */
export async function runCapabilityIndexFreshnessAudit(): Promise<{
  agentsIndexed: number
  modulesIndexed: number
  errors: number
}> {
  let agentsIndexed = 0
  let modulesIndexed = 0
  let errors = 0

  const [allAgents, allModules, indexedRows] = await Promise.all([
    db.query.workerAgents.findMany({
      where: inArray(workerAgents.lifecycleStatus, ["draft", "proposed", "approved", "published"]),
    }),
    db.query.moduleRegistry.findMany({ where: eq(moduleRegistry.isActive, true) }),
    db.query.embeddings.findMany({
      where: inArray(embeddings.entityType, ["worker_agent", "module"]),
      columns: { entityType: true, entityId: true },
    }),
  ])

  const indexedAgentIds = new Set(indexedRows.filter((r) => r.entityType === "worker_agent").map((r) => r.entityId))
  const indexedModuleKeys = new Set(indexedRows.filter((r) => r.entityType === "module").map((r) => r.entityId))

  const missingAgents = allAgents.filter((a) => !indexedAgentIds.has(a.id))
  const missingModules = allModules.filter((m) => !indexedModuleKeys.has(m.moduleKey))

  for (const a of missingAgents) {
    // CRR-018/019: org_id is null for two different reasons on this table --
    // tier='global' agents are genuinely platform-wide (safe to mark
    // is_platform_scope). tier='user' agents are null because they're scoped
    // by userId instead, NOT platform-wide -- marking those is_platform_scope
    // would leak a personal agent into every other org's capability search.
    // This sweep has no per-agent proposer context to resolve the correct
    // org for the tier='user' case, so it deliberately skips those rather
    // than guessing; worker-agent-service.ts's own creation-time hook
    // (which does have ctx.orgId) indexes them correctly already.
    if (a.orgId == null && a.tier !== "global") {
      continue
    }
    try {
      await indexCapability(
        "worker_agent", a.id,
        buildCapabilityContent({ name: a.name, domain: a.domain, description: a.description, inputSchema: a.inputSchema, outputSchema: a.outputSchema }),
        a.orgId ?? PLATFORM_SCOPE_ORG_ID
      )
      agentsIndexed++
    } catch (err) {
      errors++
      console.error(`capability-index-freshness-audit: failed to index worker agent ${a.id}:`, err)
    }
  }

  for (const m of missingModules) {
    try {
      // Modules are platform-wide by design -- see capability-backfill-service.ts's identical comment.
      await indexCapability("module", m.moduleKey, buildCapabilityContent({ name: m.displayName, domain: m.domain, description: m.description }), PLATFORM_SCOPE_ORG_ID)
      modulesIndexed++
    } catch (err) {
      errors++
      console.error(`capability-index-freshness-audit: failed to index module ${m.moduleKey}:`, err)
    }
  }

  return { agentsIndexed, modulesIndexed, errors }
}
