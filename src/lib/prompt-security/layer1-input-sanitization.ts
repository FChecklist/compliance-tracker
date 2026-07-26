// VERIDIAN_Architecture_v2.0 phase_4: Layer 1 (Input Sanitization) of the
// document's 4-layer defense-in-depth architecture (2.8) -- closes
// engine-prompt-security (deepen) and the input-guardrail half of
// pipeline-pre-execution-guardrails. Deepens phase_2's classifier.py port
// (intent-classifier.ts) with dedicated threat detection -- that module
// classifies chat CATEGORY (CODE/ANALYSIS/etc), this module classifies
// SECURITY THREAT, a distinct concern.
//
// Two independent detection paths, matching the document's own Layer 1
// description exactly (line 481-483 of the extracted source): (1) a
// deterministic, network-free, zero-latency regex/invisible-unicode-anomaly
// detector -- the ALWAYS-ON baseline, matching this codebase's own
// guardrail-engine.ts precedent ("Deterministic only -- no LLM call, matching
// every other gate in this codebase"); (2) an OPTIONAL network-dependent
// second opinion via Groq-hosted Prompt Guard 2
// (meta-llama/llama-prompt-guard-2-86m, confirmed live
// ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml) --
// callers without a GROQ_API_KEY, or that want zero added latency/cost, get
// the full deterministic verdict with promptGuardClassification left null.
import { callLLM } from "@/lib/llm-client"
// Cross-reference with the existing pre-call policy gate (Wave 46,
// VERIDIAN_AI_CONSTITUTION.md's Constitution Sec 18 -- already
// production-wired on every real LLM call site via enforcePolicy()) instead
// of maintaining a fully independent, silently-divergent pattern list. The
// phase_4 audit found this file's THREAT_PATTERNS never referenced
// checkPromptInjection() at all, so the two could drift apart with no way
// to notice. This module's own patterns still exist and cover categories
// checkPromptInjection() doesn't attempt (role-play variants,
// system-prompt-exfiltration phrasings, encoding/invisible-unicode
// anomalies, XML delimiter injection) -- checkPromptInjection() is added as
// a floor: anything the production pre-call gate already blocks is
// guaranteed to also surface here, even on a future request whose exact
// wording only matches one list.
import { checkPromptInjection } from "@/lib/policy-enforcement-engine"
import type { Layer1Result, PromptGuardClassification, ThreatCategory, ThreatMatch } from "./types"

const PROMPT_GUARD_MODEL = "meta-llama/llama-prompt-guard-2-86m"

// Real, published jailbreak/injection vectors -- the document names
// "ignore previous instructions", "system:", "role-playing attempts"
// explicitly (line 481); the rest are well-known public injection patterns
// (DAN-style, exfiltration asks) any deterministic scanner in this space
// covers. Each pattern is deliberately loose (case-insensitive, tolerant of
// punctuation/spacing variants) -- a false positive here only downgrades a
// request to "suspicious" (see classifyDeterministic below), never silently
// drops it.
const THREAT_PATTERNS: { category: ThreatCategory; pattern: RegExp; detail: string }[] = [
  { category: "instruction_override", pattern: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)\b/i, detail: "instruction-override phrase" },
  { category: "instruction_override", pattern: /\bnew\s+instructions?\s*:/i, detail: "'new instructions:' override attempt" },
  { category: "instruction_override", pattern: /^\s*system\s*:/im, detail: "user content impersonating a system-role prefix" },
  { category: "role_play_jailbreak", pattern: /\b(you are now|act as|pretend (to be|you are)|roleplay as)\b.{0,40}\b(dan|jailbreak|unrestricted|no rules|without restrictions?|developer mode)\b/i, detail: "DAN-style jailbreak role-play request" },
  { category: "role_play_jailbreak", pattern: /\bdeveloper mode\b/i, detail: "'developer mode' jailbreak invocation" },
  { category: "system_prompt_exfiltration", pattern: /\b(reveal|show|print|repeat|output|leak)\b.{0,30}\b(system prompt|initial instructions|your instructions|configuration prompt)\b/i, detail: "system-prompt exfiltration attempt" },
  { category: "system_prompt_exfiltration", pattern: /\bwhat (were|are) your (original |initial )?instructions\b/i, detail: "system-prompt exfiltration attempt" },
  { category: "encoding_obfuscation", pattern: /\\u00[0-9a-f]{2}(\\u00[0-9a-f]{2}){3,}/i, detail: "chained unicode-escape obfuscation" },
  { category: "encoding_obfuscation", pattern: /(?:[A-Za-z0-9+/]{40,}={0,2})/, detail: "long base64-like blob (possible payload obfuscation)" },
  { category: "delimiter_injection", pattern: /<\s*\/?\s*(system|assistant|instructions?)\s*>/i, detail: "fake role/instruction XML delimiter in user content" },
]

// Zero-width and bidi-control characters used to hide injected text from a
// human reviewer while an LLM still tokenizes them -- the document's own
// "character-level anomaly detection for invisible Unicode characters and
// zero-width spaces" requirement (line 481).
const INVISIBLE_UNICODE_RANGE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/

function classifyDeterministic(text: string): ThreatMatch[] {
  const matches: ThreatMatch[] = []
  for (const { category, pattern, detail } of THREAT_PATTERNS) {
    const m = pattern.exec(text)
    if (m) matches.push({ category, matchedText: m[0].slice(0, 120), detail })
  }
  if (INVISIBLE_UNICODE_RANGE.test(text)) {
    matches.push({ category: "invisible_unicode", matchedText: "[non-printable]", detail: "invisible Unicode / zero-width / bidi-control character(s) present" })
  }
  // Floor check against the existing production pre-call gate -- see the
  // import comment above. Only adds a match if THREAT_PATTERNS above missed
  // it entirely, so this never double-counts a real Layer 1 pattern hit.
  const policyCheck = checkPromptInjection(text)
  if (!policyCheck.allowed && !matches.some((m) => m.category === "instruction_override")) {
    matches.push({
      category: "instruction_override",
      matchedText: text.slice(0, 120),
      detail: `policy-enforcement-engine cross-check: ${policyCheck.reason}`,
    })
  }
  return matches
}

// A single category consistent with the "structurally difficult to override"
// vectors (instruction_override, role_play_jailbreak, system_prompt_exfiltration,
// delimiter_injection) is enough to reject outright; invisible-unicode or
// encoding-obfuscation ALONE (which have real benign uses -- copy-pasted rich
// text, legitimate base64 payloads in a CODE request) only downgrade to
// "suspicious", matching the document's own 3-way verdict design.
const HIGH_CONFIDENCE_CATEGORIES: ReadonlySet<ThreatCategory> = new Set([
  "instruction_override", "role_play_jailbreak", "system_prompt_exfiltration", "delimiter_injection",
])

function verdictFromMatches(matches: ThreatMatch[]): Layer1Result["verdict"] {
  if (matches.length === 0) return "benign"
  if (matches.some((m) => HIGH_CONFIDENCE_CATEGORIES.has(m.category))) return "malicious"
  return "suspicious"
}

/** Parses Prompt Guard 2's BENIGN/MALICIOUS text-classification output. */
export function parsePromptGuardOutput(raw: string): PromptGuardClassification {
  const label = /malicious/i.test(raw) ? "MALICIOUS" : "BENIGN"
  return { label, raw: raw.trim() }
}

/**
 * The always-on, network-free, deterministic Layer 1 check. Safe to call on
 * every request with zero added latency/cost/network-dependency.
 */
export function classifyInputDeterministic(rawText: string): Layer1Result {
  const deterministicMatches = classifyDeterministic(rawText)
  return { verdict: verdictFromMatches(deterministicMatches), deterministicMatches, promptGuardClassification: null }
}

/**
 * Full Layer 1 check: the deterministic baseline above, plus an optional
 * live call to Groq-hosted Prompt Guard 2 as a second opinion. A
 * MALICIOUS classification from Prompt Guard escalates a "benign"/"suspicious"
 * deterministic verdict to at least "suspicious" (never silently downgrades
 * a deterministic "malicious" finding -- the stricter of the two always
 * wins). Network/API failures degrade gracefully to the deterministic-only
 * result (promptGuardClassification stays null) rather than failing the
 * whole request open OR closed on an unrelated network error.
 */
export async function classifyInput(rawText: string, apiKey: string | null): Promise<Layer1Result> {
  const deterministic = classifyInputDeterministic(rawText)
  if (!apiKey) return deterministic

  try {
    const result = await callLLM("groq", PROMPT_GUARD_MODEL, apiKey, "", rawText)
    const classification = parsePromptGuardOutput(result.content)
    let verdict = deterministic.verdict
    if (classification.label === "MALICIOUS" && verdict === "benign") verdict = "suspicious"
    return { verdict, deterministicMatches: deterministic.deterministicMatches, promptGuardClassification: classification }
  } catch {
    return deterministic
  }
}
