/// <reference types="bun-types" />
// D43 regression guard for the anti-fabrication citation gate
// (scripts/r75-citation-gate.mjs). "The file exists on disk" and "the file
// is tracked in git" are different claims, and only the gate's check (c)
// proves the second one -- a citation could otherwise point at a real local
// file that was never actually committed/shared/reviewable.
//
// CORRECTION 2026-09-10 13:28 IST: this test originally used R-81 (VERIDIAN
// AI chat, closed 2026-09-05 citing src/components/veri-chat/veri-chat-context.test.ts)
// as its motivating "real, never-tracked" example. That was WRONG -- the
// citation's own closure_repo field says "projexa", the path IS tracked
// there, the cited commit/sha both resolve there, and the cited test passes
// (10/0). Every session that investigated R-81, including the one that
// wrote this file, checked compliance-tracker only. Using a synthetic path
// below instead of R-81's real one, precisely so this file can never again
// be read as evidence about R-81 specifically -- the mechanism it tests
// (git ls-files correctly rejects a genuinely untracked path) is sound and
// still worth guarding; the specific case it was originally modeled on
// wasn't fabricated after all.
//
// This spawns the real script as a subprocess against the real repo (this
// worktree) rather than importing/mocking its internals, because the bug
// class being guarded against is specifically about what git itself
// reports -- a unit test against extracted pure functions would not have
// caught the original gap (fs.existsSync doesn't know what git tracks).
import { describe, test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "..") // this worktree, standing in for compliance-tracker
const GATE = path.join(REPO_ROOT, "scripts", "r75-citation-gate.mjs")

// A second, real, independent repo on this machine -- used to prove D57's
// multi-repo behavior against something genuine, not a synthetic double.
const PROJEXA_ROOT = "C:/ct/projexa"

// A real, tracked, currently-passing test file in this repo, used as the
// known-good control so the new check (c) doesn't regress legitimate
// citations. This file and its containing commit are both real.
const REAL_TRACKED_TEST = "scripts/check-migration-integrity.test.ts"

// A real, tracked, currently-passing test file that exists ONLY in
// C:/ct/projexa, not in this repo at all -- the exact shape of R-81's real
// citation (repo says projexa; checking ct alone finds nothing).
const PROJEXA_ONLY_TEST = "src/lib/currency-fallback-env.test.ts"

function headSha(root = REPO_ROOT) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
}

function runGate(citation, extraArgs = ["--repo-root", REPO_ROOT]) {
  const tmpFile = path.join(os.tmpdir(), `citation-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(tmpFile, JSON.stringify(citation))
  try {
    const out = execFileSync("node", [GATE, tmpFile, ...extraArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    return { exitCode: 0, output: out }
  } catch (e) {
    return { exitCode: e.status ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") }
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
}

describe("D43: git-tracked check (c-tracked-in-git)", () => {
  test("a citation naming a path that has NEVER been tracked in this repo -- REJECTS (synthetic fixture, not R-81 -- see file header)", () => {
    const neverTrackedPath = "src/lib/__fixtures/this-path-was-never-committed.test.ts"
    const citation = {
      requirement_id: "SYNTHETIC-NEVER-TRACKED-TEST",
      test_path: neverTrackedPath,
      commit_sha: headSha(),
      how_broken: "would fail if the assertion this fake path claims to make were ever falsified",
    }
    const { exitCode, output } = runGate(citation)
    expect(exitCode).toBe(1)
    expect(output).toContain("FAIL | c-tracked-in-git")
    expect(output).toContain("REJECTED")
    // confirm the fixture itself really is untracked, so this test can't
    // silently pass for the wrong reason
    expect(() =>
      execFileSync("git", ["ls-files", "--error-unmatch", neverTrackedPath], { cwd: REPO_ROOT, stdio: "ignore" })
    ).toThrow()
  })

  test("an untracked file that is genuinely present on disk and would pass if run still REJECTS -- 'exists on disk' is not evidence", () => {
    const scratchRelPath = `scripts/__scratch_untracked_${Date.now()}.test.ts`
    const scratchAbsPath = path.join(REPO_ROOT, scratchRelPath)
    fs.writeFileSync(
      scratchAbsPath,
      `import { test, expect } from "bun:test"\ntest("trivially passes", () => { expect(1).toBe(1) })\n`
    )
    try {
      // confirm the fixture is genuinely untracked before asserting on it
      expect(() =>
        execFileSync("git", ["ls-files", "--error-unmatch", scratchRelPath], { cwd: REPO_ROOT, stdio: "ignore" })
      ).toThrow()

      const citation = {
        requirement_id: "D43-UNTRACKED-ON-DISK-TEST",
        test_path: scratchRelPath,
        commit_sha: headSha(),
        how_broken: "would fail if the trivial assertion were flipped to expect(1).toBe(2)",
      }
      const { exitCode, output } = runGate(citation)
      expect(exitCode).toBe(1)
      expect(output).toContain("FAIL | c-tracked-in-git")
      // sanity: the old (b) check can't see this either, since the path
      // was never part of any commit -- both checks should independently FAIL
      expect(output).toContain("FAIL | b-path-at-commit")
    } finally {
      fs.rmSync(scratchAbsPath, { force: true })
    }
  })

  test("a real, currently-tracked, currently-passing citation still ACCEPTS -- the new check doesn't break legitimate evidence", () => {
    const citation = {
      requirement_id: "D43-CONTROL-REAL-CITATION-TEST",
      test_path: REAL_TRACKED_TEST,
      commit_sha: headSha(),
      how_broken:
        "would fail if reconcile() stopped treating a CRLF/LF-only difference as non-drift, per the E-102 scenario this test proves",
    }
    const { exitCode, output } = runGate(citation)
    expect(exitCode).toBe(0)
    expect(output).toContain("PASS | c-tracked-in-git")
    expect(output).toContain("ACCEPTED")
  })

  test("check (c) fires independently of (a)/(b) -- a fabricated sha with a real tracked path still shows its own FAIL line for (c) evidence, not just a skip", () => {
    const citation = {
      requirement_id: "D43-FABRICATED-SHA-TEST",
      test_path: REAL_TRACKED_TEST,
      commit_sha: "0000000000000000000000000000000000dead",
      how_broken: "would fail if reconcile() stopped treating a CRLF/LF-only difference as non-drift",
    }
    const { exitCode, output } = runGate(citation)
    expect(exitCode).toBe(1)
    expect(output).toContain("FAIL | a-commit-exists")
    // path IS tracked at HEAD even though the cited sha is fake -- (c) is
    // about the index at HEAD, not about the (already-failing) cited sha
    expect(output).toContain("PASS | c-tracked-in-git")
  })
})

describe("D57: repo resolution must come from the citation, never a silent cwd default", () => {
  test("no --repo-root / --repo-roots at all -- refuses to run, exit 2, does not guess a repo", () => {
    const citation = {
      requirement_id: "D57-NO-REPO-GIVEN-TEST",
      test_path: REAL_TRACKED_TEST,
      commit_sha: headSha(),
      how_broken: "irrelevant -- should never reach this check",
    }
    const { exitCode, output } = runGate(citation, [])
    expect(exitCode).toBe(2)
    expect(output).toContain("will NOT default to the current directory")
  })

  test("a citation naming a repo it isn't checked against -- REJECTS with 'not found here', explicitly NOT worded as fabrication, and names the declared repo", () => {
    // the exact shape of R-81's real citation: repo says projexa, but only
    // ct (this worktree) is checked -- must fail loud and correctly-worded,
    // not silently or as a fabrication claim
    const citation = {
      requirement_id: "D57-WRONG-REPO-CHECKED-TEST",
      repo: "projexa",
      test_path: PROJEXA_ONLY_TEST,
      commit_sha: headSha(PROJEXA_ROOT),
      how_broken: "would fail if the currency fallback silently defaulted to a hardcoded symbol again",
    }
    const { exitCode, output } = runGate(citation, ["--repo-root", REPO_ROOT])
    expect(exitCode).toBe(1)
    // "fabricat*" legitimately appears in the softening language itself
    // ("not proof of fabrication by itself", "not proven fabricated") --
    // what must NOT appear is a bare accusatory verdict
    expect(output).not.toMatch(/is fabricated|verdict.*fabricat/i)
    expect(output).toContain("NOT FOUND HERE, not proven fabricated")
    expect(output).toContain('declares repo "projexa"')
  })

  test("the SAME citation, checked with the repo it actually names included via --repo-roots -- ACCEPTS. Proves the fix is checking the right repo, not that R-81-shaped citations are unprovable", () => {
    const citation = {
      requirement_id: "D57-CORRECT-REPO-INCLUDED-TEST",
      repo: "projexa",
      test_path: PROJEXA_ONLY_TEST,
      commit_sha: headSha(PROJEXA_ROOT),
      how_broken: "would fail if the currency fallback silently defaulted to a hardcoded symbol again",
    }
    const { exitCode, output } = runGate(citation, ["--repo-roots", `${REPO_ROOT},${PROJEXA_ROOT}`])
    expect(exitCode).toBe(0)
    expect(output).toContain("ACCEPTED")
    expect(output).toContain(PROJEXA_ROOT)
  })
})

describe("DOD-X5: --verify-ci checks GitHub Actions, not just local", () => {
  test("without --verify-ci, behavior is byte-identical to before -- opt-in never breaks the existing local-only workflow", () => {
    const citation = {
      requirement_id: "DOD-X5-NO-FLAG-TEST",
      repo: "compliance-tracker",
      test_path: REAL_TRACKED_TEST,
      commit_sha: headSha(),
      how_broken: "would fail if reconcile() stopped treating a CRLF/LF-only difference as non-drift",
    }
    const { exitCode, output } = runGate(citation)
    expect(exitCode).toBe(0)
    expect(output).not.toContain("f-ci-verified") // check never runs unless asked
  })

  test("--verify-ci against a real commit with a real, known-successful CI run -- ACCEPTS, CI-verified", () => {
    // A real commit, independently confirmed via `gh api actions/runs?
    // head_sha=...` before writing this test to have its ACTUAL
    // .github/workflows/ci.yml run conclude success (not merely some other
    // workflow -- see the CI_WORKFLOW_PATH fix in r75-citation-gate.mjs,
    // added specifically because several nearby commits looked
    // superficially "verified" by a passing Sentinel Governance Checks run
    // while their own real CI run was cancelled or failed). A literal sha,
    // not a HEAD~N relative ref -- this branch keeps gaining commits, so a
    // relative ref would silently drift to a different, unverified commit
    // on every future run. This exact sha's ci.yml run was independently
    // confirmed green before writing this test.
    const realShaWithKnownCiHistory = "900b4255e248118e828041bccd94f8bcd8c6f54c"
    const citation = {
      requirement_id: "DOD-X5-REAL-CI-SUCCESS-TEST",
      repo: "compliance-tracker",
      test_path: REAL_TRACKED_TEST,
      commit_sha: realShaWithKnownCiHistory,
      how_broken: "would fail if reconcile() stopped treating a CRLF/LF-only difference as non-drift",
    }
    const { exitCode, output } = runGate(citation, ["--repo-root", REPO_ROOT, "--verify-ci"])
    expect(exitCode).toBe(0)
    expect(output).toContain("PASS | f-ci-verified")
    expect(output).toContain("CI-verified")
  })

  test("--verify-ci with a repo not in REPO_OWNER_MAP -- SKIPS the CI check, does not fail the citation over it", () => {
    const citation = {
      requirement_id: "DOD-X5-UNKNOWN-REPO-TEST",
      repo: "some-repo-not-in-the-map",
      test_path: REAL_TRACKED_TEST,
      commit_sha: headSha(),
      how_broken: "would fail if reconcile() stopped treating a CRLF/LF-only difference as non-drift",
    }
    const { exitCode, output } = runGate(citation, ["--repo-root", REPO_ROOT, "--verify-ci"])
    expect(exitCode).toBe(0) // SKIP must not block an otherwise-valid local citation
    expect(output).toContain("SKIP | f-ci-verified")
  })
})
