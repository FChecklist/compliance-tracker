// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers): split out of
// prompt-construction.ts so that module can be imported into a browser
// bundle. These two functions are the only reason prompt-construction.ts
// depended on node:crypto -- analyzeLightweight() itself (the function
// phase_5's browser-native FIRST-pass tier needs to reuse, not
// reimplement, per the Owner's "no new engine unless necessary" directive)
// never touched crypto. Kept server-only (still uses node:crypto rather
// than switching to Web Crypto) since hashing/fingerprinting stay part of
// the authoritative SECOND-pass compiled-prompt contract, not something
// the browser FIRST pass needs to produce itself.
import { createHash } from "crypto"
import type { Classification, Entity, IntentLevel, PromptVariable } from "./types"

/** sha256 of the exact cleaned text -- PROMPT_METADATA_SCHEMA's `version.diff_hash` field. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * Semantic fingerprint -- NOT a hash of the exact text (that's
 * hashContent()/diff_hash above). A signature of the compiled prompt's
 * *shape* (category + primary intent + sorted unique entity types + sorted
 * variable names) so two differently-worded prompts that compile to the
 * same intent/shape can be recognized as likely duplicates cheaply, before
 * ever running the real (and more expensive) embedding-similarity search
 * in prompt-similarity.ts. This is PROMPT_METADATA_SCHEMA_2026-07-25's
 * `cache.cache_key` field.
 */
export function computeFingerprint(classification: Classification, intent: IntentLevel, entities: Entity[], variables: PromptVariable[]): string {
  const entityTypes = [...new Set(entities.map((e) => e.type))].sort()
  const variableNames = [...new Set(variables.map((v) => v.name))].sort()
  const shape = `${classification.category}|${intent.primary}|${entityTypes.join(",")}|${variableNames.join(",")}`
  return createHash("sha256").update(shape).digest("hex")
}
