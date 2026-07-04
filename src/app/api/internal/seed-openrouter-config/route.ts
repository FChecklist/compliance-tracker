// Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26) --
// one-time test-setup utility, same shared-secret pattern as
// /api/internal/metric-alerts/run. Encrypts the platform's own
// OPENROUTER_API_KEY (already a real, working env var) and stores it as a
// real Layer 2 (org) and Layer 4 (user) BYOK row for end-to-end testing --
// the raw key value never needs to leave the server or pass through any
// external caller, since this route reads process.env itself.
import { NextRequest, NextResponse } from "next/server"
import { db, customerModelConfig, personalModelConfig, clientModelConfig, clients } from "@/lib/db"
import { encryptApiKey } from "@/lib/ai-config-crypto"
import { eq } from "drizzle-orm"

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_TEST_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return NextResponse.json({ error: "OPENROUTER_API_KEY not set" }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const orgId: string = body.orgId
  const userId: string = body.userId
  const clientId: string | undefined = body.clientId
  if (!orgId || !userId) return NextResponse.json({ error: "orgId and userId required" }, { status: 400 })

  const encrypted = await encryptApiKey(apiKey)
  const model = "meta-llama/llama-3.3-70b-instruct:free"

  const [orgConfig] = await db.insert(customerModelConfig).values({
    orgId, provider: "openrouter", encryptedApiKey: encrypted, modelName: model, isActive: true,
  }).returning()

  const [userConfig] = await db.insert(personalModelConfig).values({
    userId, provider: "openrouter", modelName: model, encryptedApiKey: encrypted, isActive: true,
  }).onConflictDoUpdate({
    target: personalModelConfig.userId,
    set: { provider: "openrouter", modelName: model, encryptedApiKey: encrypted, isActive: true, updatedAt: new Date() },
  }).returning()

  let clientConfig: typeof clientModelConfig.$inferSelect | null = null
  if (clientId) {
    const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) })
    if (client) {
      const [row] = await db.insert(clientModelConfig).values({
        clientId, provider: "openrouter", encryptedApiKey: encrypted, modelName: model, isActive: true,
      }).returning()
      clientConfig = row
    }
  }

  return NextResponse.json({
    ok: true,
    orgConfigId: orgConfig?.id,
    userConfigId: userConfig?.id,
    clientConfigId: clientConfig?.id ?? null,
    model,
  })
}
