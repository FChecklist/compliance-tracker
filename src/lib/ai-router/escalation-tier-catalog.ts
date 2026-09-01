/**
 * R65 Part D, Phase 1 -- AI escalation tier model catalog (2026-09-01).
 *
 * SCOPE, READ BEFORE EXTENDING THIS FILE. The R65 Part D Phase 0 architecture
 * report (session memory: veridian_r65_part_d_phase0_architecture_report_
 * 2026-09-01.md) found this codebase already has 5 unmerged L0-L5/Layer-1-4
 * routing systems (mother-router.ts, software-team-ladder.ts,
 * escalation-ladder.ts, orchestra-model-resolver.ts's layer scoping, and the
 * pipeline's own L0/L1) and that NONE of them is the same axis as the R65
 * Part D directive's L1(perception)/L2(reasoning)/L3(authority) escalation
 * levels. The report's own Phase 1 (its §5) is explicitly scoped as
 * "Taxonomy reconciliation and owner sign-off (NO CODE)" -- producing a
 * mapping table + getting the Owner to bless a name distinct from "L0-L5"
 * (to avoid a 6th ambiguous "L" scheme) and confirming real model IDs, with
 * actual decision/dispatch WIRING explicitly deferred to a later "Phase 6,"
 * gated on that sign-off.
 *
 * This file is the bounded, conservative slice of that: it is the reviewable
 * TypeScript artifact for the mapping-table half of Phase 1 (so it can be
 * reviewed/approved as a diff, not just prose), plus the live model-catalog
 * verification Phase 1 also calls for. It deliberately does NOT:
 *   - wire into resolveModel() or any live dispatch call site (Phase 6's job)
 *   - rename or touch SoftwareTeamLevel's L0-L5, Mother Router's
 *     AiRouterScope, or any of the other 4 existing systems
 *   - decide the final owner-approved name for this axis -- "PERCEPTION /
 *     REASONING / AUTHORITY" is the Phase 0 report's OWN suggested name
 *     (chosen specifically to not collide with "L0-L5"), used here as the
 *     working name pending actual Owner sign-off, not asserted as final.
 * See this PR's description for the full list of what is and is not
 * resolved by this file.
 *
 * ── Live model-catalog verification (2026-09-01) ──────────────────────────
 * The Phase 0 report's §3.7 found (via GitHub code-search across THIS repo
 * only) that 3 of the directive's 5 named model ID strings had no exact
 * match anywhere in this codebase's own files, and flagged them
 * "unverified -- may not exist in the OpenRouter catalog at all." That
 * inspection only checked whether this repo already uses those strings
 * today, not whether they are real OpenRouter listings -- a narrower claim
 * than the report's prose read. A live check against openrouter.ai's public
 * per-model pricing pages, performed for this Phase 1 slice, resolves that
 * open question for all 5 directive strings:
 *
 *   deepseek/deepseek-v4-flash-0731   -- REAL, live listing ("DeepSeek V4
 *                                        Flash 0731", confirmed 2026-09-01)
 *   z-ai/glm-5.3-flash ("GLM-5.3-FLASH" in the directive, case/format only)
 *                                     -- REAL, live listing, confirmed
 *                                        natively multimodal (text+image+
 *                                        video in, text out) -- satisfies
 *                                        directive §11's "never use a
 *                                        text-only model" rule for vision
 *   z-ai/glm-5v-turbo                 -- REAL, live listing, confirmed
 *                                        multimodal (already known-real per
 *                                        Phase 0 -- re-confirmed here for
 *                                        consistency of method)
 *   deepseek/deepseek-v4-pro-0813     -- REAL, live listing ("DeepSeek V4
 *                                        Pro 0813", distinct from the
 *                                        un-dated deepseek/deepseek-v4-pro
 *                                        already pinned in roster.ts)
 *   z-ai/glm-5.2                      -- REAL, live listing, re-confirmed
 *                                        (already known-real/load-bearing)
 *   anthropic/claude-sonnet-5         -- REAL, live listing ("Claude Sonnet
 *                                        5"), confirmed available via
 *                                        OpenRouter as of 2026-09-01
 *
 * Honest limitation: this was a live web fetch of OpenRouter's public
 * pricing pages during this session, not a call through an authenticated
 * OpenRouter API key from this environment, and not re-verified a second
 * time. Model catalogs drift (this file's own predecessor report's own
 * caution) -- the supervising session should do one authenticated
 * `GET https://openrouter.ai/api/v1/models` spot-check before any of these
 * IDs are wired into a live dispatch path in Phase 6, exactly as the Phase 0
 * report's own Phase 1 test plan (§7) already calls for.
 */
import type { LLMProvider } from "@/lib/llm-client"

/**
 * Working name for this axis, NOT yet Owner-confirmed (see file header).
 * Deliberately distinct from SoftwareTeamLevel's "L0"-"L5" (software-team-
 * ladder.ts) and from AiRouterScope's "software_team"/"end_user_org"/
 * "sales_marketing"/"customer_success" (mother-router.ts) -- neither of
 * those is the same axis as this one, and this type must never be renamed
 * to "L1"/"L2"/"L3" without also resolving which of the 5 existing "L"
 * schemes it would then collide with (Phase 0 report §3.6/§6 risk 2).
 */
export type AiEscalationTier = "PERCEPTION" | "REASONING" | "AUTHORITY"

/** Runtime companion to the type, same pattern as software-team-ladder.ts's SOFTWARE_TEAM_LEVELS -- needed anywhere a value (not just a type) must validate an arbitrary string against the real tier set. */
export const AI_ESCALATION_TIERS: AiEscalationTier[] = ["PERCEPTION", "REASONING", "AUTHORITY"]

export type EscalationModelSpec = {
  provider: LLMProvider
  model: string
  /** Why this exact model was chosen, what directive section it maps to, and what (if anything) it replaces from the raw directive string. */
  note: string
}

/**
 * Directive §11 (L1/PERCEPTION). Perception has two input-kind axes in the
 * directive: text and vision -- kept as two separate specs here rather than
 * one, since directive §11's own rule ("if image or video exists: NEVER use
 * a text-only model") means a caller must pick between them based on input
 * kind, never treat PERCEPTION as one interchangeable model.
 */
export const PERCEPTION_MODELS: { text: EscalationModelSpec; vision: EscalationModelSpec } = {
  text: {
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash-0731",
    note:
      'Directive §11 exact string. Confirmed real & live on OpenRouter 2026-09-01 (file header). NOT currently wired anywhere in this repo -- providers/openrouter.ts\'s existing L1_MODEL_FALLBACK still points at the older, undated "deepseek/deepseek-chat". Reconciling that fallback (a different, smaller, code-only follow-up) is left to a later phase, not done by this catalog-only slice.',
  },
  vision: {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    note:
      "Directive §11 names this the vision PRIMARY ('GLM-5.3-FLASH'). Phase 0 report could not find it via repo code-search and flagged it as possibly nonexistent. Live OpenRouter verification 2026-09-01 confirms it exists, is live, and is natively multimodal (text+image+video in) -- the Phase 0 report's doubt is resolved here, not inherited.",
  },
}

/**
 * Directive §11's own named vision FALLBACK -- kept distinct from
 * PERCEPTION_MODELS.vision (the primary), not folded into one value, so a
 * caller can implement the directive's explicit primary/fallback pair
 * rather than this catalog silently picking one. Already real, live, and
 * load-bearing in this exact repo today (roster.ts's GLM_5V_TURBO constant,
 * used by the frontend_engineer and uat_qa_engineer roles) -- the one
 * directive vision string the Phase 0 report had already confirmed.
 */
export const PERCEPTION_VISION_FALLBACK: EscalationModelSpec = {
  provider: "openrouter",
  model: "z-ai/glm-5v-turbo",
  note:
    "Directive §11 fallback vision model. Already real, live, and load-bearing today (roster.ts GLM_5V_TURBO). Confirmed multimodal (image+video+text in) via live OpenRouter check 2026-09-01.",
}

/**
 * Directive §12 (L2/REASONING). Standard vs long/multi-document are kept as
 * two separate specs, matching directive §12's own explicit split.
 */
export const REASONING_MODELS: { standard: EscalationModelSpec; longDocument: EscalationModelSpec } = {
  standard: {
    provider: "openrouter",
    model: "z-ai/glm-5.2",
    note:
      "Directive §12 exact string. Already the sole JUDGMENT_ELIGIBLE model in model-tier-eligibility.ts and load-bearing across dozens of roster.ts roles plus Mother Router's end_user_org ESCALATED_DEFAULT (Phase 0 report's strongest anchor point, §3.7). Re-confirmed live on OpenRouter 2026-09-01.",
  },
  longDocument: {
    provider: "openrouter",
    model: "deepseek/deepseek-v4-pro-0813",
    note:
      "Directive §12 exact string (the '-0813' dated variant). Phase 0 report found only the undated deepseek/deepseek-v4-pro in roster.ts and flagged the dated suffix unconfirmed. Live OpenRouter verification 2026-09-01 confirms deepseek/deepseek-v4-pro-0813 exists as its own distinct, newer live listing. Use this exact dated string for new reasoning/long-document work; the undated deepseek/deepseek-v4-pro already pinned to governance_backend_engineer/chief_audit_officer in roster.ts is untouched by this file.",
  },
}

/**
 * Directive §13/§14 (L3/AUTHORITY), PRODUCTION branch only.
 *
 * The directive names 'CLAUDE CODE CLI MAX' as both the AUTHORITY-tier model
 * and the platform-wide default provider. Phase 0 report §3.7/§3.8/§6 risk 3
 * found that path (providers/claude-cli.ts) is a local-binary CLI, gated to
 * one user id (RAJAT_USER_ID) via adapter.ts's assertAiProviderAllowed(),
 * and cannot run in any deployed/production environment -- a documented
 * ToS/policy constraint (Anthropic OAuth/subscription auth is for ordinary
 * individual use only), not merely an engineering gap. Per this session's
 * own confirmed Owner-facing memory
 * (veridian_dev_vs_prod_ai_provider_model_2026-09-01): production
 * AUTHORITY-tier traffic must always resolve through OpenRouter; if literal
 * Claude is wanted at AUTHORITY tier in production, it is via OpenRouter's
 * own model id for it, never a separate Anthropic API key and never Claude
 * Code Max. Confirmed real & live on OpenRouter 2026-09-01 (file header).
 *
 * Deliberately NOT represented here as a runtime dev-vs-prod resolver
 * function: adapter.ts's existing AI_PROVIDER=claude-cli path (gated to
 * RAJAT_USER_ID) is a structurally different call surface -- the pipeline's
 * AiProvider.classify()/analyse() interface (no model string at all,
 * providers/claude-cli.ts shells out to whatever the `claude` binary itself
 * is authenticated as) -- from this catalog's {provider, model} shape,
 * which targets Mother Router / llm-client.ts's callLLM(provider, model,
 * ...) contract. The two are not merged here; a caller deciding between
 * "use dev-time Claude Code Max" vs "use this catalog's AUTHORITY model"
 * should keep calling adapter.ts's existing assertAiProviderAllowed()/
 * getAiProvider() exactly as today. This constant is only the answer for
 * "which model, once we already know we're on the OpenRouter/production
 * side" -- deciding WHICH side is Phase 6's job, not this file's.
 *
 * TypeScript enforcement, not just a comment: EscalationModelSpec.provider
 * is typed LLMProvider ("groq" | "openai" | "anthropic" | "google" |
 * "openrouter" | "cerebras", per llm-client.ts) -- a union that does NOT
 * include "claude-cli". This catalog cannot type-check with a local-CLI
 * value in this or any other production-facing slot.
 */
export const AUTHORITY_PRODUCTION_MODEL: EscalationModelSpec = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-5",
  note:
    "Directive §13 names 'CLAUDE CODE CLI MAX' for AUTHORITY; production traffic must never resolve to that local-CLI path (Phase 0 report §6 risk 3; session memory veridian_dev_vs_prod_ai_provider_model_2026-09-01). This is the OpenRouter-routed equivalent when literal Claude is wanted at AUTHORITY tier in production. Confirmed real & live on OpenRouter 2026-09-01.",
}

/** Flat lookup, useful for iterating/testing every registered spec for a tier without hand-listing the object shape at each call site. */
export function getEscalationModelsForTier(tier: AiEscalationTier): EscalationModelSpec[] {
  if (tier === "PERCEPTION") return [PERCEPTION_MODELS.text, PERCEPTION_MODELS.vision, PERCEPTION_VISION_FALLBACK]
  if (tier === "REASONING") return [REASONING_MODELS.standard, REASONING_MODELS.longDocument]
  return [AUTHORITY_PRODUCTION_MODEL]
}
