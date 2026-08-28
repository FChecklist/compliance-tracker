// VERIDIAN_Architecture_v2.0 phase_2: engine-entity + engine-variable.
// Ports scripts/prompt_gateway/engine/classifier.py's extract_entities()
// pattern set into TypeScript and adds the domain-specific entity types
// (DEADLINE_DATE/MONEY_AMOUNT/REGULATION_REF/EMAIL) the gap analysis'
// engine-entity requirement explicitly calls for and the Python original
// never had. engine-variable (a genuinely new engine, no prior art) sits
// alongside it since both operate on the same cleaned text.
import type { Entity, EntityType, PromptVariable, VariableType } from "./types"

// CodeQL js/polynomial-redos + js/regex-injection (both real, both fixed 2026-07-27):
// (a) escape any user-derived string before interpolating it into a RegExp
// constructor -- VARIABLE_TOKEN_RE already constrains `name` to
// [a-zA-Z0-9_], so this is defense-in-depth, not a currently-reachable
// injection, but a future change to that pattern must not silently
// reopen it. (b) cap input length before running any of the regex
// patterns below over it -- several use nested quantifiers/alternation
// that could show polynomial worst-case behavior on adversarial input;
// a hard length cap bounds worst-case time regardless of which pattern.
const MAX_EXTRACTION_INPUT_CHARS = 50_000

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// FILE_PATH_RE's `[\w./-]+` quantifier has no leading `\b` (unlike the
// other patterns below), so bun's/JSC's backtracking engine retries a
// full O(remaining-length) backoff at *every* character position in the
// input when the required `.` + extension is never found -- O(n) attempts
// x O(n) backoff each = O(n^2). The MAX_EXTRACTION_INPUT_CHARS cap above
// bounds n but not n^2 (50_000 chars alone measured ~12s of pure regex
// time, confirmed 2026-08-28 while diagnosing E-138 -- a real, still-live
// perf bug the length cap alone didn't fix, not a flaky/mock-leakage
// failure). Bounding the quantifier itself (real paths are never anywhere
// near this long) caps the per-position backoff to a small constant,
// which is what actually eliminates the quadratic blowup; verified this
// preserves every existing match case (short paths, repeated paths,
// multi-dot filenames like schema.d.ts) while cutting the pathological
// 50_000-char/no-match case from ~12s to well under 200ms.
const FILE_PATH_RE = /[\w./-]{1,400}\.(?:py|js|ts|tsx|jsx|json|yaml|yml|toml|cfg|ini|sh|bash|sql|md|txt|html|css)\b/g
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`]+/g
// classifier.py's CODE_REF pattern minus its English-stopword denylist,
// applied the same way (a capitalized identifier-shaped token).
const CODE_REF_RE = /\b[A-Z][a-zA-Z_]+(?:\.[A-Z][a-zA-Z_]*)*\b/g
const CODE_REF_STOPWORDS = new Set(["The", "This", "That", "Then", "There", "These"])
const MEASUREMENT_RE = /\b\d+(?:\.\d+)?\s*(?:MB|GB|KB|TB|ms|s|sec|min|hr|hours?|days?|%)\b/g
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)*(?:-\w+)?\b/g

// Domain-specific (compliance-tracker's own domain -- not in the
// chat-generic classifier.py original).
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
const MONEY_AMOUNT_RE = /(?:USD|INR|AED|\$|₹|Dh)\s?\d[\d,]*(?:\.\d+)?\b|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|INR|AED)\b/g
const DEADLINE_DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4})\b/g
const REGULATION_REF_RE = /\b(?:GDPR|SOX|HIPAA|PCI[- ]DSS|ISO\s?\d{4,5}|Section\s+\d+[A-Za-z]?|Rule\s+\d+[A-Za-z]?|Article\s+\d+[A-Za-z]?)\b/gi

function extractByPattern(text: string, re: RegExp, type: EntityType): Entity[] {
  const matches: Entity[] = []
  for (const m of text.matchAll(re)) matches.push({ type, value: m[0] })
  return matches
}

/** Pure entity extraction over already-cleaned text. No AI, no I/O. */
export function extractEntities(text: string): Entity[] {
  text = text.slice(0, MAX_EXTRACTION_INPUT_CHARS)
  const entities: Entity[] = [
    ...extractByPattern(text, FILE_PATH_RE, "FILE_PATH"),
    ...extractByPattern(text, URL_RE, "URL"),
    ...extractByPattern(text, MEASUREMENT_RE, "MEASUREMENT"),
    ...extractByPattern(text, VERSION_RE, "VERSION"),
    ...extractByPattern(text, EMAIL_RE, "EMAIL"),
    ...extractByPattern(text, MONEY_AMOUNT_RE, "MONEY_AMOUNT"),
    ...extractByPattern(text, DEADLINE_DATE_RE, "DEADLINE_DATE"),
    ...extractByPattern(text, REGULATION_REF_RE, "REGULATION_REF"),
  ]
  for (const m of text.matchAll(CODE_REF_RE)) {
    if (!CODE_REF_STOPWORDS.has(m[0])) entities.push({ type: "CODE_REF", value: m[0] })
  }

  // De-duplicate by (type, value), preserving first-seen order -- same
  // discipline classifier.py's extract_document_entities() uses.
  const seen = new Set<string>()
  const unique: Entity[] = []
  for (const e of entities) {
    const key = `${e.type}::${e.value}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(e)
    }
  }
  return unique
}

const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

const NUMBER_NAME_HINTS = ["count", "amount", "qty", "quantity", "num", "number", "days", "percent", "pct"]
const DATE_NAME_HINTS = ["date", "deadline", "due", "expiry", "expires", "at", "on"]
const BOOLEAN_NAME_HINTS = ["is", "has", "should", "enabled", "flag", "active"]

function inferVariableType(name: string): VariableType {
  const lower = name.toLowerCase()
  if (BOOLEAN_NAME_HINTS.some((h) => lower === h || lower.startsWith(h))) return "boolean"
  if (NUMBER_NAME_HINTS.some((h) => lower.includes(h))) return "number"
  if (DATE_NAME_HINTS.some((h) => lower.includes(h))) return "date"
  return lower.length > 0 ? "string" : "unknown"
}

/**
 * engine-variable: identify `{{token}}` placeholders (the same
 * substitution convention prompt-eval-service.ts's renderTemplate() already
 * uses), infer a type from the variable's own name, and flag whether the
 * bare name also appears elsewhere in the text as plain content (a signal
 * the author may have meant a literal, not a binding). Pure, deterministic,
 * no defaults source -- callers with a real defaults map (e.g. a prompt
 * template's stored metadata) should pass it to resolveVariableDefaults().
 */
export function extractVariables(text: string): PromptVariable[] {
  text = text.slice(0, MAX_EXTRACTION_INPUT_CHARS)
  const seen = new Map<string, PromptVariable>()
  for (const m of text.matchAll(VARIABLE_TOKEN_RE)) {
    const name = m[1]
    if (seen.has(name)) continue
    const withoutTokens = text.replace(VARIABLE_TOKEN_RE, "")
    const boundElsewhere = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(withoutTokens)
    seen.set(name, { name, inferredType: inferVariableType(name), defaultValue: null, boundElsewhere })
  }
  return [...seen.values()]
}

/** Fills in `defaultValue` for any variable whose name is a key in `defaults`. */
export function resolveVariableDefaults(variables: PromptVariable[], defaults: Record<string, string>): PromptVariable[] {
  return variables.map((v) => (v.name in defaults ? { ...v, defaultValue: defaults[v.name] } : v))
}
