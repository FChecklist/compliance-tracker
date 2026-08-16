// ai-os/scripts/audit198/constitution-index.mjs
//
// CONSTITUTION.yaml (ai-os/CONSTITUTION.yaml) is a DIFFERENT, already-built
// machine-readable rule registry -- confirmed by the Owner's own brief and
// by RULES_ARTICLES_198.json's own meta.relationship_to_CONSTITUTION_yaml
// field to have zero literal ID overlap with the 198-item checklist. It
// was reconciled against real code this repo's own CI already trusts.
//
// Rather than re-deriving a verdict from scratch for every one of the 198
// items, this module cross-references each item's text against every
// CONSTITUTION.yaml rule's text via word-overlap similarity. A strong
// match lets the audit INHERIT that already-audited rule's status/
// mechanism/gap/source as real, citable evidence -- exactly the "detect
// it's already mechanically enforced by an existing script" behavior the
// task calls for, generalized to the whole document instead of hand-
// matching 198 pairs by eye.

import { readFileSync } from "node:fs"
import path from "node:path"
import yaml from "js-yaml"

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "shall", "every", "whenever", "wherever", "within", "without", "through",
  "before", "after", "is", "are", "be", "been", "being", "that", "this",
  "these", "those", "not", "no", "only", "always", "never", "all", "each",
  "any", "so", "as", "by", "from", "into", "such", "than", "then", "their",
  "its", "it", "at", "if", "when", "whether", "which", "who", "whose",
  "will", "would", "should", "must", "can", "could", "same", "also",
  "primary", "system", "platform", "os", "veridian", "ai",
])

function significantWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[.,;:()"']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  )
}

/** Recursively finds every object in the parsed YAML that looks like a
 * CONSTITUTION rule entry (has both `id` and `status` string fields),
 * regardless of which section it's nested under. This is deliberately
 * structure-agnostic so it keeps working if CONSTITUTION.yaml's section
 * layout changes -- it only depends on the documented per-rule SCHEMA
 * (id/rule/status/mechanism/gap/source) stated in the file's own header.
 */
function collectRuleEntries(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRuleEntries(item, out)
  } else if (node && typeof node === "object") {
    if (typeof node.id === "string" && typeof node.status === "string" && typeof node.rule === "string") {
      out.push(node)
    }
    for (const value of Object.values(node)) collectRuleEntries(value, out)
  }
  return out
}

export function loadConstitutionIndex(repoRoot) {
  const full = path.join(repoRoot, "ai-os", "CONSTITUTION.yaml")
  const raw = readFileSync(full, "utf8")
  const doc = yaml.load(raw)
  const entries = collectRuleEntries(doc)
  const indexed = entries.map((e) => ({
    id: e.id,
    rule: e.rule,
    status: e.status,
    mechanism: e.mechanism ?? null,
    gap: e.gap ?? null,
    source: e.source ?? null,
    words: significantWords(e.rule),
  }))
  return { path: "ai-os/CONSTITUTION.yaml", count: indexed.length, entries: indexed }
}

/**
 * Jaccard-style overlap between the 198-item's text and every
 * CONSTITUTION.yaml rule's text; returns the single best match with its
 * score, or null if nothing clears the threshold. Deterministic, no LLM.
 */
export function bestConstitutionMatch(itemText, constitutionIndex, threshold = 0.30) {
  const itemWords = significantWords(itemText)
  if (itemWords.size === 0) return null
  let best = null
  for (const entry of constitutionIndex.entries) {
    if (entry.words.size === 0) continue
    let overlap = 0
    for (const w of itemWords) if (entry.words.has(w)) overlap++
    const union = new Set([...itemWords, ...entry.words]).size
    const score = union === 0 ? 0 : overlap / union
    if (!best || score > best.score) best = { ...entry, score }
  }
  if (!best || best.score < threshold) return null
  return best
}
