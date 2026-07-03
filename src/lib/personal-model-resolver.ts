// Wave 24-25 (PageAgent integration) -- the per-user counterpart to
// orchestra-model-resolver.ts's resolveModelConfig(). Most-specific-scope-
// wins chain: a user's own personalModelConfig row, then the org's
// customerModelConfig for the 'page_agent_oa' layer (unchanged, existing
// resolver), then platform default (also handled inside resolveModelConfig
// via orchestraLayers.defaultModelConfig).
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
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"

export type ResolvedPageAgentModelConfig = {
  provider: string // free text -- may be 'ollama'/'custom', not just LLMProvider
  model: string
  baseUrl: string | null
  apiKey: string | null // null only for a keyless local endpoint (e.g. Ollama)
  source: "personal" | "org" | "platform"
}

export async function resolvePageAgentModelConfig(orgId: string, userId: string): Promise<ResolvedPageAgentModelConfig | null> {
  const personal = await withTenantContext({ orgId, userId }, (db) =>
    db.query.personalModelConfig.findFirst({
      where: and(eq(personalModelConfig.userId, userId), eq(personalModelConfig.isActive, true)),
    })
  )

  if (personal?.modelName) {
    const apiKey = personal.encryptedApiKey ? await decryptApiKey(personal.encryptedApiKey) : null
    return { provider: personal.provider, model: personal.modelName, baseUrl: personal.baseUrl, apiKey, source: "personal" }
  }

  const orgConfig = await resolveModelConfig(orgId, "page_agent_oa")
  if (orgConfig) {
    return {
      provider: orgConfig.provider,
      model: orgConfig.model,
      baseUrl: null, // known-provider path only -- resolveModelConfig() only ever resolves the 4 enum providers, never a custom baseUrl
      apiKey: orgConfig.apiKey,
      source: orgConfig.isCustomerConfigured ? "org" : "platform",
    }
  }

  return null
}
