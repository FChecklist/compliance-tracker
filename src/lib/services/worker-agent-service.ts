// Wave 16 (VAIOS Worker Agent Governance) service layer.
//
// Reuses the existing generic `approvalRequests` maker-checker table (same
// one Wave 8's Policy-publish flow uses) rather than a dedicated proposal
// table -- requestType/entityType are already free text, so this is
// genuinely additive, not a new parallel mechanism.
//
// Scope-Limited Worker Creation (constitution refinement #7): a plain user
// may only propose a `tier:'user'` agent scoped to themselves; an org admin
// may propose `tier:'customer'` (org-wide) or `tier:'client'` (one of the
// org's clients, validated via user_client_access). `tier:'global'` is
// deliberately not proposable through this service at all -- RLS itself
// already blocks any app_runtime insert with tier='global' (confirmed: the
// worker_agents insert policy's USING/CHECK expression only covers
// customer/client/user branches), so "only Layer 1 may autonomously create
// platform agents" is enforced at the database layer already, not just by
// this service.
import { after } from "next/server"
import { db, workerAgents, approvalRequests, userClientAccess, taskExecutionPlan, workerAgentLearnings, workerAgentDomainIndex, workerAgentDomainGroups } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { indexCapability, buildCapabilityContent } from "./capability-registry-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type WorkerAgentContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const PROPOSABLE_TIERS = new Set(["user", "customer", "client"])

// Real Agent Hierarchy Registry write path (see workerAgents.domainGroupId's
// own comment in schema.ts and drizzle/0256_worker_agent_domain_groups.sql
// for the full "why not supervisorWorkerAgentId" reasoning). Mirrors exactly
// the CASE expression the backfill migration used, so a newly proposed
// agent's domain resolves to the same group an existing agent with the same
// domain prefix already landed in -- never re-derived differently between
// the one-time backfill and this ongoing write path.
//
// Deliberately a fixed, hand-maintained map, not a DB lookup by prefix --
// this table is a small, bounded, governable set (PLATFORM_STRATEGY.md
// §30.1's own finding: governability requires NOT auto-growing this kind of
// registry at request time). An unrecognized domain (including null/empty)
// resolves to 'general' rather than silently creating a new group row.
const DOMAIN_GROUP_PREFIXES: { prefix: string; key: string }[] = [
  { prefix: "Construction", key: "construction" },
  { prefix: "Cross-Cutting", key: "cross_cutting" },
  { prefix: "Finance", key: "finance" },
  { prefix: "India Compliance", key: "india_compliance" },
]

export function resolveDomainGroupKey(domain: string | null | undefined): string {
  if (!domain) return "general"
  const match = DOMAIN_GROUP_PREFIXES.find((g) => domain.startsWith(g.prefix))
  return match?.key ?? "general"
}

export async function proposeWorkerAgent(
  ctx: WorkerAgentContext,
  input: {
    tier: string
    name: string
    domain?: string
    description?: string
    promptTemplate?: string
    clientId?: string // required when tier === 'client'
    projectId?: string // Wave 19: optional Product/Project (L2) scope
    domainPaths?: string[] // Wave 21: additional domain paths beyond `domain` itself, for agents serving more than one
    inputSchema?: Record<string, unknown> // Wave 43 (Capability Registry): JSON-Schema-ish contract -- these columns existed since Wave 3 but were never set until now
    outputSchema?: Record<string, unknown>
  }
) {
  if (!PROPOSABLE_TIERS.has(input.tier)) {
    throw new ServiceError(`tier must be one of: ${[...PROPOSABLE_TIERS].join(", ")}`, 400)
  }
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  // Scope-limited creation: a plain user may only ever propose for
  // themselves; org-wide or client-scoped proposals need admin rank.
  if ((input.tier === "customer" || input.tier === "client") && !hasRole(ctx.dbUser, "admin")) {
    throw new ServiceError("Proposing a customer- or client-scoped worker agent requires admin role or higher", 403)
  }
  if (input.tier === "client" && !input.clientId) {
    throw new ServiceError("clientId is required for a client-scoped proposal", 400)
  }

  const clientIds = input.tier === "client" && input.clientId ? [input.clientId] : undefined

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId, clientIds }, async (db) => {
    if (input.tier === "client" && input.clientId) {
      const access = await db.query.userClientAccess.findFirst({
        where: and(eq(userClientAccess.userId, ctx.userId), eq(userClientAccess.clientId, input.clientId)),
      })
      if (!access) throw new ServiceError("You don't have access to this client", 403)
    }

    // Real Agent Hierarchy Registry write path (Wave: AHR): every new
    // worker_agents row gets a real domainGroupId, not a null one -- the
    // group always exists because worker_agent_domain_groups is seeded with
    // a 'general' fallback (drizzle/0173), so this lookup never silently
    // leaves domainGroupId unset the way supervisorWorkerAgentId was.
    const domainGroupKey = resolveDomainGroupKey(input.domain)
    const domainGroup = await db.query.workerAgentDomainGroups.findFirst({
      where: eq(workerAgentDomainGroups.key, domainGroupKey),
    })

    const [agent] = await db.insert(workerAgents).values({
      tier: input.tier,
      name,
      domain: input.domain?.trim() || null,
      description: input.description?.trim() || null,
      promptTemplate: input.promptTemplate?.trim() || null,
      inputSchema: input.inputSchema || {},
      outputSchema: input.outputSchema || {},
      lifecycleStatus: "proposed",
      domainGroupId: domainGroup?.id ?? null,
      proposedById: ctx.userId,
      orgId: input.tier !== "user" ? ctx.orgId : null,
      clientId: input.tier === "client" ? input.clientId : null,
      userId: input.tier === "user" ? ctx.userId : null,
      projectId: input.projectId || null,
    }).returning()

    // Wave 43 (Capability Registry): indexed the moment it's proposed, not
    // just once approved -- a pending proposal should already be
    // discoverable so VERI FDE (or a human) doesn't propose a duplicate of
    // something already awaiting approval. Fire-and-forget, never blocks
    // the proposal itself on an embedding-API round trip.
    // Bug fix (2026-07-06): wrapped in after() -- same fire-and-forget
    // reliability bug found in Meeting Intelligence (veri-meeting-service.ts).
    after(() => indexCapability(
      "worker_agent", agent.id,
      buildCapabilityContent({ name: agent.name, domain: agent.domain, description: agent.description, inputSchema: agent.inputSchema, outputSchema: agent.outputSchema }),
      agent.orgId
    ).catch((err) => console.error("Failed to index worker agent capability:", err)))

    // Wave 21: index the agent's serviceable domain path(s) -- the domain
    // it was proposed under is always indexed; domainPaths lets it serve
    // more than one (worker_agent_domain_index is one-to-many by design,
    // unlike the single `domain` column). Dormant since Wave 3 -- this is
    // the first real write site.
    const domainPaths = new Set([...(input.domain?.trim() ? [input.domain.trim()] : []), ...(input.domainPaths ?? [])])
    if (domainPaths.size > 0) {
      await db.insert(workerAgentDomainIndex).values([...domainPaths].map((domainPath) => ({ workerAgentId: agent.id, domainPath })))
    }

    const [approval] = await db.insert(approvalRequests).values({
      requestType: "worker_agent_proposal",
      entityType: "worker_agents",
      entityId: agent.id,
      description: `Propose ${input.tier}-tier worker agent "${name}"`,
      requestedById: ctx.userId,
      orgId: ctx.orgId,
      clientId: input.tier === "client" ? input.clientId : null,
    }).returning()

    return {
      id: agent.id, tier: agent.tier, name: agent.name, lifecycleStatus: agent.lifecycleStatus,
      domainGroupId: agent.domainGroupId, approvalRequestId: approval.id, createdAt: agent.createdAt.toISOString(),
    }
  })
}

// Wave: AHR real read path -- `with: { domainGroup: true }` joins the real
// worker_agent_domain_groups row so callers (GET /api/worker-agents ->
// AgentLibrarySheet.tsx) can render a real department grouping instead of
// the previously-dead supervisorWorkerAgentId. See domainGroupId's own
// comment in schema.ts for the full reasoning.
export async function discoverWorkerAgent(
  ctx: { orgId: string; userId?: string },
  filters: { lifecycleStatus?: string[] } = {}
) {
  const statuses = filters.lifecycleStatus ?? ["approved", "published"]
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.workerAgents.findMany({
      where: inArray(workerAgents.lifecycleStatus, statuses),
      orderBy: (t, { asc }) => asc(t.name),
      with: { domainGroup: true },
    })
  )
}

// Wave 16's real Worker Agent Learning Loop write site (constitution
// refinement #5/#6) -- workerAgentLearnings has existed since Wave 3 but no
// code path ever inserted into it before this. Called from
// chat-service.ts's resolveInstructionMismatch() when a nudge corrects a
// worker-agent-dispatched task step -- the one real "human validated and
// corrected an AI's work" event already in this codebase.
export async function recordWorkerAgentLearning(workerAgentId: string, content: string, metadata: Record<string, unknown> = {}) {
  await db.insert(workerAgentLearnings).values({ workerAgentId, content, metadata })
}

// Kept here rather than in a route file so the "which worker_agents rows
// used real worker-agent-dispatched steps" join lives next to the rest of
// this wave's governance logic.
export async function findWorkerAgentIdForTask(orgId: string, taskId: string): Promise<string | null> {
  return withTenantContext({ orgId }, async (db) => {
    const steps = await db.query.taskExecutionPlan.findMany({ where: eq(taskExecutionPlan.taskId, taskId) })
    const withAgent = steps.find((s) => s.workerAgentId)
    return withAgent?.workerAgentId ?? null
  })
}
