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
//
// GAP-UNIFIED-SOT-REMAINDER slice (d), additive: `auditFindingsSummary`
// below is a pass/fail/pending rollup of compliance.audit_protocol_findings
// (drizzle/0175) -- a fourth, DB-backed source alongside the two YAML files
// this module already reads, folded into the same "always-current
// companion" view rather than a second endpoint. Same discipline as every
// other field here: additive only, computed live, never replaces
// STATUS-REPORT.md or the two tracker files. The DB read is isolated in
// loadAuditFindingsSummary() and fails soft (never throws) -- a
// not-yet-applied migration or unset DATABASE_URL must not break every
// existing caller of loadStatusSourceOfTruth() (governance-health route),
// which worked fine before this table existed.
import { readFile } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"
import { db, auditProtocolFindings } from "@/lib/db"

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

export type AuditFindingsSummary = {
  pass: number
  fail: number
  /** Rows whose `verdict` column is missing or not literally "pass"/"fail" -- kept visible rather than silently folded into either bucket. */
  pending: number
  total: number
  /** Non-null only when the DB read itself failed (e.g. compliance.audit_protocol_findings' migration, drizzle/0175, hasn't been applied to this environment yet, or DATABASE_URL isn't configured) -- a query failure is reported here, not silently reported as zero counts with no explanation. */
  unavailableReason: string | null
}

// Deliberately UNCHANGED by the auditFindingsSummary addition below --
// computeStatusSourceOfTruth() is a pure function over the two YAML files
// only, and its existing unit tests assert against exactly this shape.
// auditFindingsSummary is layered on afterward, only on
// loadStatusSourceOfTruth()'s return type (see
// StatusSourceOfTruthWithAuditFindings below) -- additive, not a rewrite of
// this type or the pure function that produces it.
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

/** Additive (GAP-UNIFIED-SOT-REMAINDER slice d) -- pass/fail/pending rollup of compliance.audit_protocol_findings, a DB-backed companion to the two YAML-derived fields above, not a replacement for either. */
export type StatusSourceOfTruthWithAuditFindings = StatusSourceOfTruth & {
  auditFindingsSummary: AuditFindingsSummary
}

/**
 * Pure computation over already-fetched audit_protocol_findings rows --
 * mirrors computeStatusSourceOfTruth()'s own discipline (separate the pure
 * counting logic from file/DB I/O so it's directly unit-testable against a
 * small fixture, no live DB needed).
 */
export function computeAuditFindingsSummary(rows: Array<{ verdict: string | null }>): AuditFindingsSummary {
  let pass = 0
  let fail = 0
  let pending = 0
  for (const row of rows) {
    const verdict = (row.verdict ?? "").trim().toLowerCase()
    if (verdict === "pass") pass++
    else if (verdict === "fail") fail++
    else pending++
  }
  return { pass, fail, pending, total: rows.length, unavailableReason: null }
}

/**
 * I/O wrapper around computeAuditFindingsSummary() -- queries
 * compliance.audit_protocol_findings and fails SOFT, never throws. A query
 * failure (migration not yet applied, DATABASE_URL unset/unreachable) is
 * reported via unavailableReason with all counts at 0, not silently
 * swallowed and not allowed to break loadStatusSourceOfTruth()'s existing
 * callers (the governance-health route worked before this table existed and
 * must keep working while the migration is still pending live-DB
 * application -- see drizzle/0175_audit_protocol_findings.sql's header).
 */
async function loadAuditFindingsSummary(): Promise<AuditFindingsSummary> {
  try {
    const rows = await db.select({ verdict: auditProtocolFindings.verdict }).from(auditProtocolFindings)
    return computeAuditFindingsSummary(rows)
  } catch (err) {
    return {
      pass: 0,
      fail: 0,
      pending: 0,
      total: 0,
      unavailableReason: `audit_protocol_findings query failed (likely migration drizzle/0175 not yet applied, or DATABASE_URL not configured): ${err instanceof Error ? err.message : String(err)}`,
    }
  }
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
): Promise<StatusSourceOfTruthWithAuditFindings & { lastComputed: string }> {
  const repoRoot = options.repoRoot ?? process.cwd()

  const [masterTrackerRaw, completedRaw, auditFindingsSummary] = await Promise.all([
    readFile(path.resolve(repoRoot, MASTER_TRACKER_FILE), "utf8"),
    readFile(path.resolve(repoRoot, COMPLETED_FILE), "utf8"),
    // Additive (GAP-UNIFIED-SOT-REMAINDER slice d) -- see
    // loadAuditFindingsSummary()'s own header for why this never throws and
    // never blocks the two existing YAML reads above.
    loadAuditFindingsSummary(),
  ])

  const masterTracker = yaml.load(masterTrackerRaw) as RawMasterTracker
  const completed = yaml.load(completedRaw) as RawCompleted

  const computed = computeStatusSourceOfTruth(masterTracker, completed)

  return {
    ...computed,
    auditFindingsSummary,
    lastComputed: new Date().toISOString(),
  }
}
