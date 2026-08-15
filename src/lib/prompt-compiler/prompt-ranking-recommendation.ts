// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-ranking +
// engine-prompt-recommendation, both not_implemented (no prompt scoring/
// ranking or usage-pattern recommendation existed anywhere). Both are pure
// functions over metrics callers already have real sources for --
// compliance.prompt_eval_runs (Wave 94, prompt-eval-service.ts's
// listEvalRuns) for quality/cost/latency, and promptVersions.createdAt for
// freshness -- no new metrics store.
export type PromptVersionMetrics = {
  promptVersionId: string
  passRate: number // prompt_eval_runs.passed, aggregated 0-1
  avgCostUsd: number | null // prompt_eval_runs.estimatedCostUsd, averaged
  avgLatencyMs: number | null // prompt_eval_runs.latencyMs, averaged
  createdAt: Date
}

export type RankedPromptVersion = { promptVersionId: string; score: number; breakdown: Record<string, number> }

const RANKING_WEIGHTS = { quality: 0.4, cost: 0.2, latency: 0.2, freshness: 0.2 }

// Costs/latencies above these are treated as "as bad as it gets" for
// normalization purposes -- keeps one pathological outlier from dominating
// every other candidate's relative score.
const COST_CEILING_USD = 0.5
const LATENCY_CEILING_MS = 10_000
const FRESHNESS_HALF_LIFE_DAYS = 30

function normalizeInverse(value: number | null, ceiling: number): number {
  if (value === null) return 0.5 // unknown -- neutral, neither rewarded nor punished
  return Math.max(0, 1 - Math.min(value, ceiling) / ceiling)
}

function freshnessScore(createdAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
  return 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS)
}

/**
 * engine-prompt-ranking: "best-prompt selection via weighted scoring across
 * quality/cost/latency/freshness" -- the requirement's own four named
 * dimensions, each normalized to [0,1] then combined with fixed weights.
 * `now` is caller-supplied (this module has no clock of its own -- pure,
 * deterministic given its inputs).
 */
export function rankPromptVersions(metrics: PromptVersionMetrics[], now: Date): RankedPromptVersion[] {
  return metrics
    .map((m) => {
      const breakdown = {
        quality: m.passRate,
        cost: normalizeInverse(m.avgCostUsd, COST_CEILING_USD),
        latency: normalizeInverse(m.avgLatencyMs, LATENCY_CEILING_MS),
        freshness: freshnessScore(m.createdAt, now),
      }
      const score =
        breakdown.quality * RANKING_WEIGHTS.quality +
        breakdown.cost * RANKING_WEIGHTS.cost +
        breakdown.latency * RANKING_WEIGHTS.latency +
        breakdown.freshness * RANKING_WEIGHTS.freshness
      return { promptVersionId: m.promptVersionId, score: Math.round(score * 10000) / 10000, breakdown }
    })
    .sort((a, b) => b.score - a.score)
}

export type TemplateUsage = { templateKey: string; runCount: number; passRate: number }
export type SimilarTemplate = { templateKey: string; similarityScore: number }

export type Recommendation = { templateKey: string; reason: string; strength: number }

/**
 * engine-prompt-recommendation: "suggest related prompts/templates/
 * optimizations based on usage patterns" -- combines real usage counts
 * (from prompt_eval_runs, aggregated per template by the caller) with real
 * similarity matches (prompt-similarity.ts's findSimilarPromptVersionsFor,
 * mapped from promptVersionId back to templateKey by the caller) rather
 * than inventing a third data source.
 */
export function recommendRelatedTemplates(
  currentTemplateKey: string,
  usage: TemplateUsage[],
  similar: SimilarTemplate[]
): Recommendation[] {
  const recs: Recommendation[] = []

  for (const s of similar) {
    if (s.templateKey === currentTemplateKey) continue
    recs.push({ templateKey: s.templateKey, reason: "semantically similar compiled prompt", strength: s.similarityScore })
  }

  const totalRuns = usage.reduce((sum, u) => sum + u.runCount, 0) || 1
  for (const u of usage) {
    if (u.templateKey === currentTemplateKey) continue
    if (u.passRate < 0.5) continue // don't recommend a template with a poor track record
    const popularity = u.runCount / totalRuns
    if (popularity < 0.05) continue // negligible usage -- not a real pattern
    recs.push({ templateKey: u.templateKey, reason: `frequently used alongside this template (${u.runCount} runs, ${Math.round(u.passRate * 100)}% pass rate)`, strength: popularity })
  }

  // Merge duplicate templateKey entries (recommended by both signals),
  // keeping the stronger reason and summed strength, then sort descending.
  const merged = new Map<string, Recommendation>()
  for (const r of recs) {
    const existing = merged.get(r.templateKey)
    if (!existing || r.strength > existing.strength) merged.set(r.templateKey, r)
  }
  return [...merged.values()].sort((a, b) => b.strength - a.strength)
}
