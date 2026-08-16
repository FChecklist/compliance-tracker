// Priority 3 (Universal Metadata Registry, 08-priority3-umr-tracker.yaml,
// agent 2 "routing"): the Routing Engine. The Owner's spec is explicit that
// this is the differentiator from naive full-text search -- progressive
// narrowing (Asset Type -> Module -> Object -> Intent -> Permission ->
// top-N) instead of ever scanning everything. This module is Step 1-5 of
// that pipeline; Object/Intent-level narrowing beyond assetType+module and
// vector/semantic search are explicitly out of scope here (see the PR
// description / dispatch note -- vector search is the third parallel
// agent's, `subagent/umr-graph`, reserved for genuinely ambiguous queries
// as a distinct fallback layer this engine does not implement).
//
// Classification is deterministic-first, matching this codebase's own
// established discipline (intent-engine.ts's header: "cheap, reliable,
// non-bypassable gates over LLM classification wherever a gate needs to be
// unconditionally reliable") -- the keyword table below is intentionally
// the same word-boundary-regex technique as intent-engine.ts's
// classifyIntent() and business-object-classifier.ts's
// classifyBusinessObjectType(). An LLM call only happens when the keyword
// table finds no confident assetType match at all -- never on every query,
// and never as a second opinion overriding a confident deterministic hit.
import { assetTypeEnum } from "@/lib/db/schema"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import type { UserRole } from "@/lib/supabase/auth-guard"
import {
  queryByAssetType, queryByModule, queryByStatus, queryByTags, queryByAiCapability, queryByKeywords,
  type AssetQueryContext, type AssetType, type PlatformAsset,
} from "./asset-query-service"

export type AssetRoutingContext = { orgId: string; userId?: string; userRole: UserRole }

const TOP_N = 5

// ─── Step 1a: deterministic keyword classification (no LLM, no DB) ──────
//
// A defensible starter set, not the Owner's full 24-type taxonomy covered
// exhaustively -- same "v1 covers a starter set, unmatched falls through"
// posture as intent-engine.ts's own header. More specific/compound phrases
// are listed under types earlier in this object so they win over a looser
// generic phrase later (e.g. "email template" resolves to email_template
// before the bare word "template" would resolve it to `template`) --
// object key insertion order is iteration order for string keys in JS,
// exactly like intent-engine.ts's TRIGGERS relies on.
const ASSET_TYPE_KEYWORDS: Partial<Record<AssetType, string[]>> = {
  email_template: ["email template", "email draft template"],
  ai_agent: ["ai agent", "ai assistant", "assistant role"],
  computation_engine: ["computation engine", "calculation engine", "calc engine"],
  dynamic_chain: ["dynamic chain", "task chain"],
  sql_query: ["sql query", "database query"],
  report: ["report", "invoice", "overdue report", "financial report", "compliance report", "gst report", "tds report"],
  dashboard: ["dashboard", "kpi dashboard", "analytics dashboard"],
  workflow: ["workflow", "approval workflow", "approval flow"],
  screen: ["screen", "page", "form"],
  policy: ["policy", "guardrail policy"],
  rule: ["monitoring rule", "business rule", "validation rule"],
  notification: ["notification", "reminder alert"],
  project: ["project", "construction project"],
  task: ["task", "checklist item", "to-do", "todo"],
  document: ["document", "attachment", "file upload"],
  decision: ["decision log", "decision record"],
  automation: ["automation rule", "automation"],
  role: ["user role"],
  permission: ["access permission"],
  api: ["api", "endpoint", "webhook"],
  function: ["utility function"],
  prompt: ["prompt template", "system prompt"],
  template: ["template"],
}

const MODULE_KEYWORDS: Record<string, string[]> = {
  finance: ["invoice", "gst", "tds", "finance", "accounts", "payment", "billing", "expense", "budget"],
  hr: ["payroll", "attendance", "leave", "hr", "employee"],
  compliance: ["compliance", "filing", "regulatory"],
  audit: ["audit", "auditor"],
  construction: ["construction", "site diary", "boq", "manpower"],
  crm: ["crm", "lead", "customer", "opportunity"],
}

function toWordBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i")
}

export type AssetTypeGuess = {
  assetType: AssetType | null
  module: string | null
  confidence: "high" | "low"
  matchedAssetTypePhrase: string | null
  matchedModulePhrase: string | null
}

/** Pure, deterministic, case-insensitive word-boundary phrase match -- no LLM call, no DB access. */
export function classifyAssetQueryDeterministic(query: string): AssetTypeGuess {
  const normalized = query.trim()
  if (!normalized) {
    return { assetType: null, module: null, confidence: "low", matchedAssetTypePhrase: null, matchedModulePhrase: null }
  }

  let assetType: AssetType | null = null
  let matchedAssetTypePhrase: string | null = null
  for (const [type, phrases] of Object.entries(ASSET_TYPE_KEYWORDS) as [AssetType, string[]][]) {
    for (const phrase of phrases) {
      if (toWordBoundaryRegex(phrase).test(normalized)) {
        assetType = type
        matchedAssetTypePhrase = phrase
        break
      }
    }
    if (assetType) break
  }

  // Named moduleGuess (not `module`) to avoid Next.js's reserved `module`
  // global -- @next/next/no-assign-module-variable lints on any local
  // variable named `module` being assigned to, even though this has
  // nothing to do with CommonJS module scoping.
  let moduleGuess: string | null = null
  let matchedModulePhrase: string | null = null
  for (const [mod, phrases] of Object.entries(MODULE_KEYWORDS)) {
    for (const phrase of phrases) {
      if (toWordBoundaryRegex(phrase).test(normalized)) {
        moduleGuess = mod
        matchedModulePhrase = phrase
        break
      }
    }
    if (moduleGuess) break
  }

  return { assetType, module: moduleGuess, confidence: assetType ? "high" : "low", matchedAssetTypePhrase, matchedModulePhrase }
}

// ─── Step 1b: LLM fallback classification ────────────────────────────────
//
// Only reached when classifyAssetQueryDeterministic() above returned
// confidence "low" (no keyword table match at all). Reuses this codebase's
// established resolveModelConfig -> enforcePolicy -> resolvePromptTemplate
// -> callLLMJson -> recordOrchestraExecution pattern (email-intelligence-
// service.ts / construction-ai-service.ts / gst/ai-review-report.ts all
// follow this exact chain). The query is free-text user input reaching an
// LLM, so it goes through enforcePolicy() same as every other free-text
// call site in the manifest (scripts/check-guardrail-presence.mjs) --
// extending guardrail coverage to a new call site is explicitly encouraged
// per AGENTS.md Operating Rule 9. Never throws into the caller -- any
// failure here (no model configured, policy refusal, malformed LLM output)
// degrades to "no LLM classification," and resolveAssetQuery's own
// indexed-status-fallback (see below) still guarantees an indexed query.
async function classifyViaLlm(
  ctx: { orgId: string; userId?: string },
  query: string
): Promise<{ assetType: AssetType | null; module: string | null } | null> {
  try {
    const modelConfig = await resolveModelConfig(ctx.orgId, "task_oa")
    if (!modelConfig) return null

    const policyDecision = enforcePolicy(
      { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "task_oa", eventType: "asset_routing.classify" },
      query
    )
    if (!policyDecision.allowed) {
      console.warn(`[asset-routing-engine] LLM classification refused by policy: ${refusalMessageFor(policyDecision)}`)
      return null
    }

    const systemPrompt = await resolvePromptTemplate("asset_routing.classify")
    const startedAt = Date.now()
    const { data, usage } = await callLLMJson<{ assetType: string | null; module: string | null }>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey, systemPrompt, query,
      { temperature: 0, maxTokens: 150 }, modelConfig.fallback
    )

    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "task_oa", eventType: "asset_routing.classify",
      input: { query }, output: { assetType: data.assetType, module: data.module },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    // assetTypeEnum.enumValues is drizzle-orm's own runtime array for the
    // pgEnum -- validating against it (rather than a hand-copied literal
    // list) means this sanitization can never drift from schema.ts's real
    // enum, matching sanitizeSuggestedWorkItems()'s validate-before-trust
    // posture in email-intelligence-service.ts.
    const validTypes = assetTypeEnum.enumValues as readonly string[]
    const assetType = typeof data.assetType === "string" && validTypes.includes(data.assetType) ? (data.assetType as AssetType) : null
    const moduleGuess = typeof data.module === "string" && data.module.trim() ? data.module.trim().toLowerCase() : null
    return { assetType, module: moduleGuess }
  } catch (err) {
    console.warn("[asset-routing-engine] LLM classification fallback failed (non-fatal):", err)
    return null
  }
}

// ─── Step 4: permission filter ───────────────────────────────────────────
/** Pure function. An asset with no permissions set (null/empty array) is open to every role; otherwise the caller's role must be listed explicitly. */
export function filterAssetsByPermission(assets: PlatformAsset[], userRole: UserRole): PlatformAsset[] {
  return assets.filter((asset) => {
    const perms = asset.permissions as string[] | null | undefined
    if (!perms || perms.length === 0) return true
    return perms.includes(userRole)
  })
}

// ─── Step 5: top-N by recency (deterministic tiebreaker, no fabricated score) ──
/** Pure function. Assumes callers already order-by-index-friendly-column when they can; this is the final, always-safe tiebreaker. */
export function selectTopByRecency(assets: PlatformAsset[], n: number = TOP_N): PlatformAsset[] {
  return [...assets]
    .sort((a, b) => new Date(b.updatedAt as unknown as string).getTime() - new Date(a.updatedAt as unknown as string).getTime())
    .slice(0, n)
}

export type AssetRoutingResult = {
  query: string
  results: PlatformAsset[]
  classification: {
    assetType: AssetType | null
    module: string | null
    source: "deterministic" | "llm" | "none"
  }
}

/**
 * The real Routing Engine entry point. Every path through this function
 * reaches at least one real index from asset-query-service.ts before any
 * result is returned -- it never falls through to an unfiltered
 * `SELECT * FROM platform_assets`. See asset-routing-engine.test.ts's
 * "never scans unfiltered" suite, which spies on the query-service module
 * to assert this across representative inputs (empty query, gibberish
 * query, no LLM configured, LLM throwing).
 */
export async function resolveAssetQuery(query: string, context: AssetRoutingContext): Promise<AssetRoutingResult> {
  const trimmed = query?.trim() ?? ""
  const qCtx: AssetQueryContext = { orgId: context.orgId }

  // ── Step 1: classify into an assetType (+ opportunistic module guess) ──
  const deterministic = classifyAssetQueryDeterministic(trimmed)
  let assetType = deterministic.assetType
  let moduleGuess = deterministic.module
  let source: AssetRoutingResult["classification"]["source"] = assetType ? "deterministic" : "none"

  if (!assetType && trimmed) {
    const llmGuess = await classifyViaLlm({ orgId: context.orgId, userId: context.userId }, trimmed)
    if (llmGuess?.assetType) {
      assetType = llmGuess.assetType
      moduleGuess = moduleGuess ?? llmGuess.module
      source = "llm"
    }
  }

  // ── Step 2-3: index-backed narrowing. If assetType resolved (Step 1),
  // narrow by it directly (btree index). If not, this NEVER falls through
  // to an unfiltered scan -- it narrows by status='active' instead (also a
  // real btree index), which is always a safe, always-available default:
  // every genuine platform asset a user would want returned is 'active' by
  // definition, and 'draft'/'archived'/'deleted' rows are exactly what a
  // routing engine should exclude from an unclassified query anyway. ──
  let candidates: PlatformAsset[] = assetType
    ? await queryByAssetType(qCtx, assetType)
    : await queryByStatus(qCtx, "active")

  // Module narrowing on the already-index-fetched candidate set (in-memory
  // filter over a set that was never unfiltered to begin with -- no second
  // full-scan risk). Degrades gracefully: if the module guess doesn't
  // actually match anything in the assetType-narrowed set (e.g. keyword
  // table guessed a module that isn't this asset's real module field),
  // keep the pre-module-filter candidates rather than returning zero
  // results on a plausible but wrong guess.
  if (moduleGuess) {
    const narrowed = candidates.filter((c) => c.module === moduleGuess)
    if (narrowed.length > 0) candidates = narrowed
  }

  // ── Step 4: permission filter ──
  const permitted = filterAssetsByPermission(candidates, context.userRole)

  // ── Step 5: top-5 by recency ──
  const results = selectTopByRecency(permitted, TOP_N)

  return { query: trimmed, results, classification: { assetType, module: moduleGuess, source } }
}

// Re-exported so callers/tests that only need the query-composition layer
// don't have to import asset-query-service.ts directly for these two --
// kept minimal (not a blanket re-export) to avoid this file silently
// becoming a second barrel for that module.
export { queryByTags, queryByAiCapability, queryByKeywords }
