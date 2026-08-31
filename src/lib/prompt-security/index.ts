// VERIDIAN_Architecture_v2.0 phase_4 -- barrel export for the Defense-in-Depth
// Engine (2.8's 4-layer security architecture) + Quality Engine + Red Team
// Engine. See each sibling module's own header comment for which
// gap-analysis engine/pipeline item it closes.
export * from "./types"
export * from "./layer1-input-sanitization"
export * from "./layer2-system-prompt-hardening"
export * from "./layer3-runtime-guardrails"
export * from "./layer4-output-filtering"
export * from "./quality-engine"
export * from "./defense-in-depth"
export * from "./red-team-battery"
