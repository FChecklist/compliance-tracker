/// <reference types="bun-types" />
// D58 falsification test for scripts/p2-6-post-apply-verify.mjs's own
// pass/fail logic. This is the "known-good state" half of D58's two-sided
// requirement -- the live-run half (today's real, broken backend genuinely
// exiting non-zero) was proven manually and reported to PM separately,
// since it needs the real DB and this file deliberately does not (pure
// function, no import of any DB-touching module, no network).
//
// Runs automatically in CI: bunfig.toml's [test] root = "src" does NOT
// cover scripts/, but .github/workflows/ci.yml's unit-tests job already
// runs `bun test --isolate ./scripts` as a second, explicit invocation
// (added for exactly this reason -- see that job's own R1-R64-recheck
// comment) -- no CI change needed for this file to be picked up.
import { describe, test, expect } from "bun:test"
import { allChecksOk } from "./p2-6-verify-lib.mjs"

describe("p2-6-post-apply-verify.mjs allChecksOk (D58 falsification)", () => {
  test("known-good state: every check ok -- must report true", () => {
    expect(
      allChecksOk({
        v2_insert: { ok: true, id: "x" },
        v2_update: { ok: true, novelCount: 1, occurrenceCount: 1 },
        v3_read: { ok: true, count: 0 },
      })
    ).toBe(true)
  })

  test("planted bad case: v2_update failed -- must report false, not true", () => {
    expect(
      allChecksOk({
        v2_insert: { ok: true, id: "x" },
        v2_update: { ok: false, error: "Invalid schema: platform" },
        v3_read: { ok: true, count: 0 },
      })
    ).toBe(false)
  })

  test("planted bad case: v3_read failed -- must report false even if v2 both passed", () => {
    expect(
      allChecksOk({
        v2_insert: { ok: true, id: "x" },
        v2_update: { ok: true, novelCount: 1, occurrenceCount: 1 },
        v3_read: { ok: false, error: "Invalid schema: platform" },
      })
    ).toBe(false)
  })

  test("planted bad case: v2_insert failed, downstream checks never ran -- must report false, not throw", () => {
    expect(
      allChecksOk({
        v2_insert: { ok: false, error: "Invalid schema: platform" },
        v2_update: { ok: false, error: "skipped: v2_insert failed" },
        v3_read: { ok: true, count: 0 },
      })
    ).toBe(false)
  })

  test("degenerate input (missing keys entirely) -- must report false, not throw", () => {
    expect(allChecksOk({})).toBe(false)
    expect(allChecksOk(undefined)).toBe(false)
  })
})
