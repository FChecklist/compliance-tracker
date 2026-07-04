// Wave 24-25 (PageAgent integration) -- the per-user counterpart to
// orchestra-model-resolver.ts's resolveModelConfig(). Most-specific-scope-
// wins chain: a user's own personalModelConfig row (Layer 4), then the
// client's own clientModelConfig if the caller is in a client-scoped
// context (Layer 3, Wave 45), then the org's customerModelConfig for the
// 'page_agent_oa' layer (Layer 2), then platform default (Layer 1, handled
// inside resolveModelConfig via orchestraLayers.defaultModelConfig).
//
// Deliberately uses withTenantContext for the personal lookup, NOT the raw
// db client resolveModelConfig() itself uses -- personalModelConfig is a
// genuine per-user secrets table with real cross-user-leak risk if ever
// queried unscoped, unlike customerModelConfig/orchestraLayers (org-level
// or global-catalog data with no per-identity leak risk). This call always
// runs inside an authenticated request (requireAuth() already gave us both
// orgId and userId), so there's no "no live user" scenario that would force
// the raw-db pattern the way the org-level resolver sometimes needs.
import { personalModelConfig } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { decryptApiKey } from "@/lib/ai-config-crypto"
import { resolveModelConfig, resolveClientModelConfig } from "@/lib/orchestra-model-resolver"

export type ResolvedPageAgentModelConfig = {
  provider: string // free text -- may be 'ollama'/'custom', not just LLMProvider
  model: string
  baseUrl: string | null
  apiKey: string | null // null only for a keyless local endpoint (e.g. Ollama)
  source: "personal" | "client" | "org" | "platform"
}

export async function resolvePageAgentModelConfig(orgId: string, userId: string, clientId?: string | null): Promise<ResolvedPageAgentModelConfig | null> {
  const personal = await withTenantContext({ orgId, userId }, (db) =>
    db.query.personalModelConfig.findFirst({
      where: and(eq(personalModelConfig.userId, userId), eq(personalModelConfig.isActive, true)),
    })
  )

  if (personal?.modelName) {
    const apiKey = personal.encryptedApiKey ? await decryptApiKey(personal.encryptedApiKey) : null
    return { provider: personal.provider, model: personal.modelName, baseUrl: personal.baseUrl, apiKey, source: "personal" }
  }

  const resolved = clientId
    ? await resolveClientModelConfig(clientId, orgId, "page_agent_oa")
    : await resolveModelConfig(orgId, "page_agent_oa")

  if (resolved) {
    return {
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: null, // known-provider path only -- never a custom baseUrl
      apiKey: resolved.apiKey,
      source: resolved.isCustomerConfigured ? (clientId ? "client" : "org") : "platform",
    }
  }

  return null
}
