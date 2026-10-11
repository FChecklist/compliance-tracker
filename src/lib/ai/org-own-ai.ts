// "Connect your AI" (owner order 2026-10-11): an AI the CUSTOMER pays for answers PROJEXA's chat (Discuss) and typed actions (Level 1).
// Three ways to be connected, in the order they are looked up for one person (resolveAiFor):
//   1. "mine"   the person's OWN connection        compliance.user_ai_connections       (drizzle/0746), any member
//   2. "shared" a teammate's connection that teammate shared with this person   compliance.user_ai_connection_shares (0746)
//   3. "org"    the organisation's connection      compliance.customer_model_config with orchestra_layer_id NULL ("all layers"),
//                                                  the table the existing BYO settings use; only an owner/admin sets it; everyone in the org is
//                                                  served by it without doing anything (the admin who pasted it is the approval).
// Nothing connected: PROJEXA works as traditional software (every screen, form and button); only free typing to the AI is unavailable.
//
// WHY THIS SKIPS THE OWNER-ONLY AND OFF GATES. internal-ai-policy.ts exists because OUR AI costs us money and the Claude subscription may
// serve only its owner. A customer's own key is neither: they pay their own AI vendor and nobody else's account is used.
//
// A KEY IS NEVER RETURNED. Every status read is provider / model / names only. A key is decrypted for ONE model call and dropped. A
// shared key is decrypted for the teammate's call but never shown to the teammate, and unsharing or disconnecting stops it at once.
// The key is tested with one real tiny call before it is saved (a bad key saves nothing).
import { and, eq, isNull } from "drizzle-orm"
import { db, customerModelConfig, userAiConnections, userAiConnectionShares, users } from "@/lib/db"
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

export type AiSource = "mine" | "shared" | "org"
export type OwnAiStatus = { connected: boolean; provider: OwnAiProvider | null; model: string | null; changedAt: string | null }
export type OwnAiConfig = { provider: LLMProvider; model: string; apiKey: string }
export type ResolvedAi = OwnAiConfig & { source: AiSource; sharedByName?: string }

export function isOwnAiProvider(value: unknown): value is OwnAiProvider {
  return typeof value === "string" && (OWN_AI_PROVIDERS as readonly string[]).includes(value)
}

/** Validates the pasted vendor / key / model, then makes the one real tiny call. Throws OwnAiError in everyday words; returns what to store. */
async function checkedKey(input: { provider: unknown; model?: unknown; apiKey: unknown }): Promise<{ provider: OwnAiProvider; model: string; apiKey: string }> {
  if (!isOwnAiProvider(input.provider)) throw new OwnAiError("Choose one of: ChatGPT (OpenAI), Claude, Gemini, Groq, or Others (OpenRouter).")
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : ""
  if (apiKey.length < 8 || /\s/.test(apiKey)) throw new OwnAiError("Paste the key exactly as your AI company gave it, with no spaces.")
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : OWN_AI_DEFAULT_MODELS[input.provider]
  const test = await testProviderConnection(input.provider, model, apiKey)
  if (!test.ok) throw new OwnAiError(plainKeyProblem(input.provider, test.error))
  return { provider: input.provider, model, apiKey }
}

const VENDOR_NAME: Record<OwnAiProvider, string> = { openai: "OpenAI (ChatGPT)", anthropic: "Anthropic (Claude)", google: "Google (Gemini)", groq: "Groq", openrouter: "OpenRouter" }

/**
 * A refused test, in words a person who is not technical can act on. The vendor's own message is kept at the end for support, but the first
 * sentence says what to DO. Nothing was saved in any of these cases, and the sentence says so.
 */
export function plainKeyProblem(provider: OwnAiProvider, raw: string): string {
  const vendor = VENDOR_NAME[provider]
  const status = Number(/HTTP (\d{3})/.exec(raw)?.[1] ?? 0)
  const lower = raw.toLowerCase()
  let what: string
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("incorrect api key") || lower.includes("unauthorized")) {
    what = `${vendor} did not accept this key. Check that you copied ALL of it (it is long), that it has not been deleted on their site, and that it really is a ${vendor} key.`
  } else if (status === 429 || lower.includes("quota") || lower.includes("insufficient") || lower.includes("credit") || lower.includes("billing")) {
    what = `The key is real, but the ${vendor} account has no credit left or has reached its limit. Add credit on their billing page, wait a minute, and try again.`
  } else if (status === 404 || lower.includes("model")) {
    what = `The key is real, but this key cannot use that model. Clear the model box to use the one PROJEXA suggests, or type a model your ${vendor} account can use.`
  } else if (status >= 500) {
    what = `${vendor} is having a problem right now. Wait a few minutes and try again.`
  } else {
    what = `${vendor} did not answer correctly.`
  }
  const detail = raw.length > 200 ? `${raw.slice(0, 200)}...` : raw
  return `Nothing was saved. ${what} (Details for support: ${detail})`
}

// ───────────── the ORGANISATION's connection (owner/admin) ─────────────
const orgRow = (orgId: string) => and(eq(customerModelConfig.orgId, orgId), isNull(customerModelConfig.orchestraLayerId))

/** What the screen shows for the organisation's connection. Never the key. */
export async function getOwnAiStatus(orgId: string): Promise<OwnAiStatus> {
  const row = await withTenantContext({ orgId }, (tx) => tx.query.customerModelConfig.findFirst({ where: orgRow(orgId) }))
  if (!row || !row.isActive || !row.encryptedApiKey) return { connected: false, provider: null, model: null, changedAt: row?.updatedAt?.toISOString() ?? null }
  return { connected: true, provider: row.provider as OwnAiProvider, model: row.modelName, changedAt: row.updatedAt?.toISOString() ?? null }
}

/** The organisation's own AI, decrypted for ONE call, or null. Platform-level lookup like resolveModelConfig (raw db); never returned to a client. */
export async function resolveOrgOwnAi(orgId: string): Promise<OwnAiConfig | null> {
  const row = await db.query.customerModelConfig.findFirst({ where: and(orgRow(orgId), eq(customerModelConfig.isActive, true)) })
  if (!row?.encryptedApiKey || !row.modelName) return null
  return { provider: row.provider as LLMProvider, model: row.modelName, apiKey: await decryptApiKey(row.encryptedApiKey) }
}

export async function saveOwnAi(orgId: string, input: { provider: unknown; model?: unknown; apiKey: unknown }): Promise<OwnAiStatus> {
  const ok = await checkedKey(input)
  const encryptedApiKey = await encryptApiKey(ok.apiKey)
  await withTenantContext({ orgId }, async (tx) => {
    const existing = await tx.query.customerModelConfig.findFirst({ where: orgRow(orgId) })
    if (existing) {
      await tx.update(customerModelConfig).set({ provider: ok.provider, modelName: ok.model, encryptedApiKey, isActive: true, updatedAt: new Date() }).where(eq(customerModelConfig.id, existing.id))
    } else {
      await tx.insert(customerModelConfig).values({ orgId, orchestraLayerId: null, provider: ok.provider, modelName: ok.model, encryptedApiKey, isActive: true })
    }
  })
  return getOwnAiStatus(orgId)
}

/** Disconnects: the key is erased, not just switched off. */
export async function removeOwnAi(orgId: string): Promise<OwnAiStatus> {
  await withTenantContext({ orgId }, (tx) => tx.delete(customerModelConfig).where(orgRow(orgId)))
  return getOwnAiStatus(orgId)
}

// ───────────── a PERSON's connection, and who they share it with ─────────────
const mineRow = (orgId: string, personId: string) => and(eq(userAiConnections.orgId, orgId), eq(userAiConnections.ownerUserId, personId))

export type PersonRef = { id: string; name: string }
export type MyAiStatus = OwnAiStatus & { sharedWith: PersonRef[] }
export type SharedWithMe = { ownerName: string; provider: OwnAiProvider; model: string }

export async function getMyAiStatus(orgId: string, personId: string): Promise<MyAiStatus> {
  return withTenantContext({ orgId }, async (tx) => {
    const row = await tx.query.userAiConnections.findFirst({ where: mineRow(orgId, personId) })
    if (!row || !row.isActive) return { connected: false, provider: null, model: null, changedAt: null, sharedWith: [] }
    const shares = await tx.query.userAiConnectionShares.findMany({ where: eq(userAiConnectionShares.connectionId, row.id) })
    const people = await Promise.all(
      shares.map(async (s) => {
        const u = await tx.query.users.findFirst({ where: and(eq(users.id, s.sharedWithUserId), eq(users.orgId, orgId)), columns: { id: true, name: true } })
        return u ? { id: u.id, name: u.name } : null
      })
    )
    return { connected: true, provider: row.provider as OwnAiProvider, model: row.modelName, changedAt: row.updatedAt.toISOString(), sharedWith: people.filter((p): p is PersonRef => p !== null) }
  })
}

/** Teammates whose connection was shared with this person (names and models only). */
export async function listSharedWithMe(orgId: string, personId: string): Promise<SharedWithMe[]> {
  return withTenantContext({ orgId }, async (tx) => {
    const shares = await tx.query.userAiConnectionShares.findMany({ where: and(eq(userAiConnectionShares.orgId, orgId), eq(userAiConnectionShares.sharedWithUserId, personId)) })
    const out: SharedWithMe[] = []
    for (const s of shares) {
      const conn = await tx.query.userAiConnections.findFirst({ where: and(eq(userAiConnections.id, s.connectionId), eq(userAiConnections.isActive, true)) })
      if (!conn) continue
      const owner = await tx.query.users.findFirst({ where: and(eq(users.id, conn.ownerUserId), eq(users.orgId, orgId)), columns: { name: true } })
      out.push({ ownerName: owner?.name ?? "A teammate", provider: conn.provider as OwnAiProvider, model: conn.modelName })
    }
    return out
  })
}

export async function saveMyAi(orgId: string, personId: string, input: { provider: unknown; model?: unknown; apiKey: unknown }): Promise<MyAiStatus> {
  const ok = await checkedKey(input)
  const encryptedApiKey = await encryptApiKey(ok.apiKey)
  await withTenantContext({ orgId }, async (tx) => {
    const existing = await tx.query.userAiConnections.findFirst({ where: mineRow(orgId, personId) })
    if (existing) {
      await tx.update(userAiConnections).set({ provider: ok.provider, modelName: ok.model, encryptedApiKey, isActive: true, updatedAt: new Date() }).where(eq(userAiConnections.id, existing.id))
    } else {
      await tx.insert(userAiConnections).values({ orgId, ownerUserId: personId, provider: ok.provider, modelName: ok.model, encryptedApiKey, isActive: true })
    }
  })
  return getMyAiStatus(orgId, personId)
}

/** Disconnects: the key is erased and every teammate it was shared with loses it (the shares go with the connection). */
export async function removeMyAi(orgId: string, personId: string): Promise<MyAiStatus> {
  await withTenantContext({ orgId }, async (tx) => {
    const existing = await tx.query.userAiConnections.findFirst({ where: mineRow(orgId, personId) })
    if (existing) {
      await tx.delete(userAiConnectionShares).where(eq(userAiConnectionShares.connectionId, existing.id))
      await tx.delete(userAiConnections).where(eq(userAiConnections.id, existing.id))
    }
  })
  return getMyAiStatus(orgId, personId)
}

/** Replaces the set of teammates who may use my connection. Only teammates of my own organisation count; I cannot share with myself. */
export async function setMyShares(orgId: string, personId: string, userIds: unknown): Promise<MyAiStatus> {
  if (!Array.isArray(userIds) || userIds.some((u) => typeof u !== "string")) throw new OwnAiError("Send the list of teammates to share with.")
  const wanted = [...new Set(userIds as string[])].filter((u) => u !== personId)
  await withTenantContext({ orgId }, async (tx) => {
    const mine = await tx.query.userAiConnections.findFirst({ where: mineRow(orgId, personId) })
    if (!mine) throw new OwnAiError("Connect your own AI first, then you can share it.", 409)
    const valid: string[] = []
    for (const id of wanted) {
      const u = await tx.query.users.findFirst({ where: and(eq(users.id, id), eq(users.orgId, orgId), eq(users.isActive, true)), columns: { id: true } })
      if (u) valid.push(u.id)
    }
    await tx.delete(userAiConnectionShares).where(eq(userAiConnectionShares.connectionId, mine.id))
    for (const id of valid) await tx.insert(userAiConnectionShares).values({ orgId, connectionId: mine.id, sharedWithUserId: id })
  })
  return getMyAiStatus(orgId, personId)
}

/** Active teammates of the organisation a person may share with (name and role only; never e-mail or anything private). */
export async function listShareCandidates(orgId: string, personId: string): Promise<Array<PersonRef & { role: string }>> {
  const rows = await withTenantContext({ orgId }, (tx) =>
    tx.query.users.findMany({ where: and(eq(users.orgId, orgId), eq(users.isActive, true)), columns: { id: true, name: true, role: true } })
  )
  return rows.filter((r) => r.id !== personId).map((r) => ({ id: r.id, name: r.name, role: String(r.role) })).sort((a, b) => a.name.localeCompare(b.name))
}

// ───────────── which AI serves THIS person ─────────────
/**
 * The AI that answers this person's chat and typed requests, decrypted for ONE call: their own, else one a teammate shared with them, else
 * the organisation's. null = nothing connected (the caller falls back to its normal path). Raw db, run before the request's own transaction.
 */
export async function resolveAiFor(orgId: string, personId: string | null): Promise<ResolvedAi | null> {
  if (personId) {
    const mine = await db.query.userAiConnections.findFirst({ where: and(mineRow(orgId, personId), eq(userAiConnections.isActive, true)) })
    if (mine) return { source: "mine", provider: mine.provider as LLMProvider, model: mine.modelName, apiKey: await decryptApiKey(mine.encryptedApiKey) }

    const shares = await db.query.userAiConnectionShares.findMany({ where: and(eq(userAiConnectionShares.orgId, orgId), eq(userAiConnectionShares.sharedWithUserId, personId)) })
    for (const s of shares) {
      const conn = await db.query.userAiConnections.findFirst({ where: and(eq(userAiConnections.id, s.connectionId), eq(userAiConnections.isActive, true)) })
      if (!conn) continue
      const owner = await db.query.users.findFirst({ where: eq(users.id, conn.ownerUserId), columns: { name: true } })
      return { source: "shared", sharedByName: owner?.name, provider: conn.provider as LLMProvider, model: conn.modelName, apiKey: await decryptApiKey(conn.encryptedApiKey) }
    }
  }
  const org = await resolveOrgOwnAi(orgId)
  return org ? { source: "org", ...org } : null
}

export async function hasAiFor(orgId: string, personId: string | null): Promise<boolean> {
  return (await resolveAiFor(orgId, personId).catch(() => null)) !== null
}

/** The full picture one person's panel and chat box need (no keys). `projexaOwnAi` = our own AI is on for this organisation (the test arrangement). */
export type AiPicture = {
  effective: { connected: boolean; source: AiSource | "projexa" | null; provider: OwnAiProvider | null; model: string | null; sharedByName: string | null }
  mine: MyAiStatus
  sharedWithMe: SharedWithMe[]
  org: OwnAiStatus
}

export async function getAiPicture(orgId: string, personId: string, projexaOwnAi: boolean): Promise<AiPicture> {
  const [mine, sharedWithMe, org] = await Promise.all([getMyAiStatus(orgId, personId), listSharedWithMe(orgId, personId), getOwnAiStatus(orgId)])
  let effective: AiPicture["effective"] = { connected: false, source: null, provider: null, model: null, sharedByName: null }
  if (mine.connected) effective = { connected: true, source: "mine", provider: mine.provider, model: mine.model, sharedByName: null }
  else if (sharedWithMe[0]) effective = { connected: true, source: "shared", provider: sharedWithMe[0].provider, model: sharedWithMe[0].model, sharedByName: sharedWithMe[0].ownerName }
  else if (org.connected) effective = { connected: true, source: "org", provider: org.provider, model: org.model, sharedByName: null }
  else if (projexaOwnAi) effective = { connected: true, source: "projexa", provider: null, model: null, sharedByName: null }
  return { effective, mine, sharedWithMe, org }
}
