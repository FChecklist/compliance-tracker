/// <reference types="bun-types" />
// DOD-X5 live-network behavior, split from decision logic per W-GAP's
// flakiness finding -- see r75-citation-gate-ci-verify-logic.test.ts's
// header for the full story. This file is DELIBERATELY small: it exists
// only to prove the real I/O path (gh CLI invocation, repo resolution,
// the actual GitHub API) works end-to-end, not to re-exercise decision
// branches already covered exhaustively and fast in the logic file.
//
// Run in isolation, not in parallel with anything else on this machine --
// a busy machine slows real network/subprocess calls, which is expected
// and is exactly why this suite carries a generous timeout and is kept
// separate from anything timing-sensitive.
import { describe, test, expect, setDefaultTimeout } from "bun:test"
import { execFileSync } from "node:child_process"
import { checkCiVerified, REPO_OWNER_MAP } from "./r75-citation-gate.mjs"

setDefaultTimeout(30_000) // real network + a real gh subprocess per test

function ghReachable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const reachable = ghReachable()

describe.skipIf(!reachable)(`checkCiVerified: real gh api, real GitHub data${reachable ? "" : " (SKIPPED: gh not authenticated/reachable)"}`, () => {
  test("a real commit with a real, independently-confirmed successful CI run -- PASS, CI-verified", () => {
    // This exact sha's .github/workflows/ci.yml run was confirmed green via
    // `gh api repos/FChecklist/compliance-tracker/actions/runs?head_sha=...`
    // before writing this test -- a literal sha, not a relative ref, so it
    // can never silently drift to a different, unverified commit as this
    // branch gains commits.
    const citation = { requirement_id: "LIVE-CI-SUCCESS-TEST", repo: "compliance-tracker", commit_sha: "900b4255e248118e828041bccd94f8bcd8c6f54c" }
    const result = checkCiVerified(citation, ".")
    expect(result.verdict).toBe("PASS")
  })

  test("an unknown repo -- SKIP without ever reaching the network (repo resolution happens first)", () => {
    const citation = { requirement_id: "LIVE-UNKNOWN-REPO-TEST", repo: "not-a-real-repo-mapping", commit_sha: "0000000000000000000000000000000000dead" }
    const result = checkCiVerified(citation, ".")
    expect(result.verdict).toBe("SKIP")
  })
})

describe("REPO_OWNER_MAP sanity (no network, but lives here since it's DOD-X5-specific config, not general gate logic)", () => {
  test("both known repos map to their real FChecklist org", () => {
    expect(REPO_OWNER_MAP["compliance-tracker"]).toBe("FChecklist/compliance-tracker")
    expect(REPO_OWNER_MAP["projexa"]).toBe("FChecklist/projexa")
  })
})
