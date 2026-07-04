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

export async function backfillCapabilityIndex(ctx: { orgId: string; userId: string }): Promise<{ agents: number; rules: number; modules: number }> {
  const [agents, rules, modules] = await Promise.all([
    discoverWorkerAgent({ orgId: ctx.orgId, userId: ctx.userId }, { lifecycleStatus: ["proposed", "approved", "published", "draft"] }),
    listAutomationRules({ orgId: ctx.orgId }),
    listModules({ isActive: true }),
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

  return { agents: agents.length, rules: rules.length, modules: modules.length }
}
