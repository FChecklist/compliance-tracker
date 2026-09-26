// PROJEXA-BUILD-002 WP-11: which provider the INTERNAL AI (ours, the model behind the chat box) may use for a request, decided in one
// place, before any model is reached.
//
// The owner's two billing modes (PMD-39):
//   * EXTERNAL AI (a person pastes the AI work link into their own assistant): billed to that person by that vendor, and this server
//     makes no model call at all. Nothing in this file applies to it.
//   * INTERNAL AI (this file): our cost, re-billed to the customer, so every model call must be metered per person and organisation.
//     Two routes exist:
//       - "metered": OpenRouter, the only provider meant for customers. Every call is written to the usage ledger as METERED_API and
//         is re-billable.
//       - "owner subscription": claude-cli / claude-cli-remote, the owner's own Claude Code subscription. Anthropic's policy allows
//         that subscription for the owner's ordinary individual use only, never to serve another person's request (adapter.ts says
//         the same). Before go-live it stands in for the metered route for the OWNER'S OWN testing.
//
// THE RULE. The subscription route is permitted only when ALL of these hold, and it is never the default:
//   1. the deployment configured a subscription provider for this level (AI_PROVIDER / AI_PROVIDER_PIPELINE_L1, provider-config.ts);
//   2. the owner-only switch INTERNAL_AI_ALLOW_CLAUDE_CLI is exactly "1" (unset, empty or any other value is off);
//   3. the acting person is the owner (RAJAT_USER_ID, the identity gate of adapter.ts), and RAJAT_USER_ID is set.
// Anything else is the metered route. It is NOT a fallback that hides a refusal: the metered route carries its own gate (the provider
// must be on AI_ALLOWED_PROVIDERS and its key must be present), and when it cannot run the answer is a refusal that says so.
//
// No key, secret or connection string is read here beyond checking that OPENROUTER_API_KEY is present by name; the value is never
// stored, returned or logged.
import { assertAiProviderAllowed } from "./adapter"
import { resolveAllowedProviders, resolveProviderForLevel, UnknownAiProviderError, type AiProviderName } from "./provider-config"

/** The env var the owner sets, and only the owner, to let the owner's own requests use the Claude subscription. Never on by default. */
export const CLAUDE_CLI_OWNER_FLAG = "INTERNAL_AI_ALLOW_CLAUDE_CLI"

export type InternalAiRefusalReason =
  | "actor_unresolved"
  | "claude_cli_flag_off"
  | "owner_not_configured"
  | "not_owner"
  | "provider_config_invalid"
  | "metered_provider_not_allowed"
  | "metered_provider_not_configured"

export type InternalAiRoute =
  | { allowed: true; kind: "metered"; provider: "openrouter"; providerCostType: "METERED_API"; rebillable: true }
  | { allowed: true; kind: "owner_subscription"; provider: "claude-cli" | "claude-cli-remote"; providerCostType: "SUBSCRIPTION_ALLOCATED"; rebillable: false }
  | { allowed: false; reason: InternalAiRefusalReason }

export type ClaudeCliPermission = { ok: true } | { ok: false; reason: "actor_unresolved" | "claude_cli_flag_off" | "owner_not_configured" | "not_owner" }

const isSubscription = (provider: AiProviderName): provider is "claude-cli" | "claude-cli-remote" => provider === "claude-cli" || provider === "claude-cli-remote"

/** Is the owner-only switch on? Exactly "1": a value such as "true", "yes" or " 1" is a typo and stays off. */
export function claudeCliOwnerFlagOn(): boolean {
  return process.env[CLAUDE_CLI_OWNER_FLAG] === "1"
}

/**
 * May the Claude subscription serve THIS person? The switch first (off is refused before anything about the person is looked at),
 * then the identity: a person who does not resolve, an owner id that is not configured, or any person other than the owner is refused.
 */
export function claudeCliPermission(personId: string | null): ClaudeCliPermission {
  if (!claudeCliOwnerFlagOn()) return { ok: false, reason: "claude_cli_flag_off" }
  if (!personId) return { ok: false, reason: "actor_unresolved" }
  const owner = process.env.RAJAT_USER_ID
  if (!owner) return { ok: false, reason: "owner_not_configured" }
  if (personId !== owner) return { ok: false, reason: "not_owner" }
  return { ok: true }
}

/**
 * The route for one request of the internal AI. `personId` is the acting PERSON's compliance.users id (never an API key's id); null
 * means no person resolved, and the request is refused, because a metered call is re-billed to someone and a subscription call to
 * no one.
 */
export function resolveInternalAiRoute(personId: string | null): InternalAiRoute {
  if (!personId) return { allowed: false, reason: "actor_unresolved" }

  let configured: AiProviderName
  try {
    configured = resolveProviderForLevel("pipeline_l1")
  } catch (error) {
    if (error instanceof UnknownAiProviderError) {
      // The deployment named a provider this build does not know, or one its own allowlist excludes. Say so; do not guess another.
      return isMeteredAllowedAndConfigured() ?? { allowed: false, reason: "provider_config_invalid" }
    }
    throw error
  }

  if (isSubscription(configured) && claudeCliPermission(personId).ok) {
    try {
      // The identity gate every subscription request has always passed; run here so this file can never hand a route to a caller
      // that adapter.ts would have refused.
      assertAiProviderAllowed(personId, "pipeline_l1")
    } catch {
      return { allowed: false, reason: "not_owner" }
    }
    return { allowed: true, kind: "owner_subscription", provider: configured, providerCostType: "SUBSCRIPTION_ALLOCATED", rebillable: false }
  }

  return isMeteredAllowedAndConfigured() ?? meteredRefusal()
}

function meteredRefusal(): InternalAiRoute {
  let allowed: AiProviderName[]
  try {
    allowed = resolveAllowedProviders()
  } catch {
    return { allowed: false, reason: "provider_config_invalid" }
  }
  return { allowed: false, reason: allowed.includes("openrouter") ? "metered_provider_not_configured" : "metered_provider_not_allowed" }
}

/** The metered route when this deployment allows OpenRouter and has its key; null otherwise. Only the key's presence is checked. */
function isMeteredAllowedAndConfigured(): InternalAiRoute | null {
  let allowed: AiProviderName[]
  try {
    allowed = resolveAllowedProviders()
  } catch {
    return null
  }
  if (!allowed.includes("openrouter")) return null
  if (!process.env.OPENROUTER_API_KEY) return null
  return { allowed: true, kind: "metered", provider: "openrouter", providerCostType: "METERED_API", rebillable: true }
}

/** What a person is told when the internal AI cannot serve them. Fixed sentences; nothing about the deployment's configuration. */
export function refusalSentence(reason: InternalAiRefusalReason): string {
  switch (reason) {
    case "actor_unresolved":
      return "I could not tell who is asking, so I did not read the file. Sign in, or name the person this request is for, and send it again."
    case "claude_cli_flag_off":
    case "owner_not_configured":
    case "not_owner":
      return "The assistant is not available for this account, so I did not read the file. Upload it on the New project screen instead."
    default:
      return "The assistant is not switched on for this organisation yet, so I did not read the file. Upload it on the New project screen instead."
  }
}
