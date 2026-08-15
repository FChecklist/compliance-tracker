// VERIDIAN_Architecture_v2.0 phase_4: Layer 3 (Runtime Guardrails) of the
// document's 4-layer defense-in-depth architecture (2.8) -- closes
// pipeline-pre-execution-guardrails' safety-classification sub-scope and
// half of engine-defense-in-depth. Per the document's own description (line
// 493 of the extracted source): "NeMo Guardrails or Llama Guard evaluates
// both the full compiled prompt (input-side guardrails) and the model's
// output (output-side guardrails) against configurable safety policies."
//
// Uses Groq-hosted Llama Guard 4 (meta-llama/llama-guard-4-12b, confirmed
// live ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml)
// through llm-client.ts's existing callLLM() -- the real Gateway G05
// boundary -- rather than a new, separate security choke point. Zero new
// dependency: same "groq" provider llm-client.ts already dispatches every
// other Groq model through.
import { callLLM } from "@/lib/llm-client"
import type { LlamaGuardVerdict } from "./types"

const LLAMA_GUARD_MODEL = "meta-llama/llama-guard-4-12b"

/**
 * Parses Llama Guard's standard 2-line output convention: "safe", or
 * "unsafe\n<comma-or-newline-separated hazard category codes>" (e.g.
 * "unsafe\nS1,S9"). Tolerant of either separator since different Llama
 * Guard generations have used both.
 */
export function parseLlamaGuardOutput(raw: string): LlamaGuardVerdict {
  const trimmed = raw.trim()
  const firstLine = trimmed.split("\n")[0]?.trim().toLowerCase() ?? ""
  const safe = firstLine === "safe" || !/unsafe/i.test(firstLine)
  if (safe) return { safe: true, categories: [], raw: trimmed }

  const rest = trimmed.slice(trimmed.toLowerCase().indexOf("unsafe") + "unsafe".length)
  const categories = rest
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z]?\d+$/.test(s) || /^S\d+$/i.test(s))
  return { safe: false, categories, raw: trimmed }
}

/**
 * Calls Llama Guard 4 over the given text (either the Layer-2-hardened
 * compiled prompt for input-side evaluation, or the model's real response
 * for output-side evaluation -- same function, different call site, matching
 * the document's own "evaluates both" design). Network/API failures throw
 * rather than fail open -- callers that want fail-open-on-error behavior
 * (e.g. a degraded-but-available UX) should catch explicitly and decide,
 * matching this codebase's own "no silent guardrail bypass" discipline
 * (AGENTS.md Rule 9).
 */
export async function evaluateWithLlamaGuard(text: string, apiKey: string): Promise<LlamaGuardVerdict> {
  const result = await callLLM(
    "groq",
    LLAMA_GUARD_MODEL,
    apiKey,
    "",
    text
  )
  return parseLlamaGuardOutput(result.content)
}
