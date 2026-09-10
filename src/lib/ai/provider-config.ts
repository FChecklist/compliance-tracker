// R80 Part 2 / W-ROUTER P1.1 -- provider selection made config-driven and
// per-level, per R63's owner directive ("AI model agnostic -- level 1/2/3
// must not be hardcoded, must be owner-changeable at any time").
//
// This is deliberately a NARROW companion to level-model-registry.ts, not a
// merge with it: that file resolves which MODEL a level uses once the
// provider is already known to be "openrouter" (a DB-backed, owner-editable
// row). This file resolves which PROVIDER ("claude-cli" | "openrouter") a
// level uses in the first place -- env-driven, not DB-backed, because the
// choice of provider changes deploy topology (a local `claude` binary vs an
// API key) in a way a hot-reloaded DB row should not silently flip.
//
// WHAT THIS FILE DOES NOT CHANGE: adapter.ts's assertAiProviderAllowed()
// still refuses every claude-cli request that is not the one configured
// individual identity, for every level, unconditionally. That restriction
// answers a different question ("is Claude Code CLI's OAuth being used to
// serve a different person") from the one this file answers ("which
// provider/model tier does this level use today"), and removing it would
// reopen exactly the ToS exposure adapter.ts's own header documents
// (Anthropic OAuth/subscription auth is for ordinary individual use only).
// A per-level provider override configured here still passes through that
// same gate whenever it resolves to "claude-cli" -- there is no path in
// this file that reaches a provider without also going through the gate.
import type { PipelineLevelRole } from "./level-model-registry";

export type AiProviderName = "claude-cli" | "openrouter";

const KNOWN_PROVIDERS: readonly AiProviderName[] = ["claude-cli", "openrouter"];

function isKnownProvider(value: string): value is AiProviderName {
  return (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

export class UnknownAiProviderError extends Error {}

function assertKnownProvider(raw: string, sourceDescription: string): AiProviderName {
  if (!isKnownProvider(raw)) {
    throw new UnknownAiProviderError(
      `Unknown AI provider "${raw}" from ${sourceDescription} -- must be one of ${KNOWN_PROVIDERS.join(", ")}.`
    );
  }
  return raw;
}

/**
 * The configured allowlist of providers this deployment may ever resolve to,
 * regardless of level. Defaults to both known providers when unset -- an
 * empty or garbage AI_ALLOWED_PROVIDERS is a misconfiguration, not "allow
 * everything," so it throws rather than silently falling back to the
 * default list (that fallback-on-error would be exactly the "arbitrary
 * provider accepted with no check" failure mode this exists to prevent).
 */
export function resolveAllowedProviders(): AiProviderName[] {
  const raw = process.env.AI_ALLOWED_PROVIDERS;
  // Unset (not merely blank) is the only case that defaults -- an explicitly
  // set but blank/whitespace value is a misconfiguration, not "allow
  // everything," and must throw like any other empty allowlist below.
  if (raw === undefined) return [...KNOWN_PROVIDERS];
  const entries = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (entries.length === 0) {
    throw new UnknownAiProviderError(`AI_ALLOWED_PROVIDERS is set but contains no provider name (got "${raw}").`);
  }
  return entries.map((e) => assertKnownProvider(e, "AI_ALLOWED_PROVIDERS"));
}

/** Env var name for a level's provider override, e.g. AI_PROVIDER_PIPELINE_L1. */
function overrideEnvVarName(level: PipelineLevelRole): string {
  return `AI_PROVIDER_${level.toUpperCase()}`; // AI_PROVIDER_PIPELINE_L1 / AI_PROVIDER_PIPELINE_L2
}

/**
 * Resolves the provider for one pipeline level:
 *   1. a per-level override (AI_PROVIDER_PIPELINE_L1 / AI_PROVIDER_PIPELINE_L2), else
 *   2. the global default (AI_PROVIDER), else
 *   3. "claude-cli" (today's dev-phase default, unchanged from before this file existed).
 * Then checks the result against resolveAllowedProviders(), throwing rather
 * than returning a provider this deployment has not explicitly allowed --
 * there is no fallthrough branch that returns an unlisted provider.
 */
export function resolveProviderForLevel(level: PipelineLevelRole): AiProviderName {
  const overrideVar = overrideEnvVarName(level);
  const raw = process.env[overrideVar] ?? process.env.AI_PROVIDER ?? "claude-cli";
  const resolved = assertKnownProvider(raw, process.env[overrideVar] !== undefined ? overrideVar : "AI_PROVIDER (or the claude-cli default)");

  const allowed = resolveAllowedProviders();
  if (!allowed.includes(resolved)) {
    throw new UnknownAiProviderError(
      `Provider "${resolved}" resolved for level "${level}" is not in the configured allowlist (${allowed.join(", ")}). ` +
        `Set AI_ALLOWED_PROVIDERS, or ${overrideVar}/AI_PROVIDER, to a permitted value.`
    );
  }
  return resolved;
}
