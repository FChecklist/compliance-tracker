#!/usr/bin/env node
// R75 Part 2 Phase 0 (V0-02): the anti-fabrication citation gate.
//
// Run this BEFORE writing any platform.sumeet_requirements.closure_state to
// CLOSED. Takes one citation {requirement_id, test_path, commit_sha,
// how_broken} and proves, mechanically, that it is real:
//   (a) `git cat-file -e <sha>` -- the commit object exists in this repo.
//   (b) `git cat-file -e <sha>:<test_path>` -- the file existed AT that
//       commit, not merely somewhere in history or only at HEAD.
//   (c) `git ls-files --error-unmatch <test_path>` -- the path is TRACKED IN
//       GIT at HEAD right now, independent of whether it happens to exist on
//       disk (D43, P0). Existing on disk is NOT evidence: an untracked local
//       file (gitignored, created outside version control, or simply never
//       committed) passes fs.existsSync and can even pass its own test run,
//       while being invisible to every reviewer, to CI, and to anyone who
//       clones the repo. This check is unconditional and independent of (d)
//       below -- a passing test at an untracked path must still REJECT.
//
//       CORRECTION 2026-09-10 13:28 IST: this check was originally motivated
//       by "R-81, closed 2026-09-05 citing veri-chat-context.test.ts, a path
//       git never tracked" -- that motivating claim was WRONG. R-81's own
//       closure_repo field says "projexa"; every session that investigated
//       it, including the one that wrote this comment, checked ONLY
//       compliance-tracker and never checked projexa, where the path is
//       genuinely tracked, the cited commit and sha both resolve, and the
//       cited test passes (10/0). This is the EXACT GV-22 mistake described
//       two paragraphs below (R-48/R-62), now proven to have also caught out
//       R-81's own investigators -- ironic, given GV-22 exists specifically
//       to prevent it. D43 (this check) is still sound practice regardless
//       of its original motivating example being wrong -- verifying a
//       citation is tracked in the repo it actually claims is a correct
//       thing to require. See scripts/r75-citation-gate.test.ts for a
//       synthetic (not R-81) reproduction of the failure mode this guards.
//   (d) the test actually runs and passes RIGHT NOW at HEAD (a citation can
//       be structurally valid and still broken by a later merge).
//   (e) a non-empty, non-placeholder falsifiability record (how_broken) is
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

// D57 (filed 2026-09-10, after R-81's citation was wrongly called fabricated
// three separate times because every check ran in compliance-tracker while
// the citation's own `repo` field said "projexa" and nobody looked): the
// gate must resolve the repo from the citation's OWN declared field and must
// refuse to silently default to cwd. A caller who omits --repo-root/
// --repo-roots gets a loud, actionable error, never a quiet "check whatever
// directory I happen to be in and call that the answer."
function repoRoots(argv, citation) {
  const multi = argv.indexOf("--repo-roots")
  const single = argv.indexOf("--repo-root")
  const explicit = multi >= 0 ? argv[multi + 1].split(",").map(s => s.trim()).filter(Boolean)
    : single >= 0 ? [argv[single + 1]]
    : null

  if (!explicit) {
    const repoHint = citation && citation.repo ? ` The citation itself names repo "${citation.repo}" -- pass its actual path.` : ""
    console.error(`error: no --repo-root or --repo-roots given. This gate will NOT default to the current directory -- that silent default is exactly how R-81's real, valid citation got called "fabricated" three times (D57): every check happened to run in compliance-tracker, R-81's citation said projexa, nobody looked.${repoHint}`)
    process.exit(2)
  }

  // D57 second clause: if the citation declares which repo it belongs to,
  // sanity-check that at least one of the roots actually being checked looks
  // like that repo, by directory name. This is a best-effort warning, not a
  // hard block (repo checkouts are sometimes named differently on purpose),
  // but a silent mismatch here is precisely last window's failure mode.
  if (citation && citation.repo) {
    const looksRight = explicit.some(r => r.toLowerCase().includes(String(citation.repo).toLowerCase()))
    if (!looksRight) {
      console.error(`WARNING: citation declares repo "${citation.repo}" but none of the roots being checked (${explicit.join(", ")}) contain that name. Proceeding, but a REJECTED result below may mean "wrong repo checked," not "fabricated" -- verify you are pointed at the repo the citation actually names before concluding anything.`)
    }
  }

  return explicit
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

// D43: distinct from pathExistsAtCommit above -- that checks history AT one
// cited sha, this checks the git INDEX at HEAD, right now. A path can only
// pass this if `git add`/a real commit put it there; a file merely sitting
// in the working tree (untracked, gitignored, or a local scratch copy)
// fails it every time, regardless of its content or whether it runs green.
function pathTrackedInGit(root, testPath) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", testPath], { cwd: root, stdio: "ignore" })
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
  //
  // SECOND BUG, caught proving D43 (bun 1.3.14, this machine): `bun test
  // "scripts/foo.test.ts"` with a bare relative path -- no leading `./` --
  // is parsed as a NAME FILTER, not a path, and matches zero files: "The
  // following filters did not match any test files". That produces bun's
  // own "0 tests" banner, which contains neither "0 fail" nor any failure
  // text, so this function silently returned false for EVERY real citation
  // this check has ever been run against on this machine -- a passing test
  // and a not-found test were indistinguishable. Force a `./`-relative path
  // so bun's path branch, not its filter branch, is the one that runs.
  const relPath = testPath.startsWith("./") || testPath.startsWith("../") ? testPath : `./${testPath}`
  try {
    const out = execSync(`bun test "${relPath}" 2>&1`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return /\b0 fail\b/.test(out) && !/did not match any test files/.test(out)
  } catch (e) {
    const out = (e.stdout ?? "") + (e.stderr ?? "")
    return /\b0 fail\b/.test(out) && !/did not match any test files/.test(out)
  }
}

function runGate({ requirement_id, test_path, commit_sha, how_broken }, root) {
  const findings = []
  let anyFail = false

  // D57: "not found in THIS repo" is not the same claim as "fabricated" --
  // it only becomes a fabrication verdict once the repo the citation itself
  // names has actually been checked. Wording below says "not found in this
  // repo" everywhere it used to say "fabricated," on purpose.
  const shaOk = objectExists(root, commit_sha)
  findings.push({ check: "a-commit-exists", verdict: shaOk ? "PASS" : "FAIL", detail: shaOk ? `${commit_sha} is a real object` : `${commit_sha} is NOT a known object in THIS repo (${root}) -- not proof of fabrication by itself, could be the wrong repo checked; wrong SHA only if the correct repo was already confirmed` })
  if (!shaOk) anyFail = true

  let pathOk = false
  if (shaOk) {
    pathOk = pathExistsAtCommit(root, commit_sha, test_path)
    findings.push({ check: "b-path-at-commit", verdict: pathOk ? "PASS" : "FAIL", detail: pathOk ? `${test_path} exists at ${commit_sha}` : `${test_path} does NOT exist at ${commit_sha} in THIS repo (${root}) -- not proof of fabrication by itself, could be the wrong repo checked; wrong path/commit only if the correct repo was already confirmed` })
    if (!pathOk) anyFail = true
  } else {
    findings.push({ check: "b-path-at-commit", verdict: "FAIL", detail: "skipped -- commit does not exist in this repo" })
    anyFail = true
  }

  // D43 hard requirement: unconditional and independent of every other
  // check. A path that fails this REJECTS the citation even if (a)/(b)
  // passed and even if the test at that path currently runs green -- being
  // on disk, or having existed at some cited historical commit, is not the
  // same claim as "this is real, reviewable, shared evidence right now."
  const trackedOk = pathTrackedInGit(root, test_path)
  findings.push({ check: "c-tracked-in-git", verdict: trackedOk ? "PASS" : "FAIL", detail: trackedOk ? `${test_path} is tracked in git (git ls-files confirms it at HEAD)` : `${test_path} is NOT tracked in git -- git ls-files finds nothing at this path, so it is not real, reviewable, shared evidence regardless of what's on disk or whether a run of it passes (D43)` })
  if (!trackedOk) anyFail = true

  let headOk = false
  if (fs.existsSync(`${root}/${test_path}`)) {
    headOk = testPassesAtHead(root, test_path)
    findings.push({ check: "d-passes-at-head", verdict: headOk ? "PASS" : "FAIL", detail: headOk ? `${test_path} passes (0 fail) at HEAD` : `${test_path} does NOT pass at HEAD right now` })
    if (!headOk) anyFail = true
  } else {
    findings.push({ check: "d-passes-at-head", verdict: "FAIL", detail: `${test_path} does not exist at HEAD at all` })
    anyFail = true
  }

  const brokenOk = typeof how_broken === "string" && how_broken.trim().length > 20 && !PLACEHOLDER_MARKERS.includes(how_broken.trim())
  findings.push({ check: "e-falsifiability-recorded", verdict: brokenOk ? "PASS" : "FAIL", detail: brokenOk ? "how_broken is a real, substantive record" : "how_broken is empty, a placeholder, or too short to be a real demonstration" })
  if (!brokenOk) anyFail = true

  return { requirement_id, findings, anyFail }
}

const argv = process.argv.slice(2)
const citationPath = argv[0]
if (!citationPath) {
  console.error("usage: node scripts/r75-citation-gate.mjs <citation.json> --repo-root <dir> | --repo-roots <dir1>,<dir2>,... (D57: one of these is now required, no cwd default)")
  process.exit(2)
}
const citation = JSON.parse(fs.readFileSync(citationPath, "utf8"))
const roots = repoRoots(argv, citation) // D57: parse citation first, it can name the repo; this call exits(2) if no root was given at all

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
  // D57: NOT a fabrication verdict on its own -- only "not found in the
  // repo(s) actually checked." If citation.repo names something not among
  // `roots` (the repoRoots() warning above would already have fired), this
  // is very likely a repo-mismatch, not fabrication. Only call it fabricated
  // once the citation's own declared repo has genuinely been checked.
  const repoCoverageNote = citation.repo
    ? ` Citation declares repo "${citation.repo}" -- confirm that repo was actually among the roots checked before calling this fabrication.`
    : ""
  console.log(`--- ${citation.requirement_id}: REJECTED in the repo(s) checked (${roots.join(", ")}), stays OPEN. This means NOT FOUND HERE, not proven fabricated.${repoCoverageNote} ---`)
  process.exit(1)
}
