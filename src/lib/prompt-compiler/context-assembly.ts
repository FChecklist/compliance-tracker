// VERIDIAN_Architecture_v2.0 phase_2: pipeline-context-assembly (Layer 3,
// Stages 8-12), deepened. Ports scripts/prompt_gateway/engine/
// context_engine.py's RelevanceScorer (TF-IDF-like keyword overlap + 70/30
// recency-weighted combination) and ContextWindow (relevance-then-budget
// pruning) 1:1, then adds the business-context and user-context sources the
// gap analysis explicitly calls out as absent from the Python original
// (context_engine.py is session-history-only, no multi-source merge).
import type { AssembledContext, BusinessContext, ContextMessage, UserContext } from "./types"

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "shall", "can", "need", "dare", "ought", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where",
  "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very", "just", "because", "but", "and", "or", "if", "while", "about",
  "up", "down", "it", "its", "this", "that", "these", "those", "i", "me", "my", "myself", "we", "you", "your", "he",
  "she", "him", "her", "they", "them", "what", "which", "who", "am", "please", "thanks", "thank", "ok", "okay",
])

// Same real values as scripts/prompt_gateway/config.py's own constants --
// kept numerically identical so this port behaves the same as the Python
// original on the same input, not just structurally similar.
const CONTEXT_DECAY_FACTOR = 0.85
const CONTEXT_PRUNE_THRESHOLD = 0.3
const CONTEXT_MAX_MESSAGES = 20
const CONTEXT_MIN_MESSAGES = 5
const MAX_CONTEXT_TOKENS_ESTIMATE = 4000

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? []
  return words.filter((w) => !STOP_WORDS.has(w) && w.length > 1)
}

function termFrequency(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const total = tokens.length || 1
  const tf = new Map<string, number>()
  for (const [word, count] of counts) tf.set(word, count / total)
  return tf
}

function recencyScore(index: number, total: number, decayFactor = CONTEXT_DECAY_FACTOR): number {
  if (total <= 1) return 1.0
  const positionRatio = index / (total - 1)
  return decayFactor ** (1 - positionRatio)
}

/** Direct port of context_engine.py's RelevanceScorer.compute_relevance(). */
export function computeRelevance(message: string, currentQuery: string, messageIndex: number, totalMessages: number): number {
  const msgTokens = tokenize(message)
  const queryTokens = tokenize(currentQuery)

  if (queryTokens.length === 0 || msgTokens.length === 0) return recencyScore(messageIndex, totalMessages)

  const msgTf = termFrequency(msgTokens)
  const queryTf = termFrequency(queryTokens)
  const overlapWords = new Set(msgTokens.filter((t) => queryTf.has(t)))

  let overlapScore = 0
  for (const token of overlapWords) overlapScore += (msgTf.get(token) ?? 0) * (queryTf.get(token) ?? 0)
  overlapScore = Math.min(overlapScore, 1.0)

  const recency = recencyScore(messageIndex, totalMessages)
  return Math.round((overlapScore * 0.7 + recency * 0.3) * 10000) / 10000
}

function estimateTokens(text: string): number {
  const words = (text.match(/\b\w+\b/g) ?? []).length
  const special = (text.match(/[^\w\s]/g) ?? []).length
  return Math.round(words * 1.3 + special * 0.5)
}

export type PruneResult = { messages: ContextMessage[]; stats: AssembledContext["pruneStats"] }

/**
 * Direct port of context_engine.py's ContextWindow.prune(): score every
 * message by relevance to the current query, drop below-threshold messages
 * (never below min_messages), then trim oldest-first if still over the
 * token/message budget.
 */
export function pruneContext(
  messages: ContextMessage[],
  currentQuery: string,
  opts: { maxTokens?: number; maxMessages?: number; minMessages?: number; pruneThreshold?: number } = {}
): PruneResult {
  const maxTokens = opts.maxTokens ?? MAX_CONTEXT_TOKENS_ESTIMATE
  const maxMessages = opts.maxMessages ?? CONTEXT_MAX_MESSAGES
  const minMessages = opts.minMessages ?? CONTEXT_MIN_MESSAGES
  const pruneThreshold = opts.pruneThreshold ?? CONTEXT_PRUNE_THRESHOLD

  const tokensBefore = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (messages.length === 0) {
    return { messages: [], stats: { messagesBefore: 0, messagesAfter: 0, tokensBefore: 0, tokensAfter: 0, reductionPct: 0 } }
  }

  const total = messages.length
  const query = currentQuery || messages[messages.length - 1].content
  const scored = messages.map((msg, i) => ({ msg, score: computeRelevance(msg.content, query, i, total) }))
  scored.sort((a, b) => a.score - b.score)

  const toRemove = new Set<number>()
  let keepCount = total
  for (const { msg, score } of scored) {
    if (keepCount <= minMessages) break
    if (score < pruneThreshold) {
      const idx = messages.indexOf(msg)
      toRemove.add(idx)
      keepCount--
    }
  }

  let remaining = messages.filter((_, i) => !toRemove.has(i))

  let currentTokens = remaining.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  while (remaining.length > minMessages && currentTokens > maxTokens) {
    const removed = remaining.shift()!
    currentTokens -= estimateTokens(removed.content)
  }
  while (remaining.length > maxMessages) remaining.shift()

  const tokensAfter = remaining.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const reductionPct = Math.round((1 - tokensAfter / Math.max(tokensBefore, 1)) * 1000) / 10

  return {
    messages: remaining,
    stats: { messagesBefore: total, messagesAfter: remaining.length, tokensBefore, tokensAfter, reductionPct },
  }
}

const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/**
 * Template hydration -- same `{{token}}` substitution convention
 * prompt-eval-service.ts's renderTemplate() already establishes for prompt
 * content, exposed here so context assembly can hydrate a template with
 * business/user context values inline (Stage 12, "template hydration").
 */
export function hydrateTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(VARIABLE_TOKEN_RE, (match, name) => (name in variables ? variables[name] : match))
}

/**
 * Layer 3 orchestrator: merges business context + user context + pruned
 * session history + (optional) template hydration into one AssembledContext.
 * Pure given its inputs -- callers resolve `business`/`user` from real data
 * (org lookup, dbUser) before calling this; this module never queries the
 * database itself, keeping it unit-testable without a live DB (this
 * codebase's own .test.ts convention).
 */
export function assembleContext(input: {
  business: BusinessContext
  user: UserContext
  sessionMessages: ContextMessage[]
  currentQuery: string
  template?: string
  templateVariables?: Record<string, string>
}): AssembledContext {
  const { messages, stats } = pruneContext(input.sessionMessages, input.currentQuery)

  const templateVars: Record<string, string> = {
    ...(input.business.orgName ? { orgName: input.business.orgName } : {}),
    ...(input.business.country ? { country: input.business.country } : {}),
    ...(input.user.displayName ? { userName: input.user.displayName } : {}),
    ...input.templateVariables,
  }

  return {
    business: input.business,
    user: input.user,
    sessionMessages: messages,
    pruneStats: stats,
    hydratedTemplate: input.template ? hydrateTemplate(input.template, templateVars) : null,
  }
}
