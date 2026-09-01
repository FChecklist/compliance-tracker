/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { selectRollbackCandidate, formatDeployment } from "./rollback-drill.mjs"

// Fixture shape matches Vercel's real /v6/deployments response, verified
// live against the actual project 2026-08-07 (see docs/runbooks/
// rollback.md) -- deployments newest-first, READY + isRollbackCandidate
// both present on eligible entries.
function dpl(overrides) {
  return {
    uid: "dpl_test",
    url: "example-meet-track-s-projects.vercel.app",
    state: "READY",
    isRollbackCandidate: true,
    created: 1000,
    meta: { githubCommitSha: "abcdef1234567890", githubCommitMessage: "Some commit\n\nbody" },
    ...overrides,
  }
}

describe("selectRollbackCandidate", () => {
  test("picks the newest READY+isRollbackCandidate deployment as current and the next as the candidate", () => {
    const deployments = [
      dpl({ uid: "dpl_1", created: 3000 }),
      dpl({ uid: "dpl_2", created: 2000 }),
      dpl({ uid: "dpl_3", created: 1000 }),
    ]
    const { current, candidate } = selectRollbackCandidate(deployments)
    expect(current.uid).toBe("dpl_1")
    expect(candidate.uid).toBe("dpl_2")
  })

  test("skips a BUILDING/ERROR deployment even if it's newest -- only READY entries are real rollback targets", () => {
    const deployments = [
      dpl({ uid: "dpl_building", state: "BUILDING", created: 4000 }),
      dpl({ uid: "dpl_error", state: "ERROR", created: 3000, isRollbackCandidate: false }),
      dpl({ uid: "dpl_ready_1", created: 2000 }),
      dpl({ uid: "dpl_ready_2", created: 1000 }),
    ]
    const { current, candidate } = selectRollbackCandidate(deployments)
    expect(current.uid).toBe("dpl_ready_1")
    expect(candidate.uid).toBe("dpl_ready_2")
  })

  test("returns null for both when there are no READY deployments", () => {
    const { current, candidate } = selectRollbackCandidate([dpl({ state: "ERROR", isRollbackCandidate: false })])
    expect(current).toBeNull()
    expect(candidate).toBeNull()
  })

  test("returns a null candidate (not a crash) when only one READY deployment exists -- day-one project, nothing to roll back to", () => {
    const { current, candidate } = selectRollbackCandidate([dpl({ uid: "dpl_only" })])
    expect(current.uid).toBe("dpl_only")
    expect(candidate).toBeNull()
  })
})

describe("formatDeployment", () => {
  test("renders '(none)' for a null deployment without throwing", () => {
    expect(formatDeployment(null)).toBe("  (none)")
  })

  test("includes the short commit sha and first line of the commit message", () => {
    const out = formatDeployment(dpl({ meta: { githubCommitSha: "0123456789abcdef", githubCommitMessage: "Fix thing\n\nlonger body" } }))
    expect(out).toContain("0123456")
    expect(out).toContain('"Fix thing"')
    expect(out).not.toContain("longer body")
  })
})
