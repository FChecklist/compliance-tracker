// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-compiler (deepen) +
// pipeline-prompt-construction (Layer 4, Stages 13-18, deepen). Ports
// scripts/prompt_gateway/engine/prompt_engine.py's PromptConverter (template
// matching, then rule-based compression) 1:1, reuses the codebase's own
// already-live noise remover (prompt-normalizer.ts's normalizeForLlm --
// this phase does NOT build a second noise-removal engine, per the Owner's
// "no new engine unless necessary" directive), and adds what the gap
// analysis says prompt_engine.py itself never had: hash generation,
// semantic fingerprinting, and a semantic-cache lookup hook.
//
// This entire module is a PURE, DETERMINISTIC, NO-LLM-CALL pipeline --
// same "by software, not by AI" design as the Python original -- per the
// Owner's 2026-07-25 UX directive reconciliation: it is the
// machine-language-output CONTRACT phase_5's browser input surfaces will
// later compile into, not a second AI pass.
// VERIDIAN_Architecture_v2.0 phase_5 (2026-07-26): sha256Hex, not Node's
// crypto.createHash -- this module is called directly from the browser
// (src/lib/browser-execution/), and Node's `crypto` module does not exist
// in a client bundle. See universal-hash.ts's header for why a
// dependency-free sync implementation was written rather than the async
// Web Crypto API. contentHash/fingerprint are cache keys, never a security
// boundary, so the algorithm swap is safe.
import { sha256Hex } from "@/lib/universal-hash"
import { normalizeForLlm } from "@/lib/prompt-normalizer"
import { classify, extractIntent } from "./intent-classifier"
import { extractEntities, extractVariables } from "./entity-variable-extraction"
import type { Classification, CompiledPrompt, Entity, IntentLevel, LightweightAnalysis, PromptVariable } from "./types"

const ACTION_VERBS = new Set([
  "write", "create", "build", "fix", "debug", "analyze", "deploy", "update", "delete", "test", "configure",
  "install", "run", "execute", "review", "search", "find", "get", "set", "add", "remove", "check", "validate",
  "optimize", "refactor", "migrate", "convert", "parse", "extract", "transform", "load", "import", "export", "generate",
])

// Direct port of prompt_engine.py's PROMPT_TEMPLATES -- a representative
// subset (the compressed-shape-defining ones), translated to JS named
// capture groups. Falls through to compressToMachinePrompt() below when
// nothing matches, exactly like the Python original's `if not matched`.
// Built via `new RegExp(source, flags)` rather than regex literals -- this
// repo's tsconfig targets ES2017, and TS only allows named-capture-group
// *literal* syntax at ES2018+ (a compile-time-only restriction; the
// `.groups` result at runtime works identically either way).
function namedPattern(source: string): RegExp {
  return new RegExp(source, "i")
}

const TEMPLATE_PATTERNS: { pattern: RegExp; build: (g: Record<string, string>) => string }[] = [
  { pattern: namedPattern("\\b(?:write|create) (?:a |the )?(?<type>script|function|class|module|program)\\b"), build: (g) => `CODE_GEN:${g.type}` },
  { pattern: namedPattern("\\b(?:fix|debug|resolve)\\s+(?<issue>.+?)\\s+(?:in|for|on)\\s+(?<target>.+)"), build: (g) => `CODE_FIX:issue=${g.issue}:target=${g.target}` },
  { pattern: namedPattern("\\b(?:add|implement|build)\\s+(?<feature>.+?)\\s+(?:to|in|for)\\s+(?<target>.+)"), build: (g) => `CODE_ADD:feature=${g.feature}:target=${g.target}` },
  { pattern: namedPattern("\\banalyze\\s+(?<subject>.+)"), build: (g) => `ANALYZE:${g.subject}` },
  { pattern: namedPattern("\\b(?:compare|benchmark)\\s+(?<a>.+?)\\s+(?:with|against|to)\\s+(?<b>.+)"), build: (g) => `COMPARE:${g.a}:${g.b}` },
  { pattern: namedPattern("\\b(?:review|audit)\\s+(?<subject>.+)"), build: (g) => `REVIEW:${g.subject}` },
  { pattern: namedPattern("\\bhow (?:do|can|should|to) (?:i |we |you )?(?<q>.+?)\\??$"), build: (g) => `QUERY:${g.q}` },
  { pattern: namedPattern("\\b(?:find|search|lookup|get)\\s+(?<subject>.+)"), build: (g) => `LOOKUP:${g.subject}` },
  { pattern: namedPattern("\\b(?:deploy|install|setup|configure)\\s+(?:the\\s+)?(?<target>.+)"), build: (g) => `OPS:${g.target}` },
  { pattern: namedPattern("\\b(?:describe|explain)\\s+(?<subject>.+)"), build: (g) => `EXPLAIN:${g.subject}` },
  { pattern: namedPattern("\\b(?:create|add|make)\\s+(?:a\\s+)?(?:task|todo)\\s*[:=]?\\s*(?<desc>.+)"), build: (g) => `TASK:${g.desc}` },
]

function tryTemplateMatch(text: string): { machinePrompt: string; matchedTemplate: string } | null {
  for (const { pattern, build } of TEMPLATE_PATTERNS) {
    const m = pattern.exec(text)
    if (m?.groups) {
      try {
        return { machinePrompt: build(m.groups), matchedTemplate: pattern.source }
      } catch {
        continue
      }
    }
  }
  return null
}

/** Direct port of prompt_engine.py's PromptConverter._compress_to_prompt(). */
export function compressToMachinePrompt(text: string, classification: Classification, intent: IntentLevel): string {
  const category = classification?.category ?? "GENERAL"
  const intentLabel = intent?.primary ?? "UNKNOWN"

  const sentences = text.split(/[.!?]+/)
  const keyTerms: string[] = []

  for (const raw of sentences) {
    const sentence = raw.trim()
    if (!sentence) continue
    const words = sentence.split(/\s+/)
    if (words.length === 0) continue

    let i = 0
    let foundVerb = false
    while (i < words.length) {
      const w = words[i].toLowerCase()
      if (ACTION_VERBS.has(w) && i + 1 < words.length) {
        keyTerms.push(words[i], words[i + 1])
        foundVerb = true
        i += 2
        continue
      }
      i++
    }
    if (!foundVerb) {
      if (words.length >= 2) keyTerms.push(words[0], words[words.length - 1])
      else keyTerms.push(words[0])
    }
  }

  const seen = new Set<string>()
  const uniqueTerms: string[] = []
  for (const t of keyTerms) {
    const tl = t.toLowerCase()
    if (!seen.has(tl)) {
      seen.add(tl)
      uniqueTerms.push(t)
    }
  }

  return `${category}:${intentLabel}:${uniqueTerms.join("_")}`
}

/** Direct port of prompt_engine.py's PromptConverter.estimate_token_reduction(). */
export function estimateTokenReduction(original: string, machinePrompt: string) {
  const origTokens = Math.round((original.split(/\s+/).filter(Boolean).length) * 1.3)
  const machineTokens = Math.round((machinePrompt.split(/\s+/).filter(Boolean).length) * 1.1)
  return {
    estimatedOriginalTokens: origTokens,
    estimatedMachineTokens: machineTokens,
    reductionPct: Math.round((1 - machineTokens / Math.max(origTokens, 1)) * 1000) / 10,
  }
}

/** sha256 of the exact cleaned text -- PROMPT_METADATA_SCHEMA's `version.diff_hash` field. */
export function hashContent(text: string): string {
  return sha256Hex(text)
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
  return sha256Hex(shape)
}

/**
 * Layer 2 (Lightweight Analysis, Stages 3-7): noise removal (reuses the
 * existing normalizeForLlm(), not a new engine) + classification + intent +
 * entities + variables. Pure, no I/O.
 */
export function analyzeLightweight(rawText: string): LightweightAnalysis {
  const cleaned = normalizeForLlm(rawText)
  const classification = classify(cleaned)
  const intent = extractIntent(cleaned)
  const entities = extractEntities(cleaned)
  const variables = extractVariables(cleaned)
  const words = cleaned.match(/\b\w+\b/g) ?? []
  return {
    originalText: rawText,
    classification,
    intent,
    entities,
    variables,
    wordCount: words.length,
    charCount: cleaned.length,
    estimatedTokens: cleaned.split(/\s+/).filter(Boolean).length + (cleaned.match(/[^\w\s]/g) ?? []).length,
  }
}

/**
 * Layer 4 (Prompt Construction, Stages 13-18): builds the compiled
 * machine-language-output contract from an already-analyzed prompt --
 * template match first, compression fallback, then hash + fingerprint +
 * token-reduction estimate. Pure, no I/O -- callers needing the
 * semantic-cache lookup or persistence should use prompt-similarity.ts /
 * prompt-os-service.ts's createPromptVersion with this function's output.
 */
export function buildCompiledPrompt(analysis: LightweightAnalysis): CompiledPrompt {
  const cleaned = normalizeForLlm(analysis.originalText)
  const templateMatch = tryTemplateMatch(cleaned)
  const machinePrompt = templateMatch?.machinePrompt ?? compressToMachinePrompt(cleaned, analysis.classification, analysis.intent)

  const originalLength = analysis.originalText.length
  const cleanedLength = cleaned.length
  const noiseReductionPct = Math.round((1 - cleanedLength / Math.max(originalLength, 1)) * 1000) / 10

  return {
    cleanedText: cleaned,
    machinePrompt,
    contentHash: hashContent(cleaned),
    fingerprint: computeFingerprint(analysis.classification, analysis.intent, analysis.entities, analysis.variables),
    noiseReductionPct,
    tokenReduction: estimateTokenReduction(analysis.originalText, machinePrompt),
    matchedTemplate: templateMatch?.matchedTemplate ?? null,
  }
}
