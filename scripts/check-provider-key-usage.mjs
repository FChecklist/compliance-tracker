#!/usr/bin/env node
// AI Cost Governance & FinOps gap-closure (2026-08-07), finding "Cross-repo
// (compliance-tracker + projexa) AI spend is visible as one combined
// figure": that visibility is real today because FChecklist/projexa has
// zero local LLM client (confirmed in ai-os/CONSTITUTION.yaml's
// control_model) -- every AI call it makes routes through this repo's
// /api/v1/projexa/* endpoints, which log the same token_usage_ledger every
// other call site does. This check is the guardrail that keeps that
// invariant from silently regressing on the ONE side of it this repo's CI
// can actually see: a full-repo scan (not diff-only -- an allow-list gate,
// not a debt ratchet) of src/ for any of the known LLM-provider API key env
// var names. Same enforcement class as check-guardrail-presence.mjs /
// check-terminology-guardrail.mjs -- a reviewable-diff guarantee via
// ai-os/registry/provider-key-usage-allowlist.yaml, not a runtime-
// unbypassable lock. See that registry file's own header for the honest
// limitation regarding FChecklist/projexa's repo, which this script cannot
// see or check.
//
// Usage: node scripts/check-provider-key-usage.mjs
// Exit code: 0 if every file referencing a provider key is in the
// allowlist, 1 if a NEW (unlisted) file is found.
import { readFile } from "node:fs/promises"
import { execSync } from "node:child_process"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const ALLOWLIST_FILE = "ai-os/registry/provider-key-usage-allowlist.yaml"
const SCAN_ROOT = "src"
const SCANNABLE_EXT_RE = /\.(ts|tsx)$/

async function loadAllowlist() {
  const raw = await readFile(path.resolve(REPO_ROOT, ALLOWLIST_FILE), "utf8")
  const doc = yaml.load(raw)
  const envVars = doc?.provider_key_env_vars ?? []
  const allowedFiles = new Set((doc?.allowed_files ?? []).map((e) => e.file))
  return { envVars, allowedFiles }
}

function listTrackedFiles() {
  // Full-repo sweep (not --diff-only): this is an allow-list gate, not a
  // debt ratchet -- every real reference must be accounted for in the
  // registry, not just new ones, since the registry itself is the audit
  // trail of "what's allowed to touch a provider key and why."
  const out = execSync(`git ls-files -- '${SCAN_ROOT}'`, { encoding: "utf8" })
  return out.trim().split("\n").filter((f) => f && SCANNABLE_EXT_RE.test(f))
}

async function main() {
  const { envVars, allowedFiles } = await loadAllowlist()
  if (envVars.length === 0) {
    console.error(`${ALLOWLIST_FILE} has no provider_key_env_vars configured -- failing closed rather than silently checking nothing.`)
    process.exit(1)
  }
  const pattern = new RegExp(`\\b(${envVars.join("|")})\\b`)

  const files = listTrackedFiles()
  const unlisted = []

  for (const relPath of files) {
    let content
    try {
      content = await readFile(path.resolve(REPO_ROOT, relPath), "utf8")
    } catch {
      continue
    }
    if (pattern.test(content) && !allowedFiles.has(relPath)) {
      unlisted.push(relPath)
    }
  }

  if (unlisted.length > 0) {
    console.error("=== Provider Key Usage Check FAILED ===")
    console.error(
      `${unlisted.length} file(s) reference an LLM-provider API key env var but aren't in ${ALLOWLIST_FILE}:\n`
    )
    for (const f of unlisted) console.error(`  - ${f}`)
    console.error(
      "\nIf this is a real new provider-call site, add it to the registry's allowed_files with a real reason " +
        "(and confirm it logs through logTokenUsage/token_usage_ledger, the invariant this check protects). " +
        "If it's a false positive (comment/string literal only), add it with that reason instead."
    )
    process.exit(1)
  }

  console.log(`Provider Key Usage Check passed -- ${files.length} file(s) scanned, all provider-key references accounted for in ${ALLOWLIST_FILE}.`)
}

main().catch((err) => {
  console.error("Provider Key Usage Check crashed:", err)
  process.exit(1)
})
