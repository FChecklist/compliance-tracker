import { db, orchestraLayers, customerModelConfig, clientModelConfig, sharedPoolAllocations } from "@/lib/db";
import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import { decryptApiKey } from "@/lib/ai-config-crypto";
import type { LLMProvider, LLMFallback } from "@/lib/llm-client";

export type ResolvedModelConfig = {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  isCustomerConfigured: boolean;
  // Wave 72 (AI_OS_CERTIFICATION.md §2.5, model-switching-on-failure): the
  // platform's own OpenRouter default, when it's actually configured and
  // isn't just a repeat of the primary -- passed straight through to
  // callLLM/callLLMJson's optional `fallback` parameter. undefined when
  // there's genuinely nothing sensible to fall back to (no OPENROUTER_API_KEY
  // configured, or the primary already IS the platform OpenRouter default).
  fallback?: LLMFallback;
};

const PLATFORM_FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct:free"

// Wave (2026-07-10, founder directive): platform-default floor for text
// orchestration, replacing the OpenRouter llama-3.3-70b-instruct default
// (Wave 45) now that GROQ_API_KEY is live. GPT-OSS-120B is meaningfully
// stronger than llama-3.3-70b while staying just as fast/cheap on Groq's
// hardware -- this is the FLOOR every org gets before configuring anything
// of their own, not a ceiling: GLM-5.2/DeepSeek/Claude remain available
// higher up this same resolution chain (customer BYO config, shared pool)
// for anything needing real reasoning, per the founder's explicit 90-day
// "don't cut corners on cost" directive. Verified live against
// api.groq.com/openai/v1/models 2026-07-10 as "openai/gpt-oss-120b".
const PLATFORM_DEFAULT_PROVIDER: LLMProvider = "groq"
const PLATFORM_DEFAULT_MODEL = "openai/gpt-oss-120b";

// Wave (2026-07-10, founder directive): Cerebras added as a second host for
// the SAME floor-tier model -- "Groq is free, Cerebras is paid," loaded
// with $10 of prepaid credit specifically as a reliability backstop, not a
// second cheap option to shop between. Cerebras's own API returns this
// model under a different id than Groq's ("gpt-oss-120b", no "openai/"
// prefix -- confirmed live via api.cerebras.ai/v1/models). Kept as its own
// named constant rather than inlined so platformFallbackFor() below reads
// as an obvious one-line policy: same model, different (paid) infra, only
// when the free primary is actually down.
const CEREBRAS_GPT_OSS_MODEL = "gpt-oss-120b"

function platformFallbackFor(primary: { provider: LLMProvider; model: string }): LLMFallback | undefined {
  // Same-model failover for the floor tier specifically: if Groq's
  // gpt-oss-120b is the primary and it fails, retry the SAME model on
  // Cerebras rather than dropping to a weaker free OpenRouter model --
  // preserves quality on failover, not just uptime. Falls through to the
  // generic OpenRouter fallback below for every other primary (including
  // when CEREBRAS_API_KEY isn't configured).
  if (primary.provider === PLATFORM_DEFAULT_PROVIDER && primary.model === PLATFORM_DEFAULT_MODEL) {
    const cerebrasKey = platformApiKeyFor("cerebras")
    if (cerebrasKey) return { provider: "cerebras", model: CEREBRAS_GPT_OSS_MODEL, apiKey: cerebrasKey }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return undefined;
  if (primary.provider === "openrouter" && primary.model === PLATFORM_FALLBACK_MODEL) return undefined;
  return { provider: "openrouter", model: PLATFORM_FALLBACK_MODEL, apiKey };
}

// Wave 45: the platform-default path previously hardcoded process.env.GROQ_API_KEY
// regardless of what layer.defaultModelConfig.provider actually said -- a real
// bug (silently broken for any layer ever pointed at a non-Groq provider).
// Picks the right env var for whichever provider is actually configured.
export function platformApiKeyFor(provider: LLMProvider): string | undefined {
  switch (provider) {
    case "groq": return process.env.GROQ_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "openai": return process.env.OPENAI_API_KEY;
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "google": return process.env.GOOGLE_API_KEY;
    case "cerebras": return process.env.CEREBRAS_API_KEY;
  }
}

// Wave (2026-07-10, founder directive): the model a floor-tier call escalates
// TO when src/lib/floor-tier-escalation.ts's deterministic signals fire.
// GLM-5.2, already pinned to OpenRouter provider "DeepInfra" in
// llm-client.ts's OPENROUTER_PROVIDER_PREFERENCE. Callers must only use this
// for requests that resolved to `isCustomerConfigured: false` -- never
// overrides an org's own BYO model choice.
const ESCALATED_PROVIDER: LLMProvider = "openrouter"
const ESCALATED_MODEL = "z-ai/glm-5.2"

/** Returns the escalation target for a floor-tier call, or null if OPENROUTER_API_KEY isn't configured (nothing sensible to escalate to). */
export function escalatedPlatformConfig(): ResolvedModelConfig | null {
  const apiKey = platformApiKeyFor(ESCALATED_PROVIDER)
  if (!apiKey) return null
  return { provider: ESCALATED_PROVIDER, model: ESCALATED_MODEL, apiKey, isCustomerConfigured: false }
}

/**
 * Resolves which provider/model/key an org should use for a given Orchestra
 * Layer: a customer's own `customer_model_config` row (BYO) if one is active
 * for that layer specifically, else one that applies to all layers
 * (orchestra_layer_id IS NULL), else the layer's own `default_model_config`
 * (platform default, currently always Groq).
 *
 * Uses the raw `db` client -- `customer_model_config`/`orchestra_layers`
 * lookups here are a platform-level resolution step that runs before any
 * tenant-scoped transaction, not a per-request user action needing RLS.
 * The BYO API key itself is decrypted here and must never be returned to
 * a client -- callers use it to make the LLM call and discard it.
 *
 * This function's own per-ORG resolution logic is untouched by Wave 18's
 * Shared AI Resource Pool -- an org's own key is never substituted with
 * another org's here, by construction (there is no code path in this
 * function that reads any other org's customer_model_config row). See
 * resolvePlatformModelConfig() below for the separate, platform-scoped path.
 */
export async function resolveModelConfig(orgId: string, layerKey: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  const customerConfig = await db.query.customerModelConfig.findFirst({
    where: and(
      eq(customerModelConfig.orgId, orgId),
      eq(customerModelConfig.isActive, true),
      or(eq(customerModelConfig.orchestraLayerId, layer.id), isNull(customerModelConfig.orchestraLayerId))
    ),
    // Layer-specific configs take priority over "applies to all layers" ones:
    // ascending sort puts non-null orchestra_layer_id first (Postgres's
    // default NULLS LAST for ASC), so the more specific row wins.
    orderBy: (t, { asc }) => asc(t.orchestraLayerId),
  });

  if (customerConfig?.encryptedApiKey && customerConfig.modelName) {
    // Wave 18: lastUsedAt reflects the org's OWN real usage too, not just
    // pool-borrowing -- otherwise a heavily-used config could look "idle" to
    // the shared pool just because it had never been borrowed yet. Fire-and-
    // forget, same non-blocking pattern as apiKeys.lastUsedAt elsewhere.
    db.update(customerModelConfig).set({ lastUsedAt: new Date() }).where(eq(customerModelConfig.id, customerConfig.id)).then(() => {});

    const apiKey = await decryptApiKey(customerConfig.encryptedApiKey);
    const provider = customerConfig.provider as LLMProvider;
    const model = customerConfig.modelName;
    return {
      provider,
      model,
      apiKey,
      isCustomerConfigured: true,
      fallback: platformFallbackFor({ provider, model }),
    };
  }

  const defaultConfig = layer.defaultModelConfig as { provider?: string; model?: string };
  const provider = (defaultConfig.provider as LLMProvider) ?? PLATFORM_DEFAULT_PROVIDER;
  const model = defaultConfig.model ?? PLATFORM_DEFAULT_MODEL;
  const apiKey = platformApiKeyFor(provider);
  if (!apiKey) return null;

  return { provider, model, apiKey, isCustomerConfigured: false, fallback: platformFallbackFor({ provider, model }) };
}

/**
 * Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26) --
 * Layer 3 (client) resolution: a real, confirmed gap. Layers 1/2/4
 * (platform/org/user) already had a model-resolution mechanism; a client
 * (e.g. a CA/legal firm's individual end-client under an org) had none.
 * Most-specific-scope-wins, same pattern as resolvePageAgentModelConfig()'s
 * user->org->platform chain: a client-specific row wins, else falls back to
 * the client's own org's resolution (resolveModelConfig), which itself
 * falls back to the platform default.
 */
export async function resolveClientModelConfig(clientId: string, orgId: string, layerKey: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  const clientConfig = await db.query.clientModelConfig.findFirst({
    where: and(
      eq(clientModelConfig.clientId, clientId),
      eq(clientModelConfig.isActive, true),
      or(eq(clientModelConfig.orchestraLayerId, layer.id), isNull(clientModelConfig.orchestraLayerId))
    ),
    orderBy: (t, { asc }) => asc(t.orchestraLayerId),
  });

  if (clientConfig?.encryptedApiKey && clientConfig.modelName) {
    db.update(clientModelConfig).set({ lastUsedAt: new Date() }).where(eq(clientModelConfig.id, clientConfig.id)).then(() => {});
    const apiKey = await decryptApiKey(clientConfig.encryptedApiKey);
    const provider = clientConfig.provider as LLMProvider;
    const model = clientConfig.modelName;
    return {
      provider,
      model,
      apiKey,
      isCustomerConfigured: true,
      fallback: platformFallbackFor({ provider, model }),
    };
  }

  return resolveModelConfig(orgId, layerKey);
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Wave 18 (VAIOS Shared AI Resource Pool, constitution refinement #10) --
 * resolves a model for the PLATFORM's OWN internal orchestration work, never
 * a customer org's workflow. Deliberately takes no `orgId` parameter at all:
 * that is the structural guarantee this can never be mistaken for (or
 * accidentally reused as) a customer org's resolution path. Falls back to
 * borrowing an idle, explicitly opted-in org's BYO config only when the
 * platform has no default key configured for this layer -- "Layer 1 needs
 * more capacity to do orchestra, so it takes from all available models as
 * per need" (the user's own framing). Never lends to another org; never
 * silently substitutes a customer's own resolution with someone else's key.
 */
export async function resolvePlatformModelConfig(layerKey: string): Promise<ResolvedModelConfig | null> {
  const layer = await db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, layerKey) });
  if (!layer) return null;

  const defaultConfig = layer.defaultModelConfig as { provider?: string; model?: string };
  const provider = (defaultConfig.provider as LLMProvider) ?? PLATFORM_DEFAULT_PROVIDER;
  const model = defaultConfig.model ?? PLATFORM_DEFAULT_MODEL;
  const platformApiKey = platformApiKeyFor(provider);
  if (platformApiKey) {
    return { provider, model, apiKey: platformApiKey, isCustomerConfigured: false, fallback: platformFallbackFor({ provider, model }) };
  }

  return borrowFromSharedPool(layerKey, layer.id);
}

async function borrowFromSharedPool(layerKey: string, orchestraLayerId: string): Promise<ResolvedModelConfig | null> {
  const idleCutoff = new Date(Date.now() - IDLE_THRESHOLD_MS);

  const candidate = await db.query.customerModelConfig.findFirst({
    where: and(
      eq(customerModelConfig.isActive, true),
      eq(customerModelConfig.sharedPoolEligible, true),
      isNotNull(customerModelConfig.encryptedApiKey),
      or(eq(customerModelConfig.orchestraLayerId, orchestraLayerId), isNull(customerModelConfig.orchestraLayerId))
    ),
    // Most-idle first: never-used (lastUsedAt IS NULL) configs sort first
    // under Postgres's default NULLS LAST for ASC... explicit ordering
    // below handles that correctly either way via the idle-cutoff filter.
    orderBy: (t, { asc: ascOrder }) => ascOrder(t.lastUsedAt),
  });

  if (!candidate?.encryptedApiKey || !candidate.modelName) return null;
  if (candidate.lastUsedAt && candidate.lastUsedAt > idleCutoff) return null; // in active use by its own org right now, not actually idle

  await db.insert(sharedPoolAllocations).values({
    lenderOrgId: candidate.orgId,
    purpose: `${layerKey}_platform_orchestration`,
    customerModelConfigId: candidate.id,
    orchestraLayerKey: layerKey,
  });
  await db.update(customerModelConfig).set({ lastUsedAt: new Date() }).where(eq(customerModelConfig.id, candidate.id));

  const apiKey = await decryptApiKey(candidate.encryptedApiKey);
  const provider = candidate.provider as LLMProvider;
  const model = candidate.modelName;
  return {
    provider,
    model,
    apiKey,
    isCustomerConfigured: true,
    fallback: platformFallbackFor({ provider, model }),
  };
}
