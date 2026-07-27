// TET Engine (Task Execution Trace) increment 1 -- client-facing security
// shield gate for user-submitted TET-engine actions. REUSES the existing
// 4-layer defense-in-depth prompt-security module (src/lib/prompt-security/)
// rather than reimplementing regex-based filtering: Layer 1 (deterministic
// input-sanitization threat classification, classifyInputDeterministic --
// network-free, always on) is mandatory; Layer 3 (Llama-Guard runtime
// guardrail, evaluateWithLlamaGuard) runs whenever a Groq key is configured,
// same opt-in-if-available posture defense-in-depth.ts itself uses for
// callers without GROQ_API_KEY.
//
// Deliberately does NOT call defense-in-depth.ts's runDefenseInDepth()
// directly -- that function's whole contract is "wraps one real callLLM()
// call" (its own header comment), and a TET action is an arbitrary
// user-initiated operation (e.g. "complete this checklist item"), not a
// prompt bound for an LLM. This gate calls the same underlying layer1/layer3
// functions runDefenseInDepth() calls, applying its own fail-closed-on-
// network-error posture (AGENTS.md Rule 9: "no silent guardrail bypass"),
// without requiring an LLM call to exist at all.
//
// Gap check (per this task's own SCOPE item 2): no new regex threat
// patterns were added here. layer1-input-sanitization.ts's THREAT_PATTERNS
// (instruction_override, role_play_jailbreak, system_prompt_exfiltration,
// encoding_obfuscation, invisible_unicode, delimiter_injection) already
// cover the injection/jailbreak/exfiltration pattern classes a malicious
// TET action description could contain; nothing TET-specific was found
// missing from that coverage.
import { classifyInput } from "@/lib/prompt-security/layer1-input-sanitization"
import { evaluateWithLlamaGuard } from "@/lib/prompt-security/layer3-runtime-guardrails"
import type { Layer1Result, LlamaGuardVerdict } from "@/lib/prompt-security/types"

export type TetShieldGateResult = {
  verdict: "pass" | "block"
  reason: string | null
  layer1: Layer1Result
  layer3: LlamaGuardVerdict | null
}

export type TetShieldGateOptions = {
  // The actual text being gated -- a free-text action description, note, or
  // other user-submitted content driving this TET action.
  text: string
  // Groq key for Layer 1's optional Prompt Guard second opinion + Layer 3's
  // Llama Guard call -- same as defense-in-depth.ts's groqApiKey option.
  // Pass null to run Layer 1's deterministic check only (Layer 3 is skipped
  // entirely, not failed closed, matching Layer 1's own "no key -> skip the
  // network-dependent half" contract in classifyInput()).
  groqApiKey: string | null
}

/**
 * Runs Layer 1 (input classification) then, if a Groq key is configured,
 * Layer 3 (Llama Guard) over the given text. Blocks on a "malicious" Layer 1
 * verdict or an unsafe Layer 3 verdict -- including Layer 3's own network/API
 * failure, which fails CLOSED (blocks) rather than silently treating an
 * unevaluated input as safe, same posture as defense-in-depth.ts's own Layer
 * 3 handling.
 */
export async function runTetShieldGate(options: TetShieldGateOptions): Promise<TetShieldGateResult> {
  const layer1 = await classifyInput(options.text, options.groqApiKey)

  if (layer1.verdict === "malicious") {
    return {
      verdict: "block",
      reason: `Layer 1 rejected this action as malicious: ${layer1.deterministicMatches.map((m) => m.detail).join("; ") || "Prompt Guard classifier flagged this input"}`,
      layer1,
      layer3: null,
    }
  }

  if (!options.groqApiKey) {
    return { verdict: "pass", reason: null, layer1, layer3: null }
  }

  let layer3: LlamaGuardVerdict
  try {
    layer3 = await evaluateWithLlamaGuard(options.text, options.groqApiKey)
  } catch (err) {
    console.error("[tet-shield-gate] Layer 3 (Llama Guard) call failed -- failing closed (blocking the action), not defaulting to safe:", err)
    return {
      verdict: "block",
      reason: "Layer 3 (Llama Guard) check failed (network/API error) -- failing closed rather than assuming the action is safe",
      layer1,
      layer3: { safe: false, categories: ["LAYER3_UNAVAILABLE"], raw: err instanceof Error ? err.message : String(err) },
    }
  }

  if (!layer3.safe) {
    return {
      verdict: "block",
      reason: `Layer 3 (Llama Guard) flagged this action as unsafe: categories ${layer3.categories.join(",") || "unspecified"}`,
      layer1,
      layer3,
    }
  }

  return { verdict: "pass", reason: null, layer1, layer3 }
}
