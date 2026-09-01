// R63 (owner directive, 2026-08-29): "AI model agnostic -- level 1/2/3 must
// not be hardcoded, must be owner-changeable at any time, must propagate
// across VERIDIAN AI OS ERP and every product including PROJEXA-AI.COM."
//
// Deliberately NARROW, matching providers/openrouter.ts's own established
// precedent ("Deliberately NOT wired through orchestra-model-resolver.ts/
// policy-enforcement-engine/guardrail-engine... reusing that larger
// machinery would re-couple exactly what this pipeline exists to keep
// simple"). This does not touch Mother Router, computeEndUserOrgResolution,
// or AiRouterScope -- those resolve models by ORG SUBSCRIPTION PACKAGE, a
// different question from "which model does the platform-wide L1/L2
// pipeline classifier use." Reads platform.pipeline_level_models (drizzle/
// 0329_r63_pipeline_level_models.sql) -- a dedicated table, not a 5th value
// bolted onto ai_model_registry.role (that column's own comment already
// reserves exactly 4 meanings for orchestra-model-resolver.ts's failover
// chain).
//
// PROJEXA-AI.COM needs zero code changes to pick this up: it calls this
// same compliance-tracker backend's /api/v1/projexa/* routes, which call
// runSubmission() -> level1.ts -> getAiProvider() -> providers/openrouter.ts
// -> this file. One row edit here covers both products, because there is
// one backend (see [[veridian_single_product_multi_brand_architecture]]).
import { db, pipelineLevelModels } from "@/lib/db";
import { and, eq, desc } from "drizzle-orm";

export type PipelineLevelRole = "pipeline_l1" | "pipeline_l2";

const CACHE_TTL_MS = 60_000; // matches mother-router.ts's own POLICY_CACHE_TTL_MS
const cache = new Map<PipelineLevelRole, { fetchedAt: number; model: string | null }>();

/** Call after writing/activating a pipeline_level_models row so the change takes effect immediately instead of waiting out CACHE_TTL_MS -- same convention as mother-router.ts's invalidateMotherRouterCache(). */
export function invalidatePipelineModelCache(role?: PipelineLevelRole): void {
  if (role) cache.delete(role);
  else cache.clear();
}

async function fetchActiveModel(role: PipelineLevelRole): Promise<string | null> {
  const row = await db.query.pipelineLevelModels.findFirst({
    where: and(eq(pipelineLevelModels.level, role), eq(pipelineLevelModels.status, "active")),
    orderBy: desc(pipelineLevelModels.updatedAt),
  });
  return row?.model ?? null;
}

/**
 * Resolves the model for one pipeline level. `fallbackModel` (the caller's
 * existing env-var-driven default, e.g. L1_MODEL/L2_MODEL in
 * providers/openrouter.ts) is used ONLY when no active ai_model_registry
 * row exists for this role -- this function never invents a model and
 * never silently returns an empty string. Boolean gate: every call
 * returns exactly one of {registry override, documented fallback} -- never
 * null, never throws for a missing row (a missing row is the NORMAL,
 * expected state until an owner sets an override).
 */
export async function resolvePipelineModel(role: PipelineLevelRole, fallbackModel: string): Promise<string> {
  const cached = cache.get(role);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.model ?? fallbackModel;
  }
  const model = await fetchActiveModel(role);
  cache.set(role, { fetchedAt: Date.now(), model });
  return model ?? fallbackModel;
}
