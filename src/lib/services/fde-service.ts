// Wave 42 (VERI FDE -- Forward Deployed AI, PLATFORM_STRATEGY.md §23). Adds
// NO new creation power over what proposeWorkerAgent() (Wave 16) already
// allows -- this is a natural-language front-end to that existing
// role-gated, human-approval-gated pipeline, not a bypass of it. Closes
// the gap §11 already named: "if none exists, the governing layer may
// create a new Worker Agent Proposal" (refinement #4).
//
// Wave 43 (Capability Registry, §24) rewired the catalog step: previously
// this fetched the org's ENTIRE worker-agent/module/automation-rule roster
// on every single call and stuffed it all into one LLM prompt. Now a cheap
// embedding search runs first -- a high-confidence match answers instantly
// with zero LLM call at all, and anything less certain only sends the
// top-K semantically similar candidates (not the whole org) to the LLM.
import { fdeRequests, workerAgents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { resolveModelConfig, escalatedPlatformConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJsonCached } from "@/lib/llm-response-cache"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { redactPii } from "@/lib/pii-redaction"
import { hasRole } from "@/lib/supabase/auth-guard"
import { proposeWorkerAgent } from "./worker-agent-service"
import { findSimilarCapabilities } from "./capability-registry-service"
// DMP-04 gap closure (CONSTITUTION.yaml): the second half of a genuine
// no-match proposal -- see proposeDynamicChain()'s own header for why this
// is additive scaffolding, not a bypass of the human-approval gate.
import { proposeDynamicChain } from "./dynamic-chain-directory-service"
// Priority 12 (OPEN-07 point 1): the FDE -> Dynamic-Chain/Chat side of the
// cross-catalog bridge -- see capability-bridge-service.ts's own header.
import { findTaskCapabilityForDynamicChainMatch } from "./capability-bridge-service"
import { computeCoverageStats } from "./capability-learning-service"
import { ServiceError } from "./compliance-service"
import { isToolAllowedForDomain } from "@/lib/purpose-bound-ai"
import { dispatchTool } from "@/lib/task-execution-engine"
export { ServiceError }
import type { users } from "@/lib/db"

export type FdeContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// A match this strong answers instantly with no LLM call at all -- the
// concrete token-reduction the user asked for. Below this, the LLM still
// reasons, but only over the top-K candidates, not the full catalog.
//
// Owner correction (2026-07-10, Worker Agent Library Phase 1 sign-off):
// the originally-proposed value here was 0.9 -- the Owner explicitly raised
// it to 0.95 when approving Phase 1 read-only auto-dispatch (the
// `topMatch.entityType === "worker_agent"` branch below, which reuses
// task-execution-engine.ts's dispatchTool() to actually run the matched
// agent), on the grounds that 0.9 is loose enough to occasionally auto-run
// a real action for a request that was only superficially similar. This is
// VERI FDE's single no-LLM-reasoning-at-all gate -- both the "already
// covered" short-circuit for module/rule matches AND the worker-agent
// auto-dispatch branch share it, and the Owner's sign-off was never asked
// to split them into two separate thresholds, so raising the one shared
// constant is the correct, complete fix.
const HIGH_CONFIDENCE_THRESHOLD = 0.95
const CANDIDATE_LIMIT = 8

type FdeEvaluation = {
  matchType: "existing_agent" | "existing_module" | "existing_rule" | "no_match"
  matchedId: string | null
  matchedLabel: string | null
  proposal: {
    name: string; domain: string; description: string; promptTemplate: string
    inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>
    // DMP-04 gap closure (fde.evaluate_request prompt v3): the Dynamic
    // Chain bundle fields -- all optional/best-effort from the LLM, same
    // "genuine first-pass contract, not exhaustive" posture the prompt
    // already asks for on inputSchema/outputSchema. proposeDynamicChain()
    // supplies safe defaults for anything the model omits.
    moduleRef?: string
    businessRules?: string[]
    permissions?: string[]
    workflowSteps?: string[]
    kpis?: { label: string; target?: string }[]
  } | null
  responseToUser: string
}

export async function listFdeRequests(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.fdeRequests.findMany({ where: eq(fdeRequests.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

// A capability's embedded content is "name | domain | description | Input:
// {...} | Output: {...}" (buildCapabilityContent) -- the name is always
// the first segment, cheap to recover for a label without a second query.
function labelFromContent(content: string): string {
  return content.split(" | ")[0] || content.slice(0, 60)
}

// Wave 144: shared shape for the top-K candidates persisted alongside every
// FDE request, per the joint implementation plan (Phase 1 item 5) -- lets a
// future UI surface "here's what else looked close" instead of a single
// verdict, without a second embedding search.
type TopCandidate = { entityType: string; entityId: string; score: number; label: string }
function toTopCandidates(candidates: { entityType: string; entityId: string; score: number; content: string }[]): TopCandidate[] {
  return candidates.map((c) => ({ entityType: c.entityType, entityId: c.entityId, score: Math.round(c.score * 100) / 100, label: labelFromContent(c.content) }))
}

export type SubmitFdeRequestOptions = {
  // Real bug found + fixed 2026-07-08: chat-service.ts's inline background
  // FDE evaluation (fires on EVERY AI-thread chat message, not just
  // explicit capability requests) was falling through to this function's
  // full LLM-evaluation-and-propose-new-agent path for any message that
  // didn't match an existing capability at HIGH_CONFIDENCE_THRESHOLD --
  // meaning ordinary chat ("thanks", "ok") was silently triggering a
  // second LLM call AND could auto-propose garbage Worker Agent proposals
  // from casual conversation. `passive: true` stops at the embedding
  // check: a confident match still auto-answers/auto-dispatches exactly
  // as before (that's the real "product evolves from real usage" value,
  // and it's ~free); anything below threshold returns immediately with NO
  // LLM call and NO fde_requests row, rather than escalating. The
  // explicit /fde page ("Request a capability" button) always calls this
  // WITHOUT passive:true, so a user who deliberately asks for something
  // still gets the full evaluate-and-propose pipeline.
  passive?: boolean
}

export async function submitFdeRequest(ctx: FdeContext, input: { requestText: string }, options?: SubmitFdeRequestOptions) {
  const requestText = input.requestText?.trim()
  if (!requestText) throw new ServiceError("requestText is required", 400)

  // Wave 46 (VERIDIAN AI Constitution, Policy Enforcement Engine): gated
  // before the embedding search even runs -- VERI FDE can propose new
  // Worker Agents from free text, making it VERIDIAN's highest-stakes
  // surface for an out-of-scope or injected request to reach.
  const policyDecision = enforcePolicy(
    { orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "fde.evaluate_request" },
    requestText
  )
  if (!policyDecision.allowed) {
    return recordFdeRequest(ctx, requestText, {
      status: "not_part_of_work",
      responseText: refusalMessageFor(policyDecision),
    })
  }

  const candidates = await findSimilarCapabilities(requestText, ctx.orgId, CANDIDATE_LIMIT)
  const topMatch = candidates[0]

  if (topMatch && topMatch.score >= HIGH_CONFIDENCE_THRESHOLD) {
    const label = labelFromContent(topMatch.content)
    let responseText = `This looks like it's already covered by "${label}" (${Math.round(topMatch.score * 100)}% match) -- no new capability needed.`

    // Phase 1 of Worker Agent Dispatch (READ-ONLY actions only): when the
    // high-confidence match is a worker agent that qualifies for the exact
    // same read-only auto-dispatch task-execution-engine.ts already
    // enforces (global tier + codeReference + isToolAllowedForDomain),
    // actually run it and surface its real JSON output. This reuses the
    // existing dispatchTool() -- it only ever executes the 3 read-only
    // global agents hardcoded there, so no write action can ever slip
    // through. Any failure falls back to the static message above.
    if (topMatch.entityType === "worker_agent") {
      try {
        const agent = await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
          db.query.workerAgents.findFirst({
            where: eq(workerAgents.id, topMatch.entityId),
            columns: { id: true, tier: true, codeReference: true, domain: true },
          })
        )
        const codeReference = agent?.tier === "global" ? agent.codeReference : null
        if (codeReference && isToolAllowedForDomain(agent?.domain, codeReference)) {
          await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
            const output = await dispatchTool(db, ctx.orgId, ctx.userId, codeReference)
            responseText += ` Result: ${JSON.stringify(output)}`
          })
        }
      } catch {
        // Dispatch failure -- fall back to the existing static message
        // rather than surfacing an error to the user.
      }
    }

    // Priority 12 (OPEN-07 point 1, GAP-FDE-CHAIN-INTAKE-SPLIT): the
    // worker_agent branch above has always had a real special case; a
    // dynamic_chain match never did -- FDE would report "already covered"
    // using nothing but the embedded label, with zero visibility into
    // whether Dynamic-Chain/Chat has actually learned anything about that
    // chain. capability-bridge-service.ts's findTaskCapabilityForDynamicChainMatch()
    // resolves the SAME (modePill, pathKeys) pair back to its
    // taskCapabilities row (if the chain has ever really been executed
    // through the Dynamic-Chain/Chat path), so the response can state real,
    // persisted coverage history instead of just the FDE similarity score.
    // Best-effort and additive only -- a null/failed lookup falls back to
    // the exact same generic message every other match type already gets.
    if (topMatch.entityType === "dynamic_chain") {
      const linkedCapability = await findTaskCapabilityForDynamicChainMatch(topMatch)
      if (linkedCapability && linkedCapability.occurrenceCount > 0) {
        const stats = computeCoverageStats(linkedCapability.fullSoftwareCount, linkedCapability.packageAvailableCount, linkedCapability.novelCount)
        responseText += ` This exact Dynamic Chain has been run ${stats.total} time(s) before: ${stats.fullSoftwarePercent}% required zero AI reasoning, ${stats.packageAvailablePercent}% used an approved instruction package, ${stats.novelPercent}% needed fresh judgment.`
      }
    }

    return recordFdeRequest(ctx, requestText, {
      status: "matched_existing",
      matchedWorkerAgentId: topMatch.entityType === "worker_agent" ? topMatch.entityId : null,
      matchedLabel: label,
      responseText,
      reuseLevel: "exact_match",
      topCandidates: toTopCandidates(candidates),
    })
  }

  // See SubmitFdeRequestOptions.passive: a passive (background) caller
  // stops here on anything below high confidence -- no LLM call, no
  // fde_requests row, no chance of auto-proposing a Worker Agent from
  // ordinary chat text like "thanks" or "ok".
  if (options?.passive) return null

  const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
  if (!modelConfig) {
    return recordFdeRequest(ctx, requestText, {
      status: "error",
      responseText: "No AI model is configured for this organisation yet. Set one up in Settings -> AI Configuration to use VERI FDE.",
    })
  }
  // Founder directive (2026-07-10): FDE always runs on the escalated model
  // (GLM-5.2), never the floor tier -- deciding whether a capability
  // already exists, or drafting a brand-new Worker Agent proposal, is a
  // higher-consequence, lower-frequency operation than ordinary chat, worth
  // the extra cost every time rather than gating it behind a confidence
  // signal the way chat-service.ts/task-execution-engine.ts do. Never
  // overrides an org's own BYO choice -- falls straight through to
  // `modelConfig` if escalatedPlatformConfig() has nothing configured
  // (no OPENROUTER_API_KEY) rather than failing the request.
  const effectiveConfig = modelConfig.isCustomerConfigured ? modelConfig : (escalatedPlatformConfig() ?? modelConfig)

  const startedAt = Date.now()
  try {
    const systemPrompt = await resolvePromptTemplate("fde.evaluate_request")
    const candidateList = candidates.map((c) => ({ entityType: c.entityType, entityId: c.entityId, similarityScore: Math.round(c.score * 100) / 100, contract: c.content }))
    const userMessage = `User's request: "${requestText}"\n\nClosest existing capabilities found by semantic search (JSON, NOT the full catalog):\n${JSON.stringify(candidateList)}`
    // Wave 110: expectedKeys catches a malformed/incomplete LLM response
    // here (LLMVerificationError, caught below) instead of silently
    // proceeding with an undefined matchType/responseToUser that could
    // otherwise mis-route into the wrong branch below (e.g.
    // `undefined !== "no_match"` would wrongly look like a real match).
    //
    // Gap closure, 2026-07-09: this is the exact call site
    // llm-response-cache.ts's own header comment named as the intended
    // first caller, which never happened -- callLLMJsonCached instead of
    // callLLMJson, org-scoped 24h cache. Safe here specifically because the
    // full candidate list from findSimilarCapabilities() is baked into
    // userMessage, so a changed capability catalog produces a different
    // cache key automatically rather than serving a stale evaluation.
    const { data: evaluation, usage, cached } = await callLLMJsonCached<FdeEvaluation>(
      { orgId: ctx.orgId },
      effectiveConfig.provider, effectiveConfig.model, effectiveConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens: 700, expectedKeys: ["matchType", "responseToUser"] }, effectiveConfig.fallback
    )
    // Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1 item 3):
    // store the actual prompt/response content, not just token/cost
    // metadata -- see the matching change in chat-service.ts for why.
    // Wave 146 (Phase 2): redact before write -- see pii-redaction.ts.
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "fde.evaluate_request",
      input: { requestText: redactPii(requestText), candidateCount: candidates.length, systemPrompt: redactPii(systemPrompt), userMessage: redactPii(userMessage) },
      output: { matchType: evaluation.matchType, cached, responseToUser: redactPii(evaluation.responseToUser) },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: effectiveConfig.provider, model: effectiveConfig.model, usage,
    })

    if (evaluation.matchType !== "no_match" || !evaluation.proposal) {
      return recordFdeRequest(ctx, requestText, {
        status: "matched_existing",
        matchedWorkerAgentId: evaluation.matchType === "existing_agent" ? evaluation.matchedId : null,
        matchedLabel: evaluation.matchedLabel,
        responseText: evaluation.responseToUser,
        reuseLevel: "llm_assisted_match",
        topCandidates: toTopCandidates(candidates),
      })
    }

    // No existing capability covers this -- draft a new Worker Agent
    // proposal through the *existing* Wave 16 pipeline. Tier is chosen by
    // the requester's own role, exactly as proposeWorkerAgent() already
    // requires -- VERI FDE never escalates a non-admin's request to
    // org-wide scope itself (see PLATFORM_STRATEGY.md §23.2). inputSchema/
    // outputSchema (Wave 43) are persisted for real now, not silently
    // dropped -- see worker-agent-service.ts.
    const tier = hasRole(ctx.dbUser, "admin") ? "customer" : "user"
    const proposed = await proposeWorkerAgent(ctx, {
      tier,
      name: evaluation.proposal.name,
      domain: evaluation.proposal.domain,
      description: evaluation.proposal.description,
      promptTemplate: evaluation.proposal.promptTemplate,
      inputSchema: evaluation.proposal.inputSchema,
      outputSchema: evaluation.proposal.outputSchema,
    })

    // DMP-04 gap closure: a genuine no-match proposal is now the FULL
    // Dynamic Chain bundle (module/rules/permissions/workflow/KPIs), not
    // just the one workerAgents row above -- proposeDynamicChain() creates
    // its own separately-reviewable approvalRequests row (see that
    // function's own header for why status stays 'proposed', never
    // 'approved', here). Never lets a failure here take down the
    // worker-agent proposal that already succeeded -- same "best-effort,
    // additive" posture capability-bridge-service.ts's lookup already uses
    // elsewhere in this function.
    let proposedChainId: string | null = null
    try {
      const proposedChain = await proposeDynamicChain(ctx, {
        workerAgentId: proposed.id,
        name: evaluation.proposal.name,
        domain: evaluation.proposal.domain,
        description: evaluation.proposal.description,
        moduleRef: evaluation.proposal.moduleRef ?? evaluation.proposal.domain,
        businessRules: evaluation.proposal.businessRules,
        permissions: evaluation.proposal.permissions,
        workflowSteps: evaluation.proposal.workflowSteps,
        kpis: evaluation.proposal.kpis,
        fallbackPermissionRole: tier === "user" ? "user" : "admin",
      })
      proposedChainId = proposedChain.id
    } catch (err) {
      console.error("VERI FDE: failed to propose Dynamic Chain bundle alongside worker agent proposal:", err)
    }

    return recordFdeRequest(ctx, requestText, {
      status: "proposed_agent",
      createdWorkerAgentId: proposed.id,
      createdDynamicChainId: proposedChainId,
      responseText: evaluation.responseToUser,
      reuseLevel: "new_proposal",
      topCandidates: toTopCandidates(candidates),
    })
  } catch (err) {
    console.error("VERI FDE evaluation failed:", err)
    // Wave 146 audit (AUDIT_wave146_claude_items.md, z.ai): the success path
    // above redacts requestText before logging, but this failure path didn't --
    // an FDE request containing PII that then hit an LLM error would persist
    // unredacted into orchestra_executions. Match the success path.
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "fde.evaluate_request",
      input: { requestText: redactPii(requestText) }, status: "failed", durationMs: Date.now() - startedAt,
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
  fields: {
    status: string; matchedWorkerAgentId?: string | null; matchedLabel?: string | null; createdWorkerAgentId?: string | null
    createdDynamicChainId?: string | null; responseText: string
    reuseLevel?: "exact_match" | "llm_assisted_match" | "new_proposal"; topCandidates?: TopCandidate[]
  }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [record] = await db.insert(fdeRequests).values({
      orgId: ctx.orgId, userId: ctx.userId, requestText,
      status: fields.status, matchedWorkerAgentId: fields.matchedWorkerAgentId || null,
      matchedLabel: fields.matchedLabel || null, createdWorkerAgentId: fields.createdWorkerAgentId || null,
      createdDynamicChainId: fields.createdDynamicChainId || null,
      responseText: fields.responseText,
      reuseLevel: fields.reuseLevel ?? null,
      topCandidates: fields.topCandidates ?? null,
    }).returning()
    return record
  })
}
