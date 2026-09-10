/// <reference types="bun-types" />
// PM-T24 (2026-09-10): the ONLY test in this repo that drives the
// capability-registry write path over a REAL database connection. Every
// other capability-audit/-learning test is pure-function-only, by this
// codebase's own documented convention -- see capability-audit-service.
// test.ts's own header: "DB/LLM-touching functions ... are not tested
// here, matching this codebase's established convention." That convention
// is exactly why the transport regression this file exists to catch
// (bfb1fcb8/9b7a596b moved capability-audit-service.ts's and
// capability-learning-service.ts's platform-wide writes from the
// app_runtime drizzle connection, direct Postgres, onto a supabase-js
// client that PostgREST refuses to route to the `platform` schema --
// see service-role-client.ts's own header and PM-T23) shipped with 78/78
// tests green: nothing exercised the real client, so nothing could fail.
//
// GUARD: src/lib/db/test-guard-preload.ts (loaded via bunfig.toml's [test]
// preload, ahead of every test file including this one) refuses to run at
// all unless DATABASE_URL and APP_RUNTIME_DATABASE_URL both point at
// localhost or this repo's known dev/test Supabase project
// (pcrjmlpuqsbocqfwoxod). This file never runs against an unknown database
// -- if that guard ever fails, the whole test run aborts before this file's
// own tests get a chance to touch anything.
//
// FIXTURE STRATEGY, deliberately NOT create-then-delete: platform.
// task_capabilities has no delete primitive reachable by app_runtime, not
// even before 0577 (no policy or grant ever covered DELETE for this role),
// and PM-T23's redesign (whichever option lands) does not add one either --
// no real production call site ever deletes a row from this table, so
// adding a delete-only function purely to let a test clean up after itself
// would be new privileged surface with zero production justification. This
// file instead reuses ONE permanent, idempotent sentinel row
// (capabilityKey "pm_t24_real_socket_test_sentinel.do_not_delete") via
// findOrCreateCapability's own ON CONFLICT DO NOTHING upsert, and every
// assertion is RELATIVE (after == before + 1), never an absolute value --
// the same accepted-tradeoff style capability-learning-service.ts's own
// comments already use for this table's cumulative, self-healing counters
// (not tenant data, not money, safe to leave running forever in CI).
//
// EXPECTED STATE AT THE TIME THIS FILE WAS COMMITTED (2026-09-10, PM-T23
// still open), when run against a REAL DATABASE_URL (see the CI GAP note
// below for what happens without one): both tests FAIL, on purpose, for the
// same reason scripts/p2-6-post-apply-verify.mjs is committed failing
// (D44) -- the underlying write/read path throws "Invalid schema:
// platform" before either assertion is reached. Verified manually against
// the real dev project (pcrjmlpuqsbocqfwoxod) before this commit. This file
// is the regression test for PM-T23's fix, whichever option lands: once
// that fix repoints findOrCreateCapability/recordExecutionOutcome/
// listImprovementProposals off the broken service-role/PostgREST client,
// these tests should flip to passing with NO CHANGE to this file, since it
// only calls those functions' existing public signatures.
import { describe, test, expect } from "bun:test"
import { findOrCreateCapability, recordExecutionOutcome } from "./capability-learning-service"
import { listImprovementProposals } from "./capability-audit-service"

const SENTINEL_MODE_PILL = "pm_t24_real_socket_test_sentinel"
const SENTINEL_PATH_KEYS = ["do_not_delete"]

// CI GAP (2026-09-10, not fixed by this file -- an owner/PM CI-wiring
// decision, see this file's own module header): .github/workflows/ci.yml's
// unit-tests job runs `bun test --isolate` with DATABASE_URL/
// APP_RUNTIME_DATABASE_URL hardcoded to the literal string
// "postgresql://.../placeholder@localhost:5432/postgres" -- nothing is
// listening there, by design, since every OTHER test in this repo is
// pure-function-only and never dereferences that value. Without this guard,
// this file's two tests would ECONNREFUSED/timeout against that
// placeholder on every PR in the whole repo, forever, proving nothing about
// the actual PM-T23 regression -- a strictly worse failure than skipping.
// Detects the SAME literal "placeholder" substring ci.yml's own build job
// already uses for the identical purpose (see that job's DATABASE_URL/
// NEXT_PUBLIC_SUPABASE_URL values) rather than inventing a new convention.
// Runs for real: locally (via .env.local, copied into a worktree) and in
// any environment where DATABASE_URL is a real connection string -- CI,
// once wired with one, needs no change to this file to start actually
// running these tests.
const HAS_REAL_DATABASE = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL?.includes("placeholder")

describe.skipIf(!HAS_REAL_DATABASE)("capability registry, real socket (PM-T24)", () => {
  test("findOrCreateCapability + recordExecutionOutcome round-trip through the real registry write path", async () => {
    const before = await findOrCreateCapability({
      modePill: SENTINEL_MODE_PILL,
      pathKeys: SENTINEL_PATH_KEYS,
      orgId: null,
    })
    expect(before.id).toBeTruthy()
    expect(before.orgId).toBeNull() // this row is platform-wide by construction -- the exact write 0577 restricts to non-app_runtime roles

    const beforeNovelCount = before.novelCount
    const beforeOccurrenceCount = before.occurrenceCount

    await recordExecutionOutcome(before.id, "NOVEL")

    // Re-fetch through the same public entry point (idempotent upsert hits
    // the "already exists" branch and does a fresh read) rather than a
    // second, separate read function -- proves the SAME code path used by
    // every real caller actually observes its own write.
    const after = await findOrCreateCapability({
      modePill: SENTINEL_MODE_PILL,
      pathKeys: SENTINEL_PATH_KEYS,
      orgId: null,
    })

    expect(after.id).toBe(before.id) // same sentinel row, not a duplicate
    expect(after.novelCount).toBe(beforeNovelCount + 1)
    expect(after.occurrenceCount).toBe(beforeOccurrenceCount + 1)
  })

  test("listImprovementProposals reads through the real registry read path without throwing", async () => {
    const proposals = await listImprovementProposals()
    expect(Array.isArray(proposals)).toBe(true)
  })
})
