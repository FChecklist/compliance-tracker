#!/usr/bin/env node
// CI guard: fails if a NEW or changed migration file under drizzle/ contains
// destructive DDL/DCL (DROP*, TRUNCATE, GRANT/REVOKE, role changes, SECURITY
// DEFINER, REASSIGN OWNED) with no citable human-authorization record.
//
// WHY THIS EXISTS (2026-09-29): this repo's ai-os/CONSTITUTION.yaml SEC-06
// claimed "Live production database DDL/DCL execution is gated at dispatch
// time" as ENFORCED, citing a mechanism (claude-control's
// scripts/ddl_authorization_check.py, wired into scripts/task-gateway.py's
// dispatch-time gate) that ran on the VERIDIAN-DEV Hetzner server. That
// server was permanently deleted 2026-08-25. Verified directly: zero live
// invocation path for that mechanism has existed since -- not on the laptop,
// not in any GitHub Action anywhere in this org. SEC-06's "ENFORCED" claim
// was stale from that date until this check shipped; unauthorized/unreviewed
// destructive schema changes were unenforced by anything in the interim.
//
// SCOPE, deliberately narrower than the original (see CONSTITUTION.yaml
// SEC-06's updated entry for the full reasoning): this ports only the
// original's "Category A" path (an explicit PRE-APPROVED-LIVE-DDL citation),
// and only for genuinely destructive statements -- not every DDL keyword.
// The original's Category B (10-condition deterministic-recovery
// auto-authorization) is NOT ported: it was built entirely around the old
// dispatch-prompt-file / sibling-server-checkout architecture (a `repo`
// field naming a sibling checkout under a shared parent directory, git log
// checks against that sibling's own history, etc.) that no longer exists on
// this laptop-only, single-repo-per-clone workflow -- force-fitting it here
// would be unverifiable, not a real port. If a genuine "reapply
// already-reviewed, idempotent SQL" recovery case comes up, use a real
// PRE-APPROVED-LIVE-DDL citation for it too, same as any other destructive
// change, until Category B is deliberately redesigned for this environment.
//
// Also deliberately narrower in WHAT triggers the requirement: the original
// required a citation for ANY DDL keyword at all, including plain CREATE
// TABLE/ADD COLUMN -- correct for its threat model (a dispatch prompt could
// bypass PR review entirely via a live Supabase MCP call). That threat model
// doesn't apply here: EVERY migration file in this repo already goes through
// normal PR + CI review before merge, which is itself the human-review step
// for routine, additive schema changes. Requiring a citation on every single
// migration would just be friction with no real safety gain and a strong
// chance of being routinely bypassed/disabled. Requiring one specifically
// for DESTRUCTIVE DDL (irreversible data loss on a mistake, unlike an
// additive change) is where a real, non-redundant gap exists.
//
// HONEST LIMITATION, same class as the original: this is a git-diff TEXT
// scan of migration files, not a runtime interceptor. It cannot catch a live
// interactive AI session calling the Supabase MCP's apply_migration/
// execute_sql/merge_branch tools directly, bypassing git/PR entirely -- CI
// only runs on pushes/PRs. Closing THAT gap needs an MCP-proxy-level policy
// check, which is a materially different, larger piece of infrastructure
// and out of scope here (same conclusion the original script's own docstring
// already reached for its equivalent limitation).
//
// Usage: node scripts/check-ddl-authorization.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-ddl-authorization.mjs
// Exit code 0 = no unauthorized destructive DDL, 1 = violation(s) found.

import { readFileSync } from "fs"
import { execSync } from "child_process"
import { pathToFileURL } from "url"

export function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]
  if (process.env.BASE_REF && process.env.BASE_REF.trim()) return process.env.BASE_REF.trim()
  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // offline/shallow clone -- non-fatal, fall through to whatever ref exists
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // fall through
  }
  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // fall through
  }
  return "HEAD~1"
}

export function mergeBaseWith(ref) {
  try {
    // stdio pipes stderr rather than an inline `2>/dev/null` redirect: the redirect is
    // POSIX shell syntax that cmd.exe (Windows) cannot parse, which silently broke this
    // whole check on Windows (falls into the catch below, then main()'s own git-diff
    // catch, producing a false "OK: could not compute git diff -- skipping" pass even
    // with real, unauthorized DROP TABLE staged) -- found via independent verification,
    // reproduced directly on this laptop. CI itself runs on ubuntu-latest so this bug
    // never affected the actual gate, only local Windows sanity-testing of it.
    return execSync(`git merge-base HEAD ${ref}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
  } catch {
    return "HEAD~1"
  }
}

// Destructive-only subset of the original ddl_authorization_check.py's
// DDL_KEYWORD_PATTERNS -- see module header for why additive forms (CREATE
// TABLE, ADD COLUMN, CREATE INDEX, etc.) are deliberately excluded here.
export const DESTRUCTIVE_PATTERNS = {
  "DROP TABLE": /\bDROP\s+TABLE\b/i,
  "DROP INDEX": /\bDROP\s+INDEX\b/i,
  "DROP POLICY": /\bDROP\s+POLICY\b/i,
  "DROP TRIGGER": /\bDROP\s+TRIGGER\b/i,
  "DROP COLUMN": /\bDROP\s+COLUMN\b/i,
  "DROP TYPE": /\bDROP\s+TYPE\b/i,
  "DROP SCHEMA": /\bDROP\s+SCHEMA\b/i,
  "DROP VIEW": /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/i,
  "DROP FUNCTION": /\bDROP\s+FUNCTION\b/i,
  TRUNCATE: /\bTRUNCATE\b/i,
  GRANT: /\bGRANT\b/i,
  REVOKE: /\bREVOKE\b/i,
  "CREATE ROLE": /\bCREATE\s+ROLE\b/i,
  "ALTER ROLE": /\bALTER\s+ROLE\b/i,
  "DROP ROLE": /\bDROP\s+ROLE\b/i,
  "CREATE USER": /\bCREATE\s+USER\b/i,
  "ALTER USER": /\bALTER\s+USER\b/i,
  "DROP USER": /\bDROP\s+USER\b/i,
  "SECURITY DEFINER": /\bSECURITY\s+DEFINER\b/i,
  "REASSIGN OWNED": /\bREASSIGN\s+OWNED\b/i,
}

export function stripSqlComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "")
}

export function findDestructiveHits(text) {
  const stripped = stripSqlComments(text)
  return Object.entries(DESTRUCTIVE_PATTERNS)
    .filter(([, re]) => re.test(stripped))
    .map(([label]) => label)
}

// Same citation grammar/validation as the original ddl_authorization_check.py's
// PRE-APPROVED-LIVE-DDL path: a real, checkable decision-log reference, not a
// bare word. Matched against the RAW file text (so it can live in a SQL
// comment, e.g. `-- PRE-APPROVED-LIVE-DDL: KE-20260929-120000-ab12`).
export const APPROVAL_LINE_RE = /^\s*(?:--\s*)?PRE-APPROVED-LIVE-DDL:\s*(.*)$/im
export const PLACEHOLDER_RE = /^(tbd|todo|n\/?a|none|null|undefined|yes|approved|xxx+|\.\.\.|fill.?in|pending|<.*>)$/i
export const KE_ID_RE = /KE-\d{8}-\d{6}-[0-9a-f]{4}/i
export const OWNER_DECISIONS_FILE_RE = /OWNER_DECISIONS_NEEDED_\d{4}-\d{2}-\d{2}\.ya?ml/i
export const DATED_NOTE_RE = /\d{4}-\d{2}-\d{2}/
export const MIN_DATED_NOTE_LENGTH = 25

export function keIdExistsOnDisk(keId) {
  try {
    // ai-os/ is small enough (~tens of MB) to grep directly per check run.
    // stdio pipes stderr instead of an inline `2>/dev/null` -- see mergeBaseWith's
    // comment for why the shell-redirect form silently broke this on Windows.
    const out = execSync(
      `git grep -l -- "${keId}" -- ai-os/`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim()
    return out.length > 0
  } catch {
    return false
  }
}

export function ownerDecisionsFileExists(filename) {
  try {
    execSync(`git cat-file -e HEAD:ai-os/${filename}`, { stdio: ["pipe", "pipe", "pipe"] })
    return true
  } catch {
    try {
      readFileSync(`ai-os/${filename}`)
      return true
    } catch {
      return false
    }
  }
}

export function isRealReference(reference) {
  if (!reference || PLACEHOLDER_RE.test(reference.trim())) return false
  const keMatch = reference.match(KE_ID_RE)
  if (keMatch) return keIdExistsOnDisk(keMatch[0])
  const fileMatch = reference.match(OWNER_DECISIONS_FILE_RE)
  if (fileMatch) return ownerDecisionsFileExists(fileMatch[0])
  if (DATED_NOTE_RE.test(reference) && reference.length >= MIN_DATED_NOTE_LENGTH) return true
  return false
}

export function findValidCitation(text) {
  const match = text.match(APPROVAL_LINE_RE)
  if (!match) return null
  const reference = match[1].trim()
  return isRealReference(reference) ? reference : null
}

// Only run the CLI/git-diff orchestration when executed directly (not when
// imported for its pure functions by the test file) -- same guard pattern as
// check-migration-integrity.mjs / check-migration-schema-drift.mjs.
// pathToFileURL handles both POSIX and Windows argv[1] paths correctly,
// unlike a manual string comparison.
function main() {
  const baseRef = resolveBaseRef()
  const mergeBase = mergeBaseWith(baseRef)

  // New/changed .sql files under drizzle/ -- committed diff vs merge-base, plus
  // untracked (mirrors check-migration-collision.mjs's proven base-ref/diff
  // pattern). Includes drizzle/down/*.down.sql deliberately -- destructive DDL
  // in a rollback script is still destructive DDL that can run against prod.
  let changedFiles = []
  try {
    // stdio pipes stderr instead of an inline `2>/dev/null` -- see mergeBaseWith's
    // comment above for why the shell-redirect form silently broke this on Windows
    // (fell into this very catch block, producing a false-pass "skipping" exit 0
    // even with real unauthorized DROP TABLE staged -- reproduced directly).
    const committed = execSync(
      `git diff --name-only --diff-filter=d ${mergeBase} HEAD -- drizzle/`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim()
    const untracked = execSync(
      `git ls-files --others --exclude-standard -- drizzle/`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim()
    changedFiles = [...committed.split("\n"), ...untracked.split("\n")]
      .filter(Boolean)
      .filter(f => f.endsWith(".sql") && !f.startsWith("drizzle/meta/"))
  } catch {
    console.log("OK: could not compute git diff (shallow clone or no drizzle/ changes) -- skipping.")
    process.exit(0)
  }

  if (changedFiles.length === 0) {
    console.log(`OK: no new/changed drizzle/*.sql files (base: ${baseRef}).`)
    process.exit(0)
  }

  const violations = []
  const cleared = []

  for (const file of changedFiles) {
    let content
    try {
      content = readFileSync(file, "utf8")
    } catch {
      continue // deleted/unreadable -- diff-filter=d already excludes deletions, defensive only
    }
    const hits = findDestructiveHits(content)
    if (hits.length === 0) continue
    const citation = findValidCitation(content)
    if (citation) {
      cleared.push({ file, hits, citation })
    } else {
      violations.push({ file, hits })
    }
  }

  if (violations.length === 0) {
    if (cleared.length > 0) {
      console.log(`OK: ${cleared.length} migration file(s) with destructive DDL, all have a valid PRE-APPROVED-LIVE-DDL citation:`)
      for (const { file, hits, citation } of cleared) {
        console.log(`  - ${file}: [${hits.join(", ")}] approved via ${citation}`)
      }
    } else {
      console.log(`OK: ${changedFiles.length} new/changed migration file(s) checked, no destructive DDL found requiring authorization (base: ${baseRef}).`)
    }
    process.exit(0)
  }

  console.error("ERROR: destructive DDL found in new/changed migration file(s) with no valid authorization citation!")
  for (const { file, hits } of violations) {
    console.error(`  - ${file}: [${hits.join(", ")}]`)
  }
  console.error("")
  console.error("Destructive schema changes (DROP*, TRUNCATE, GRANT/REVOKE, role changes,")
  console.error("SECURITY DEFINER, REASSIGN OWNED) require an explicit, checkable human")
  console.error("sign-off citation before merge -- see ai-os/CONSTITUTION.yaml SEC-06.")
  console.error("")
  console.error("Add a line to the migration file itself:")
  console.error("  -- PRE-APPROVED-LIVE-DDL: <real citation>")
  console.error("where <real citation> is one of:")
  console.error("  - a decision-log entry ID that actually exists under ai-os/ (KE-<date>-<time>-<hex>)")
  console.error("  - an OWNER_DECISIONS_NEEDED_<date>.yaml reference to a file that actually exists under ai-os/")
  console.error("  - a dated, meaningful-length approval note (e.g. \"Owner approved via Slack DM on 2026-09-29, see #ops-approvals\")")
  console.error("A bare word like `yes` or `approved` is not a citation and will not pass.")
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
