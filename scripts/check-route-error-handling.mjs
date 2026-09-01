#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (task-20260718-065003-ai-engineering-
// quality--error-handling), [Low] Error Handling Quality: "~9% of API
// routes lack a visible try/catch." Recommended approach (the finding's own
// words): "Add an ESLint rule or CI check requiring try/catch + ServiceError
// handling in every route.ts."
//
// CI guard: fails if a NEW or MODIFIED src/app/api/**/route.ts file exports
// an HTTP method handler (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) with no
// visible `try {` block anywhere in the file.
//
// Same enforcement class/precedent as check-migration-collision.mjs: only
// checks files that are new or changed relative to the base branch, NOT
// every route.ts in the repo. As of this check's introduction, ~7% of
// existing route.ts files (72/995) still lack a try/catch -- this check
// does not retroactively fail CI on that pre-existing debt (a mass
// mechanical edit across 70+ files risks colliding with unrelated
// in-flight work on the same directory, for what the finding itself rates
// a Low-severity issue); it only stops the number from growing, exactly
// like check-migration-collision.mjs does for pre-existing migration-number
// collisions. See that script's own header for the identical framing.
//
// Base ref resolution mirrors check-migration-collision.mjs's own fix
// (2026-07-30, "stale local main ref" incident): in shared checkouts/
// worktrees the local `main` ref is frequently stale relative to
// `origin/main`, which makes a naive `git merge-base HEAD main` misreport
// pre-existing violations as new (or miss real new ones). Resolution
// order, highest priority first: --base <ref> CLI arg, BASE_REF env var,
// freshly-fetched origin/main, local main, HEAD~1.
//
// Honest limitation, same class as this repo's other check-*.mjs scripts:
// this is a textual "does a `try {` appear anywhere in the file" check, not
// a control-flow analysis -- it does not verify the try/catch actually
// wraps the handler body, nor that the catch block does anything
// meaningful (e.g. distinguishes ServiceError, as the established pattern
// in this codebase does -- see src/lib/services/compliance-service.ts's
// `ServiceError` and any of the ~90% of routes that already follow this
// shape). A determined author could satisfy this check with a no-op
// try/catch; that is a reviewable-diff problem for a human/AI reviewer to
// catch in the PR, same class of guarantee as every other check-*.mjs here.
//
// Usage: node scripts/check-route-error-handling.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-route-error-handling.mjs
// Exit code 0 = no new violations, 1 = new violation detected.

import { execSync } from "child_process"
import { readFileSync } from "fs"

// A route file genuinely may not need a try/catch (no I/O, cannot throw) --
// list it here with a one-line reason rather than letting CI block a real,
// justified exception.
const TRIVIAL_ROUTE_EXEMPTIONS = new Set([
  // Example: "src/app/api/health/route.ts", // static payload, no I/O, cannot throw
  "src/app/api/forge/captcha/route.ts", // generateCaptcha() is pure Math.random()+btoa() over ASCII digits, no I/O, no service calls -- see forge-captcha.ts's own header
  "src/app/api/v1/openapi.json/route.ts", // generateOpenApiDocument() is a pure function over static zod schemas, no I/O, no service calls -- see src/lib/openapi/generate.ts's own header
])

const HTTP_HANDLER_RE = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/
const TRY_RE = /\btry\s*\{/

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
    if (!TRY_RE.test(source)) violations.push(file)
  }

  if (violations.length > 0) {
    console.error("ERROR: new/modified API route file(s) export an HTTP handler with no visible try/catch block:")
    for (const f of violations) console.error(`  - ${f}`)
    console.error("")
    console.error("Wrap the handler body in try/catch and translate ServiceError -> NextResponse.json({ error }, { status })")
    console.error('(see src/lib/services/compliance-service.ts\'s ServiceError, src/lib/logger.ts for structured error')
    console.error("logging, and any existing route.ts for the established pattern this repo already uses.")
    console.error("If this route genuinely cannot fail (no I/O, no service calls), add it to TRIVIAL_ROUTE_EXEMPTIONS")
    console.error("at the top of scripts/check-route-error-handling.mjs with a one-line reason.")
    process.exit(1)
  }

  console.log(`OK: ${files.length} new/changed API route file(s) checked, all have a visible try/catch (base: ${baseRef}).`)
  process.exit(0)
}

main()
