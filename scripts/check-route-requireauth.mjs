#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (task-20260718-112006-retry-1--ai-
// engineering-quality--code-s), [Low] Design Pattern Consistency: "Patterns
// are convention-enforced, not compiler/lint-enforced." Recommended
// approach (the finding's own words): "Add a custom lint rule requiring
// requireAuth()/ServiceError usage in new API routes/services."
//
// CI guard: fails if a NEW or MODIFIED src/app/api/**/route.ts file exports
// an HTTP method handler (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) with no
// visible call to requireAuth() (from @/lib/supabase/auth-guard) anywhere
// in the file. Same enforcement class/shape as the sibling check --
// scripts/check-route-error-handling.mjs (task-20260718-065003, PR #1219)
// already covers the "ServiceError" half of this finding's recommendation
// (try/catch presence); this script covers the "requireAuth()" half. Not
// merged into one script deliberately -- they check independent, separately
// exemptable properties, matching check-route-error-handling.mjs's own
// TRIVIAL_ROUTE_EXEMPTIONS pattern (a route can legitimately need one
// exemption but not the other).
//
// Implemented as a repo-native CI script rather than an actual ESLint AST
// rule: this repo's eslint.config.mjs already has nearly every rule turned
// off (see that file's own comments), and every other convention-
// enforcement gate in this repo (check-guardrail-presence.mjs,
// check-migration-collision.mjs, check-route-error-handling.mjs, etc.) uses
// this same "new/changed-files-only CI script" pattern -- following the
// established precedent instead of introducing a second, inconsistent
// enforcement mechanism.
//
// Same precedent, same honest limitation: only checks files that are new
// or changed relative to the base branch, NOT every route.ts in the repo.
// A mass retroactive check across the ~995 existing route.ts files risks
// colliding with unrelated in-flight work across this file's own directory
// for what this finding rates a Low-severity issue -- this only stops the
// number of un-authed new routes from growing.
//
// Honest limitation, same class as check-route-error-handling.mjs: this is
// a textual "does `requireAuth(` appear anywhere in the file" check, not a
// control-flow analysis -- it does not verify requireAuth() is actually
// called before the handler does anything sensitive, only that it's
// present. A determined author could satisfy this check with a dead-code
// call; that is a reviewable-diff problem for a human/AI reviewer to catch
// in the PR, same class of guarantee as every other check-*.mjs here.
//
// Usage: node scripts/check-route-requireauth.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-route-requireauth.mjs
// Exit code 0 = no new violations, 1 = new violation detected.

import { execSync } from "child_process"
import { readFileSync } from "fs"

// A route file genuinely may not need requireAuth() (e.g. a public/
// unauthenticated endpoint by design) -- list it here with a one-line
// reason rather than letting CI block a real, justified exception.
const TRIVIAL_ROUTE_EXEMPTIONS = new Set([
  // Example: "src/app/api/health/route.ts", // public liveness probe, no auth by design
])

const HTTP_HANDLER_RE = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/
const REQUIRE_AUTH_RE = /\brequireAuth\s*\(/

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim()
}

function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]

  if (process.env.BASE_REF && process.env.BASE_REF.trim()) return process.env.BASE_REF.trim()

  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // ignore -- use whatever origin/main we already have, if anything
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // origin/main not available locally at all, fall through
  }

  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // no local main either, fall through
  }

  return "HEAD~1"
}

function getMergeBase(baseRef) {
  try {
    return run(`git merge-base HEAD ${baseRef} 2>/dev/null`) || "HEAD~1"
  } catch {
    return "HEAD~1"
  }
}

function getChangedRouteFiles(baseRef) {
  const mergeBase = getMergeBase(baseRef)
  let changedOut = ""
  let untrackedOut = ""
  try {
    changedOut = run(`git diff --name-only --diff-filter=d ${mergeBase} HEAD 2>/dev/null`)
  } catch {
    changedOut = ""
  }
  try {
    untrackedOut = run("git ls-files --others --exclude-standard 2>/dev/null")
  } catch {
    untrackedOut = ""
  }
  const all = [...changedOut.split("\n"), ...untrackedOut.split("\n")].filter(Boolean)
  return [...new Set(all)].filter((f) => f.startsWith("src/app/api/") && f.endsWith("/route.ts"))
}

function main() {
  const baseRef = resolveBaseRef()
  const files = getChangedRouteFiles(baseRef)
  if (files.length === 0) {
    console.log(`No new/changed API route files -- nothing to check (base: ${baseRef}).`)
    process.exit(0)
  }

  const violations = []
  for (const file of files) {
    if (TRIVIAL_ROUTE_EXEMPTIONS.has(file)) continue
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch {
      continue // deleted file
    }
    if (!HTTP_HANDLER_RE.test(source)) continue
    if (!REQUIRE_AUTH_RE.test(source)) violations.push(file)
  }

  if (violations.length > 0) {
    console.error("ERROR: new/modified API route file(s) export an HTTP handler with no visible requireAuth() call:")
    for (const f of violations) console.error(`  - ${f}`)
    console.error("")
    console.error("Call requireAuth() from @/lib/supabase/auth-guard before doing anything with the request")
    console.error("(see any existing route.ts for the established pattern this repo already uses, or")
    console.error("docs/architecture/REUSABLE-UTILITIES.md for the reuse index).")
    console.error("If this route is genuinely and deliberately unauthenticated, add it to")
    console.error("TRIVIAL_ROUTE_EXEMPTIONS at the top of scripts/check-route-requireauth.mjs with a one-line reason.")
    process.exit(1)
  }

  console.log(`OK: ${files.length} new/changed API route file(s) checked, all call requireAuth() (base: ${baseRef}).`)
  process.exit(0)
}

main()
