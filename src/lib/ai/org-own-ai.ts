// "Connect your AI" (owner order 2026-10-11): an organisation pastes ITS OWN AI key once; from then on every person of that organisation
// is served by that AI, for chat (Discuss) and for typed actions (Level 1). One row of compliance.customer_model_config with
// orchestra_layer_id NULL ("applies to all layers"), the same table and encryption the existing BYO settings use (settings/model-config),
// so nothing new is stored and orchestra-model-resolver.ts already honours it for every layer.
//
// WHY THIS SKIPS THE OWNER-ONLY AND OFF GATES. internal-ai-policy.ts exists because OUR AI costs us money and the Claude subscription may
// serve only its owner. An organisation's own key is neither: the organisation pays its own AI vendor and nobody else's account is used.
// "PROJEXA's own AI is off" is the default for OUR spend; it does not apply to a customer's own key. The admin who saved the key is
// the approval for the people of that organisation.
//
// The key is encrypted at rest, tested once before it is saved, and is never returned by any read here (hasKey / provider / model only).
import { and, eq, isNull } from "drizzle-orm"
import { db, customerModelConfig } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { decryptApiKey, encryptApiKey } from "@/lib/ai-config-crypto"
import type { LLMProvider } from "@/lib/llm-client"
import { testProviderConnection } from "@/lib/orchestra-model-resolver"

export const OWN_AI_PROVIDERS = ["openai", "anthropic", "google", "groq", "openrouter"] as const
export type OwnAiProvider = (typeof OWN_AI_PROVIDERS)[number]

/** A fast, cheap model per vendor so typed requests answer in about a second or two. The person may type another model name. */
export const OWN_AI_DEFAULT_MODELS: Record<OwnAiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-5-5",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "deepseek/deepseek-chat",
}

export class OwnAiError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type OwnAiStatus = { connected: boolean; provider: OwnAiProvider | null; model: string | null; changedAt: string | null }
export type OwnAiConfig = { provider: LLMProvider; model: string; apiKey: string }

export function isOwnAiProvider(value: unknown): value is OwnAiProvider {
  return typeof value === "string" && (OWN_AI_PROVIDERS as readonly string[]).includes(value)
}

const allLayers = (orgId: string) => and(eq(customerModelConfig.orgId, orgId), isNull(customerModelConfig.orchestraLayerId))

/** What the screen shows. Never the key. */
export async function getOwnAiStatus(orgId: string): Promise<OwnAiStatus> {
  const row = await withTenantContext({ orgId }, (tx) => tx.query.customerModelConfig.findFirst({ where: allLayers(orgId) }))
  if (!row || !row.isActive || !row.encryptedApiKey) return { connected: false, provider: null, model: null, changedAt: row?.updatedAt?.toISOString() ?? null }
  return { connected: true, provider: row.provider as OwnAiProvider, model: row.modelName, changedAt: row.updatedAt?.toISOString() ?? null }
}

/**
 * The organisation's own AI, decrypted for ONE call, or null. Used by the model paths before they look at any of OUR switches.
 * Platform-level lookup like resolveModelConfig (raw db, run before the request's own transaction); never returned to a client.
 */
export async function resolveOrgOwnAi(orgId: string): Promise<OwnAiConfig | null> {
  const row = await db.query.customerModelConfig.findFirst({ where: and(allLayers(orgId), eq(customerModelConfig.isActive, true)) })
  if (!row?.encryptedApiKey || !row.modelName) return null
  return { provider: row.provider as LLMProvider, model: row.modelName, apiKey: await decryptApiKey(row.encryptedApiKey) }
}

export async function orgHasOwnAi(orgId: string): Promise<boolean> {
  return (await resolveOrgOwnAi(orgId).catch(() => null)) !== null
}

/** Tests the key with one real tiny call, then saves it (replacing any earlier one). The message on failure is in everyday words. */
export async function saveOwnAi(orgId: string, input: { provider: unknown; model?: unknown; apiKey: unknown }): Promise<OwnAiStatus> {
  if (!isOwnAiProvider(input.provider)) throw new OwnAiError("Choose one of: ChatGPT (OpenAI), Claude, Gemini, Groq, or Others (OpenRouter).")
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : ""
  if (apiKey.length < 8 || /\s/.test(apiKey)) throw new OwnAiError("Paste the key exactly as your AI company gave it, with no spaces.")
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : OWN_AI_DEFAULT_MODELS[input.provider]

  const test = await testProviderConnection(input.provider, model, apiKey)
  if (!test.ok) throw new OwnAiError(`That key did not work, so nothing was saved. ${test.error}`)

  const encryptedApiKey = await encryptApiKey(apiKey)
  await withTenantContext({ orgId }, async (tx) => {
    const existing = await tx.query.customerModelConfig.findFirst({ where: allLayers(orgId) })
    if (existing) {
      await tx.update(customerModelConfig).set({ provider: input.provider as OwnAiProvider, modelName: model, encryptedApiKey, isActive: true, updatedAt: new Date() }).where(eq(customerModelConfig.id, existing.id))
    } else {
      await tx.insert(customerModelConfig).values({ orgId, orchestraLayerId: null, provider: input.provider as OwnAiProvider, modelName: model, encryptedApiKey, isActive: true })
    }
  })
  return getOwnAiStatus(orgId)
}

/** Disconnects: the key is erased, not just switched off. */
export async function removeOwnAi(orgId: string): Promise<OwnAiStatus> {
  await withTenantContext({ orgId }, (tx) => tx.delete(customerModelConfig).where(allLayers(orgId)))
  return getOwnAiStatus(orgId)
}
