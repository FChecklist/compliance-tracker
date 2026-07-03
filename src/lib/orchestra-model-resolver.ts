import { db, orchestraLayers, customerModelConfig, sharedPoolAllocations } from "@/lib/db";
import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import { decryptApiKey } from "@/lib/ai-config-crypto";
import type { LLMProvider } from "@/lib/llm-client";

export type ResolvedModelConfig = {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  isCustomerConfigured: boolean;
};

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
    return {
      provider: customerConfig.provider as LLMProvider,
      model: customerConfig.modelName,
      apiKey,
      isCustomerConfigured: true,
    };
  }

  const defaultConfig = layer.defaultModelConfig as { provider?: string; model?: string };
  const provider = (defaultConfig.provider as LLMProvider) ?? "groq";
  const model = defaultConfig.model ?? "llama-3.3-70b-versatile";
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  return { provider, model, apiKey, isCustomerConfigured: false };
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
  const provider = (defaultConfig.provider as LLMProvider) ?? "groq";
  const model = defaultConfig.model ?? "llama-3.3-70b-versatile";
  const platformApiKey = process.env.GROQ_API_KEY;
  if (platformApiKey) {
    return { provider, model, apiKey: platformApiKey, isCustomerConfigured: false };
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
  return {
    provider: candidate.provider as LLMProvider,
    model: candidate.modelName,
    apiKey,
    isCustomerConfigured: true,
  };
}
