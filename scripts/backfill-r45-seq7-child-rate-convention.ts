// R45 seq 7 fixup (verify-pass finding #2) -- backfills pre-existing child
// BOQ line items into line with the canonical F2/F3 child-rate convention
// construction-boq-service.ts's insertLineItems()/
// deriveLineItemQuantityAndRate() now enforces at write time (platform.
// sumeet_spec row BOQ-10, "Sample Scope with Sub Task.xlsx", CONFIRMED):
//   F2  RATE_child   = RATE_root x (breakdownPercentage / 100)
//   F3  QTY_child    = QTY_root
//   F4  AMOUNT_child = QTY_child x RATE_child
//
// Scope, re-verified live via Supabase MCP 2026-08-24 (root-ancestor
// resolution via parent_line_item_id -- confirmed only one level of nesting
// exists in the live table, so a direct parent join is a correct root
// resolution, no recursive walk needed):
//   503 total child rows / 287 already match F2/F3 / 216 mismatch, of which:
//     - 198 are e2e test noise -- demo-gate-smoke.spec.ts (and its R45 seq6
//       predecessor) submitting quantity:1/rate:1 for weighted sub-tasks
//       against real production, pre-dating this write-path fix. Same
//       family as the already-accepted "R-B1 smoke" leaked rows (see that
//       spec's own header comment) -- harmless, and this repo's own P-11
//       protocol (same header comment) forbids a raw-SQL cleanup of
//       test-created rows anyway, so they are deliberately EXCLUDED below,
//       not backfilled.
//     - 18 are real, pre-existing DEMO-ORG data: org_id='projexa_demo_org'
//       ("Skyline Builders (PROJEXA Demo)", boq "Sumeet Sample Scope" --
//       named after the very customer spec this rule derives from) and
//       org_id='ve45lczmkodbiq1m20fy48r5' ("Demo Organization", boq
//       "R-71 Post-Deploy Retest") -- both confirmed demo tenants via
//       compliance.organisations, not live paying-customer production.
//       Created 2026-08-23/24, hours to a day before this PR's own commit,
//       i.e. entered before the write-path fix existed. Neither BOQ id nor
//       any of these 18 row ids is referenced by any e2e fixture or test
//       assertion (grepped the repo) -- nothing depends on their current,
//       wrong values. THESE are what this script corrects.
//
// SAFETY: defaults to --dry-run (no writes), matching
// scripts/backfill-platform-assets.ts's established shape -- pure
// computation functions below are independently unit tested in
// backfill-r45-seq7-child-rate-convention.test.ts. The e2e-noise exclusion
// filter only ever WIDENS what's left alone, never what gets corrected, so
// a future legitimate quantity=1/rate=1 child is never silently touched by
// this one-off pass.
//
// Run: `bun run scripts/backfill-r45-seq7-child-rate-convention.ts` (dry
// run) or `--execute` to write. Reads DATABASE_URL the same way `bun run
// dev` does.
//
// ACTUAL EXECUTION RECORD (2026-08-24, R45 seq 7 fixup): this worktree had
// no DATABASE_URL configured to run this file directly via `bun run`, so
// the fix was applied by hand-executing the identical predicate/formula
// this script implements (selectBackfillTargets / computeCanonicalChildValues,
// unit tested in the sibling .test.ts) via the Supabase MCP against project
// pcrjmlpuqsbocqfwoxod -- the same live-DB channel this repo's own AGENTS.md
// grants to this session ("Super Boss ... run live DB migrations via the
// Supabase MCP"), not a divergent ad-hoc query. Real result: 18 rows
// targeted, 18 updated, 0 failed. Pre-update: 503 total child rows / 287
// matching / 216 mismatching (198 e2e smoke noise + 18 real). Immediately
// post-update: 0 real (non-smoke-noise) mismatches remained. This script
// stays committed so a future run with DATABASE_URL available reproduces
// the identical, reviewable result via `bun run ... --execute` rather than
// requiring another one-off MCP query.
import { db, constructionBoqLineItems } from "../src/lib/db"
import { eq } from "drizzle-orm"

const EXECUTE = process.argv.includes("--execute")

export type RootRow = { quantity: string; rate: string }
export type ChildRow = { quantity: string; rate: string; breakdownPercentage: string | null }

/**
 * Pure F2/F3/F4 computation -- mirrors construction-boq-service.ts's
 * deriveLineItemQuantityAndRate exactly (same formula, different input
 * shape: this operates on already-persisted DB rows looked up by
 * parent_line_item_id, rather than an in-flight insert batch keyed by
 * itemCode). Do not reintroduce a third convention -- if the formula ever
 * changes, change deriveLineItemQuantityAndRate first and port the change
 * here.
 */
export function computeCanonicalChildValues(child: ChildRow, root: RootRow): { quantity: number; rate: number; amount: number } {
  if (child.breakdownPercentage == null) {
    throw new Error("breakdownPercentage is null on a row with a parent_line_item_id set -- a real data-integrity issue, not something this backfill should silently paper over")
  }
  const quantity = Number(root.quantity)
  const rate = Number(root.rate) * (Number(child.breakdownPercentage) / 100)
  return { quantity, rate, amount: quantity * rate }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** True when a child row's stored quantity/rate already match F2/F3 (4-decimal tolerance, matching the numeric column precision already in play). */
export function alreadyMatchesCanonicalRate(child: ChildRow, root: RootRow): boolean {
  const expected = computeCanonicalChildValues(child, root)
  return round4(Number(child.rate)) === round4(expected.rate) && round4(Number(child.quantity)) === round4(expected.quantity)
}

/**
 * The e2e-smoke-noise exclusion: quantity=1 AND rate=1 is the exact pre-fix
 * payload demo-gate-smoke.spec.ts submits for weighted sub-tasks (see
 * e2e/demo-gate-smoke.spec.ts's TC-10/TC-30 line-item literals) -- not this
 * backfill's job to touch, see header comment above.
 */
export function isE2eSmokeNoise(child: ChildRow): boolean {
  return Number(child.quantity) === 1 && Number(child.rate) === 1
}

type LineItemRow = typeof constructionBoqLineItems.$inferSelect

/** Pure targeting logic (unit tested) -- which rows this backfill would touch, given the full in-memory set of line items. Exported so the test file can exercise it without a live DB. */
export function selectBackfillTargets(allItems: LineItemRow[]): LineItemRow[] {
  const byId = new Map(allItems.map((i) => [i.id, i]))
  return allItems.filter((c) => {
    if (!c.parentLineItemId) return false
    const root = byId.get(c.parentLineItemId)
    if (!root) return false // orphaned parent ref -- a different, real data-integrity issue; not this script's job to fix
    if (isE2eSmokeNoise(c)) return false
    return !alreadyMatchesCanonicalRate(
      { quantity: c.quantity, rate: c.rate, breakdownPercentage: c.breakdownPercentage },
      { quantity: root.quantity, rate: root.rate }
    )
  })
}

async function main() {
  console.log(EXECUTE ? "Running LIVE (writes will happen)." : "Running in --dry-run mode (no writes). Pass --execute to actually update.")

  const allItems = await db.query.constructionBoqLineItems.findMany()
  const byId = new Map(allItems.map((i) => [i.id, i]))
  const targets = selectBackfillTargets(allItems)

  console.log(`${targets.length} row(s) need backfill (out of ${allItems.length} total line items, ${allItems.filter((i) => i.parentLineItemId).length} of them children).`)

  let updated = 0
  let failed = 0
  for (const c of targets) {
    const root = byId.get(c.parentLineItemId!)!
    const { quantity, rate, amount } = computeCanonicalChildValues(
      { quantity: c.quantity, rate: c.rate, breakdownPercentage: c.breakdownPercentage },
      { quantity: root.quantity, rate: root.rate }
    )
    const label = `${c.id} (org=${c.orgId} boq=${c.boqId} "${c.description}")`
    console.log(`${EXECUTE ? "" : "[dry-run] would "}update ${label}: qty ${c.quantity}->${quantity}, rate ${c.rate}->${rate}, amount ${c.amount}->${amount}`)

    if (!EXECUTE) {
      updated++
      continue
    }
    try {
      await db.update(constructionBoqLineItems).set({
        quantity: String(quantity),
        rate: String(rate),
        amount: String(amount),
      }).where(eq(constructionBoqLineItems.id, c.id))
      updated++
    } catch (err) {
      console.error(`FAILED to update ${label}:`, err)
      failed++
    }
  }

  console.log(`\n--- Backfill summary --- targets=${targets.length} updated=${updated} failed=${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

// import.meta.main (Bun's supported entrypoint check), same convention as
// backfill-platform-assets.ts -- the pure functions above need to be
// importable by the .test.ts file without triggering a live DB connection.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
}
