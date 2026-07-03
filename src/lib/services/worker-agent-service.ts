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
import { db, workerAgents, approvalRequests, userClientAccess, taskExecutionPlan, workerAgentLearnings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type WorkerAgentContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const PROPOSABLE_TIERS = new Set(["user", "customer", "client"])

export async function proposeWorkerAgent(
  ctx: WorkerAgentContext,
  input: {
    tier: string
    name: string
    domain?: string
    description?: string
    promptTemplate?: string
    clientId?: string // required when tier === 'client'
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

    const [agent] = await db.insert(workerAgents).values({
      tier: input.tier,
      name,
      domain: input.domain?.trim() || null,
      description: input.description?.trim() || null,
      promptTemplate: input.promptTemplate?.trim() || null,
      lifecycleStatus: "proposed",
      proposedById: ctx.userId,
      orgId: input.tier !== "user" ? ctx.orgId : null,
      clientId: input.tier === "client" ? input.clientId : null,
      userId: input.tier === "user" ? ctx.userId : null,
    }).returning()

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
      approvalRequestId: approval.id, createdAt: agent.createdAt.toISOString(),
    }
  })
}

export async function discoverWorkerAgent(
  ctx: { orgId: string; userId?: string },
  filters: { lifecycleStatus?: string[] } = {}
) {
  const statuses = filters.lifecycleStatus ?? ["approved", "published"]
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.workerAgents.findMany({
      where: inArray(workerAgents.lifecycleStatus, statuses),
      orderBy: (t, { asc }) => asc(t.name),
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
