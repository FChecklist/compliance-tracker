// VERIDIAN_Architecture_v2.0 phase_4: shared types for the Defense-in-Depth
// Engine (2.8's 4-layer security architecture) + Quality Engine + Red Team
// Engine. See ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml
// for which named tool (if any) backs each layer, and each sibling module's
// own header for which gap-analysis engine/pipeline item it closes.
import type { LLMUsage } from "@/lib/llm-client"

// Layer 1 (Input Sanitization) threat categories -- mirrors the document's
// own Layer 1 description (line 481-483 of the extracted source: "regex-based
// pattern detection for known injection vectors ... character-level anomaly
// detection for invisible Unicode characters ... a lightweight LLM classifier
// that classifies input intent as benign, suspicious, or malicious").
export type ThreatCategory =
  | "instruction_override"
  | "role_play_jailbreak"
  | "system_prompt_exfiltration"
  | "encoding_obfuscation"
  | "invisible_unicode"
  | "delimiter_injection"

export type ThreatMatch = { category: ThreatCategory; matchedText: string; detail: string }

export type PromptGuardClassification = { label: "BENIGN" | "MALICIOUS"; raw: string }

export type Layer1Result = {
  // "malicious" inputs are rejected immediately, "suspicious" flagged for
  // downstream scrutiny, "benign" proceeds -- exact 3-way vocabulary from
  // the document's own Layer 1 description.
  verdict: "benign" | "suspicious" | "malicious"
  deterministicMatches: ThreatMatch[]
  // null when the caller didn't opt into the network-dependent model call
  // (see layer1-input-sanitization.ts header) -- the deterministic verdict
  // above never depends on this being present.
  promptGuardClassification: PromptGuardClassification | null
}

export type HardenedPrompt = {
  systemPrompt: string
  userContent: string
  // The full, delimiter-wrapped text actually sent to the model --
  // system-level instructions structurally separated from user-supplied
  // content per the document's Layer 2 "instruction hierarchy" requirement.
  wrappedSystemPrompt: string
  wrappedUserMessage: string
}

// Llama Guard's own standard 2-line output convention: "safe" or
// "unsafe\n<comma-or-newline-separated hazard category codes>".
export type LlamaGuardVerdict = { safe: boolean; categories: string[]; raw: string }

export type Layer3Result = {
  inputGuard: LlamaGuardVerdict
  // null until Layer 3 is invoked a second time over the real model output
  // (see defense-in-depth.ts's orchestration -- Layer 3 runs once
  // pre-execution over the compiled prompt, once post-execution over the
  // response, matching the document's own "evaluates both the full compiled
  // prompt ... and the model's output" Layer 3 description).
  outputGuard: LlamaGuardVerdict | null
}

// PII types this layer detects. EMAIL/PHONE/CREDIT_CARD/GSTIN/PAN/IFSC/AADHAAR
// come straight from pii-redaction.ts's shared PATTERNS (see findPii() there)
// -- reused, not duplicated, per the phase_4 audit finding that this layer's
// own PII list diverged from and regressed on that existing engine's
// India-specific GSTIN/PAN/IFSC/Aadhaar coverage. SSN is the one genuinely
// new category layered on top: pii-redaction.ts is India-focused and has no
// US SSN pattern.
export type PiiMatch = { type: "EMAIL" | "PHONE" | "SSN" | "CREDIT_CARD" | "GSTIN" | "PAN" | "IFSC" | "AADHAAR"; matchedText: string }

export type Layer4Result = {
  piiMatches: PiiMatch[]
  scrubbedText: string
  leakedSystemInstruction: boolean
  contentModeration: LlamaGuardVerdict | null
}

export type QualitySignal = { name: string; passed: boolean; detail: string }

export type QualityScore = {
  composite: number
  signals: QualitySignal[]
}

export type DefenseInDepthResult = {
  layer1: Layer1Result
  layer2: HardenedPrompt
  layer3: Layer3Result
  layer4: Layer4Result
  quality: QualityScore
  blocked: boolean
  blockReason: string | null
  // null when blocked (no real LLM call was ever made -- Layer 1/3 rejected
  // before callLLM ran, so there is no usage to report). Populated from the
  // real callLLM() result otherwise, so a caller integrating this module
  // doesn't lose its own cost/latency observability by switching to it.
  usage: LLMUsage | null
}

export type RedTeamSample = {
  id: string
  category: ThreatCategory
  // Which garak probe family this payload's category is drawn from --
  // ai-os/VERIDIAN_V2_DEFENSE_IN_DEPTH_TOOL_EVALUATION_2026-07-26.yaml's
  // garak row explains why this is a curated battery, not a live garak run.
  garakProbeFamily: string
  payload: string
  expectDetected: boolean
}

export type RedTeamFinding = {
  sampleId: string
  category: ThreatCategory
  garakProbeFamily: string
  detected: boolean
  passed: boolean
  verdict: Layer1Result["verdict"]
}

export type RedTeamReport = {
  findings: RedTeamFinding[]
  totalSamples: number
  passedSamples: number
  passRatePct: number
}
