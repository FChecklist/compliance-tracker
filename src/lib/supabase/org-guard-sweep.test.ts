/// <reference types="bun-types" />
// R62 B3: filesystem-walking regression test for E-52 (platform.r43_faults
// fault_id LIKE 'E52_%'). The 76-route sweep in this PR replaced every
// `if (!ctx.orgId) return NextResponse.json({ <empty shape> })` -- a
// fake-success 200 on a broken auth/org context, indistinguishable from a
// real, legitimately-empty tenant -- with the shared requireOrg() guard
// (src/lib/supabase/auth-guard.ts), which always returns a real 400. This
// test is the regression guard: it reads every real route.ts file on disk
// under src/app/api and fails if that silent-empty-200 shape is ever
// reintroduced anywhere in the tree, not just in the 76 files this PR
// touched -- so a future new route (or a careless revert) can't quietly
// bring the pattern back without CI catching it.
//
// Deliberately pure text/regex detection, not a TS AST parse (same
// "reviewable, not a compiler" honest-limitation class as this repo's other
// check-*.mjs scripts) -- and deliberately does NOT import anything from
// auth-guard.ts, so this test still runs (and still correctly fails) even
// in a pre-fix tree where requireOrg doesn't exist yet. That's what the
// stash-and-rerun proof in the PR description depends on.
import { describe, test, expect } from "bun:test"
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"

// A falsy-orgId guard that returns NextResponse.json(...) with NO `status:`
// anywhere in the (possibly two-argument, e.g. `(body, init)`) call is the
// exact fake-success-200 shape E-52 found 80 instances of live-grepping
// this repo (#1418) -- a real error response always carries a non-2xx
// `status:` (400/401/403), so its absence is what marks this as the
// silent-empty-200 defect rather than a legitimate, already-loud guard.
const GUARD_START_RE = /if\s*\(\s*!\s*ctx\.orgId\b[^)]*\)\s*return\s+NextResponse\.json\(/g

// Finds the full `NextResponse.json(...)` call text starting at `openParenIdx`
// (the index of the `(` right after `NextResponse.json`), via a simple
// balanced-paren scan -- correct for both the one-arg silent-200 shape and
// the two-arg `(body, { status: N })` shape a real fix produces.
function captureCall(source: string, openParenIdx: number): string {
  let depth = 0
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i]
    if (ch === "(") depth++
    else if (ch === ")") {
      depth--
      if (depth === 0) return source.slice(openParenIdx, i + 1)
    }
  }
  return source.slice(openParenIdx) // unbalanced (shouldn't happen in real valid TS) -- return the rest
}

export type Violation = { file: string; line: number; snippet: string }

// Core pure function: scan one file's already-read source text for the E-52
// silent-empty-200 shape. Exported so the synthetic-fixture tests below can
// prove both directions (catches the bad shape, doesn't false-positive on
// the fixed shape) against the exact same logic the real repo sweep uses.
export function findSilentOrgGuardViolations(filePath: string, source: string): Violation[] {
  const violations: Violation[] = []
  GUARD_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = GUARD_START_RE.exec(source))) {
    const matchStart = m.index
    // Skip a commented-out occurrence -- same honest-limitation class as
    // check-route-error-handling.mjs's textual (not AST) matching.
    const lineStart = source.lastIndexOf("\n", matchStart) + 1
    const linePrefix = source.slice(lineStart, matchStart).trim()
    if (linePrefix.startsWith("//") || linePrefix.startsWith("*")) continue

    const openParenIdx = matchStart + m[0].length - 1 // index of the "(" the regex ended on
    const call = captureCall(source, openParenIdx)
    if (/status\s*:/.test(call)) continue // already a real (non-200) error response -- not the defect

    const line = source.slice(0, matchStart).split("\n").length
    const snippet = source.slice(matchStart, Math.min(matchStart + 140, source.length)).replace(/\s+/g, " ").trim()
    violations.push({ file: filePath, line, snippet })
  }
  return violations
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(full))
    } else if (entry.isFile() && entry.name === "route.ts") {
      out.push(full)
    }
  }
  return out
}

// Real repo sweep -- src/app/api relative to this test file, resolved via
// import.meta.dir rather than process.cwd() so it's correct regardless of
// where `bun test` is invoked from (repo root in CI, a worktree elsewhere).
const API_DIR = join(dirname(import.meta.dir), "..", "app", "api")

describe("E-52 org-guard sweep: synthetic fixtures prove the detector itself", () => {
  let tmpDir: string
  const write = (name: string, content: string) => {
    const p = join(tmpDir, name)
    writeFileSync(p, content, "utf8")
    return p
  }

  test("setup", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "org-guard-sweep-"))
    expect(tmpDir.length).toBeGreaterThan(0)
  })

  test("REGRESSION: catches the real pre-fix E-52 shape -- single-key empty array", () => {
    const src = `export async function GET(request: NextRequest) {\n  const ctx = await requireAuthOrApiKey(request)\n  if (ctx.response) return ctx.response\n  if (!ctx.orgId) return NextResponse.json({ documents: [] })\n\n  try {\n`
    const p = write("bad1.ts", src)
    const v = findSilentOrgGuardViolations(p, src)
    expect(v.length).toBe(1)
    expect(v[0].line).toBe(4)
  })

  test("REGRESSION: catches the real pre-fix E-52 shape -- multi-key pagination-shaped default", () => {
    const src = `if (!ctx.orgId) return NextResponse.json({ notices: [], total: 0, page: 1, limit: 20, totalPages: 0 })\n`
    const p = write("bad2.ts", src)
    expect(findSilentOrgGuardViolations(p, src).length).toBe(1)
  })

  test("REGRESSION: catches it even combined with a second falsy check (e.g. `|| !actorId`)", () => {
    const src = `if (!ctx.orgId || !actorId) return NextResponse.json({ receipts: [] })\n`
    const p = write("bad3.ts", src)
    expect(findSilentOrgGuardViolations(p, src).length).toBe(1)
  })

  test("does NOT flag a route.ts already fixed with an explicit 400 status", () => {
    const src = `if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })\n`
    const p = write("ok1.ts", src)
    expect(findSilentOrgGuardViolations(p, src).length).toBe(0)
  })

  test("does NOT flag a route.ts routed through the new requireOrg() shared guard", () => {
    const src = `const ctx = await requireAuthOrApiKey(request)\n  if (ctx.response) return ctx.response\n  const orgErr = requireOrg(ctx)\n  if (orgErr) return orgErr\n\n  try {\n`
    const p = write("ok2.ts", src)
    expect(findSilentOrgGuardViolations(p, src).length).toBe(0)
  })

  test("does NOT flag a commented-out occurrence of the old shape", () => {
    const src = `  // if (!ctx.orgId) return NextResponse.json({ documents: [] })\n  const orgErr = requireOrg(ctx)\n`
    const p = write("ok3.ts", src)
    expect(findSilentOrgGuardViolations(p, src).length).toBe(0)
  })

  test("teardown", () => {
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("E-52 org-guard sweep: real repo, every route.ts on disk under src/app/api", () => {
  // Real repo has 700+ route.ts files as of this PR -- reading and
  // regex-scanning every one comfortably exceeds bun:test's 5000ms default
  // per-test timeout on a slower/loaded CI runner (~1-2 min observed
  // locally), so this gets its own generous explicit timeout rather than
  // risking a flaky false failure that has nothing to do with the actual
  // check.
  test("no silent-empty-200 falsy-orgId guard remains anywhere in the tree, outside requireOrg()", () => {
    const files = listRouteFiles(API_DIR)
    // Sanity floor: this repo has hundreds of v1 route.ts files alone (255+
    // at the time E-52 was scoped) -- if this drops near zero, API_DIR
    // resolution itself is broken and the sweep below would pass for the
    // wrong reason (nothing to scan), not because the defect is fixed.
    expect(files.length).toBeGreaterThan(200)

    const allViolations: Violation[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      allViolations.push(...findSilentOrgGuardViolations(file, source))
    }

    if (allViolations.length > 0) {
      const listing = allViolations
        .map((v) => `  - ${v.file}:${v.line}  ${v.snippet}`)
        .join("\n")
      throw new Error(
        `${allViolations.length} route.ts file(s) still return a silent fake-success 200 on a falsy ` +
        `ctx.orgId check instead of routing through requireOrg() (src/lib/supabase/auth-guard.ts):\n${listing}`
      )
    }
    expect(allViolations.length).toBe(0)
  }, 30000)
})
