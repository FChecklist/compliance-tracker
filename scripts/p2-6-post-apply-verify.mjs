#!/usr/bin/env bun
// S1a repair (2026-09-10, PM ruling 13:40/13:52 IST, D58). The ORIGINAL
// version of this file (committed 900b4255, header claimed "THIS SCRIPT
// FAILS TODAY, BY DESIGN") did not actually fail: it had no
// process.exit/exitCode logic at all, only console.log(JSON.stringify(...)),
// so it exited 0 regardless of its own ok:false payload. D44's "committed
// FAILING BY DESIGN" was therefore WRONG -- an instrument that cannot fail
// is not a regression test, it is a script that always reports success at
// the shell level no matter what it found. Found by W-ENV, confirmed by PM
// independently (grepped for process.exit/exitCode/an ok-aggregation --
// zero matches), corrected here rather than defended.
//
// THREE DEFECTS FIXED IN THIS FILE, all previously confirmed live:
// 1. No exit code -- fixed: allChecksOk() (./p2-6-verify-lib.mjs, split out
//    so it is importable without also running this file's live DB calls)
//    aggregates every check's `ok`, process.exit(allChecksOk(results) ? 0
//    : 1) at the end. allChecksOk has its own falsification test,
//    scripts/p2-6-post-apply-verify.test.ts (D58: an instrument's own
//    pass/fail logic must be shown to fail on a planted bad case AND pass
//    on a known-good case, not just exercised against today's one real,
//    currently-broken state).
// 2. Read-back used a HAND-TYPED capability key
//    ("p2_6_post_apply_verify_probe", underscore) that never matched
//    deriveCapabilityKey("p2_6_post_apply_verify", ["probe"])'s real output
//    ("p2_6_post_apply_verify.probe", dot-joined) -- so v2_update always
//    reported ok:true with every field undefined, proving nothing. Fixed by
//    re-fetching through the SAME public entry point (findOrCreateCapability
//    again, idempotent) instead of guessing a second, independently-derived
//    key.
// 3. Cleanup deleted the probe row via an inline supabase-js client with
//    db:{schema:"platform"} -- the EXACT broken PostgREST transport this
//    whole design exists to replace, so cleanup always failed too, and
//    every run leaked a permanent junk row into a table that held exactly 1
//    real row. Fixed by NOT creating a throwaway row at all: this script
//    now targets one permanent, idempotent sentinel capability (distinct
//    key from src/lib/services/capability-registry-live.test.ts's own
//    sentinel, so the two never share or corrupt each other's counters) and
//    every assertion on it is RELATIVE (after == before + 1), the same
//    accepted-tradeoff style already used elsewhere in this codebase for
//    this table's cumulative, self-healing counters. No delete primitive
//    exists or is planned for platform.task_capabilities (no real
//    production call site ever deletes a row) -- adding one solely to let a
//    verify script clean up after itself would be new privileged surface
//    with zero production justification, so this script stops needing one
//    instead.
//
// P2.6 post-apply verification (PM-directed, 2026-09-10, after PM applied
// drizzle/0577 + 0578 live via the Supabase MCP). Proves V2/V3 for real
// against the live database, not by assumption. NOT a bun:test file --
// deliberately touches the live DB, run once, by hand, or dispatched
// manually to compare before/after a PM-T23 fix lands.
import { findOrCreateCapability, recordExecutionOutcome } from "../src/lib/services/capability-learning-service.ts"
import { listImprovementProposals } from "../src/lib/services/capability-audit-service.ts"
import { allChecksOk } from "./p2-6-verify-lib.mjs"

const SENTINEL_MODE_PILL = "p2_6_post_apply_verify_script_sentinel"
const SENTINEL_PATH_KEYS = ["do_not_delete"]

const results = {}

try {
  const cap = await findOrCreateCapability({
    modePill: SENTINEL_MODE_PILL,
    pathKeys: SENTINEL_PATH_KEYS,
    orgId: null,
  })
  results.v2_insert = { ok: true, id: cap.id, capabilityKey: cap.capabilityKey, orgId: cap.orgId }
} catch (err) {
  results.v2_insert = { ok: false, error: err instanceof Error ? err.message : String(err) }
}

if (results.v2_insert.ok) {
  try {
    const before = await findOrCreateCapability({ modePill: SENTINEL_MODE_PILL, pathKeys: SENTINEL_PATH_KEYS, orgId: null })
    const beforeNovelCount = before.novelCount
    const beforeOccurrenceCount = before.occurrenceCount

    await recordExecutionOutcome(results.v2_insert.id, "NOVEL")

    // Re-fetch through the SAME public entry point (idempotent upsert hits
    // the "already exists" branch), not a second, independently-derived
    // key -- this is exactly defect (2) above, fixed.
    const after = await findOrCreateCapability({ modePill: SENTINEL_MODE_PILL, pathKeys: SENTINEL_PATH_KEYS, orgId: null })
    results.v2_update = {
      ok: after.id === results.v2_insert.id && after.novelCount === beforeNovelCount + 1 && after.occurrenceCount === beforeOccurrenceCount + 1,
      novelCount: after.novelCount,
      occurrenceCount: after.occurrenceCount,
      status: after.status,
    }
  } catch (err) {
    results.v2_update = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
} else {
  results.v2_update = { ok: false, error: "skipped: v2_insert failed" }
}

try {
  const proposals = await listImprovementProposals()
  results.v3_read = { ok: Array.isArray(proposals), count: proposals.length }
} catch (err) {
  results.v3_read = { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// No cleanup step -- see defect (3) above. The sentinel row is meant to
// persist and be reused by every future run.

console.log(JSON.stringify(results, null, 2))
const ok = allChecksOk(results)
console.log(ok ? "ALL CHECKS OK" : "AT LEAST ONE CHECK FAILED")
process.exit(ok ? 0 : 1)
