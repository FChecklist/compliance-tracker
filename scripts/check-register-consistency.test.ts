/// <reference types="bun-types" />
// Real automated test for check-register-consistency.mjs (pm-t1 brief, added
// 2026-09-12). Proves proof 1 (closure-state drift) and proof 4 (NA
// self-certification, literal spec) against the actual pure functions the
// CI job calls -- no mocked internals -- with a genuine plant-a-violation,
// confirm-it's-flagged, confirm-clean-state-passes red/green cycle for
// each, per this task's own falsifiability requirement. Proofs 2/3 need
// live network/git state (GitHub compare + Actions-log API) and are
// exercised directly against the real, live data in
// scripts/check-register-consistency.mjs's own header comment /
// platform.claude_log (author pm-t1) instead of here.
import { describe, test, expect } from "bun:test"
import {
  EXPECTED_CLOSURE_DRIFT_IDS,
  evaluateProof1,
  evaluateProof4,
  classifyCompareStatus,
  logContainsTestPath,
  resolveTestJobName,
  computeClosureDriftRows,
  computeC6TrueRows,
} from "./check-register-consistency.mjs"

describe("computeClosureDriftRows (proof 1 join helper)", () => {
  test("a CLOSED requirement with a FALSE component is drifted", () => {
    const requirements = [{ id: "R-1", closure_state: "CLOSED" }, { id: "R-2", closure_state: "CLOSED" }]
    const components = [
      { requirement_id: "R-1", state: "FALSE" },
      { requirement_id: "R-2", state: "TRUE" },
    ]
    expect(computeClosureDriftRows(requirements, components).map((r) => r.id)).toEqual(["R-1"])
  })
  test("a non-CLOSED requirement with a FALSE component is NOT drifted", () => {
    const requirements = [{ id: "R-1", closure_state: "OPEN" }]
    const components = [{ requirement_id: "R-1", state: "FALSE" }]
    expect(computeClosureDriftRows(requirements, components)).toEqual([])
  })
})

describe("computeC6TrueRows (proofs 2/3 join helper)", () => {
  test("returns the requirement row for a requirement with c6=TRUE", () => {
    const requirements = [{ id: "R-1", closure_repo: "compliance-tracker" }, { id: "R-2", closure_repo: "projexa" }]
    const components = [
      { requirement_id: "R-1", component: "c6", state: "TRUE" },
      { requirement_id: "R-2", component: "c6", state: "FALSE" },
    ]
    expect(computeC6TrueRows(requirements, components).map((r) => r.id)).toEqual(["R-1"])
  })
  test("ignores a TRUE component that isn't c6", () => {
    const requirements = [{ id: "R-1" }]
    const components = [{ requirement_id: "R-1", component: "c2", state: "TRUE" }]
    expect(computeC6TrueRows(requirements, components)).toEqual([])
  })
})

describe("evaluateProof1 (closure-state c1 vs c6 drift)", () => {
  test("GREEN: the current live set exactly matching EXPECTED_CLOSURE_DRIFT_IDS passes", () => {
    const rows = EXPECTED_CLOSURE_DRIFT_IDS.map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
  })

  test("RED: a NEW row drifting (not in the recorded expected set) is flagged, not silently accepted", () => {
    const rows = [...EXPECTED_CLOSURE_DRIFT_IDS, "R-99"].map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(false)
    expect(result.extra).toEqual(["R-99"])
    expect(result.missing).toEqual([])
  })

  test("RED: a row genuinely fixed (no longer drifting) also fails -- forces the literal array to be updated in the same PR, not silently accepted as a free win", () => {
    const fixedId = EXPECTED_CLOSURE_DRIFT_IDS[0]
    const rows = EXPECTED_CLOSURE_DRIFT_IDS.filter((id) => id !== fixedId).map((id) => ({ id }))
    const result = evaluateProof1(rows)
    expect(result.pass).toBe(false)
    expect(result.missing).toEqual([fixedId])
    expect(result.extra).toEqual([])
  })

  test("REGRESSION GUARD: this proof must never assert zero -- an empty live result is itself a mismatch against the known-red expected set, not a pass", () => {
    const result = evaluateProof1([])
    expect(result.pass).toBe(false)
    expect(result.missing.length).toBe(EXPECTED_CLOSURE_DRIFT_IDS.length)
  })
})

describe("evaluateProof4 (NA self-certification, literal spec)", () => {
  test("GREEN: na_ruling_id and verified_by in their real, distinct shapes never collide", () => {
    const rows = [
      { requirement_id: "R-A2", component: "c1", na_ruling_id: "R83-NA-R-A2-c1", verified_by: "W-VERIFY (local_2c4175a1-a6ca-4ad1-bded-d7fe9f9cd63d)" },
      { requirement_id: "R-A1", component: "c1", na_ruling_id: "R85-NA-R-A1-c1", verified_by: "claude-independent-verify-subagent (a8462e8f, separate from ruler claude-r85-p4)" },
    ]
    const result = evaluateProof4(rows)
    expect(result.pass).toBe(true)
    expect(result.violations).toEqual([])
  })

  test("RED: a planted literal self-certification (na_ruling_id === verified_by) IS flagged", () => {
    const rows = [
      { requirement_id: "R-A2", component: "c1", na_ruling_id: "R83-NA-R-A2-c1", verified_by: "W-VERIFY (local_2c4175a1-a6ca-4ad1-bded-d7fe9f9cd63d)" },
      { requirement_id: "R-ZZ", component: "c9", na_ruling_id: "SAME-ACTOR-STRING", verified_by: "SAME-ACTOR-STRING" },
    ]
    const result = evaluateProof4(rows)
    expect(result.pass).toBe(false)
    expect(result.violations).toEqual([
      { requirement_id: "R-ZZ", component: "c9", na_ruling_id: "SAME-ACTOR-STRING", verified_by: "SAME-ACTOR-STRING" },
    ])
  })

  test("rows with na_ruling_id null are never flagged (this predicate only applies to NA-ruled rows)", () => {
    const rows = [{ requirement_id: "R-1", component: "c1", na_ruling_id: null, verified_by: null }]
    expect(evaluateProof4(rows).pass).toBe(true)
  })
})

describe("classifyCompareStatus (proof 2 helper)", () => {
  test("'identical' and 'behind' are ancestors of main", () => {
    expect(classifyCompareStatus("identical")).toBe(true)
    expect(classifyCompareStatus("behind")).toBe(true)
  })
  test("'ahead', 'diverged', and null (404 / unresolved) are NOT ancestors of main", () => {
    expect(classifyCompareStatus("ahead")).toBe(false)
    expect(classifyCompareStatus("diverged")).toBe(false)
    expect(classifyCompareStatus(null)).toBe(false)
  })
})

describe("resolveTestJobName (proof 3 helper)", () => {
  test("finds the job literally named 'Unit Tests' or 'Test', ignoring position in the array", () => {
    const jobs = [{ name: "Migration Integrity Check", id: 1 }, { name: "Unit Tests", id: 2 }, { name: "Build", id: 3 }]
    expect(resolveTestJobName(jobs)).toBe(2)
  })
  test("returns null when no such job exists, rather than falling back to jobs[0] (the real R-C09-class gotcha)", () => {
    const jobs = [{ name: "Migration Integrity Check", id: 1 }, { name: "Build", id: 3 }]
    expect(resolveTestJobName(jobs)).toBe(null)
  })
})

describe("logContainsTestPath (proof 3 helper)", () => {
  test("matches a single closure_test_path substring in the log", () => {
    expect(logContainsTestPath("...src/lib/foo.test.ts: 3 pass...", "src/lib/foo.test.ts")).toBe(true)
  })
  test("multi-file closure_test_path (';'-separated) requires ALL of them present", () => {
    const log = "src/lib/crr/capture.test.ts: pass\nsrc/lib/crr/recall.test.ts: pass"
    expect(logContainsTestPath(log, "src/lib/crr/capture.test.ts; src/lib/crr/recall.test.ts")).toBe(true)
    expect(logContainsTestPath("src/lib/crr/capture.test.ts: pass", "src/lib/crr/capture.test.ts; src/lib/crr/recall.test.ts")).toBe(false)
  })
  test("a null log (fetch failure) never counts as a match", () => {
    expect(logContainsTestPath(null, "src/lib/foo.test.ts")).toBe(false)
  })
})
