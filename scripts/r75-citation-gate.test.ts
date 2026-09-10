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
import { describe, test, expect, setDefaultTimeout } from "bun:test"

// This whole file's tests spawn a real subprocess per test (the gate CLI
// itself, and one of them nests a full second `bun test` invocation inside
// that). No network, but subprocess-spawn latency is itself variable under
// machine load -- exactly the same shape of problem W-GAP found in the
// (now-split-out) DOD-X5 network suite, just with a process spawn instead
// of a socket. Every test here is homogeneously "spawns a subprocess," so
// one generous shared budget is the honest fix (unlike DOD-X5, there is no
// fast pure-logic test in this file for a wide timeout to mask).
setDefaultTimeout(30_000)
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

// CI's actions/checkout only checks out THIS repo (compliance-tracker);
// C:/ct/projexa is a local-laptop-only path that does not exist there.
// headSha(PROJEXA_ROOT) previously threw ENOENT ("posix_spawn 'git'") in CI
// -- a misleading message; the real cause is execFileSync's cwd not
// existing, not git being missing from PATH (confirmed: this repo's OTHER
// git calls in the same run succeeded). Skip these two genuine-second-repo
// tests when that path isn't present rather than fail loud on an
// environment difference that has nothing to do with D57's own logic --
// D57 itself (repo resolution never defaults to cwd) is independently
// covered above by a REPO_ROOT-only test that has no such dependency.
const PROJEXA_ROOT_EXISTS = fs.existsSync(PROJEXA_ROOT)

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

  test.skipIf(!PROJEXA_ROOT_EXISTS)("a citation naming a repo it isn't checked against -- REJECTS with 'not found here', explicitly NOT worded as fabrication, and names the declared repo (SKIPPED when C:/ct/projexa isn't present, e.g. in CI)", () => {
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

  test.skipIf(!PROJEXA_ROOT_EXISTS)("the SAME citation, checked with the repo it actually names included via --repo-roots -- ACCEPTS. Proves the fix is checking the right repo, not that R-81-shaped citations are unprovable (SKIPPED when C:/ct/projexa isn't present, e.g. in CI)", () => {
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

// DOD-X5's tests live in two SEPARATE files from here on, not in this one --
// see r75-citation-gate-ci-verify-logic.test.ts (fast, deterministic, no
// network) and r75-citation-gate-ci-verify-live.test.ts (small, isolated,
// real gh api calls). W-GAP found the original single-suite version flaky
// under machine load (9/10, 5/10, 2/10 across three re-runs, a different
// test failing each time) because logic assertions and live-network calls
// shared one bun-test timeout budget -- splitting them means a red in the
// logic suite always means the logic is wrong, and a red in the live suite
// always means the network was slow, never the same color again.
