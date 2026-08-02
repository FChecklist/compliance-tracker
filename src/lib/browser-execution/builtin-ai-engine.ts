// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 3:
// engine-browser-builtin-ai's real inference wiring. Increment 1 shipped
// only feature detection (tier-detection.ts#detectBuiltinAiTier); this
// wires a real call path behind it -- closing the audit-confirmed gap
// (ai-os/audits/owner_engine_reaudit_2026-07-27.md) that
// detectBuiltinAiTier() only checked `window.ai` / `window.LanguageModel`
// presence and never actually prompted the model.
//
// Two real, DIFFERENT shapes because Chrome shipped two real generations of
// this API, and detection deliberately accepts either (see
// tier-detection.ts's own `available = Boolean(window?.ai ||
// window?.LanguageModel)`):
//   - Current (Chrome's stable Prompt API): a global `LanguageModel` with
//     `LanguageModel.create()` returning a session with `session.prompt(text)`.
//   - Legacy (the earlier origin-trial shape, still present on some
//     channels): `window.ai.languageModel.create()`, same session shape.
// This module tries the current global first, falls back to the legacy
// namespaced one, and only reports "unavailable" if genuinely neither
// real API is reachable -- an honest reflection of detectBuiltinAiTier's
// own OR condition, not a silent assumption of one shape.
export type BuiltinAiSession = {
  prompt(text: string): Promise<string>
  destroy?(): void
}

type BuiltinAiWindow = {
  LanguageModel?: { create(): Promise<BuiltinAiSession> }
  ai?: { languageModel?: { create(): Promise<BuiltinAiSession> } }
}

export type BuiltinAiEnv = { window?: BuiltinAiWindow }

export type BuiltinAiSessionFactory = (env?: BuiltinAiEnv) => Promise<BuiltinAiSession>

/**
 * Real session factory: resolves whichever of the two real API shapes is
 * actually present (current global preferred, legacy namespaced as
 * fallback) and creates a real on-device model session. Throws with a
 * clear message if called when neither is present -- callers are expected
 * to gate on shouldAttemptBuiltinAi/detectBuiltinAiTier first, same
 * contract as every other engine file in this tier.
 */
export async function defaultBuiltinAiSessionFactory(env?: BuiltinAiEnv): Promise<BuiltinAiSession> {
  const w = env?.window ?? (typeof window !== "undefined" ? (window as unknown as BuiltinAiWindow) : undefined)
  if (w?.LanguageModel) return w.LanguageModel.create()
  if (w?.ai?.languageModel) return w.ai.languageModel.create()
  throw new Error("neither window.LanguageModel nor window.ai.languageModel is present in this environment")
}

export type BuiltinAiPromptResult =
  | { kind: "not-selected"; reason: string }
  | { kind: "ready"; text: string }

/**
 * Real entry point: gated by tier-orchestrator.ts's own
 * shouldAttemptBuiltinAi (single source of truth for tier selection),
 * itself built on tier-detection.ts's real window.ai/window.LanguageModel
 * presence check. Only creates a real (or injected) session and prompts it
 * once that gate passes, then releases the session -- this is the literal
 * fix for the audited gap: a real prompt call now sits behind the
 * detector, not just a boolean.
 */
export async function runBuiltinAiPrompt(
  prompt: string,
  env?: Parameters<typeof import("./tier-orchestrator").planExecution>[0] & BuiltinAiEnv,
  factory: BuiltinAiSessionFactory = defaultBuiltinAiSessionFactory,
): Promise<BuiltinAiPromptResult> {
  const { planExecution, shouldAttemptBuiltinAi } = await import("./tier-orchestrator")
  const plan = planExecution(env)
  if (!shouldAttemptBuiltinAi(plan)) {
    return { kind: "not-selected", reason: `tier-orchestrator selected "${plan.selectedTier}" for this environment, not builtin-ai` }
  }
  const session = await factory(env)
  try {
    const text = await session.prompt(prompt)
    return { kind: "ready", text }
  } finally {
    session.destroy?.()
  }
}
