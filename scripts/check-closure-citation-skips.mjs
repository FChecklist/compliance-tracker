#!/usr/bin/env node
// R81 K5-08 -- a cited test must RUN, not merely be green.
//
// WHY THIS EXISTS, AND WHY THE OBVIOUS FIX WOULD NOT HAVE WORKED.
// Six requirements (R-01, R-02, R-32, R-40, R-B1, R-B2) are recorded CLOSED in
// platform.sumeet_requirements citing e2e/demo-gate-smoke.spec.ts. That spec
// declares ONE test, covering TC-01/10/11/30/40, which asserts against REAL
// PRODUCTION -- and at :230 it calls test.skip() when production answers
// DEPLOYMENT_PAUSED or 503. Environment 2 (Vercel) is paused deliberately, so
// the test skips itself on every run.
//
// R81's first remedy for this was "make the citation gate look at CI outcome."
// That was WRONG, and the CI log is what proved it: the E2E job reports
//   "Running 9 tests using 2 workers ... 3 skipped, 6 passed"
// and concludes SUCCESS. A skipped test lives inside a GREEN job. So a
// CI-outcome check passes it just as happily as the four existing structural
// checks do. The property that actually failed is narrower and this is it:
//
//   A TEST CITED AS CLOSURE EVIDENCE MUST NOT BE ABLE TO SILENTLY DECLINE TO RUN.
//
// A conditional skip is a perfectly good thing for a spec to have -- this one is
// well written, it explains itself, and it names its own remedy
// (E2E_PROJEXA_ORIGIN=http://localhost:3100, i.e. environment 1). The defect is
// not the skip. The defect is CITING a self-skipping test as proof a
// requirement is met, because then "requirement satisfied" and "requirement
// never checked" produce identical output everywhere a human or a gate looks.
//
// HOW TO SATISFY THIS CHECK, in the order of preference:
//   1. Run the spec against environment 1 so it does not skip, and cite THAT
//      run -- recording the environment in the citation.
//   2. Cite a different test that does not gate itself on an external service.
//   3. Move the requirement out of CLOSED until one of the above is true.
// Deleting the skip is NOT on that list: it would turn a self-aware skip into a
// hard failure against a deliberately paused environment.
import fs from "node:fs"
import path from "node:path"

const CT = path.resolve(import.meta.dirname, "..")

/**
 * Requirements recorded CLOSED whose evidence is an e2e spec. Mirrors
 * platform.sumeet_requirements.closure_test_path -- kept here rather than read
 * from the database on purpose: this must run in CI, where the platform schema
 * is not reachable (it is service_role-only, and PostgREST does not expose it).
 * A drifted entry is caught by the file-existence leg below.
 */
const CITED = [
  { req: "R-01", spec: "e2e/demo-gate-smoke.spec.ts" },
  { req: "R-02", spec: "e2e/demo-gate-smoke.spec.ts" },
  { req: "R-32", spec: "e2e/demo-gate-smoke.spec.ts" },
  { req: "R-40", spec: "e2e/demo-gate-smoke.spec.ts" },
  { req: "R-B1", spec: "e2e/demo-gate-smoke.spec.ts" },
  { req: "R-B2", spec: "e2e/demo-gate-smoke.spec.ts" },
]

// A citation may declare the environment that makes its spec actually execute.
// Empty today, and that is the honest state: nothing has yet been proven
// against environment 1. Adding an entry here is a claim that must be true.
const PROVEN_AGAINST = {
  // "R-01": { env: "http://localhost:3100", run: "<link or log reference>" },
}

const SKIP_PATTERN = /\btest\.(skip|fixme)\s*\(/
const failures = []
const seen = new Set()

for (const { req, spec } of CITED) {
  const abs = path.join(CT, spec)
  if (!fs.existsSync(abs)) {
    failures.push(`${req} cites ${spec}, which does not exist. Either the citation is stale or the spec was deleted while the requirement stayed CLOSED.`)
    continue
  }
  const src = fs.readFileSync(abs, "utf8")
  if (!SKIP_PATTERN.test(src)) continue
  if (PROVEN_AGAINST[req]) continue
  seen.add(spec)
  failures.push(
    `${req} is CLOSED citing ${spec}, which can skip itself at runtime (test.skip/test.fixme present).\n` +
    `    A skipped test sits inside a GREEN job, so neither the citation gate nor a CI-outcome check\n` +
    `    distinguishes "this requirement holds" from "this requirement was never checked".\n` +
    `    Run it against environment 1 and record that in PROVEN_AGAINST, cite a test that does not\n` +
    `    gate on an external service, or move ${req} out of CLOSED.`,
  )
}

console.log(`closure-citation skips: ${CITED.length} citation(s) checked, ${seen.size} self-skipping spec(s), ${failures.length} failure(s)`)
for (const f of failures) console.error(`\nFAIL  ${f}`)
if (failures.length) {
  console.error(
    `\nA requirement is not closed by a test that declined to run.\n` +
    `This is the gap that took the defensible CLOSED count from 51 to 45.`,
  )
  process.exit(1)
}
process.exit(0)
