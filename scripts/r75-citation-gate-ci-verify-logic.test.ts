/// <reference types="bun-types" />
// DOD-X5 decision logic, split from network I/O per W-GAP's finding
// (2026-09-10): the original single-file --verify-ci suite mixed these
// deterministic assertions with real gh api calls under one bun-test
// timeout budget, and came back flaky under machine load -- 9/10, then
// 5/10, then 2/10 across three re-runs, a different test failing each
// time. That is not "slow," it is unmeasured: a suite whose pass rate
// tracks machine load has not tested anything.
//
// This file tests decideCiVerdict() (r75-citation-gate.mjs) DIRECTLY,
// against ALREADY-FETCHED, recorded response shapes -- no gh api call, no
// subprocess spawn, no network of any kind. Every fixture below is
// modeled on a REAL response this program actually observed during PM-T30
// step 2 (2026-09-10), not invented -- see pm/PMT30_CI_BACKFILL_AUDIT_
// 2026-09-10T1435.md for the real commits these shapes came from.
//
// The live, real-network behavior (does gh api actually work, does the
// real repo/sha resolve) is tested separately and minimally in
// r75-citation-gate-ci-verify-live.test.ts. A red here always means the
// decision logic is wrong. A red there always means the network was slow.
// Those are not allowed to be the same color again.
import { describe, test, expect } from "bun:test"
import { decideCiVerdict } from "./r75-citation-gate.mjs"

const CITATION = { requirement_id: "LOGIC-TEST", commit_sha: "deadbeef", repo: "compliance-tracker" }
const GH_REPO = "FChecklist/compliance-tracker"

describe("decideCiVerdict: pure decision logic, recorded fixtures, zero network", () => {
  test("zero workflow runs of any kind -- FAIL, 'never actually run through CI'", () => {
    const fixture = { total_count: 0, workflow_runs: [] }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("FAIL")
    expect(result.detail).toContain("zero workflow runs")
  })

  test("REAL SHAPE (PM-T30 audit, sha b67b853f...): CI failed, an unrelated Sentinel governance check succeeded -- FAIL, not fooled by the Sentinel success", () => {
    const fixture = {
      total_count: 2,
      workflow_runs: [
        { id: 33936561078, name: "CI", path: ".github/workflows/ci.yml", conclusion: "failure" },
        { id: 33936561133, name: "Sentinel Governance Checks", path: ".github/workflows/sentinel.yml", conclusion: "success" },
      ],
    }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("FAIL")
    expect(result.detail).toContain("none concluded success")
    expect(result.detail).not.toContain("Sentinel Governance Checks succeeded") // must never read as a pass
  })

  test("only unrelated workflows ran, CI workflow itself never triggered -- FAIL, names the workflows that did run", () => {
    const fixture = {
      total_count: 1,
      workflow_runs: [{ id: 1, name: "Domain Ownership Drift Check", path: ".github/workflows/domain-drift-check.yml", conclusion: "failure" }],
    }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("FAIL")
    expect(result.detail).toContain("NONE are the actual test-running workflow")
    expect(result.detail).toContain("Domain Ownership Drift Check")
  })

  test("CI workflow ran and concluded success -- PASS, names the run id", () => {
    const fixture = { total_count: 1, workflow_runs: [{ id: 42, name: "CI", path: ".github/workflows/ci.yml", conclusion: "success" }] }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("PASS")
    expect(result.detail).toContain("42")
  })

  test("CI workflow ran but was cancelled, not success -- FAIL, distinct from zero-runs wording", () => {
    const fixture = { total_count: 1, workflow_runs: [{ id: 7, name: "CI", path: ".github/workflows/ci.yml", conclusion: "cancelled" }] }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("FAIL")
    expect(result.detail).toContain("cancelled")
    expect(result.detail).not.toContain("zero workflow runs") // must not conflate "ran but failed" with "never ran"
  })

  test("multiple CI runs, latest succeeds after an earlier failure -- PASS (any success in the set counts)", () => {
    const fixture = {
      total_count: 2,
      workflow_runs: [
        { id: 1, name: "CI", path: ".github/workflows/ci.yml", conclusion: "failure" },
        { id: 2, name: "CI", path: ".github/workflows/ci.yml", conclusion: "success" },
      ],
    }
    const result = decideCiVerdict(CITATION, GH_REPO, fixture)
    expect(result.verdict).toBe("PASS")
  })
})
