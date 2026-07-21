// VERIDIAN Cognitive AI OS Development Team — execution layer.
//
// Every LLM-backed role in roster.ts is invoked the same way: resolve its
// prompt-OS template (resolvePromptTemplate, Wave 22 -- no hardcoded system
// prompt string literals in this codebase), then call it via OpenRouter
// using the platform's own key, same posture as
// resolvePlatformModelConfig() in orchestra-model-resolver.ts ("the
// platform's OWN internal orchestration work, never a customer org's
// workflow"). This module never touches a customer org's
// customer_model_config -- the AI Dev Team builds VERIDIAN, it doesn't run
// inside it.

import { callLLM, callLLMJson, type LLMResult } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { checkCostPolicy, checkOpenRouterBalance } from "./cost-policy"
import { logTokenUsage } from "@/lib/services/token-usage-service"
import { AI_TEAM_ROSTER, allGuardrailRoles, getRole, operationalRoles, type RoleDefinition } from "./roster"
import { resolveEffectiveModel } from "./roster-overrides"

function platformOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured -- the AI Dev Team has no platform key to call OpenRouter with.")
  return key
}

export class RoleNotCallableError extends Error {
  constructor(roleKey: string, reason: string) {
    super(`Role '${roleKey}' cannot be called directly: ${reason}`)
    this.name = "RoleNotCallableError"
  }
}

function requireCallableRole(roleKey: string): RoleDefinition {
  const role = getRole(roleKey)
  if (!role) throw new RoleNotCallableError(roleKey, "unknown role_key")
  if (role.isHuman) throw new RoleNotCallableError(roleKey, "this is a human role (Founder/Executive Advisor), never API-dispatched")
  if (role.isCodeOnly || !role.model || !role.promptKey) throw new RoleNotCallableError(roleKey, "this role is deterministic code, not an LLM call -- see cost-policy.ts / existing RBAC in auth-guard.ts")
  return role
}

/** Runs one AI Dev Team or Guardrail role against a task/input string. Enforces the Cost & Policy Engine before spending anything. */
export async function runRole(roleKey: string, input: string): Promise<LLMResult & { role: RoleDefinition }> {
  const role = requireCallableRole(roleKey)
  const systemPrompt = await resolvePromptTemplate(role.promptKey!)
  const apiKey = platformOpenRouterKey()

  // VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
  // 2026-07-18): resolve an admin-set DB override BEFORE the actual call --
  // this is the one place that actually spends money/tokens for every
  // LLM-backed role, so it's the real enforcement point for
  // roster-overrides.ts, not just the tier-eligibility pre-flight checks
  // upstream of this function. Falls back to role.model (guaranteed
  // non-null by requireCallableRole above) on any resolution failure.
  const effectiveModel = (await resolveEffectiveModel(roleKey)) ?? role.model!

  // Cumulative balance check (2026-07-20, Owner zero-waste directive): the
  // per-call ceiling below has no memory of prior calls, so it alone
  // cannot stop many small calls from summing past the platform's actual
  // funded budget -- the confirmed real mechanism gap behind this account
  // drifting from its $10 funding intent (PLATFORM_STRATEGY.md §26) to
  // $40.07 real usage. See cost-policy.ts's checkOpenRouterBalance() for
  // the full rationale (live-balance check, fails open on network error,
  // fails closed on a confirmed low balance).
  const balance = await checkOpenRouterBalance()
  if (!balance.allowed) throw new Error(`Cost & Policy Engine blocked call to '${roleKey}': ${balance.reason}`)

  // Pre-flight cost check uses a rough usage estimate (input length as a
  // token-count proxy) -- good enough to catch a wildly oversized prompt
  // before spending; the real, precise check is the returned usage itself.
  const roughEstimate = { promptTokens: Math.ceil((systemPrompt.length + input.length) / 4), completionTokens: 500 }
  const preflight = checkCostPolicy(effectiveModel, roughEstimate)
  if (!preflight.allowed) throw new Error(`Cost & Policy Engine blocked call to '${roleKey}': ${preflight.reason}`)

  const result = await callLLM("openrouter", effectiveModel, apiKey, systemPrompt, input)

  const postflight = checkCostPolicy(effectiveModel, result.usage)
  if (!postflight.allowed) {
    // The call already happened (money spent); this flags it for the Cost
    // Governance Officer / human review rather than pretending it didn't.
    console.error(`[ai-team] Cost & Policy Engine: role '${roleKey}' exceeded ceiling post-call: ${postflight.reason}`)
  }

  // Token Usage Ledger (Finance, 2026-07-08): this is the Next.js-side
  // invocation path (via /api/ai/team/dispatch); the GitHub-Actions-side
  // path (scripts/ai-workforce-agent.mjs) logs separately via the
  // secret-gated /api/ai/team/log-usage route, since that script has no
  // direct DB access. Fire-and-forget -- logTokenUsage never throws.
  void logTokenUsage({
    scope: "ai_team_internal",
    roleKey,
    taskSummary: input.slice(0, 200),
    provider: "openrouter",
    model: effectiveModel,
    usage: result.usage,
  })

  // `role` returned with its own `.model` set to the model actually called
  // (not necessarily roster.ts's static default) -- every existing
  // downstream reader of `execution.role.model` (dispatch route's
  // estimateCostUsd/executedBy response field) picks up the real value
  // automatically, with no separate plumbing needed.
  return { ...result, role: { ...role, model: effectiveModel } }
}

export type ClassificationResult = { role: string; reasoning: string; confidence: number }

/**
 * AI Router / Task Classifier -- assigns an incoming task to one
 * operational department role (Engineering, Data, Customer Setup,
 * Customer Support, Sales & Marketing, Finance, HR, Admin, Quality &
 * Safety, Legal & Compliance -- everything except Human and the
 * Guardrail Team, which validates work rather than doing it).
 */
export async function classifyTask(taskDescription: string): Promise<ClassificationResult> {
  const systemPrompt = await resolvePromptTemplate("ai_team.ai_router")
  const apiKey = platformOpenRouterKey()
  const routerRole = getRole("ai_router")!
  const { data } = await callLLMJson<ClassificationResult>(
    "openrouter",
    routerRole.model!,
    apiKey,
    systemPrompt,
    taskDescription,
    { jsonMode: true, expectedKeys: ["role", "reasoning", "confidence"] }
  )
  const assignedRole = getRole(data.role)
  if (!assignedRole || !operationalRoles().some((r) => r.roleKey === data.role)) {
    throw new Error(`AI Router returned an invalid role_key: '${data.role}' is not a dispatchable operational role`)
  }
  return data
}

export type GuardrailVerdict = { roleKey: string; title: string; team: string; verdict: string }

/**
 * Runs the Guardrail Team's LLM-backed roles for one enforcement level
 * (platform/product/account/user) against a proposed action, returning
 * each role's raw verdict. Platform level should run for every dispatched
 * task; product/account/user levels only when that layer is actually
 * touched (mirrors workflow_orchestrator's own stated policy).
 */
export async function runGuardrailLevel(
  level: "GUARDRAIL_PLATFORM" | "GUARDRAIL_PRODUCT" | "GUARDRAIL_ACCOUNT" | "GUARDRAIL_USER",
  proposedAction: string
): Promise<GuardrailVerdict[]> {
  const levelRoles = allGuardrailRoles().filter((r) => r.team === level && !r.isCodeOnly)
  const results = await Promise.all(
    levelRoles.map(async (role) => {
      const { content } = await runRole(role.roleKey, proposedAction)
      return { roleKey: role.roleKey, title: role.title, team: role.team, verdict: content }
    })
  )
  return results
}

export { AI_TEAM_ROSTER, getRole }
