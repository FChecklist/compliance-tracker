#!/usr/bin/env node
// R75 Part 2 Phase 0 (V0-01): the anti-fabrication payload gate.
//
// Every agent payload from here on (a Workflow result shaped like
// { allFiles: [{path, full_content, ...}], allReqs: [{id, test_file,
// passes_now, falsifiability_proven, how_broken, notes}] }) MUST pass this
// gate before any file in it is written to disk. Run it against the raw
// workflow output JSON file (the .output file under the session's tasks/
// directory, or any JSON with the same {result:{allFiles,allReqs}} shape).
//
// Four checks, matched 1:1 to what actually failed this session:
//   (a) git-status agreement -- New for a genuinely new path, Modified for
//       one that already exists in git. Catches the case where an agent
//       claims to have "modified" a file that never existed, or silently
//       treats an existing file as if it were new (about to be clobbered).
//   (b) byte-count plausibility -- a MODIFY payload smaller than 50% of the
//       real current file is rejected outright. This is the exact rule that
//       would have caught the 17-byte "SEE_PREVIOUS_CALL" overwrite of a
//       1244-line file before it ever reached a commit.
//   (c) claimed-test-name presence -- every requirement id in allReqs whose
//       test_file matches this file's path must appear (grep) somewhere in
//       full_content. Catches a convincing narrative with no code behind it
//       (R-44/R-45's failure mode: detailed how_broken, zero actual test).
//   (d) placeholder-marker scan -- full_content must not contain any of a
//       fixed list of lazy-placeholder markers.
//
// Usage: node scripts/r75-payload-gate.mjs <path-to-workflow-output.json> [--repo-root <dir>]
// Exit code 0 = every file+requirement passed all four checks.
// Exit code 1 = at least one failed; prints exactly which check and why.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const PLACEHOLDER_MARKERS = [
  "SEE_PREVIOUS_CALL",
  "SEE PREVIOUS",
  "<unchanged>",
  "[rest of file]",
  "[REST OF FILE]",
  "// ... rest unchanged",
  "// ...unchanged",
  "/* unchanged */",
  "TRUNCATED FOR BREVITY",
  "[TRUNCATED]",
  "...(no changes)",
]

function repoRoot(argv) {
  const i = argv.indexOf("--repo-root")
  return i >= 0 ? argv[i + 1] : process.cwd()
}

function gitFileExists(root, relPath) {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${relPath}`], { cwd: root, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function currentByteLength(root, relPath) {
  const full = path.join(root, relPath)
  if (!fs.existsSync(full)) return 0
  return fs.statSync(full).size
}

function runGate(payloadJsonPath, root) {
  const raw = fs.readFileSync(payloadJsonPath, "utf8")
  const data = JSON.parse(raw)
  const result = data.result ?? data // tolerate being handed {result:...} or the bare result object
  const files = result.allFiles ?? result.files ?? []
  const reqs = result.allReqs ?? result.per_requirement ?? []

  const findings = [] // {file, check, verdict: PASS|FAIL, detail}
  let anyFail = false

  for (const f of files) {
    const relPath = f.path.replaceAll("\\", "/")
    const content = f.full_content ?? ""

    // (a) git-status agreement. Hardened briefs (V0-05) now require every
    // file entry to declare claimed_status: "new" | "modified". If a payload
    // omits it (older-format payloads), this check degrades to informational
    // (cannot disagree with a claim that was never made) rather than failing
    // the whole gate on a payload shape it predates.
    const existsInGit = gitFileExists(root, relPath)
    const realStatus = existsInGit ? "modified" : "new"
    if (f.claimed_status) {
      const agrees = f.claimed_status === realStatus
      if (!agrees) {
        anyFail = true
        findings.push({ file: relPath, check: "a-git-status", verdict: "FAIL", detail: `agent claimed "${f.claimed_status}" but this path is really "${realStatus}" in git -- claim/reality mismatch` })
      } else {
        findings.push({ file: relPath, check: "a-git-status", verdict: "PASS", detail: `claimed "${f.claimed_status}", matches real git status "${realStatus}"` })
      }
    } else {
      findings.push({ file: relPath, check: "a-git-status", verdict: "PASS", detail: `no claimed_status in payload (pre-V0-05 format) -- real status is "${realStatus}", not checked against a claim` })
    }

    // (b) byte-count plausibility, only meaningful for existing files
    if (existsInGit) {
      const originalSize = currentByteLength(root, relPath)
      const newSize = Buffer.byteLength(content, "utf8")
      if (originalSize > 0 && newSize < originalSize * 0.5) {
        anyFail = true
        findings.push({
          file: relPath, check: "b-byte-plausibility", verdict: "FAIL",
          detail: `modify payload is ${newSize}B, original is ${originalSize}B (${Math.round((newSize / originalSize) * 100)}% -- below the 50% floor). REJECTED, not applied.`,
        })
      } else {
        findings.push({ file: relPath, check: "b-byte-plausibility", verdict: "PASS", detail: `${newSize}B vs original ${originalSize}B` })
      }
    } else {
      findings.push({ file: relPath, check: "b-byte-plausibility", verdict: "PASS", detail: "new file, no floor to check" })
    }

    // (c) claimed-test-name presence -- every req whose test_file matches this path
    const claimedReqs = reqs.filter(r => (r.test_file ?? "").replaceAll("\\", "/") === relPath)
    for (const r of claimedReqs) {
      const hit = content.includes(r.id)
      if (!hit) {
        anyFail = true
        findings.push({ file: relPath, check: "c-claimed-test-presence", verdict: "FAIL", detail: `requirement ${r.id} claims test_file=${relPath} but "${r.id}" does not appear anywhere in the returned content -- narrative without code.` })
      } else {
        findings.push({ file: relPath, check: "c-claimed-test-presence", verdict: "PASS", detail: `${r.id} found in content` })
      }
    }

    // (d) placeholder-marker scan
    const foundMarkers = PLACEHOLDER_MARKERS.filter(m => content.includes(m))
    if (foundMarkers.length > 0) {
      anyFail = true
      findings.push({ file: relPath, check: "d-placeholder-scan", verdict: "FAIL", detail: `contains placeholder marker(s): ${foundMarkers.join(", ")}` })
    } else {
      findings.push({ file: relPath, check: "d-placeholder-scan", verdict: "PASS", detail: "clean" })
    }
  }

  return { findings, anyFail, fileCount: files.length, reqCount: reqs.length }
}

const argv = process.argv.slice(2)
const payloadPath = argv[0]
if (!payloadPath) {
  console.error("usage: node scripts/r75-payload-gate.mjs <workflow-output.json> [--repo-root <dir>]")
  process.exit(2)
}
const root = repoRoot(argv)
const { findings, anyFail, fileCount, reqCount } = runGate(payloadPath, root)

for (const f of findings) {
  console.log(`${f.verdict === "PASS" ? "PASS" : "FAIL"} | ${f.check} | ${f.file} | ${f.detail}`)
}
console.log(`--- ${fileCount} files, ${reqCount} requirements checked. Overall: ${anyFail ? "REJECTED" : "ACCEPTED"} ---`)
process.exit(anyFail ? 1 : 0)
