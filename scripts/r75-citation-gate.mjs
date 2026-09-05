#!/usr/bin/env node
// R75 Part 2 Phase 0 (V0-02): the anti-fabrication citation gate.
//
// Run this BEFORE writing any platform.sumeet_requirements.closure_state to
// CLOSED. Takes one citation {requirement_id, test_path, commit_sha,
// how_broken} and proves, mechanically, that it is real:
//   (a) `git cat-file -e <sha>` -- the commit object exists in this repo.
//   (b) `git cat-file -e <sha>:<test_path>` -- the file existed AT that
//       commit, not merely somewhere in history or only at HEAD.
//   (c) the test actually runs and passes RIGHT NOW at HEAD (a citation can
//       be structurally valid and still broken by a later merge).
//   (d) a non-empty, non-placeholder falsifiability record (how_broken) is
//       present -- a test never seen to fail is unproven (GV-12).
//
// CORRECTION (R75 Part 2 continuation, Phase 2 -> "MAJOR CORRECTION" log
// entries): this gate's very first real use flagged R-48/R-62's citation
// (commit 2b6bfbb88a30f15e47b9a3e770c05ebceecff8bd) as fabricated -- the
// object genuinely does not exist in compliance-tracker. But it DOES exist,
// really, on origin/main, in the SEPARATE FChecklist/projexa repository
// (GV-22 -- these are two different repos, a fix in one does not reach the
// other, and neither does its git history). The citation was real, just
// missing which repo it belonged to. A commit/path not found in the repo
// you happened to check is NOT proof of fabrication by itself -- pass
// --repo-roots with every real candidate repo before concluding a citation
// is fake. This gate now checks each root in order and reports which one
// (if any) the citation resolved against.
//
// Usage: node scripts/r75-citation-gate.mjs <citation.json> [--repo-root <dir>] [--repo-roots <dir1>,<dir2>,...]
// citation.json shape: { requirement_id, test_path, commit_sha, how_broken }
// Exit 0 = citation is real (in at least one checked repo) and the test
// passes now there. Exit 1 = reject (fails in every checked repo).
//
// PATH FORMAT GOTCHA (caught proving the R-48/R-62 correction above): pass
// Windows-style paths (C:/ct/projexa or C:\ct\projexa), never a Git-Bash
// MSYS path (/c/ct/projexa). Node's child_process cwd does not understand
// the /c/... form -- it silently fails to find the directory, every git
// command then throws, and every check in that root reports FAIL, which
// looks exactly like "the citation is fake" when the real fault is the path
// format. Same family as the memory-recorded "PowerShell [id] paths
// silently match nothing" gotcha -- a Windows/POSIX path confusion that
// fails silent and plausible instead of loud.
import fs from "node:fs"
import { execFileSync, execSync } from "node:child_process"

const PLACEHOLDER_MARKERS = ["SEE_PREVIOUS_CALL", "SEE PREVIOUS", "TODO", "N/A", "n/a", ""]

function repoRoots(argv) {
  const multi = argv.indexOf("--repo-roots")
  if (multi >= 0) return argv[multi + 1].split(",").map(s => s.trim()).filter(Boolean)
  const single = argv.indexOf("--repo-root")
  if (single >= 0) return [argv[single + 1]]
  return [process.cwd()]
}

function objectExists(root, sha) {
  try {
    execFileSync("git", ["cat-file", "-e", sha], { cwd: root, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function pathExistsAtCommit(root, sha, testPath) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}:${testPath}`], { cwd: root, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function testPassesAtHead(root, testPath) {
  // bun test writes its actual pass/fail tally to STDERR, not stdout (only the
  // version banner goes to stdout) -- confirmed live, a real bug caught while
  // proving this gate on a planted fixture (this comment IS that proof).
  // `2>&1` merges both streams so the tally is visible regardless of which
  // one bun used, on both cmd.exe and a POSIX shell.
  try {
    const out = execSync(`bun test "${testPath}" 2>&1`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return /\b0 fail\b/.test(out)
  } catch (e) {
    const out = (e.stdout ?? "") + (e.stderr ?? "")
    return /\b0 fail\b/.test(out)
  }
}

function runGate({ requirement_id, test_path, commit_sha, how_broken }, root) {
  const findings = []
  let anyFail = false

  const shaOk = objectExists(root, commit_sha)
  findings.push({ check: "a-commit-exists", verdict: shaOk ? "PASS" : "FAIL", detail: shaOk ? `${commit_sha} is a real object` : `${commit_sha} is NOT a known object in this repo -- fabricated or wrong SHA` })
  if (!shaOk) anyFail = true

  let pathOk = false
  if (shaOk) {
    pathOk = pathExistsAtCommit(root, commit_sha, test_path)
    findings.push({ check: "b-path-at-commit", verdict: pathOk ? "PASS" : "FAIL", detail: pathOk ? `${test_path} exists at ${commit_sha}` : `${test_path} does NOT exist at ${commit_sha} -- fabricated path or wrong commit` })
    if (!pathOk) anyFail = true
  } else {
    findings.push({ check: "b-path-at-commit", verdict: "FAIL", detail: "skipped -- commit does not exist" })
    anyFail = true
  }

  let headOk = false
  if (fs.existsSync(`${root}/${test_path}`)) {
    headOk = testPassesAtHead(root, test_path)
    findings.push({ check: "c-passes-at-head", verdict: headOk ? "PASS" : "FAIL", detail: headOk ? `${test_path} passes (0 fail) at HEAD` : `${test_path} does NOT pass at HEAD right now` })
    if (!headOk) anyFail = true
  } else {
    findings.push({ check: "c-passes-at-head", verdict: "FAIL", detail: `${test_path} does not exist at HEAD at all` })
    anyFail = true
  }

  const brokenOk = typeof how_broken === "string" && how_broken.trim().length > 20 && !PLACEHOLDER_MARKERS.includes(how_broken.trim())
  findings.push({ check: "d-falsifiability-recorded", verdict: brokenOk ? "PASS" : "FAIL", detail: brokenOk ? "how_broken is a real, substantive record" : "how_broken is empty, a placeholder, or too short to be a real demonstration" })
  if (!brokenOk) anyFail = true

  return { requirement_id, findings, anyFail }
}

const argv = process.argv.slice(2)
const citationPath = argv[0]
if (!citationPath) {
  console.error("usage: node scripts/r75-citation-gate.mjs <citation.json> [--repo-root <dir>]")
  process.exit(2)
}
const roots = repoRoots(argv)
const citation = JSON.parse(fs.readFileSync(citationPath, "utf8"))

const perRoot = roots.map(root => ({ root, ...runGate(citation, root) }))
const winner = perRoot.find(r => !r.anyFail)

if (roots.length > 1) console.log(`Checking ${roots.length} repo(s): ${roots.join(", ")}`)
for (const r of perRoot) {
  if (roots.length > 1) console.log(`-- in ${r.root} --`)
  for (const f of r.findings) console.log(`${f.verdict} | ${f.check} | ${f.detail}`)
}
if (winner) {
  console.log(`--- ${citation.requirement_id}: ACCEPTED in ${winner.root}, may be written CLOSED (record which repo in the closure citation) ---`)
  process.exit(0)
} else {
  console.log(`--- ${citation.requirement_id}: REJECTED in every checked repo (${roots.join(", ")}), stays OPEN ---`)
  process.exit(1)
}
