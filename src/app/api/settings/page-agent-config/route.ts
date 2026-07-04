import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { personalModelConfig } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { encryptApiKey } from "@/lib/ai-config-crypto"

const KEYLESS_PROVIDERS = ["ollama", "custom"]

// Wave 26: per-user PageAgent BYO model config. Uses withTenantContext for
// every personalModelConfig read/write -- this table is a genuine per-user
// secrets table with real cross-user-leak risk if ever queried unscoped,
// per personal-model-resolver.ts's own precedent. The API key itself is
// NEVER returned to the client, only a hasKey flag -- matches /api/settings/
// ai-config's confidentiality pattern.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ config: null })

  try {
    const row = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.personalModelConfig.findFirst({ where: eq(personalModelConfig.userId, dbUser.id) })
    )

    if (!row) return NextResponse.json({ config: null })

    return NextResponse.json({
      config: {
        provider: row.provider,
        model: row.modelName,
        baseUrl: row.baseUrl,
        hasKey: !!row.encryptedApiKey,
        isActive: row.isActive,
      },
    })
  } catch (error) {
    console.error("Failed to load PageAgent config:", error)
    return NextResponse.json({ error: "Failed to load configuration" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const { provider, model, baseUrl, apiKey } = body as {
      provider?: string
      model?: string
      baseUrl?: string
      apiKey?: string
    }

    if (!provider || typeof provider !== "string" || !provider.trim()) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 })
    }
    if (!model || typeof model !== "string" || !model.trim()) {
      return NextResponse.json({ error: "model is required" }, { status: 400 })
    }
    if (KEYLESS_PROVIDERS.includes(provider) && (!baseUrl || !baseUrl.trim())) {
      return NextResponse.json({ error: "baseUrl is required for a local/custom endpoint" }, { status: 400 })
    }

    await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.personalModelConfig.findFirst({ where: eq(personalModelConfig.userId, dbUser.id) })

      const patch: Partial<typeof personalModelConfig.$inferInsert> = {
        provider: provider.trim(),
        modelName: model.trim(),
        baseUrl: baseUrl?.trim() || null,
        isActive: true,
        updatedAt: new Date(),
      }
      if (apiKey) patch.encryptedApiKey = await encryptApiKey(apiKey)

      if (existing) {
        await db.update(personalModelConfig).set(patch).where(eq(personalModelConfig.id, existing.id))
      } else {
        await db.insert(personalModelConfig).values({
          userId: dbUser.id,
          provider: patch.provider!,
          modelName: patch.modelName!,
          baseUrl: patch.baseUrl ?? null,
          encryptedApiKey: patch.encryptedApiKey ?? null,
          isActive: true,
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to save PageAgent config:", error)
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 })
  }
}

// Soft-disable, not delete -- matches personalModelConfig.isActive's own
// purpose and this codebase's enablement-flag convention elsewhere
// (e.g. pms-enablement-service's disablePmsForOrg never deletes data).
export async function DELETE() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.update(personalModelConfig)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(personalModelConfig.userId, dbUser.id)))
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to clear PageAgent config:", error)
    return NextResponse.json({ error: "Failed to clear configuration" }, { status: 500 })
  }
}
