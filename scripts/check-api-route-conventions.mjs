#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Design
// Pattern Consistency, 2026-08-15): "Patterns are convention-enforced, not
// compiler/lint-enforced" -- CLAUDE.md already states "All API routes MUST
// call requireAuth()" and "All API routes MUST use Drizzle" as rules, but
// nothing mechanical checked either one before this script. Same
// enforcement class as check-terminology-guardrail.mjs / check-guardrail-
// presence.mjs / check-asset-registry-coverage.mjs: a reviewable-diff
// ratchet enforced in CI, not a runtime-unbypassable lock -- named
// honestly, not oversold.
//
// Scope, deliberately narrow (matches the finding's own wording, "new API
// routes/services", not a retroactive sweep): --diff-only checks only
// route.ts files ADDED in this PR (git diff --diff-filter=A against the
// base branch), not the ~995 pre-existing route.ts files. A retroactive
// full-repo sweep would need a real per-route audit of which of the ~288
// pre-existing routes without a requireAuth()-family call are genuinely
// public/token-scoped (contact forms, e-signature sign-by-token links,
// client-portal token routes, SSO ACS callbacks, webhooks) versus a real
// gap -- that audit is out of this script's own scope; this only stops the
// convention from silently eroding further on NEW routes going forward.
//
// What "requireAuth()" means for this check: a call to requireAuth() OR
// requireAuthOrApiKey() (both from @/lib/supabase/auth-guard -- the latter
// already calls the former internally, see that file's own header) is
// accepted. A new route with neither is either a real gap or a genuinely
// public/token-authenticated endpoint (webhook signature check, public
// contact form, e-signature/client-portal token route, SSO callback) -- the
// latter is common enough in this codebase's real, reviewed history
// (compliance/[id]/route.ts, client-portal/*, esignature/sign/[token]/*,
// auth/sso/*, contact/*, ai/team/log-usage) that a hard, un-exemptable fail
// would be wrong; ai-os/registry/api-route-service-convention-exemptions.yaml
// records each real exemption with its own reason instead of a silent skip.
//
// Second half, same file, lighter-touch: a NEW service file under
// src/lib/services/*.ts that throws a generic `new Error(` without ever
// importing ServiceError (from ./compliance-service, this repo's one real
// ServiceError definition) is flagged -- 162/212 existing service files
// already follow this convention (see this script's own PR for the count),
// so a new file breaking it is real, catchable drift. A service file with
// no throw at all (pure read/compute helpers) is not flagged -- nothing to
// convert.
//
// Usage:
//   node scripts/check-api-route-conventions.mjs --diff-only
//   node scripts/check-api-route-conventions.mjs --file <path> [--file <path> ...]
// Exit code: 0 if no new (unexempted) violations, 1 otherwise.
import { readFile, access } from "node:fs/promises"
import { execSync } from "node:child_process"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const EXEMPTIONS_FILE = "ai-os/registry/api-route-service-convention-exemptions.yaml"
const BASE_BRANCH = process.env.GITHUB_BASE_REF || "main"

const AUTH_CALL_RE = /\brequireAuth(?:OrApiKey)?\s*\(/
const SERVICE_ERROR_IMPORT_RE = /\bServiceError\b/
const GENERIC_THROW_RE = /\bthrow\s+new\s+Error\s*\(/

export function isApiRouteFile(relPath) {
  return relPath.startsWith("src/app/api/") && relPath.endsWith("route.ts") && !relPath.endsWith(".test.ts")
}

export function isServiceFile(relPath) {
  return relPath.startsWith("src/lib/services/") && relPath.endsWith(".ts") && !relPath.endsWith(".test.ts")
}

// Pure, filesystem-free check for one (relPath, text) pair -- the real unit
// tests (check-api-route-conventions.test.ts) call this directly rather
// than mocking the filesystem/git, matching check-sec07-ocid-lock.mjs's own
// "test the pure function, not the CLI shell" precedent.
export function checkFileText(relPath, text) {
  if (isApiRouteFile(relPath) && !AUTH_CALL_RE.test(text)) {
    return {
      file: relPath,
      rule: "requireAuth()/requireAuthOrApiKey()",
      detail:
        "New API route calls neither requireAuth() nor requireAuthOrApiKey() from " +
        "@/lib/supabase/auth-guard. If this route is genuinely public/token-authenticated " +
        `(webhook signature check, sign-by-token link, etc.), add it to ${EXEMPTIONS_FILE} with a real reason.`,
    }
  }
  if (isServiceFile(relPath) && GENERIC_THROW_RE.test(text) && !SERVICE_ERROR_IMPORT_RE.test(text)) {
    return {
      file: relPath,
      rule: "ServiceError",
      detail:
        "New service file throws a generic `new Error(...)` without ever referencing ServiceError " +
        "(this repo's one real ServiceError class, src/lib/services/compliance-service.ts). Use " +
        `ServiceError instead so API routes can map it to the right HTTP status, or add this file to ${EXEMPTIONS_FILE} with a real reason.`,
    }
  }
  return null
}

async function readIfExists(relPath) {
  const abs = path.resolve(REPO_ROOT, relPath)
  try {
    await access(abs)
  } catch {
    return null // deleted/renamed-away file, nothing to check
  }
  return readFile(abs, "utf8")
}

function getAddedFiles() {
  try {
    execSync(`git fetch origin ${BASE_BRANCH} --depth=100`, { stdio: "ignore" })
  } catch {
    // best-effort, matches check-terminology-guardrail.mjs's own precedent
  }
  let mergeBase = null
  for (const ref of [`origin/${BASE_BRANCH}`, BASE_BRANCH]) {
    try {
      mergeBase = execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8" }).trim()
      if (mergeBase) break
    } catch {
      // try next ref candidate
    }
  }
  if (!mergeBase) {
    try {
      mergeBase = execSync(`git rev-parse HEAD~1`, { encoding: "utf8" }).trim()
    } catch {
      return null
    }
  }
  // --diff-filter=A only -- this check is scoped to genuinely NEW files
  // (per the finding's own "new API routes/services" wording), not every
  // file touched in the PR. Untracked (not-yet-committed) new files are
  // included too, matching check-terminology-guardrail.mjs's own precedent
  // for running before the worker's final commit.
  const tracked = execSync(`git diff --name-only --diff-filter=A ${mergeBase} HEAD`, { encoding: "utf8" }).trim()
  const untracked = execSync(`git ls-files --others --exclude-standard`, { encoding: "utf8" }).trim()
  const files = new Set()
  for (const f of [...tracked.split("\n"), ...untracked.split("\n")]) {
    if (f) files.add(f)
  }
  return [...files]
}

async function loadExemptions() {
  try {
    const raw = await readFile(path.resolve(REPO_ROOT, EXEMPTIONS_FILE), "utf8")
    const doc = yaml.load(raw)
    const byFile = new Map()
    for (const entry of doc?.exemptions ?? []) {
      byFile.set(entry.file, entry.reason ?? "(no reason recorded)")
    }
    return byFile
  } catch (err) {
    console.error(`WARNING: could not load ${EXEMPTIONS_FILE} (${err.message}) -- treating as no exemptions.`)
    return new Map()
  }
}

async function checkFiles(filesToScan, exemptions) {
  const violations = []
  for (const relPath of filesToScan) {
    if (exemptions.has(relPath)) continue
    if (!isApiRouteFile(relPath) && !isServiceFile(relPath)) continue
    const text = await readIfExists(relPath)
    if (text === null) continue
    const violation = checkFileText(relPath, text)
    if (violation) violations.push(violation)
  }
  return violations
}

async function main() {
  const args = process.argv.slice(2)
  const diffOnly = args.includes("--diff-only")
  const explicitFiles = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") explicitFiles.push(args[++i])
  }

  let filesToScan
  if (diffOnly) {
    filesToScan = getAddedFiles()
    if (filesToScan === null) {
      console.error("Could not determine a diff base (no merge-base, no HEAD~1) -- failing closed.")
      process.exit(1)
    }
  } else if (explicitFiles.length > 0) {
    filesToScan = explicitFiles
  } else {
    console.error("Usage: check-api-route-conventions.mjs --diff-only | --file <path> [...]")
    process.exit(1)
  }

  const exemptions = await loadExemptions()
  const violations = await checkFiles(filesToScan, exemptions)

  if (violations.length > 0) {
    console.error("=== API Route / Service Convention Check FAILED ===")
    console.error(`${violations.length} violation(s):\n`)
    for (const v of violations) {
      console.error(`  --- ${v.file} (${v.rule}) ---`)
      console.error(`      ${v.detail}\n`)
    }
    process.exit(1)
  }

  console.log(
    `API Route / Service Convention Check passed -- ${filesToScan.length} new file(s) checked, no violations.`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("API Route / Service Convention Check crashed:", err)
    process.exit(1)
  })
}
