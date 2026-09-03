#!/usr/bin/env node
// R67 Part B, item 1.7 (PART_B_STATUS.md "1.7 remaining" section) -- the CI
// wrapper around a self-healing SQL pair that is already applied and proven
// live (migration r67b_phase1_7_reconciling_rebuild):
//   - platform.graph_reconcile_platform_tier() deletes platform-tier
//     graph_node/graph_edge rows whose source no longer exists (a dropped
//     table, a dropped FK by constraint name, a removed
//     asset_registration_config entry). It ONLY ever touches tier='platform'
//     rows -- proven live, see PART_B_STATUS.md -- so it can never delete
//     real tenant (tier='instance') data.
//   - platform.graph_full_resync() runs reconcile (delete stale) THEN the
//     builders (add new), in that order, and returns one row per step with
//     a row_count.
//
// Same reasoning as scripts/generate-protected-routes.mjs's own header
// (written after 4 drift incidents there): the graph is DERIVED from the
// live schema (FK constraints, asset_registration_config), so on a clean
// system every step of a resync must return 0 rows changed. A non-zero
// row_count on a "supposedly stable" run means one of two things, both
// real:
//   1. The committed graph-builder logic (this repo's SQL) has drifted from
//      what the live schema actually looks like now, OR
//   2. Someone bypassed the builders and hand-edited graph_node/graph_edge
//      directly.
// Either way, this must be a loud, named CI failure -- not a silent stale
// catalogue that erodes trust in the graph the same way #0264 (see
// check-migration-schema-drift.mjs's own header) eroded trust in the
// migration ledger.
//
// WHAT THIS DOES NOT DO
// ----------------------
// - Does not diagnose WHICH schema change caused the drift -- that's a
//   human/agent investigation once this fails, same division of labour as
//   every other structural-drift check in this repo.
// - Does not run without a live DB connection -- same convention as
//   check-migration-schema-drift.mjs and check-migration-integrity.mjs: an
//   unreachable database is an infrastructure condition, not proof of
//   drift, so this warns and exits 0 rather than blocking every PR on prod
//   DB reachability.
// - graph_full_resync() is a real read+write call (it deletes stale rows,
//   then re-adds missing ones) -- not a pure read. It is idempotent by
//   design (ON CONFLICT DO NOTHING on the add side, existence-checked
//   deletes on the reconcile side), and every step is documented to return
//   0 rows changed when nothing has drifted -- proven live, see
//   PART_B_STATUS.md's 1.7 section. Running it in CI on every PR is exactly
//   how the self-healing half stays proven, not just asserted once.
//
// Usage: DATABASE_URL=... node scripts/verify-graph-drift.mjs
// Exit code 0 = no drift (or DB unavailable, warned), 1 = real drift found.

import { pathToFileURL } from "url"

export function summarizeDrift(rows) {
  // rows: [{ phase, step, row_count }, ...] from platform.graph_full_resync()
  const drifted = rows.filter((r) => Number(r.row_count) !== 0)
  const totalChanged = drifted.reduce((sum, r) => sum + Number(r.row_count), 0)
  return { drifted, totalChanged, clean: drifted.length === 0 }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("WARNING: DATABASE_URL not set -- skipping the graph-drift check.")
    process.exit(0)
  }

  let sql
  try {
    const postgres = (await import("postgres")).default
    sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5 })

    const rows = await sql`select phase, step, row_count from platform.graph_full_resync()`

    console.log(`Graph drift check: platform.graph_full_resync() ran ${rows.length} step(s).`)
    for (const r of rows) {
      console.log(`  - [${r.phase}] ${r.step}: row_count=${r.row_count}`)
    }

    const { drifted, totalChanged, clean } = summarizeDrift(rows)

    if (clean) {
      console.log("No drift found -- every reconcile/rebuild step returned 0 rows changed.")
      await sql.end({ timeout: 5 })
      process.exit(0)
    }

    console.error("\nERROR: graph drift found -- platform.graph_full_resync() changed rows on a run")
    console.error("expected to be a no-op. This means either the committed graph-builder logic and")
    console.error("the live schema have drifted apart, or graph_node/graph_edge were hand-edited")
    console.error("outside the builders:")
    for (const r of drifted) {
      console.error(`  - [${r.phase}] ${r.step}: row_count=${r.row_count} (expected 0)`)
    }
    console.error(`\n${totalChanged} row(s) changed across ${drifted.length} step(s).`)
    console.error("Investigate before merging -- see platform.graph_reconcile_platform_tier() and")
    console.error("the individual graph_build_* functions (PART_B_STATUS.md, R67 Part B item 1.7).")
    await sql.end({ timeout: 5 })
    process.exit(1)
  } catch (err) {
    console.warn(`WARNING: could not complete the graph-drift DB check (${err.message ?? err}).`)
    console.warn("Not failing CI on this -- an unreachable database is an infrastructure condition, not proof of drift.")
    try { await sql?.end({ timeout: 1 }) } catch { /* best-effort cleanup */ }
    process.exit(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
