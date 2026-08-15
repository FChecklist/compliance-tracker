#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
// Debt & Complexity, "Duplicate Code Detection" finding (2026-07-18, marked
// High -- prior state: no duplicate-code detection tooling at all). Wraps
// jscpd (config: .jscpd.json) with a real, measured threshold rather than a
// zero-duplication gate.
//
// Baseline measured 2026-07-18 via `bunx jscpd` against .jscpd.json's
// path/format/ignore rules: 5.74% duplicated lines across src/**/*.{ts,tsx}
// (schema.ts and *.test.ts excluded -- schema.ts is generated-shape
// boilerplate by nature, and test files legitimately share setup/fixture
// patterns that aren't the kind of duplication this check is meant to
// catch). .jscpd.json's threshold is set to 7% -- a real buffer above
// today's baseline (not 0%, which this run would already fail, and not
// left uncapped, which would mean the tool exists but enforces nothing).
// jscpd's own --threshold flag does the actual gating (non-zero exit when
// exceeded) -- this wrapper exists only to match this repo's check-*.mjs
// naming/invocation convention and give a clear failure message, the same
// reason check-dead-code.mjs wraps knip instead of calling it bare from CI.
//
// Honest limitation: 7% is a coarse repo-wide average, not a per-file
// budget -- a single new 500-line file that's 100% copy-pasted from an
// existing one could still slip through if the rest of the repo is small
// enough to dilute the percentage. Tightening this to a per-file or per-PR
// diff check is future work, not attempted here.

import { execFileSync } from "node:child_process"

try {
  execFileSync("bunx", ["jscpd", "--config", ".jscpd.json"], { cwd: process.cwd(), stdio: "inherit" })
} catch (err) {
  console.error("\nDuplicate Code Check FAILED: duplication exceeds the 7% threshold in")
  console.error(".jscpd.json. Run `bunx jscpd --config .jscpd.json --reporters consoleFull`")
  console.error("locally to see exactly which blocks are duplicated.")
  process.exit(typeof err.status === "number" ? err.status : 1)
}

console.log("\nDuplicate Code Check passed -- duplication is within the 7% threshold.")
