// Wave 43 (VERIDIAN Capability Registry, PLATFORM_STRATEGY.md §24). One-off
// backfill for capabilities that existed before this wave's indexing hooks
// were added to proposeWorkerAgent()/createAutomationRule() -- everything
// created from this wave onward is indexed automatically at creation time
// (see those two files); this only needs to run once per org to catch up
// on what was already there. Idempotent -- storeEmbedding() dedupes on
// identical content, so re-running this is always safe.
//
// Kept in its own file rather than inside capability-registry-service.ts
// to avoid a circular import: that file is a low-level primitive
// worker-agent-service.ts/automation-rule-service.ts both depend on, and
// this file needs to depend on both of *them* (to list what to backfill).
import { discoverWorkerAgent } from "./worker-agent-service"
import { listAutomationRules } from "./automation-rule-service"
import { listModules } from "./module-registry-service"
import { indexCapability, buildCapabilityContent } from "./capability-registry-service"
// Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): dynamic_chain's own backfill source --
// every chain created before task-service.ts's resolveDynamicChainId got
// its indexing hook (this same wave) needs this one-off catch-up, same
// reasoning as the 3 pre-existing sources below.
import { db, dynamicChains, embeddings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, isNull, or } from "drizzle-orm"

export type CapabilityCoverageByType = { total: number; indexed: number; coveragePercent: number }

export type CapabilityCoverageReport = {
  worker_agent: CapabilityCoverageByType
  automation_rule: CapabilityCoverageByType
  module: CapabilityCoverageByType
  dynamic_chain: CapabilityCoverageByType
  overall: CapabilityCoverageByType
}

export function toCoverage(total: number, indexed: number): CapabilityCoverageByType {
  return { total, indexed, coveragePercent: total === 0 ? 100 : Math.round((indexed / total) * 1000) / 10 }
}

// Gap closure (VERIDIAN Review Framework, AI Capability Registry: "registry
// coverage/backfill completeness not independently measured"). Re-derives
// ground truth straight from compliance.embeddings rather than trusting
// backfillCapabilityIndex()'s own attempted-count -- that count is what it
// TRIED to index; indexCapability() failures there are caught and
// console.error'd, not surfaced, so a partially-failed run would otherwise
// report identically to a fully successful one. Callable standalone (to
// check current coverage without running a backfill) or after a backfill
// (to confirm it actually landed).
export async function measureCapabilityCoverage(ctx: { orgId: string; userId: string }): Promise<CapabilityCoverageReport> {
  const [agents, rules, modules, chains, indexedRows] = await Promise.all([
    discoverWorkerAgent({ orgId: ctx.orgId, userId: ctx.userId }, { lifecycleStatus: ["proposed", "approved", "published", "draft"] }),
    listAutomationRules({ orgId: ctx.orgId }),
    listModules({ isActive: true }),
    withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.query.dynamicChains.findMany({ where: eq(dynamicChains.orgId, ctx.orgId) })
    ),
    db.query.embeddings.findMany({
      where: and(
        inArray(embeddings.entityType, ["worker_agent", "automation_rule", "module", "dynamic_chain"]),
        or(eq(embeddings.orgId, ctx.orgId), isNull(embeddings.orgId))
      ),
      columns: { entityType: true, entityId: true },
    }),
  ])

  const indexedKeys = new Set(indexedRows.map((r) => `${r.entityType}:${r.entityId}`))
  const agentsIndexed = agents.filter((a) => indexedKeys.has(`worker_agent:${a.id}`)).length
  const rulesIndexed = rules.filter((r) => indexedKeys.has(`automation_rule:${r.id}`)).length
  const modulesIndexed = modules.filter((m) => indexedKeys.has(`module:${m.moduleKey}`)).length
  const chainsIndexed = chains.filter((c) => indexedKeys.has(`dynamic_chain:${c.id}`)).length

  return {
    worker_agent: toCoverage(agents.length, agentsIndexed),
    automation_rule: toCoverage(rules.length, rulesIndexed),
    module: toCoverage(modules.length, modulesIndexed),
    dynamic_chain: toCoverage(chains.length, chainsIndexed),
    overall: toCoverage(
      agents.length + rules.length + modules.length + chains.length,
      agentsIndexed + rulesIndexed + modulesIndexed + chainsIndexed
    ),
  }
}

export async function backfillCapabilityIndex(ctx: { orgId: string; userId: string }): Promise<{ agents: number; rules: number; modules: number; chains: number; coverage: CapabilityCoverageReport }> {
  const [agents, rules, modules, chains] = await Promise.all([
    discoverWorkerAgent({ orgId: ctx.orgId, userId: ctx.userId }, { lifecycleStatus: ["proposed", "approved", "published", "draft"] }),
    listAutomationRules({ orgId: ctx.orgId }),
    listModules({ isActive: true }),
    withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
      db.query.dynamicChains.findMany({ where: eq(dynamicChains.orgId, ctx.orgId) })
    ),
  ])

  await Promise.all(
    agents.map((a) =>
      indexCapability(
        "worker_agent", a.id,
        buildCapabilityContent({ name: a.name, domain: a.domain, description: a.description, inputSchema: a.inputSchema, outputSchema: a.outputSchema }),
        a.orgId
      ).catch((err) => console.error(`Failed to backfill-index worker agent ${a.id}:`, err))
    )
  )
  await Promise.all(
    rules.map((r) =>
      indexCapability("automation_rule", r.id, buildCapabilityContent({ name: r.name, domain: r.triggerType, description: r.description }), r.orgId)
        .catch((err) => console.error(`Failed to backfill-index automation rule ${r.id}:`, err))
    )
  )
  // Modules are platform-wide (orgId null) -- indexed once, harmless to
  // re-run per-org since storeEmbedding dedupes on identical content.
  await Promise.all(
    modules.map((m) =>
      indexCapability("module", m.moduleKey, buildCapabilityContent({ name: m.displayName, domain: m.domain, description: m.description }), null)
        .catch((err) => console.error(`Failed to backfill-index module ${m.moduleKey}:`, err))
    )
  )
  // Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): chains created before this wave's
  // indexing hook (task-service.ts's resolveDynamicChainId) never got
  // embedded -- catch them up here, same idempotent storeEmbedding() dedupe
  // every other source above already relies on.
  await Promise.all(
    chains.map((c) => {
      const labels = Array.isArray(c.pathLabels) ? (c.pathLabels as unknown[]).map((l) => String(l)) : []
      return indexCapability("dynamic_chain", c.id, buildCapabilityContent({ name: c.modePill, domain: labels.join(" > ") || null, description: c.description }), c.orgId)
        .catch((err) => console.error(`Failed to backfill-index dynamic chain ${c.id}:`, err))
    })
  )

  // Independently confirm what actually landed in compliance.embeddings,
  // rather than trusting the attempted-count above (each indexCapability()
  // call's failure is caught and logged, not surfaced, a few lines up).
  const coverage = await measureCapabilityCoverage(ctx)

  return { agents: agents.length, rules: rules.length, modules: modules.length, chains: chains.length, coverage }
}
