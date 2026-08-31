#!/usr/bin/env node
// Real, deterministic pre-merge SEC-07 / Hard Rule 7 enforcement gate.
//
// UMR-20260805-025554-46f9 (Owner corrective action, citing UMR-20260805-025349-a6b8 /
// OD-20260805-001, UMR-20260802-165606-4413, UMR-20260804-194323-0bc5): the real SEC-07
// violation on PR #886 (OCID-038 real implementation merged while OCID-020 was not yet
// independently verified complete) was only detected AFTER merge, by a discovery-only
// audit -- nothing technically stopped it at merge time. This script is that real,
// required pre-merge check: it fails the PR's own CI (not a warning) when a PR's own
// real diff touches locked OCID-038/039/040/041-046 scope while OCID-020's own real,
// current status (read directly from ai-os/MASTER-TRACKER.yaml) is anything other than
// a literal "VERIFIED" -- unless a real, explicit Owner override entry exists for that
// exact PR number in ai-os/registry/sec07-overrides.yaml.
//
// Two independent, real detection signals for "touches locked scope" (either one
// triggers the gate -- see ai-os/registry/ocid-locked-scope-manifest.yaml's own header
// for why a pure file-path list alone is not sufficient):
//   1. The PR's changed files match a real path glob in the scope manifest.
//   2. The PR's own title or body self-identifies as real implementation under a locked
//      OCID -- the exact real pattern that flagged PR #886 in the first place (its own
//      title: "OCID-038 real gap closure: Stage 1 pre-authentication..."). This is the
//      broader-reaching signal: it also catches genuinely new files under OCID-039/040/
//      041-046, which have no real implementation (and so no manifest entries) yet.
//
// Usage:
//   node scripts/check-sec07-ocid-lock.mjs           (real CI mode -- reads GitHub Actions env)
// Exit code: 0 if not blocked, 1 if blocked.
import { readFile } from "node:fs/promises"
import { execSync } from "node:child_process"
import yaml from "js-yaml"

export const LOCKED_OCID_LABELS = {
  ocid_038: "OCID-038",
  ocid_039: "OCID-039",
  ocid_040: "OCID-040",
  ocid_041_046: "Group E (OCID-041 through OCID-046)",
}

// Matches a locked OCID number together with real-implementation-framing language in
// the same PR title/body -- deliberately requires BOTH (a bare "OCID-038" mention alone
// is common in perfectly legitimate discovery/planning/audit text, per SEC-07's own
// explicitly-still-allowed scope; only the combination with implementation framing is
// the real signal PR #886 itself exhibited).
const OCID_NUMBER_RE = /OCID-0*(38|39|40|4[1-6])\b/gi
const IMPLEMENTATION_FRAMING_RE = /real implementation|gap closure|real fix|production change|real gap closure|implements?\b/i

function normalizeOcidNumber(n) {
  const num = Number(n)
  if (num === 38) return "ocid_038"
  if (num === 39) return "ocid_039"
  if (num === 40) return "ocid_040"
  if (num >= 41 && num <= 46) return "ocid_041_046"
  return null
}

// Real signal 2: self-identification via title/body text.
export function findSelfIdentifiedLockedOcids(prTitle, prBody) {
  const text = `${prTitle || ""}\n${prBody || ""}`
  if (!IMPLEMENTATION_FRAMING_RE.test(text)) return []
  const found = new Set()
  let m
  OCID_NUMBER_RE.lastIndex = 0
  while ((m = OCID_NUMBER_RE.exec(text))) {
    const key = normalizeOcidNumber(m[1])
    if (key) found.add(key)
  }
  return [...found]
}

// Real signal 1: changed-file paths matched against the scope manifest.
export function findManifestMatchedLockedOcids(changedFiles, manifest) {
  const found = new Set()
  for (const [ocidKey, entry] of Object.entries(manifest || {})) {
    const paths = new Set(entry?.paths || [])
    for (const f of changedFiles) {
      if (paths.has(f)) found.add(ocidKey)
    }
  }
  return [...found]
}

// Real OCID-020 status: read directly from ai-os/MASTER-TRACKER.yaml's own top-level
// `ocid_020_status` block (see that file's own header for why this is a dedicated block,
// not a synthesized `open_items` gap entry -- OCID-020 is the certification gate itself,
// not a gap under it). Absence of an explicit literal "VERIFIED" status -- including no
// block at all -- is real, honest "not verified", fails closed by design.
export function readOcid020Status(masterTrackerYamlText) {
  let doc
  try {
    doc = yaml.load(masterTrackerYamlText)
  } catch (err) {
    return { verified: false, statusText: `MASTER-TRACKER.yaml failed to parse (${err.message})` }
  }
  const block = doc?.ocid_020_status
  if (!block || typeof block.status !== "string") {
    return { verified: false, statusText: "no ocid_020_status block found in ai-os/MASTER-TRACKER.yaml" }
  }
  return { verified: block.status.trim() === "VERIFIED", statusText: block.status.trim() }
}

// Real, narrowly-scoped override check: an entry must exist for this EXACT PR number.
// Never a blanket bypass -- an override for PR #900 does not authorize PR #901.
export function hasValidOverride(overridesYamlText, prNumber) {
  let doc
  try {
    doc = yaml.load(overridesYamlText)
  } catch {
    return { allowed: false, entry: null }
  }
  const entries = doc?.overrides || []
  const entry = entries.find((e) => Number(e?.pr_number) === Number(prNumber))
  return { allowed: !!entry, entry: entry || null }
}

// Pure decision function -- the real gate logic, independent of git/fs/env, so it can be
// unit-tested directly against synthetic inputs.
export function evaluate({ changedFiles, prTitle, prBody, prNumber, manifest, masterTrackerYamlText, overridesYamlText }) {
  const manifestHits = findManifestMatchedLockedOcids(changedFiles, manifest)
  const selfIdHits = findSelfIdentifiedLockedOcids(prTitle, prBody)
  const lockedOcidsTouched = [...new Set([...manifestHits, ...selfIdHits])]

  if (lockedOcidsTouched.length === 0) {
    return { blocked: false, reason: "This PR's diff and title/body do not touch any locked OCID-038/039/040/041-046 scope. No SEC-07 concern." }
  }

  const { verified, statusText } = readOcid020Status(masterTrackerYamlText)
  const lockedLabels = lockedOcidsTouched.map((k) => LOCKED_OCID_LABELS[k]).join(", ")

  if (verified) {
    return { blocked: false, reason: `This PR touches locked scope (${lockedLabels}), but OCID-020's real current status is "VERIFIED" -- SEC-07's own lock condition is satisfied. Allowed.` }
  }

  const { allowed, entry } = hasValidOverride(overridesYamlText, prNumber)
  if (allowed) {
    return {
      blocked: false,
      reason: `This PR touches locked scope (${lockedLabels}) while OCID-020's real current status is "${statusText}" (not VERIFIED), but a real, explicit Owner override exists for this exact PR (#${prNumber}): ${entry.umr_id}, granted by ${entry.granted_by} at ${entry.granted_at}. Allowed -- one-time, narrowly scoped to this PR only, not a blanket bypass.`,
    }
  }

  return {
    blocked: true,
    reason:
      `BLOCKED by SEC-07 / Hard Rule 7: this PR's real diff and/or title/body touches locked scope under ${lockedLabels}, ` +
      `and OCID-020's real current status (read from ai-os/MASTER-TRACKER.yaml) is "${statusText}", not the required "VERIFIED". ` +
      `Real implementation, gap closure, and production changes under OCID-038, OCID-039, OCID-040, and Group E (OCID-041 through OCID-046) ` +
      `stay locked until OCID-020 is independently verified complete (see ai-os/CONSTITUTION.yaml, rule SEC-07), ` +
      `or a real, explicit Owner override entry is added for this exact PR number in ai-os/registry/sec07-overrides.yaml ` +
      `(matching the precedent UMR-20260804-172011-b839 already set, added via its own separate, independently-reviewed PR, ` +
      `never the same PR the override is granted for). See ai-os/GOVERNANCE_RECORD_HARD_RULE_7_VIOLATION_PR886_2026-08-05.md ` +
      `for the real incident this gate exists to prevent from recurring.`,
  }
}

function getChangedFiles(baseBranch) {
  try {
    execSync(`git fetch origin ${baseBranch} --depth=100`, { stdio: "ignore" })
  } catch {
    // best-effort, same convention as check-terminology-guardrail.mjs
  }
  let mergeBase = null
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      mergeBase = execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim()
      if (mergeBase) break
    } catch {
      // try next ref candidate
    }
  }
  if (!mergeBase) {
    mergeBase = execSync(`git rev-parse HEAD~1`, { encoding: "utf8" }).trim()
  }
  return execSync(`git diff --name-only --diff-filter=ACMR ${mergeBase} HEAD`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
}

async function main() {
  const baseBranch = process.env.GITHUB_BASE_REF || "main"
  const changedFiles = getChangedFiles(baseBranch)

  let prTitle = ""
  let prBody = ""
  let prNumber = null
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      const event = JSON.parse(await readFile(eventPath, "utf8"))
      prTitle = event?.pull_request?.title || ""
      prBody = event?.pull_request?.body || ""
      prNumber = event?.pull_request?.number ?? null
    } catch (err) {
      console.error(`WARNING: could not read GITHUB_EVENT_PATH (${err.message}) -- PR title/body self-identification signal disabled for this run.`)
    }
  }

  const manifestText = await readFile("ai-os/registry/ocid-locked-scope-manifest.yaml", "utf8")
  const manifest = yaml.load(manifestText)
  const masterTrackerYamlText = await readFile("ai-os/MASTER-TRACKER.yaml", "utf8")
  const overridesYamlText = await readFile("ai-os/registry/sec07-overrides.yaml", "utf8")

  const result = evaluate({ changedFiles, prTitle, prBody, prNumber, manifest, masterTrackerYamlText, overridesYamlText })

  console.log(result.blocked ? "=== SEC-07 Ocid Lock Check FAILED ===" : "SEC-07 Ocid Lock Check passed.")
  console.log(result.reason)
  process.exit(result.blocked ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("FATAL:", err)
    process.exit(1)
  })
}
