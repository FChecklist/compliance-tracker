// Wave 42 (VERI FDE -- Forward Deployed AI, PLATFORM_STRATEGY.md §23). Adds
// NO new creation power over what proposeWorkerAgent() (Wave 16) already
// allows -- this is a natural-language front-end to that existing
// role-gated, human-approval-gated pipeline, not a bypass of it. Closes
// the gap §11 already named: "if none exists, the governing layer may
// create a new Worker Agent Proposal" (refinement #4).
import { fdeRequests } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { hasRole } from "@/lib/supabase/auth-guard"
import { discoverWorkerAgent, proposeWorkerAgent } from "./worker-agent-service"
import { listModules } from "./module-registry-service"
import { listAutomationRules } from "./automation-rule-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FdeContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

type FdeEvaluation = {
  matchType: "existing_agent" | "existing_module" | "existing_rule" | "no_match"
  matchedId: string | null
  matchedLabel: string | null
  proposal: { name: string; domain: string; description: string; promptTemplate: string } | null
  responseToUser: string
}

export async function listFdeRequests(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.fdeRequests.findMany({ where: eq(fdeRequests.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export async function submitFdeRequest(ctx: FdeContext, input: { requestText: string }) {
  const requestText = input.requestText?.trim()
  if (!requestText) throw new ServiceError("requestText is required", 400)

  // Build the catalog VERI FDE checks against -- every list function here
  // already existed; this is the first place all three are read together.
  const [agents, modules, rules] = await Promise.all([
    discoverWorkerAgent({ orgId: ctx.orgId, userId: ctx.userId }, { lifecycleStatus: ["proposed", "approved", "published"] }),
    listModules({ isActive: true }),
    listAutomationRules({ orgId: ctx.orgId }),
  ])

  const catalog = {
    workerAgents: agents.map((a) => ({ id: a.id, name: a.name, domain: a.domain, description: a.description, lifecycleStatus: a.lifecycleStatus })),
    modules: modules.map((m) => ({ moduleKey: m.moduleKey, displayName: m.displayName, description: m.description, domain: m.domain })),
    automationRules: rules.map((r) => ({ id: r.id, name: r.name, description: r.description, triggerType: r.triggerType })),
  }

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) {
    return recordFdeRequest(ctx, requestText, {
      status: "error",
      responseText: "No AI model is configured for this organisation yet. Set one up in Settings -> AI Configuration to use VERI FDE.",
    })
  }

  const startedAt = Date.now()
  try {
    const systemPrompt = await resolvePromptTemplate("fde.evaluate_request")
    const userMessage = `User's request: "${requestText}"\n\nExisting catalog (JSON):\n${JSON.stringify(catalog)}`
    const { data: evaluation, usage } = await callLLMJson<FdeEvaluation>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens: 600 }
    )
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "fde.evaluate_request",
      input: { requestText }, output: { matchType: evaluation.matchType },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    if (evaluation.matchType !== "no_match" || !evaluation.proposal) {
      return recordFdeRequest(ctx, requestText, {
        status: "matched_existing",
        matchedWorkerAgentId: evaluation.matchType === "existing_agent" ? evaluation.matchedId : null,
        matchedLabel: evaluation.matchedLabel,
        responseText: evaluation.responseToUser,
      })
    }

    // No existing capability covers this -- draft a new Worker Agent
    // proposal through the *existing* Wave 16 pipeline. Tier is chosen by
    // the requester's own role, exactly as proposeWorkerAgent() already
    // requires -- VERI FDE never escalates a non-admin's request to
    // org-wide scope itself (see PLATFORM_STRATEGY.md §23.2).
    const tier = hasRole(ctx.dbUser, "admin") ? "customer" : "user"
    const proposed = await proposeWorkerAgent(ctx, {
      tier,
      name: evaluation.proposal.name,
      domain: evaluation.proposal.domain,
      description: evaluation.proposal.description,
      promptTemplate: evaluation.proposal.promptTemplate,
    })

    return recordFdeRequest(ctx, requestText, {
      status: "proposed_agent",
      createdWorkerAgentId: proposed.id,
      responseText: evaluation.responseToUser,
    })
  } catch (err) {
    console.error("VERI FDE evaluation failed:", err)
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "fde.evaluate_request",
      input: { requestText }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    })
    return recordFdeRequest(ctx, requestText, {
      status: "error",
      responseText: "Something went wrong evaluating this request. Please try again in a moment.",
    })
  }
}

async function recordFdeRequest(
  ctx: { orgId: string; userId: string },
  requestText: string,
  fields: { status: string; matchedWorkerAgentId?: string | null; matchedLabel?: string | null; createdWorkerAgentId?: string | null; responseText: string }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [record] = await db.insert(fdeRequests).values({
      orgId: ctx.orgId, userId: ctx.userId, requestText,
      status: fields.status, matchedWorkerAgentId: fields.matchedWorkerAgentId || null,
      matchedLabel: fields.matchedLabel || null, createdWorkerAgentId: fields.createdWorkerAgentId || null,
      responseText: fields.responseText,
    }).returning()
    return record
  })
}
