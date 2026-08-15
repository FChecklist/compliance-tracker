#!/usr/bin/env node
// AI Engineering Quality / Technical Debt gap-closure -- "Duplicate Code
// Detection" finding: no automated duplicate-code detection existed
// anywhere in CI before this. jscpd (config: .jscpd.json) is the actual
// detector; this script runs it and turns its own exit code into a clear
// CI failure message, the same wrapper role check-dead-code.mjs plays for
// knip.
//
// Threshold rationale: a first real run against src/ (excluding
// components/ui (shadcn-generated, not this codebase's own duplication),
// *.test.ts(x), and db/schema.ts (a declarative table-definition file
// where structurally-similar column blocks are expected and not
// meaningful debt)) measured 1.97% duplicated lines. .jscpd.json's
// `threshold: 4` gates on the WHOLE-REPO percentage exceeding 4% -- headroom
// over the measured baseline so normal, unrelated development doesn't
// trip this by chance, while still catching a real step-change in
// copy-pasted logic. Unlike check-dead-code.mjs / check-migration-
// collision.mjs, this is intentionally NOT diff-scoped: duplication is a
// property of the whole codebase (a duplicate can straddle one old file
// and one new file), not something `git diff` against a single PR can
// meaningfully isolate.
//
// Honest limitation, same class as every other check-*.mjs in this repo:
// jscpd's clone detection is token-based, not semantic -- it will not
// catch logic that's duplicated with different variable names or
// restructured control flow, and a legitimately unavoidable near-copy
// (e.g. two DB migration-adjacent seed scripts) can trip a rise in the
// percentage as validly as an accidental copy-paste. Raising the
// threshold is a reviewable diff to this file, not a silent bypass -- if
// it needs raising, say why in the PR.
//
// Usage: node scripts/check-duplicate-code.mjs

import { execSync } from "node:child_process"

try {
  const output = execSync("bunx jscpd --silent", { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 })
  console.log(output)
  console.log("check-duplicate-code: duplication is within threshold (see .jscpd.json).")
  process.exit(0)
} catch (err) {
  const stdout = (err.stdout ?? "").toString()
  const stderr = (err.stderr ?? "").toString()
  console.error(stdout)
  console.error(stderr)
  console.error("\nERROR: duplicate-code threshold exceeded (.jscpd.json `threshold`). Either de-duplicate the flagged clones, or if the duplication is genuinely unavoidable, raise the threshold in .jscpd.json and explain why in the PR description.")
  process.exit(1)
}
