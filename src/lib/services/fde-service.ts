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
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJsonCached } from "@/lib/llm-response-cache"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { redactPii } from "@/lib/pii-redaction"
import { hasRole } from "@/lib/supabase/auth-guard"
import { proposeWorkerAgent } from "./worker-agent-service"
import { findSimilarCapabilities } from "./capability-registry-service"
import { ServiceError } from "./compliance-service"
import { isToolAllowedForDomain } from "@/lib/purpose-bound-ai"
import { dispatchTool } from "@/lib/task-execution-engine"
export { ServiceError }
import type { users } from "@/lib/db"

export type FdeContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// A match this strong answers instantly with no LLM call at all -- the
// concrete token-reduction the user asked for. Below this, the LLM still
// reasons, but only over the top-K candidates, not the full catalog.
const HIGH_CONFIDENCE_THRESHOLD = 0.9
const CANDIDATE_LIMIT = 8

type FdeEvaluation = {
  matchType: "existing_agent" | "existing_module" | "existing_rule" | "no_match"
  matchedId: string | null
  matchedLabel: string | null
  proposal: { name: string; domain: string; description: string; promptTemplate: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> } | null
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
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens: 700, expectedKeys: ["matchType", "responseToUser"] }, modelConfig.fallback
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
      provider: modelConfig.provider, model: modelConfig.model, usage,
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

    return recordFdeRequest(ctx, requestText, {
      status: "proposed_agent",
      createdWorkerAgentId: proposed.id,
      responseText: evaluation.responseToUser,
      reuseLevel: "new_proposal",
      topCandidates: toTopCandidates(candidates),
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
  fields: {
    status: string; matchedWorkerAgentId?: string | null; matchedLabel?: string | null; createdWorkerAgentId?: string | null; responseText: string
    reuseLevel?: "exact_match" | "llm_assisted_match" | "new_proposal"; topCandidates?: TopCandidate[]
  }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [record] = await db.insert(fdeRequests).values({
      orgId: ctx.orgId, userId: ctx.userId, requestText,
      status: fields.status, matchedWorkerAgentId: fields.matchedWorkerAgentId || null,
      matchedLabel: fields.matchedLabel || null, createdWorkerAgentId: fields.createdWorkerAgentId || null,
      responseText: fields.responseText,
      reuseLevel: fields.reuseLevel ?? null,
      topCandidates: fields.topCandidates ?? null,
    }).returning()
    return record
  })
}
