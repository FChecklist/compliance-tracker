import { db, orchestraLayers, customerModelConfig } from "@/lib/db";
import { and, eq, isNull, or } from "drizzle-orm";
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
