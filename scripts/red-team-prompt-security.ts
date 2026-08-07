#!/usr/bin/env bun
// VERIDIAN_Architecture_v2.0 phase_4: Red Team Engine CLI -- the real command
// a cron wrapper (mirroring /opt/veridian/ai-os/scripts/audit_pipeline_security.py's
// own subprocess + finding-normalization pattern, per this phase's own scope
// note to reuse registries.auditor_engine's real scanning-cadence pattern)
// shells out to. Runs the curated adversarial battery
// (src/lib/prompt-security/red-team-battery.ts) against Layer 1's
// deterministic classifier and prints one JSON object to stdout --
// zero network, zero DB, safe to run on any cadence. Exit code is non-zero
// only if the pass rate drops below the threshold (a real regression a cron
// wrapper should alert on), matching audit_pipeline_security.py's own
// "findings are data, not pipeline failure, unless something is actually
// broken" exit-code convention.
import { runRedTeamBattery } from "@/lib/prompt-security"

const PASS_RATE_THRESHOLD_PCT = 90

const report = runRedTeamBattery()
const output = {
  domain: "prompt_security",
  standard_cited: "VERIDIAN_Architecture_v2.0 2.8 Defense-in-Depth Security Architecture, Layer 1 (Input Sanitization)",
  tool: "custom-red-team-battery (payload categories sourced from garak's published probe taxonomy -- see ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml)",
  ranAtIso: new Date().toISOString(),
  totalSamples: report.totalSamples,
  passedSamples: report.passedSamples,
  passRatePct: report.passRatePct,
  findings: report.findings,
}

console.log(JSON.stringify(output, null, 2))

if (report.passRatePct < PASS_RATE_THRESHOLD_PCT) {
  console.error(`\nRED TEAM REGRESSION: pass rate ${report.passRatePct}% is below the ${PASS_RATE_THRESHOLD_PCT}% threshold`)
  process.exit(1)
}
