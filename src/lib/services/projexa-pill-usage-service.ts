// R67 WS-A (A-07) -- the strip's ranking, and the one place its LABELS are
// decided.
//
// WHY THIS FILE EXISTS. GET /api/v1/projexa/pill-usage returned a bare
// `pillKey` per ranked entry and nothing else. That was survivable while the
// only keys in the table were the fourteen universal pill keys the client
// already knew by heart; it stops being survivable the moment leaf CARD ids
// are recorded ("work-progress.entry", "permits.new"), because a client that
// does not recognise a key has nothing to render but the key itself -- and a
// strip printing "work-progress.entry" at a site engineer is worse than a
// strip that is one card short.
//
// So the server now answers with a LABEL as well as a key. compliance.
// pill_usage.pill_key is free text (schema.ts) and derived_chain is jsonb, so
// this needs no migration: the leaf id goes in the key it already fits, and
// the words come from the chain the client recorded with it.
//
// *** THE RANKING IS A QUERY, NOT A STORED NUMBER *** and that is unchanged
// from R53: MP-RULE-3's rolling 7-day window is a predicate over last_used_at,
// and a cached rank goes stale the moment someone works. The three tiers --
// PINNED at any age, then inside the window by use_count, then OUTSIDE it by
// last-used-ever (MP-RISK-3, without which month-end work vanishes for three
// weeks) -- are exactly the tiers R53 shipped; this file only moves the
// ordering and labelling out of the route handler so both halves can be unit
// tested without a database, and adds the label.
//
// PER USER, never per org: one PM's ranking must never reorder another's
// strip. The unique key on pill_usage is (org_id, user_id, pill_key).

import { and, desc, eq, gte, lt, sql } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { chainHistory, pillUsage } from "@/lib/db/schema"

export const PILL_WINDOW_DAYS = 7

/** Which of the three tiers put an entry on the strip. Returned so a wrong
 *  order is diagnosable from the response alone, without a reproduction. */
export type PillTier = "pinned" | "window" | "last_used_ever"

/** The columns this service reads. Declared structurally so the pure
 *  functions below can be tested with plain object literals. */
export type PillUsageRow = {
  pillKey: string
  functionId: string | null
  derivedChain: unknown
  useCount: number
  pinned: boolean
  lastUsedAt: Date
}

export type RankedPillEntry = PillUsageRow & {
  /** A-07: the words the client renders. Never a raw key. */
  label: string
  tier: PillTier
}

/** The shape derive-chain.ts writes into pill_usage.derived_chain. */
type DerivedChainish = { full?: unknown; root?: unknown; steps?: unknown }

function stepsOf(derivedChain: unknown): string[] {
  if (!derivedChain || typeof derivedChain !== "object") return []
  const steps = (derivedChain as DerivedChainish).steps
  if (!Array.isArray(steps)) return []
  return steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
}

/**
 * A-07 -- THE WORDS FOR A RANKED ENTRY, in priority order:
 *
 *  1. THE CHAIN'S LAST STEP. The chain is what the user actually did
 *     ("Cedar Heights > Work Progress > Record progress"), and its last step
 *     is the leaf -- which is precisely the thing a leaf card id identifies.
 *  2. THE KEY ITSELF, when the key is already human. Every row R53 wrote used
 *     chain.steps[0] as the key, so "Work Progress" and "Budget" are keys AND
 *     labels; re-deriving those would be work that changes nothing.
 *  3. THE KEY, HUMANISED. A dotted or snake_cased id from a client this build
 *     does not know about still produces readable words rather than an id.
 *
 * It never returns an empty string: a blank card is indistinguishable from a
 * missing one, and the caller would have no way to tell which it had.
 */
export function labelForPillKey(pillKey: string, derivedChain?: unknown): string {
  const steps = stepsOf(derivedChain)
  if (steps.length > 0) return steps[steps.length - 1]

  const key = pillKey.trim()
  if (!key) return "Untitled"
  // Already human: it contains a space and no machine separator.
  if (/\s/.test(key) && !/[._]/.test(key)) return key

  const words = key
    .split(/[._\-\s]+/)
    .filter(Boolean)
    // An all-caps word is an acronym the product already uses in the UI --
    // WPR, BOQ, 3D. Title-casing those would produce "Wpr", which is not a
    // word anyone in construction has ever written.
    .map((w) =>
      w.length >= 2 && w === w.toUpperCase() && /[A-Z0-9]/.test(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
  return words.length > 0 ? words.join(" ") : key
}

/**
 * The three tiers, concatenated, deduplicated by key (a pinned pill that is
 * also inside the window must appear ONCE, at its pinned position), then cut
 * to the caller's limit. Pure, so the tier boundary can be asserted at the
 * exact millisecond rather than "around a week ago".
 */
export function rankPillEntries(input: {
  pinned: readonly PillUsageRow[]
  inWindow: readonly PillUsageRow[]
  outsideWindow: readonly PillUsageRow[]
  windowStart: Date
  limit: number
}): RankedPillEntry[] {
  const seen = new Set<string>()
  const out: RankedPillEntry[] = []
  for (const row of [...input.pinned, ...input.inWindow, ...input.outsideWindow]) {
    if (seen.has(row.pillKey)) continue
    seen.add(row.pillKey)
    out.push({
      ...row,
      label: labelForPillKey(row.pillKey, row.derivedChain),
      tier: row.pinned ? "pinned" : row.lastUsedAt >= input.windowStart ? "window" : "last_used_ever",
    })
    if (out.length >= input.limit) break
  }
  return out
}

/**
 * A-07 -- WHAT THE SERVER WILL ACCEPT AS A KEY. The column is free text, but
 * "free text" is not the same as "anything": a key is an identity that has to
 * survive a round trip and be matched against a client catalogue, so it is
 * bounded, trimmed, and rejected outright when it is empty or absurd rather
 * than being stored as a row nothing can ever rank or render.
 *
 * Returns null for a value the caller must reject with 400.
 */
export const MAX_PILL_KEY_LENGTH = 120

export function normaliseRecordedPillKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const key = raw.trim()
  if (key.length === 0 || key.length > MAX_PILL_KEY_LENGTH) return null
  // Control characters would make the key unprintable and un-diffable in a
  // response the client is expected to match against its own catalogue.
  if (/[\u0000-\u001f\u007f]/.test(key)) return null
  return key
}

/** The whole composer strip payload, read in ONE transaction. */
export type PillStripPayload = {
  pills: RankedPillEntry[]
  history: ChainHistoryEntry[]
  /** R67 A-08: the three "Do again" cards. See recentLeafChains(). */
  recentChains: RecentChainEntry[]
  windowDays: number
  /** True when the arrays are empty BECAUSE nothing is earned yet, which must
   *  not look identical on screen to a failed call (M24). */
  isNewUser: boolean
}

export type ChainHistoryEntry = {
  fullChain: string
  functionId: string | null
  mode: string | null
  projectId: string | null
  outcome: string
  pinned: boolean
  useCount: number
  lastUsedAt: Date
}

/** One "Do again" card: a whole chain the user really ran, recently. */
export type RecentChainEntry = {
  /** As stored: "Cedar Heights Villa - Phase 1 > Work Progress > Record progress". */
  fullChain: string
  /** The steps WITHOUT the root -- the strip already shows the project, and
   *  repeating it on the card would be the same word twice on one line. */
  label: string
  /** The chain's steps, so the client can restore the strip verbatim. */
  steps: string[]
  functionId: string | null
  projectId: string | null
  outcome: string
  useCount: number
  lastUsedAt: Date
}

/** chain_history stores the chain as TEXT (the UNIQUE index IS the dedup
 *  rule), joined by " > " in derive-chain.ts's buildChain(). */
export function splitChainText(fullChain: string): string[] {
  return fullChain
    .split(">")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * R67 A-08 -- THE "DO AGAIN" CARDS: the top three LEAF chains of the last
 * seven days.
 *
 * WHY LEAF CHAINS ONLY. M24 is explicit that history shows the WHOLE chain
 * and never a fragment -- "Import BOQ" alone is ambiguous. The inverse is
 * just as true for a repeat card: a chain that stops at the module ("Cedar
 * Heights > Permits") is not a thing anyone can do again, it is a place they
 * went. Only a chain that reaches a leaf names an action, so only those
 * become cards.
 *
 * WHY THE SEVEN-DAY WINDOW. This is "what I have been doing lately", not
 * "what I have ever done" -- the second is what the History tab is for, and
 * it has no window at all. Ordering is by use_count then recency, which is
 * MP-RULE-3's own ordering applied to chains instead of keys.
 *
 * FAILED CHAINS ARE KEPT, exactly as they are in the history list: the
 * commonest reason to re-run something is that it went wrong.
 */
export function recentLeafChains(
  rows: readonly ChainHistoryEntry[],
  options: { now: Date; windowDays?: number; limit?: number }
): RecentChainEntry[] {
  const windowDays = options.windowDays ?? PILL_WINDOW_DAYS
  const limit = options.limit ?? 3
  const windowStart = new Date(options.now.getTime() - windowDays * 86400000)

  return rows
    .map((row) => ({ row, steps: splitChainText(row.fullChain) }))
    // parts = root + at least one step + the leaf. Two parts is a module, not
    // an action.
    .filter(({ row, steps }) => steps.length >= 3 && row.lastUsedAt >= windowStart)
    .sort(
      (a, b) => b.row.useCount - a.row.useCount || b.row.lastUsedAt.getTime() - a.row.lastUsedAt.getTime()
    )
    .slice(0, limit)
    .map(({ row, steps }) => {
      const withoutRoot = steps.slice(1)
      return {
        fullChain: row.fullChain,
        label: withoutRoot.join(" > "),
        steps: withoutRoot,
        functionId: row.functionId,
        projectId: row.projectId,
        outcome: row.outcome,
        useCount: row.useCount,
        lastUsedAt: row.lastUsedAt,
      }
    })
}

/**
 * Reads this user's ranked strip and their chain history.
 *
 * ONE withTenantContext FOR ALL OF IT, deliberately. app_runtime's pool is
 * five connections and every withTenantContext() is its own transaction on
 * one of them (tenant-scoped.ts); splitting this read in two would double the
 * transaction count on the single call every screen in PROJEXA makes on
 * mount, which is exactly the N+1-transaction shape that made /scope an
 * eight-second page.
 */
export async function readPillStrip(input: {
  orgId: string
  userId: string
  limit: number
  historyLimit: number
  now?: Date
}): Promise<PillStripPayload> {
  const now = input.now ?? new Date()
  const windowStart = new Date(now.getTime() - PILL_WINDOW_DAYS * 86400000)

  return withTenantContext({ orgId: input.orgId }, async (db) => {
    const scope = and(eq(pillUsage.orgId, input.orgId), eq(pillUsage.userId, input.userId))

    const pinned = await db
      .select()
      .from(pillUsage)
      .where(and(scope, eq(pillUsage.pinned, true)))
      .orderBy(desc(pillUsage.lastUsedAt))

    const inWindow = await db
      .select()
      .from(pillUsage)
      .where(and(scope, eq(pillUsage.pinned, false), gte(pillUsage.lastUsedAt, windowStart)))
      .orderBy(desc(pillUsage.useCount), desc(pillUsage.lastUsedAt))
      .limit(input.limit)

    const outsideWindow = await db
      .select()
      .from(pillUsage)
      .where(and(scope, eq(pillUsage.pinned, false), lt(pillUsage.lastUsedAt, windowStart)))
      .orderBy(desc(pillUsage.lastUsedAt))
      .limit(input.limit)

    // M24: PINNED above a divider, then RECENT. FAILED chains are INCLUDED --
    // "the commonest reason to re-run something is that it went wrong."
    const history = await db
      .select()
      .from(chainHistory)
      .where(and(eq(chainHistory.orgId, input.orgId), eq(chainHistory.userId, input.userId)))
      .orderBy(desc(chainHistory.pinned), desc(chainHistory.lastUsedAt))
      .limit(input.historyLimit)

    const pills = rankPillEntries({ pinned, inWindow, outsideWindow, windowStart, limit: input.limit })
    const historyEntries: ChainHistoryEntry[] = history.map((h) => ({
      fullChain: h.fullChain,
      functionId: h.functionId,
      mode: h.mode,
      projectId: h.projectId,
      outcome: h.outcome,
      pinned: h.pinned,
      useCount: h.useCount,
      lastUsedAt: h.lastUsedAt,
    }))

    return {
      pills,
      history: historyEntries,
      // A-08: computed from the SAME rows the history list is built from, in
      // the same transaction. A second query for "the recent three" would be a
      // second thing that can disagree with the first.
      recentChains: recentLeafChains(historyEntries, { now }),
      windowDays: PILL_WINDOW_DAYS,
      isNewUser: pinned.length + inWindow.length + outsideWindow.length === 0,
    }
  })
}

/**
 * A-07 -- RECORDING A CARD CLICK. The composer used to keep its usage counts
 * in the browser's own localStorage, which meant the server ranked from rows
 * only the PIPELINE had ever written: a card the user clicked to NAVIGATE
 * (which is most of them -- a card opens a screen, it does not execute)
 * counted for nothing, so the strip could never learn what that user actually
 * does. This is the write path that closes it.
 *
 * UPSERT, never read-modify-write: the UNIQUE (org_id, user_id, pill_key)
 * index is what makes "increment the count" safe under concurrency, and it is
 * also M24's dedup rule -- clicking a card six times leaves ONE row.
 *
 * Recording is NOT running. Nothing here executes a function; the row is the
 * strip's memory and nothing more.
 */
export async function recordPillUse(input: {
  orgId: string
  userId: string
  pillKey: string
  functionId?: string | null
  derivedChain?: unknown
}): Promise<void> {
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db
      .insert(pillUsage)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        pillKey: input.pillKey,
        functionId: input.functionId ?? null,
        derivedChain: (input.derivedChain as object | undefined) ?? null,
        useCount: 1,
      })
      .onConflictDoUpdate({
        target: [pillUsage.orgId, pillUsage.userId, pillUsage.pillKey],
        set: {
          useCount: sql`${pillUsage.useCount} + 1`,
          lastUsedAt: new Date(),
          // A null chain from a bare navigation must not erase the richer
          // chain the pipeline recorded for the same key on an earlier run.
          ...(input.derivedChain ? { derivedChain: input.derivedChain as object } : {}),
          ...(input.functionId ? { functionId: input.functionId } : {}),
        },
      })
  )
}
