#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, "Duplicate Code Detection" finding
// (AI Engineering Quality / Technical Debt & Complexity): "Add jscpd (or
// similar) to CI with a report threshold, following the codebase's
// existing check-*.mjs guardrail pattern." Same enforcement class as the
// other check-*.mjs scripts: a reviewable-diff guarantee via PR/CI, not a
// runtime-unbypassable lock -- named honestly, not oversold.
//
// Thin wrapper around jscpd (config: .jscpd.json, repo root) so this check
// reports the same way every other check-*.mjs script does, and so the
// threshold decision lives in one reviewable place instead of being
// hardcoded twice (CI job + local dev invocation). jscpd itself does the
// real detection and threshold gating (.jscpd.json's own `threshold: 6` --
// measured duplication at authoring time was 5.40% across src/**/*.{ts,tsx};
// 6% leaves headroom for organic growth while still catching a real
// regression spike). Scope: src/**/*.{ts,tsx} only, excluding tests
// (legitimate structural repetition, not the actionable kind), schema.ts
// (hundreds of DB table definitions that are structurally repetitive by
// necessity, not copy-paste debt), and src/components/ui/** (shadcn/ui-
// generated components, third-party pattern, not app logic). See
// .jscpd.json's own `ignore` list for the exact scope.
//
// Usage: node scripts/check-duplicate-code.mjs
// Exit code: mirrors jscpd's own -- 0 under threshold, 1 at/over it.
import { execFileSync } from "node:child_process"
import path from "node:path"

const REPO_ROOT = process.cwd()
const JSCPD_BIN = path.resolve(REPO_ROOT, "node_modules/.bin/jscpd")

try {
  execFileSync(JSCPD_BIN, ["-c", ".jscpd.json"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  })
  console.log("\nDuplicate Code Check passed -- duplication is under .jscpd.json's recorded threshold.")
} catch (err) {
  if (typeof err.status === "number") {
    console.error("\n=== Duplicate Code Check FAILED ===")
    console.error(
      "jscpd found duplication at or over .jscpd.json's threshold. Either\n" +
      "refactor the flagged clones, or -- if the threshold itself needs\n" +
      "reconsidering -- raise it in .jscpd.json with a comment explaining why."
    )
    process.exit(err.status)
  }
  console.error("Duplicate Code Check crashed (jscpd itself failed to run):", err.message)
  process.exit(1)
}
