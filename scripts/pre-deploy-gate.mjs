#!/usr/bin/env node
// R72 Phase 7 -- Deploy Ritual, pre-deploy gate.
//
// Runs the checks that must pass before a deliberate `vercel --prod` (see
// R72_DEPLOY_RITUAL.md). Exits non-zero on ANY hard failure. The test-suite
// check is baseline-aware: this repo has 69 known, pre-existing, deterministic
// failures (cross-test-file pollution, proven unrelated to any real change --
// see known-test-failures-baseline.json and claude_log ids 176/193). A test
// run that reproduces exactly that baseline is a PASS. A run with MORE
// failures than the baseline, or failures not in the baseline set, is a
// hard FAIL -- something new broke and must be investigated before deploying.
// A run with FEWER failures than the baseline is reported but does not block
// (something got fixed -- update the baseline deliberately, this script
// will not do it silently).
//
// Usage: node scripts/pre-deploy-gate.mjs

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

// This machine's default V8 heap (~2.1GB) OOMs on BOTH `tsc --noEmit` and
// Next's internal build-time typecheck on this codebase's size (14,000+ line
// schema.ts) -- confirmed live by actually running this script (first draft
// only raised the heap for the build step, tsc --noEmit OOM'd at exit 134
// before ever reaching lint/test/build). Set once, globally, before any
// child process spawns, so every step below inherits it via execSync's
// default env passthrough.
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || "--max-old-space-size=6144";

const RESET = "\x1b[0m", RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", BOLD = "\x1b[1m";
const ok = (msg) => console.log(`${GREEN}[PASS]${RESET} ${msg}`);
const fail = (msg) => console.log(`${RED}[FAIL]${RESET} ${msg}`);
const warn = (msg) => console.log(`${YELLOW}[WARN]${RESET} ${msg}`);
const step = (msg) => console.log(`\n${BOLD}== ${msg} ==${RESET}`);

let hardFailures = 0;

function run(label, cmd, opts = {}) {
  step(label);
  try {
    const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
    ok(`${label} exited 0`);
    return { code: 0, out };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    if (opts.tolerant) {
      warn(`${label} exited non-zero (tolerated -- inspected below)`);
      return { code: e.status ?? 1, out };
    }
    fail(`${label} exited ${e.status}`);
    console.log(out.slice(-4000));
    hardFailures++;
    return { code: e.status ?? 1, out };
  }
}

// 1. Install (frozen lockfile -- must not silently drift)
run("bun install --frozen-lockfile", "bun install --frozen-lockfile");

// 2. Typecheck
run("tsc --noEmit", "bun run typecheck");

// 3. Lint (baseline-aware: this repo's own known baseline was 152 warnings,
//    0 errors, as of R71 Phase 4 / claude_log id 176 -- only ERRORS are a
//    hard gate here; a warning-count regression is reported, not blocking,
//    since no work order has yet defined a warning-reduction target).
{
  step("eslint . (0 errors required; warning count reported only)");
  const { out } = run("eslint (raw)", "bun run lint", { tolerant: true });
  const errorMatch = out.match(/(\d+)\s+error/);
  const warnMatch = out.match(/(\d+)\s+warning/);
  const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;
  const warnings = warnMatch ? parseInt(warnMatch[1], 10) : 0;
  if (errors > 0) {
    fail(`lint: ${errors} errors (must be 0)`);
    hardFailures++;
  } else {
    ok(`lint: 0 errors, ${warnings} warnings (baseline was 152 as of 2026-09-04)`);
  }
}

// 4. Full test suite, diffed against the known baseline.
{
  step("bun test (diffed against known-test-failures-baseline.json)");
  const { out } = run("bun test (raw)", "bun test", { tolerant: true });
  const failLines = out.split(/\r?\n/)
    .filter((l) => l.startsWith("(fail)"))
    .map((l) => l.replace(/^\(fail\)\s*/, "").replace(/\s*\[[0-9.]+m?s\]\s*$/, "").trim());

  if (!existsSync("known-test-failures-baseline.json")) {
    warn("no known-test-failures-baseline.json found -- cannot diff, treating ANY failure as hard-fail");
    if (failLines.length > 0) { fail(`${failLines.length} test failures, no baseline to compare against`); hardFailures++; }
    else ok("0 test failures");
  } else {
    const baseline = JSON.parse(readFileSync("known-test-failures-baseline.json", "utf8"));
    const knownSet = new Set(baseline.knownFailures);
    const newFailures = failLines.filter((l) => !knownSet.has(l));
    const stillFailing = failLines.filter((l) => knownSet.has(l));
    const nowFixed = baseline.knownFailures.filter((l) => !failLines.includes(l));

    if (newFailures.length > 0) {
      fail(`${newFailures.length} NEW test failure(s) not in the known baseline:`);
      newFailures.forEach((l) => console.log(`  - ${l}`));
      hardFailures++;
    } else {
      ok(`0 new test failures (${stillFailing.length}/${baseline.knownFailures.length} known baseline failures still present, as expected)`);
    }
    if (nowFixed.length > 0) {
      warn(`${nowFixed.length} previously-known failure(s) now PASS -- consider regenerating the baseline:`);
      nowFixed.forEach((l) => console.log(`  - ${l}`));
    }
  }
}

// 5. Production build (NODE_OPTIONS already raised globally above -- see
//    R72_PARITY_GAP_REGISTER.md item 5. Vercel's own build infra has not been
//    observed to need this; it is purely a constraint of this local machine.)
run("next build", "bun run build");

// Summary
console.log(`\n${BOLD}==================== GATE SUMMARY ====================${RESET}`);
if (hardFailures === 0) {
  console.log(`${GREEN}${BOLD}ALL CHECKS PASSED -- safe to proceed to the deploy step in R72_DEPLOY_RITUAL.md${RESET}`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}${hardFailures} HARD FAILURE(S) -- DO NOT DEPLOY. Fix and re-run this gate.${RESET}`);
  process.exit(1);
}
