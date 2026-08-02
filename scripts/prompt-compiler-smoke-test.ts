#!/usr/bin/env bun
// VERIDIAN_Architecture_v2.0 phase_2 SUCCESS_CRITERIA command: runs the
// Layer 2-5 compiler pipeline end to end on one real sample prompt, no DB,
// no LLM call (this pipeline is pure/deterministic by design -- see
// prompt-construction.ts's header comment). Exit 0 on success.
import { runPipeline } from "@/lib/prompt-compiler"

const result = runPipeline({
  rawText: "Hi, could you please basically fix the login bug in the auth module for me today? Thanks!",
  business: { orgId: "org_smoke_test", orgName: "Smoke Test Org", country: "IN" },
  user: { userId: "user_smoke_test", displayName: "Smoke Test User", roles: [] },
  sessionMessages: [
    { role: "user", content: "We had an issue with the login flow yesterday.", id: "m1" },
    { role: "assistant", content: "Can you share the error message?", id: "m2" },
  ],
})

console.log("=== VERIDIAN_Architecture_v2.0 phase_2 compiler pipeline smoke test ===")
console.log(JSON.stringify(result, null, 2))

let ok = true
function assertTrue(condition: boolean, label: string) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`)
  if (!condition) ok = false
}

assertTrue(result.analysis.classification.category === "CODE", "Layer 2 classified the sample as CODE")
assertTrue(result.compiled.machinePrompt.length > 0, "Layer 4 produced a non-empty machine prompt")
assertTrue(/^[0-9a-f]{64}$/.test(result.compiled.contentHash), "Layer 4 produced a real sha256 content hash")
assertTrue(/^[0-9a-f]{64}$/.test(result.compiled.fingerprint), "Layer 4 produced a real semantic fingerprint")
assertTrue(result.verification.checks.length === 4, "Layer 5 ran all 4 verification checks")
assertTrue(result.verification.confidence.signals.length === 4, "Layer 5 computed all 4 confidence signals")
assertTrue(result.timings.length === 4, "all 4 pipeline stages reported a timing")
assertTrue(
  result.timings.every((t) => t.durationMs >= 0),
  "every stage timing is a real, non-negative measured duration"
)

if (!ok) {
  console.error("\nSMOKE TEST FAILED")
  process.exit(1)
}
console.log("\nSMOKE TEST PASSED")
