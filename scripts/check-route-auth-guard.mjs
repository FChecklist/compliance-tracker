#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (AI Engineering Quality / Code
// Structure & Modularity), [Low] "Design Pattern Consistency": "Patterns
// are convention-enforced, not compiler/lint-enforced." Recommended
// approach (the finding's own words): "Add a custom lint rule requiring
// requireAuth()/ServiceError usage in new API routes/services."
//
// Same enforcement class and shape as scripts/check-route-error-handling.mjs
// (introduced for the sibling "Error Handling Quality" finding) -- this
// repo's established pattern for "compiler/lint-enforced" conventions is a
// standalone diff-scoped Node check wired into CI, not a real ESLint rule
// (eslint.config.mjs deliberately runs with almost every built-in rule
// switched off; there's no local-rule plugin infrastructure to extend).
// Reuses that script's exact base-ref resolution and diff-only philosophy:
// only checks NEW or MODIFIED files, never retroactively fails CI on
// pre-existing gaps.
//
// Checks two conventions, independently, both AGENTS.md/CLAUDE.md-mandated:
//   1. Every new/changed src/app/api/**/route.ts must call requireAuth()
//      somewhere in the file ("All API routes MUST call requireAuth() from
//      @/lib/supabase/auth-guard" -- CLAUDE.md).
//   2. Every new/changed src/lib/services/*-service.ts must reference
//      ServiceError somewhere in the file (either define/throw it, or
//      import and use the shared shape) -- the established error-shaping
//      convention (see src/lib/services/compliance-service.ts).
//
// Honest limitation, same class as check-route-error-handling.mjs's own
// header: this is a textual "does the identifier appear anywhere in the
// file" check, not a control-flow analysis -- it does not verify
// requireAuth()'s result is actually used to gate the handler, nor that
// ServiceError is thrown on every failure path. A determined author could
// satisfy this check with an unused import; that is a reviewable-diff
// problem for a human/AI reviewer to catch in the PR, same class of
// guarantee as every other check-*.mjs here.
//
// CI wiring status: NOT yet wired into .github/workflows/ci.yml as of this
// commit -- this session's git token lacks the `workflow` OAuth scope
// needed to push a branch that touches .github/workflows/*.yml (same
// documented limitation as the "Back out ci.yml wiring for the new
// service-header-comment check" commit in this repo's history). A
// follow-up session with a workflow-scoped token should add:
//   - run: node scripts/check-route-auth-guard.mjs --base origin/main
// as its own job step, alongside check-route-error-handling.mjs (which
// has the same not-yet-wired status).
//
// Usage: node scripts/check-route-auth-guard.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-route-auth-guard.mjs
// Exit code 0 = no new violations, 1 = new violation detected.

import { execSync } from "child_process"
import { readFileSync } from "fs"

// A route/service file genuinely may not need requireAuth()/ServiceError
// (e.g. a webhook endpoint authenticated by signature, not a session; a
// pure-function service with no I/O that cannot fail) -- list it here with
// a one-line reason rather than letting CI block a real, justified
// exception.
const ROUTE_AUTH_EXEMPTIONS = new Set([
  // Example: "src/app/api/health/route.ts", // static payload, no auth boundary
])
const SERVICE_ERROR_EXEMPTIONS = new Set([
  // Example: "src/lib/services/pure-math-service.ts", // no I/O, cannot fail
])

const HTTP_HANDLER_RE = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/
const REQUIRE_AUTH_RE = /\brequireAuth\s*\(/
const SERVICE_ERROR_RE = /\bServiceError\b/

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
    return "HEAD~1"
  }
}

function getMergeBase(baseRef) {
  try {
    return run(`git merge-base ${baseRef} HEAD`)
  } catch {
    return baseRef
  }
}

function getChangedFiles(baseRef, predicate) {
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
  return [...new Set(all)].filter(predicate)
}

function main() {
  const baseRef = resolveBaseRef()

  const routeFiles = getChangedFiles(baseRef, (f) => f.startsWith("src/app/api/") && f.endsWith("/route.ts"))
  const serviceFiles = getChangedFiles(baseRef, (f) => f.startsWith("src/lib/services/") && f.endsWith("-service.ts") && !f.endsWith(".test.ts"))

  const authViolations = []
  for (const file of routeFiles) {
    if (ROUTE_AUTH_EXEMPTIONS.has(file)) continue
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch {
      continue // deleted file
    }
    if (!HTTP_HANDLER_RE.test(source)) continue
    if (!REQUIRE_AUTH_RE.test(source)) authViolations.push(file)
  }

  const serviceErrorViolations = []
  for (const file of serviceFiles) {
    if (SERVICE_ERROR_EXEMPTIONS.has(file)) continue
    let source
    try {
      source = readFileSync(file, "utf8")
    } catch {
      continue // deleted file
    }
    if (!SERVICE_ERROR_RE.test(source)) serviceErrorViolations.push(file)
  }

  if (routeFiles.length === 0 && serviceFiles.length === 0) {
    console.log(`No new/changed API route or service files -- nothing to check (base: ${baseRef}).`)
    process.exit(0)
  }

  if (authViolations.length > 0 || serviceErrorViolations.length > 0) {
    if (authViolations.length > 0) {
      console.error("ERROR: new/modified API route file(s) export an HTTP handler with no requireAuth() call:")
      for (const f of authViolations) console.error(`  - ${f}`)
      console.error("Add `const { user, orgId } = await requireAuth()` (see @/lib/supabase/auth-guard) near the top of the handler.")
      console.error("If this route is genuinely unauthenticated by design (e.g. signature-verified webhook), add it to")
      console.error("ROUTE_AUTH_EXEMPTIONS at the top of scripts/check-route-auth-guard.mjs with a one-line reason.")
      console.error("")
    }
    if (serviceErrorViolations.length > 0) {
      console.error("ERROR: new/modified service file(s) never reference ServiceError:")
      for (const f of serviceErrorViolations) console.error(`  - ${f}`)
      console.error("Throw/import ServiceError for failure paths (see src/lib/services/compliance-service.ts for the established shape).")
      console.error("If this service genuinely cannot fail (pure function, no I/O), add it to SERVICE_ERROR_EXEMPTIONS")
      console.error("at the top of scripts/check-route-auth-guard.mjs with a one-line reason.")
    }
    process.exit(1)
  }

  console.log(`OK: ${routeFiles.length} route file(s) + ${serviceFiles.length} service file(s) checked, all follow the requireAuth()/ServiceError convention (base: ${baseRef}).`)
  process.exit(0)
}

main()
