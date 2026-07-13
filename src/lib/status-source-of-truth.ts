// PLATFORM_STRATEGY.md §31 (Boss directive 2026-07-13, second pass of the
// metadata/drift investigation): pain points #3/#7/#8 -- "% completed and %
// pending" and "what's open, what's closed, reviewed by, audited by" -- are
// each individually real today but scattered:
//   - ai-os/STATUS-REPORT.md exists but is explicitly point-in-time and
//     manually reconciled (its own header: a multi-hour domain-by-domain
//     Tree1-vs-Tree3 pass), already stale the day after it was built.
//   - ai-os/MASTER-TRACKER.yaml (open, real owner/blocker per item),
//     ai-os/boss/COMPLETED.yaml (closed, doer+auditor per AGENTS.md Rule
//     7(d)), and PR audit-verdict comments (audit-protocol.ts /
//     mandatory-audit-check.yml) together answer "what's open, what's
//     closed, reviewed by, audited by" -- but as three separate files with
//     no single queryable view.
//
// This module is a READ-ONLY, always-current companion, explicitly NOT a
// replacement for either file or for STATUS-REPORT.md's deeper periodic
// methodology (§31.3's own "what NOT to build" list). It parses
// MASTER-TRACKER.yaml's open_items and COMPLETED.yaml's entries and computes
// a shallow, item-count-based percentage -- a fundamentally different
// measurement than STATUS-REPORT.md's domain-level reconciliation. The two
// numbers are expected to differ; that is not a bug (see
// METHODOLOGY_DISCLAIMER below, surfaced by every consumer of this module).
//
// Shared by scripts/compute-status.ts (CLI) and
// src/app/api/ai/team/governance-health/route.ts (the `sourceOfTruth` field)
// so the counting/extraction logic exists in exactly one place, per the
// Boss's "not a new tracker file, reads the two existing ones" instruction.
//
// Reuses this repo's established js-yaml parsing pattern (see
// scripts/check-asset-registry-coverage.mjs / check-metadata-index-coverage.mjs):
// `import yaml from "js-yaml"`, `yaml.load(await readFile(...))`.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

export const MASTER_TRACKER_FILE = "ai-os/MASTER-TRACKER.yaml"
export const COMPLETED_FILE = "ai-os/boss/COMPLETED.yaml"

// The three open_items subcategories that represent real, actionable
// pending work. `ratified_do_not_build` is deliberately excluded -- those
// are final decisions NOT to build something, not pending work (see
// MASTER-TRACKER.yaml's own status-vocabulary header).
const PENDING_CATEGORIES = ["owner_blocked", "needs_owner_decision", "real_gaps_not_yet_built"] as const
export type PendingCategory = (typeof PENDING_CATEGORIES)[number]

export const METHODOLOGY_DISCLAIMER =
  "This is a SHALLOW, item-count-based figure (open_items count vs COMPLETED.yaml entries count), computed live on every call. " +
  "It is NOT the same methodology as ai-os/STATUS-REPORT.md's deeper, periodic, manually-reconciled domain-level Tree1-vs-Tree3 audit. " +
  "The two numbers measure different things and are expected to disagree -- that is by design, not a bug. " +
  "STATUS-REPORT.md remains the authoritative deep audit; this is its always-current, always-shallow companion."

type RawMasterTrackerItem = {
  id?: string
  name?: string
  detail?: string
  next_step?: string
  recommendation?: string
  size?: string
  [key: string]: unknown
}

type RawMasterTracker = {
  open_items?: {
    owner_blocked?: RawMasterTrackerItem[]
    needs_owner_decision?: RawMasterTrackerItem[]
    real_gaps_not_yet_built?: RawMasterTrackerItem[]
    ratified_do_not_build?: unknown[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

type RawCompletedEntry = {
  id?: string
  title?: string
  doer?: { agent?: string; date?: string; pr?: number | string; summary?: string }
  auditor?: { agent?: string; date?: string; verdict?: string; summary?: string }
  [key: string]: unknown
}

type RawCompleted = {
  entries?: RawCompletedEntry[]
  [key: string]: unknown
}

export type OpenItemSummary = {
  id: string | null
  name: string | null
  category: PendingCategory
  /** next_step (owner_blocked) / recommendation (needs_owner_decision, real_gaps_not_yet_built) -- falls back to `detail` when the category-specific field is absent. */
  owner_or_blocker: string | null
}

export type ClosedItemSummary = {
  id: string | null
  title: string | null
  doer: string | null
  auditor: string | null
  verdict: string | null
  date: string | null
}

export type StatusSourceOfTruth = {
  openCount: number
  closedCount: number
  percentComplete: number
  /** Open item count per subcategory -- owner_blocked / needs_owner_decision / real_gaps_not_yet_built only (ratified_do_not_build is tracked separately, see ratifiedExcludedCount). */
  openBreakdown: Record<PendingCategory, number>
  /** Count of ratified_do_not_build entries -- deliberately excluded from openCount/percentComplete, surfaced here so the exclusion is visible, not silent. */
  ratifiedExcludedCount: number
  openItems: OpenItemSummary[]
  closedItems: ClosedItemSummary[]
  methodology: string
}

function extractOwnerOrBlocker(item: RawMasterTrackerItem, category: PendingCategory): string | null {
  if (category === "owner_blocked") return item.next_step ?? item.detail ?? null
  if (category === "needs_owner_decision") return item.recommendation ?? item.detail ?? null
  return item.recommendation ?? item.detail ?? item.size ?? null // real_gaps_not_yet_built
}

/**
 * Pure computation over already-parsed MASTER-TRACKER.yaml / COMPLETED.yaml
 * objects. Kept separate from file I/O so it's directly unit-testable
 * against small fixtures, without touching disk.
 */
export function computeStatusSourceOfTruth(
  masterTracker: RawMasterTracker | null | undefined,
  completed: RawCompleted | null | undefined
): StatusSourceOfTruth {
  const openItemsRoot = masterTracker?.open_items ?? {}
  const openItems: OpenItemSummary[] = []
  const openBreakdown = {} as Record<PendingCategory, number>

  for (const category of PENDING_CATEGORIES) {
    const items = Array.isArray(openItemsRoot[category]) ? (openItemsRoot[category] as RawMasterTrackerItem[]) : []
    openBreakdown[category] = items.length
    for (const item of items) {
      openItems.push({
        id: item.id ?? null,
        name: item.name ?? null,
        category,
        owner_or_blocker: extractOwnerOrBlocker(item, category),
      })
    }
  }

  const ratifiedExcludedCount = Array.isArray(openItemsRoot.ratified_do_not_build)
    ? openItemsRoot.ratified_do_not_build.length
    : 0

  const entries = Array.isArray(completed?.entries) ? (completed!.entries as RawCompletedEntry[]) : []
  const closedItems: ClosedItemSummary[] = entries.map((entry) => ({
    id: entry.id ?? null,
    title: entry.title ?? null,
    doer: entry.doer?.agent ?? null,
    auditor: entry.auditor?.agent ?? null,
    verdict: entry.auditor?.verdict ?? null,
    date: entry.doer?.date ?? null,
  }))

  const openCount = openItems.length
  const closedCount = closedItems.length
  const denominator = openCount + closedCount
  const percentComplete = denominator === 0 ? 0 : (closedCount / denominator) * 100

  return {
    openCount,
    closedCount,
    percentComplete,
    openBreakdown,
    ratifiedExcludedCount,
    openItems,
    closedItems,
    methodology: METHODOLOGY_DISCLAIMER,
  }
}

export type LoadStatusOptions = {
  /** Repo root to resolve MASTER_TRACKER_FILE/COMPLETED_FILE against. Defaults to process.cwd(), which is the repo root for both `bun run scripts/compute-status.ts` and the Next.js server process. */
  repoRoot?: string
}

/**
 * Reads MASTER-TRACKER.yaml and COMPLETED.yaml from disk (read-only -- never
 * writes to either file) and computes the live status view. `lastComputed`
 * is stamped fresh on every call; nothing here is cached, so the result is
 * always current as of the moment it's requested.
 */
export async function loadStatusSourceOfTruth(
  options: LoadStatusOptions = {}
): Promise<StatusSourceOfTruth & { lastComputed: string }> {
  const repoRoot = options.repoRoot ?? process.cwd()

  const [masterTrackerRaw, completedRaw] = await Promise.all([
    readFile(path.resolve(repoRoot, MASTER_TRACKER_FILE), "utf8"),
    readFile(path.resolve(repoRoot, COMPLETED_FILE), "utf8"),
  ])

  const masterTracker = yaml.load(masterTrackerRaw) as RawMasterTracker
  const completed = yaml.load(completedRaw) as RawCompleted

  const computed = computeStatusSourceOfTruth(masterTracker, completed)

  return {
    ...computed,
    lastComputed: new Date().toISOString(),
  }
}
