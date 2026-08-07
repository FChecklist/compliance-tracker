// VERIDIAN_Architecture_v2.0 phase_2: the DB-touching seam between this
// phase's pure pipeline and phase_1's real compliance.prompt_versions
// storage. Per this phase's own amended scope (the Owner's 2026-07-25 UX
// directive reconciliation): "the compiled contract must be written to
// phase_1's compliance.prompt_versions row via this phase's own
// compiled/versioned storage integration_point" -- this is that write path.
// Deliberately thin and DB-only (no pipeline logic here) so pipeline.ts
// itself stays pure/testable without a live database.
import { createPromptVersion, type PromptOsContext } from "@/lib/services/prompt-os-service"
import { findSemanticCacheHit, indexCompiledPromptVersion } from "./prompt-similarity"
import type { CompiledPrompt, LightweightAnalysis } from "./types"

export type CompileAndStoreResult =
  | { outcome: "cache_hit"; promptVersionId: string; score: number }
  | { outcome: "created"; promptVersionId: string; version: number }

/**
 * Checks the semantic cache first (prompt-similarity.ts's
 * findSemanticCacheHit, itself the L5-equivalent instruction_execution_cache/
 * embeddings.ts infrastructure this phase's integration_point names) before
 * ever minting a new compliance.prompt_versions row -- the "semantic-cache
 * lookup" pipeline-prompt-construction's own gap analysis entry calls for.
 * On a genuine miss, persists the compiled machine_prompt as the new
 * version's `content` (createPromptVersion() itself is phase_1's own,
 * untouched API -- this phase does not add a metadata parameter to it;
 * `compiled.contentHash`/`compiled.fingerprint` are PROMPT_METADATA_SCHEMA's
 * `version.diff_hash`/`cache.cache_key` shape but populating the row's
 * `metadata` column is left to a future phase that owns that write path),
 * then indexes it so the NEXT similarly-shaped compile can find it in turn.
 */
export async function compileAndStorePromptVersion(
  ctx: PromptOsContext,
  input: { templateKey: string; compiled: CompiledPrompt; analysis: LightweightAnalysis; orgId: string; cacheThreshold?: number }
): Promise<CompileAndStoreResult> {
  const cacheHit = await findSemanticCacheHit(input.compiled.machinePrompt, input.orgId, input.cacheThreshold ?? 0.95)
  if (cacheHit) return { outcome: "cache_hit", promptVersionId: cacheHit.promptVersionId, score: cacheHit.score }

  const created = await createPromptVersion(ctx, {
    templateKey: input.templateKey,
    content: input.compiled.machinePrompt,
    bump: "patch",
  })

  await indexCompiledPromptVersion(created.id, input.compiled.machinePrompt, input.orgId)

  return { outcome: "created", promptVersionId: created.id, version: created.version }
}
