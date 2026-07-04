// TEMPORARY test harness for the 3-pass VERIDIAN AI OpenRouter E2E testing
// effort. Invokes real service functions directly (bypassing HTTP session
// auth) against the real production DB, so every test exercises real code
// paths with zero mocking. Gated behind TEST_HARNESS_KEY, a secret minted
// solely for this testing window. NEVER leaves a decrypted API key in an
// HTTP response. MUST be deleted (and a clean redeploy pushed) once the
// 3-pass testing effort concludes -- matches the "temporary internal test
// route, removed after use" precedent established in Wave 45.
import { NextRequest, NextResponse } from "next/server"
import { users, clients, documents, conversations, customerModelConfig, clientModelConfig, personalModelConfig, orchestraLayers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, sql } from "drizzle-orm"
import { encryptApiKey } from "@/lib/ai-config-crypto"
import { resolveModelConfig, resolveClientModelConfig } from "@/lib/orchestra-model-resolver"
import { resolvePageAgentModelConfig } from "@/lib/personal-model-resolver"
import { listConversations, sendMessage, regenerateAiReply } from "@/lib/services/chat-service"
import { submitFdeRequest } from "@/lib/services/fde-service"
import { enforcePolicy, refusalMessageFor, policyDecisionDisplayLabel } from "@/lib/policy-enforcement-engine"
import { findSimilarCapabilities } from "@/lib/services/capability-registry-service"
import { callLLM } from "@/lib/llm-client"
import { extractDocumentContent } from "@/lib/services/document-extraction-service"

const ORG_ID = "org_001"

async function getDbUser(userId: string) {
  return withTenantContext({ orgId: ORG_ID, userId }, (db) => db.query.users.findFirst({ where: eq(users.id, userId) }))
}

// Never let a decrypted BYOK secret leave this endpoint in a response body.
function redact<T extends { apiKey?: string | null } | null>(resolved: T) {
  if (!resolved) return resolved
  const { apiKey, ...safe } = resolved as Record<string, unknown>
  return { ...safe, hasApiKey: Boolean(apiKey) }
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-harness-key") !== process.env.TEST_HARNESS_KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json()
  const { action, payload } = body as { action: string; payload?: Record<string, unknown> }

  try {
    switch (action) {
      case "resolveModelConfig": {
        const { layerKey } = payload as { layerKey: string }
        const resolved = await resolveModelConfig(ORG_ID, layerKey)
        return NextResponse.json({ resolved: redact(resolved) })
      }

      case "resolveClientModelConfig": {
        const { layerKey, clientId } = payload as { layerKey: string; clientId: string }
        const resolved = await resolveClientModelConfig(clientId, ORG_ID, layerKey)
        return NextResponse.json({ resolved: redact(resolved) })
      }

      case "resolvePageAgent": {
        const { userId, clientId } = payload as { userId: string; clientId?: string }
        const resolved = await resolvePageAgentModelConfig(ORG_ID, userId, clientId ?? null)
        return NextResponse.json({ resolved: redact(resolved) })
      }

      case "chat": {
        const { userId, message } = payload as { userId: string; message: string }
        const { conversations } = await listConversations({ orgId: ORG_ID, userId })
        const aiThread = conversations.find((c) => c.isAiThread)!
        const result = await sendMessage({ orgId: ORG_ID, userId }, aiThread.id, { content: message })
        return NextResponse.json({ result })
      }

      case "chatRegenerate": {
        const { userId } = payload as { userId: string }
        const { conversations } = await listConversations({ orgId: ORG_ID, userId })
        const aiThread = conversations.find((c) => c.isAiThread)!
        const result = await regenerateAiReply({ orgId: ORG_ID, userId }, aiThread.id)
        return NextResponse.json({ result })
      }

      case "fde": {
        const { userId, requestText } = payload as { userId: string; requestText: string }
        const dbUser = await getDbUser(userId)
        const result = await submitFdeRequest({ orgId: ORG_ID, userId, dbUser: dbUser! }, { requestText })
        return NextResponse.json({ result })
      }

      case "policyCheck": {
        const { text, layerKey, eventType, domain } = payload as { text: string; layerKey: string; eventType: string; domain?: string }
        const decision = enforcePolicy({ orgId: ORG_ID, layerKey, eventType, domain }, text)
        return NextResponse.json({ decision, refusal: refusalMessageFor(decision), label: policyDecisionDisplayLabel(decision.category) })
      }

      case "debugConversationInsert": {
        const { userId } = payload as { userId: string }
        const result = await withTenantContext({ orgId: ORG_ID, userId }, async (db) => {
          const gucRows = await db.execute(sql`select current_setting('app.current_org_id', true) as org, current_setting('app.current_user_id', true) as usr, current_user as db_role`)
          try {
            const [row] = await db.insert(conversations).values({
              orgId: ORG_ID, type: "ai", isAiThread: true, title: "DEBUG",
            }).returning()
            await db.delete(conversations).where(eq(conversations.id, row.id))
            return { guc: gucRows[0], insertOk: true, insertedRow: row }
          } catch (err) {
            return { guc: gucRows[0], insertOk: false, error: err instanceof Error ? err.message : String(err) }
          }
        })
        return NextResponse.json(result)
      }

      case "docExtraction": {
        const { userId, imageBase64, mimeType } = payload as { userId: string; imageBase64: string; mimeType: string }
        const [doc] = await withTenantContext({ orgId: ORG_ID, userId }, (db) =>
          db.insert(documents).values({
            name: "harness-test-image", fileUrl: "test/harness-image", fileType: mimeType,
            uploadedById: userId, orgId: ORG_ID,
          }).returning()
        )
        await extractDocumentContent({ orgId: ORG_ID, userId, documentId: doc.id, imageBase64, mimeType })
        const [after] = await withTenantContext({ orgId: ORG_ID, userId }, (db) =>
          db.select({ extractedData: documents.extractedData }).from(documents).where(eq(documents.id, doc.id))
        )
        await withTenantContext({ orgId: ORG_ID, userId }, (db) => db.delete(documents).where(eq(documents.id, doc.id)))
        return NextResponse.json({ extractedData: after?.extractedData ?? null })
      }

      case "capabilitySearch": {
        const { text, limit } = payload as { text: string; limit?: number }
        const results = await findSimilarCapabilities(text, ORG_ID, limit ?? 8)
        return NextResponse.json({ results })
      }

      case "rawLLM": {
        const { provider, model, systemPrompt, userMessage } = payload as {
          provider: "openrouter"; model: string; systemPrompt: string; userMessage: string
        }
        const { content, usage } = await callLLM(provider, model, process.env.OPENROUTER_API_KEY!, systemPrompt, userMessage, { temperature: 0.3, maxTokens: 200 })
        return NextResponse.json({ content, usage })
      }

      case "seedCustomerConfig": {
        const { model } = payload as { model: string }
        const layer = await withTenantContext({ orgId: ORG_ID }, (db) => db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, "page_agent_oa") }))
        const enc = await encryptApiKey(process.env.OPENROUTER_API_KEY!)
        const [row] = await withTenantContext({ orgId: ORG_ID }, (db) =>
          db.insert(customerModelConfig).values({
            orgId: ORG_ID, orchestraLayerId: layer!.id, provider: "openrouter", encryptedApiKey: enc, modelName: model, isActive: true,
          }).returning()
        )
        return NextResponse.json({ id: row.id })
      }

      case "seedClientConfig": {
        const { model, clientId } = payload as { model: string; clientId: string }
        const layer = await withTenantContext({ orgId: ORG_ID }, (db) => db.query.orchestraLayers.findFirst({ where: eq(orchestraLayers.layerKey, "page_agent_oa") }))
        const enc = await encryptApiKey(process.env.OPENROUTER_API_KEY!)
        const [row] = await withTenantContext({ orgId: ORG_ID }, (db) =>
          db.insert(clientModelConfig).values({
            clientId, orchestraLayerId: layer!.id, provider: "openrouter", encryptedApiKey: enc, modelName: model, isActive: true,
          }).returning()
        )
        return NextResponse.json({ id: row.id })
      }

      case "seedPersonalConfig": {
        const { userId, model } = payload as { userId: string; model: string }
        const enc = await encryptApiKey(process.env.OPENROUTER_API_KEY!)
        const [row] = await withTenantContext({ orgId: ORG_ID, userId }, (db) =>
          db.insert(personalModelConfig).values({
            userId, provider: "openrouter", modelName: model, encryptedApiKey: enc, isActive: true,
          }).returning()
        )
        return NextResponse.json({ id: row.id })
      }

      case "cleanupTestConfigs": {
        await withTenantContext({ orgId: ORG_ID }, async (db) => {
          await db.delete(customerModelConfig).where(eq(customerModelConfig.orgId, ORG_ID))
          await db.delete(clientModelConfig).where(eq(clientModelConfig.clientId, (payload as { clientId: string }).clientId))
        })
        const { userId } = payload as { userId: string }
        if (userId) {
          await withTenantContext({ orgId: ORG_ID, userId }, (db) => db.delete(personalModelConfig).where(eq(personalModelConfig.userId, userId)))
        }
        return NextResponse.json({ ok: true })
      }

      case "listUsers": {
        const rows = await withTenantContext({ orgId: ORG_ID }, (db) => db.query.users.findMany({ where: eq(users.orgId, ORG_ID) }))
        return NextResponse.json({ users: rows.map((u) => ({ id: u.id, email: u.email, role: u.role })) })
      }

      case "listClients": {
        const rows = await withTenantContext({ orgId: ORG_ID }, (db) => db.query.clients.findMany({ where: eq(clients.orgId, ORG_ID) }))
        return NextResponse.json({ clients: rows.map((c) => ({ id: c.id, name: c.name })) })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    console.error("Test harness error:", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, { status: 500 })
  }
}
