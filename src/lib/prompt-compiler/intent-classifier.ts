// VERIDIAN_Architecture_v2.0 phase_2: engine-intent, deepened to multi-level
// (primary/secondary/implicit) per the gap analysis' own requirement text.
// Ports scripts/prompt_gateway/engine/classifier.py's ChatClassifier
// (keyword-ratio + regex-pattern category scoring, 60/40 weighted) 1:1 --
// same categories, same scoring formula -- then adds the multi-level
// intent decomposition classifier.py's single extract_intent() never had.
import { CHAT_CATEGORIES, type ChatCategory, type Classification, type IntentLevel } from "./types"

// Mirrors config.py's CHAT_CATEGORIES keyword/pattern lists (same six
// categories, same keyword sets) -- kept here rather than importing Python
// config at build time, since this module must run with zero Python
// dependency in the Next.js/bun runtime.
const CATEGORY_KEYWORDS: Record<ChatCategory, string[]> = {
  CODE: ["code", "function", "bug", "script", "api", "class", "variable", "compile", "syntax", "repository", "commit", "typescript", "python", "javascript"],
  ANALYSIS: ["analyze", "review", "assess", "report", "metrics", "performance", "trend", "compare", "evaluate", "audit", "insight"],
  OPS: ["deploy", "server", "infrastructure", "docker", "kubernetes", "pipeline", "ci", "cd", "monitor", "restart", "provision", "database"],
  QUERY: ["what", "how", "why", "when", "where", "explain", "find", "search", "tell me", "show me"],
  TASK: ["task", "todo", "assign", "schedule", "track", "remind", "deadline", "plan", "milestone"],
  GENERAL: ["hello", "thanks", "help", "please", "chat", "talk"],
}

const CATEGORY_PATTERNS: Record<ChatCategory, RegExp[]> = {
  CODE: [/\bfix (the|this|a)\b.*\b(bug|error|issue)\b/i, /\bwrite (a|the)?\s*(function|script|class)\b/i],
  ANALYSIS: [/\banalyze\b.*\b(logs?|data|performance)\b/i, /\bwhat (do you think|is your assessment)\b/i],
  OPS: [/\bdeploy\b.*\b(to|on)\b.*\bproduction\b/i, /\bset\s?up\b.*\b(server|environment)\b/i],
  QUERY: [/^\s*(what|how|why|when|where)\b/i],
  TASK: [/\bcreate a task\b/i, /\bremind me\b/i],
  GENERAL: [/^\s*(hi|hello|hey)\b/i],
}

function tokenize(text: string): string[] {
  return text.match(/\b\w+\b/g) ?? []
}

/**
 * Category classification -- direct port of classifier.py's classify():
 * keyword-match ratio weighted 60%, any-pattern-match weighted 40%,
 * defaulting to GENERAL when the top score is below 0.05. Pure,
 * deterministic, zero AI calls (matches the Python original's own "zero
 * API calls, zero token usage" design).
 */
export function classify(text: string): Classification {
  const textLower = text.toLowerCase().trim()
  const scores: Record<string, number> = {}
  const allKeywords: string[] = []
  const allPatterns: string[] = []

  for (const cat of CHAT_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat]
    const patterns = CATEGORY_PATTERNS[cat]

    const keywordMatches = keywords.filter((kw) => textLower.includes(kw))
    for (const kw of keywordMatches) if (!allKeywords.includes(kw)) allKeywords.push(kw)
    const keywordScore = keywordMatches.length / Math.max(keywords.length, 1)

    let patternScore = 0
    for (const p of patterns) {
      if (p.test(text)) {
        patternScore = 0.5
        if (!allPatterns.includes(p.source)) allPatterns.push(p.source)
      }
    }

    scores[cat] = Math.round((keywordScore * 0.6 + patternScore * 0.4) * 10000) / 10000
  }

  let primary = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "GENERAL") as ChatCategory
  let confidence = scores[primary]

  if (confidence < 0.05) {
    primary = "GENERAL"
    confidence = 0.1
    scores.GENERAL = 0.1
  }

  return { category: primary, confidence: Math.round(confidence * 10000) / 10000, scores, keywordsFound: allKeywords, patternsMatched: allPatterns }
}

// Direct port of classifier.py's extract_intent() action-verb pattern map --
// this becomes the PRIMARY level below.
const INTENT_PATTERNS: [string, RegExp[]][] = [
  ["WRITE", [/\bwrite\b/, /\bcreate\b/, /\bgenerate\b/, /\bcompose\b/, /\bbuild\b/, /\bmake\b/]],
  ["FIX", [/\bfix\b/, /\bdebug\b/, /\bresolve\b/, /\brepair\b/, /\bcorrect\b/, /\bsolve\b/]],
  ["ANALYZE", [/\banalyze\b/, /\breview\b/, /\bassess\b/, /\bevaluate\b/, /\bexamine\b/]],
  ["DEPLOY", [/\bdeploy\b/, /\binstall\b/, /\bsetup\b/, /\bconfigure\b/, /\bset\s+up\b/]],
  ["QUERY", [/\bwhat\b/, /\bhow\b/, /\bwhy\b/, /\bfind\b/, /\bsearch\b/, /\bget\b/, /\btell\b/]],
  ["UPDATE", [/\bupdate\b/, /\bmodify\b/, /\bchange\b/, /\bedit\b/, /\balter\b/, /\badjust\b/]],
  ["DELETE", [/\bdelete\b/, /\bremove\b/, /\berase\b/, /\bclean\b/, /\bpurge\b/]],
  ["TEST", [/\btest\b/, /\brun\b/, /\bexecute\b/, /\bverify\b/, /\bvalidate\b/]],
  ["TASK", [/\btask\b/, /\btodo\b/, /\bassign\b/, /\bschedule\b/, /\btrack\b/]],
]

function firstIntentMatch(textLower: string): { intent: string; index: number } | null {
  let best: { intent: string; index: number } | null = null
  for (const [intent, patterns] of INTENT_PATTERNS) {
    for (const p of patterns) {
      const m = p.exec(textLower)
      if (m && (best === null || m.index < best.index)) best = { intent, index: m.index }
    }
  }
  return best
}

/**
 * Multi-level intent decomposition -- the real deepening of engine-intent
 * (single-level in classifier.py's original). PRIMARY is the first
 * action-verb signal found (same patterns as extract_intent()). SECONDARY
 * is a second, distinct action-verb signal found later in the text (a
 * compound instruction, e.g. "fix the bug AND write a test"). IMPLICIT is a
 * signal not expressed as an action verb at all: a bare question with no
 * matched verb implies QUERY; a sentence ending in only a noun phrase with
 * no verb match implies TASK (a reference/note, not an instruction).
 */
export function extractIntent(text: string): IntentLevel {
  const textLower = text.toLowerCase()

  const primaryMatch = firstIntentMatch(textLower)
  if (!primaryMatch) {
    const implicit = /\?\s*$/.test(text.trim()) ? "QUERY" : "TASK"
    return { primary: "UNKNOWN", secondary: null, implicit }
  }

  // Look for a second, distinct intent starting after the first match's verb.
  const remainder = textLower.slice(primaryMatch.index + 1)
  let secondary: string | null = null
  for (const [intent, patterns] of INTENT_PATTERNS) {
    if (intent === primaryMatch.intent) continue
    if (patterns.some((p) => p.test(remainder))) {
      secondary = intent
      break
    }
  }

  return { primary: primaryMatch.intent, secondary, implicit: null }
}
