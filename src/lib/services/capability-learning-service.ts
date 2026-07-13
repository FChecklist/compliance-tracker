// Priority 5 (10-priority5-software-orchestrator-tracker.yaml): the
// Software Orchestrator's capability-memory CRUD layer. Owns
// compliance.task_capabilities / instruction_packages -- the persisted
// state that makes "next time either software or the cheap model can do
// this" real instead of aspirational.
//
// Deliberately platform-wide (no withTenantContext) -- task_capabilities.
// orgId is nullable BY DESIGN (see schema.ts's own comment): capability
// LEARNING generalizes across every org, mirroring platform_assets' own
// mixed-tier posture and capability-registry-service.ts's precedent for
// the same class of entity-agnostic, cross-org table.
import { db, taskCapabilities, instructionPackages } from "@/lib/db"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type TaskCapability = typeof taskCapabilities.$inferSelect
export type InstructionPackage = typeof instructionPackages.$inferSelect
export type PackageType = "task_execution" | "dialogue_script"

// ─── Pure functions (unit tested, no DB) ───────────────────────────────────

// Deterministic slug derivation -- same (modePill, pathKeys) always yields
// the same capabilityKey, mirroring dynamicChains' own dedup-on-(modePill,
// pathKeys) convention (task-service.ts's resolveDynamicChainId()) so a
// capability and its originating Dynamic Chain stay recognizably linked.
export function deriveCapabilityKey(modePill: string, pathKeys: string[]): string {
  const parts = [modePill, ...pathKeys]
    .map((p) => p.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
  if (parts.length === 0) throw new ServiceError("modePill and at least one pathKey are required to derive a capabilityKey", 400)
  return parts.join(".")
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "did", "do", "does", "we", "i", "you", "it", "this", "that",
  "to", "of", "in", "on", "for", "and", "or", "have", "has", "had", "be", "been", "will", "would", "can", "could",
])

// Normalizes free text into the word-index array the "Did/We/File" example
// describes -- lowercase, strip punctuation, dedupe, drop stopwords (a
// stopword-only query like "did we" carries no matching signal; "file"/
// "gst"/"filed" does). Deliberately simple (no stemming) -- exact-token
// overlap is enough for the "match against previous prompts" use case this
// feeds, and stemming would need a real NLP dependency for marginal gain.
export function tokenizePrompt(text: string): string[] {
  if (!text?.trim()) return []
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  return Array.from(new Set(words))
}

// Jaccard-style overlap between two tokenized word sets -- the deterministic
// half of "match against previous prompts" (the semantic half is
// capability-registry-service.ts's findSimilarCapabilities(), used as a
// fallback by callers when this returns no strong match).
export function wordOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  const intersection = [...setA].filter((w) => setB.has(w)).length
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

export type CoverageStats = {
  total: number
  fullSoftwarePercent: number
  packageAvailablePercent: number
  novelPercent: number
}

// The X/Y/A/B aggregate reporting number -- computed from real rolling
// classification history, not a fabricated per-request fraction (see
// tracker's scope_decision for why per-request decomposition is out of
// scope this pass).
export function computeCoverageStats(fullSoftwareCount: number, packageAvailableCount: number, novelCount: number): CoverageStats {
  const total = fullSoftwareCount + packageAvailableCount + novelCount
  if (total === 0) return { total: 0, fullSoftwarePercent: 0, packageAvailablePercent: 0, novelPercent: 0 }
  return {
    total,
    fullSoftwarePercent: Math.round((fullSoftwareCount / total) * 100),
    packageAvailablePercent: Math.round((packageAvailableCount / total) * 100),
    novelPercent: Math.round((novelCount / total) * 100),
  }
}

// Priority 12 (OPEN-07 point 6): task_capabilities.status was a dead column
// -- schema default only, never read or written by any real code (confirmed
// by grep before writing this). This makes it a real, derived reflection of
// the SAME rolling counters computeCoverageStats() already aggregates,
// instead of a value someone would otherwise have to set by hand.
export type CapabilityStatus = "ai_only" | "partial" | "full_software"

// Below this many total observations, neither "overwhelmingly full-software"
// nor "still mostly novel" is a meaningful read yet -- status stays at the
// column's own 'ai_only' default. 5 is the smallest n where the two live
// percentage thresholds below (80/60) both land on a whole-vote boundary
// that can actually occur (4-of-5, 3-of-5) rather than a threshold no real
// split at that sample size could ever cross.
const MIN_OBSERVATIONS_FOR_STATUS = 5

// 'full_software' requires an OVERWHELMING majority of recent classifications
// needing zero AI reasoning, not a bare majority -- a capability that's
// "usually" full-software but still regularly needs AI is exactly the
// 'partial' case, not this one. 80% (4-in-5) tolerates one stray non-
// FULL_SOFTWARE classification at the sample floor without flipping back,
// but stops short of requiring literal unanimity (which would make the
// status brittle to any single one-off outlier forever).
const FULL_SOFTWARE_THRESHOLD_PERCENT = 80

// 'ai_only' (beyond the sample-floor case above) requires recent history to
// still be MOSTLY novel -- set above a bare 50% majority (60%) so a
// capability that has already crossed into "less than half novel" reads as
// 'partial' -- the more honest label once non-novel outcomes are becoming
// the norm -- rather than staying pinned at 'ai_only' until it separately
// clears the much higher FULL_SOFTWARE_THRESHOLD_PERCENT bar.
const AI_ONLY_THRESHOLD_PERCENT = 60

/**
 * Pure derivation of task_capabilities.status from the exact same counters
 * computeCoverageStats() reports on -- never a separately-tracked value.
 * Callers that mutate the counters (recordExecutionOutcome() below) must
 * recompute and write this in the SAME transaction as the counter update,
 * the same "can never drift out of sync with its source data" discipline
 * capability-tree-service.ts's markDeterministic() already follows for
 * CapabilityNode.deterministic -- applied here to a persisted column
 * instead of a value recomputed on every read.
 */
export function deriveCapabilityStatus(fullSoftwareCount: number, packageAvailableCount: number, novelCount: number): CapabilityStatus {
  const stats = computeCoverageStats(fullSoftwareCount, packageAvailableCount, novelCount)
  if (stats.total < MIN_OBSERVATIONS_FOR_STATUS) return "ai_only"
  if (stats.fullSoftwarePercent >= FULL_SOFTWARE_THRESHOLD_PERCENT) return "full_software"
  if (stats.novelPercent >= AI_ONLY_THRESHOLD_PERCENT) return "ai_only"
  return "partial"
}

// ─── DB-touching lookups/writes ────────────────────────────────────────────

export async function findCapabilityByKey(capabilityKey: string): Promise<TaskCapability | null> {
  const row = await db.query.taskCapabilities.findFirst({ where: eq(taskCapabilities.capabilityKey, capabilityKey) })
  return row ?? null
}

export async function findCapabilityById(capabilityId: string): Promise<TaskCapability | null> {
  const row = await db.query.taskCapabilities.findFirst({ where: eq(taskCapabilities.id, capabilityId) })
  return row ?? null
}

// find-or-create, same shape as task-service.ts's resolveDynamicChainId() --
// a capability is identified by (modePill, pathKeys) first; promptText is
// used only to seed/extend promptWordIndex, never to fork a new row for a
// differently-worded request against the same chain selection.
export async function findOrCreateCapability(input: { modePill: string; pathKeys: string[]; promptText?: string; orgId?: string | null }): Promise<TaskCapability> {
  const capabilityKey = deriveCapabilityKey(input.modePill, input.pathKeys)
  const existing = await findCapabilityByKey(capabilityKey)
  if (existing) {
    if (input.promptText) await extendPromptWordIndex(existing.id, input.promptText)
    return existing
  }

  const newWords = input.promptText ? tokenizePrompt(input.promptText) : []
  const [row] = await db
    .insert(taskCapabilities)
    .values({
      capabilityKey,
      modePill: input.modePill,
      pathKeys: input.pathKeys,
      promptWordIndex: newWords,
      orgId: input.orgId ?? null,
    })
    .onConflictDoNothing({ target: taskCapabilities.capabilityKey })
    .returning()

  // onConflictDoNothing races: another concurrent caller may have inserted
  // the same capabilityKey between our findCapabilityByKey() and this
  // insert -- if so, `row` is undefined and we re-fetch instead of
  // returning an incomplete result.
  if (row) return row
  const raceWinner = await findCapabilityByKey(capabilityKey)
  if (!raceWinner) throw new ServiceError(`Failed to find-or-create capability ${capabilityKey}`, 500)
  return raceWinner
}

// Merges new tokens into the existing word index without duplicates --
// called every time the same capability is invoked with different phrasing
// ("Have we filed GST?" / "GST filing done?"), so the index accumulates
// every real phrasing seen, not just the first one.
async function extendPromptWordIndex(capabilityId: string, promptText: string): Promise<void> {
  const newWords = tokenizePrompt(promptText)
  if (newWords.length === 0) return
  const existing = await findCapabilityById(capabilityId)
  if (!existing) return
  const existingWords = (existing.promptWordIndex as string[] | null) ?? []
  const merged = Array.from(new Set([...existingWords, ...newWords]))
  if (merged.length === existingWords.length) return // nothing new, skip the write
  await db.update(taskCapabilities).set({ promptWordIndex: merged, updatedAt: new Date() }).where(eq(taskCapabilities.id, capabilityId))
}

// Word-overlap fallback lookup for callers that only have free text (VERI
// Chat, before any Chain Selector step) -- not a replacement for
// capability-registry-service.ts's embedding search, a cheaper first pass
// callers can try before paying for a vector query.
export async function findCapabilityByPromptOverlap(promptText: string, minScore = 0.3): Promise<TaskCapability | null> {
  const queryWords = tokenizePrompt(promptText)
  if (queryWords.length === 0) return null

  const candidates = await db.query.taskCapabilities.findMany({
    where: sql`${taskCapabilities.promptWordIndex} IS NOT NULL AND jsonb_array_length(${taskCapabilities.promptWordIndex}) > 0`,
    limit: 200, // bounded scan -- a real ranked index (GIN, already migrated) backs this in practice; 200 is a sane ceiling for a fallback path, not the primary lookup
  })

  let best: { capability: TaskCapability; score: number } | null = null
  for (const c of candidates) {
    const score = wordOverlapScore(queryWords, (c.promptWordIndex as string[] | null) ?? [])
    if (score >= minScore && (!best || score > best.score)) best = { capability: c, score }
  }
  return best?.capability ?? null
}

export async function findApprovedPackage(capabilityId: string, packageType: PackageType): Promise<InstructionPackage | null> {
  const row = await db.query.instructionPackages.findFirst({
    where: and(eq(instructionPackages.capabilityId, capabilityId), eq(instructionPackages.packageType, packageType), eq(instructionPackages.status, "approved")),
    orderBy: (t, { desc }) => desc(t.version),
  })
  return row ?? null
}

export type ExecutionBucket = "FULL_SOFTWARE" | "PACKAGE_AVAILABLE" | "NOVEL"

const COUNTER_RETURNING = {
  fullSoftwareCount: taskCapabilities.fullSoftwareCount,
  packageAvailableCount: taskCapabilities.packageAvailableCount,
  novelCount: taskCapabilities.novelCount,
} as const

// The "software learning" write -- increments exactly one rolling counter
// plus occurrenceCount, never overwrites history. This is what feeds
// computeCoverageStats()'s aggregate reporting. Written as 3 explicit
// branches rather than a dynamic column-key lookup -- this counter is the
// load-bearing signal the whole learning loop depends on, worth the extra
// lines for certainty over a clever-but-riskier single code path.
//
// Wrapped in a db.transaction() (same pattern as prompt-os-service.ts's
// createPromptVersion()) so the counter increment and the derived-status
// write below happen atomically against the SAME row: Postgres holds the
// UPDATE's row lock for the life of the transaction, so a concurrent call
// for the same capabilityId blocks until this one commits (counters AND
// status together), then runs against the already-consistent row. That is
// what makes "status can never drift out of sync with the counters" true
// here, not just a comment -- see deriveCapabilityStatus()'s own doc for
// the markDeterministic() precedent this mirrors.
export async function recordExecutionOutcome(capabilityId: string, bucket: ExecutionBucket): Promise<void> {
  const common = { occurrenceCount: sql`${taskCapabilities.occurrenceCount} + 1`, updatedAt: new Date() }

  await db.transaction(async (tx) => {
    let updated: { fullSoftwareCount: number; packageAvailableCount: number; novelCount: number } | undefined

    if (bucket === "FULL_SOFTWARE") {
      ;[updated] = await tx.update(taskCapabilities).set({ ...common, fullSoftwareCount: sql`${taskCapabilities.fullSoftwareCount} + 1` }).where(eq(taskCapabilities.id, capabilityId)).returning(COUNTER_RETURNING)
    } else if (bucket === "PACKAGE_AVAILABLE") {
      ;[updated] = await tx.update(taskCapabilities).set({ ...common, packageAvailableCount: sql`${taskCapabilities.packageAvailableCount} + 1` }).where(eq(taskCapabilities.id, capabilityId)).returning(COUNTER_RETURNING)
    } else {
      ;[updated] = await tx.update(taskCapabilities).set({ ...common, novelCount: sql`${taskCapabilities.novelCount} + 1` }).where(eq(taskCapabilities.id, capabilityId)).returning(COUNTER_RETURNING)
    }

    if (!updated) return // capabilityId matched no row -- nothing to derive a status from either

    const status = deriveCapabilityStatus(updated.fullSoftwareCount, updated.packageAvailableCount, updated.novelCount)
    await tx.update(taskCapabilities).set({ status }).where(eq(taskCapabilities.id, capabilityId))
  })
}

// Records a package's real usage outcome -- successRate is a simple moving
// average over usageCount, not stored per-call (no separate log table this
// pass; usageCount + successRate is enough to flag a degrading package for
// the Auditor without a full execution-history table).
export async function recordPackageUsage(packageId: string, succeeded: boolean): Promise<void> {
  const pkg = await db.query.instructionPackages.findFirst({ where: eq(instructionPackages.id, packageId) })
  if (!pkg) throw new ServiceError(`No instruction package found for ${packageId}`, 404)

  const priorSuccesses = pkg.successRate !== null ? Math.round((pkg.successRate / 100) * pkg.usageCount) : 0
  const newUsageCount = pkg.usageCount + 1
  const newSuccesses = priorSuccesses + (succeeded ? 1 : 0)
  const newSuccessRate = Math.round((newSuccesses / newUsageCount) * 100)

  await db
    .update(instructionPackages)
    .set({ usageCount: newUsageCount, successRate: newSuccessRate, lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(instructionPackages.id, packageId))
}
