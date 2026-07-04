// Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26) --
// one-time end-to-end verification route, same shared-secret pattern as
// /api/internal/seed-openrouter-config. Exercises each of the 4 tenant-tier
// resolvers with a REAL, minimal LLM call through OpenRouter, so this proves
// actual API connectivity + DB resolution + decryption, not just that the
// code compiles. maxTokens kept tiny and the free-tier model used for 3 of
// the 4 calls to keep this near-zero cost (PLATFORM_STRATEGY.md §26.3).
import { NextRequest, NextResponse } from "next/server"
import { resolveModelConfig, resolveClientModelConfig, resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver"
import { resolvePageAgentModelConfig } from "@/lib/personal-model-resolver"
import { callLLM, estimateCostUsd } from "@/lib/llm-client"
import { db, users } from "@/lib/db"
import { eq } from "drizzle-orm"
import { submitFdeRequest } from "@/lib/services/fde-service"

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_TEST_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

const TEST_PROMPT = "Reply with exactly one word: OK"

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { orgId, userId, clientId } = body as { orgId: string; userId: string; clientId: string }
  if (!orgId || !userId || !clientId) return NextResponse.json({ error: "orgId, userId, clientId required" }, { status: 400 })

  const results: Record<string, unknown> = {}

  // Layer 1: Platform default (no BYOK involved at all)
  try {
    const cfg = await resolvePlatformModelConfig("task_oa")
    if (!cfg) throw new Error("no platform config resolved")
    const { content, usage } = await callLLM(cfg.provider, cfg.model, cfg.apiKey, "You are a test.", TEST_PROMPT, { maxTokens: 10 })
    results.layer1_platform = { provider: cfg.provider, model: cfg.model, reply: content, usage, costUsd: estimateCostUsd(cfg.model, usage) }
  } catch (e) {
    results.layer1_platform = { error: String(e) }
  }

  // Layer 2: Org BYOK (customer_model_config seeded by seed-openrouter-config)
  try {
    const cfg = await resolveModelConfig(orgId, "task_oa")
    if (!cfg) throw new Error("no org config resolved")
    const { content, usage } = await callLLM(cfg.provider, cfg.model, cfg.apiKey, "You are a test.", TEST_PROMPT, { maxTokens: 10 })
    results.layer2_org = { provider: cfg.provider, model: cfg.model, isCustomerConfigured: cfg.isCustomerConfigured, reply: content, usage, costUsd: estimateCostUsd(cfg.model, usage) }
  } catch (e) {
    results.layer2_org = { error: String(e) }
  }

  // Layer 3: Client BYOK (client_model_config, the genuinely new table)
  try {
    const cfg = await resolveClientModelConfig(clientId, orgId, "task_oa")
    if (!cfg) throw new Error("no client config resolved")
    const { content, usage } = await callLLM(cfg.provider, cfg.model, cfg.apiKey, "You are a test.", TEST_PROMPT, { maxTokens: 10 })
    results.layer3_client = { provider: cfg.provider, model: cfg.model, isCustomerConfigured: cfg.isCustomerConfigured, reply: content, usage, costUsd: estimateCostUsd(cfg.model, usage) }
  } catch (e) {
    results.layer3_client = { error: String(e) }
  }

  // Layer 4: User BYOK (personal_model_config) via resolvePageAgentModelConfig,
  // which itself chains personal -> client -> org -> platform.
  try {
    const cfg = await resolvePageAgentModelConfig(orgId, userId, clientId)
    if (!cfg || !cfg.apiKey) throw new Error("no personal config resolved")
    const { content, usage } = await callLLM(cfg.provider as Parameters<typeof callLLM>[0], cfg.model, cfg.apiKey, "You are a test.", TEST_PROMPT, { maxTokens: 10 })
    results.layer4_user = { provider: cfg.provider, model: cfg.model, source: cfg.source, reply: content, usage, costUsd: estimateCostUsd(cfg.model, usage) }
  } catch (e) {
    results.layer4_user = { error: String(e) }
  }

  // Real product feature end-to-end: VERI FDE's submitFdeRequest, which
  // internally resolves via resolveModelConfig("task_oa") -- proves the new
  // provider works through an actual existing call site, not just the
  // resolvers in isolation.
  try {
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!dbUser) throw new Error("test user not found")
    const fdeResult = await submitFdeRequest({ orgId, userId, dbUser }, { requestText: "Can VERIDIAN send me a reminder email before a compliance deadline?" })
    results.real_feature_veri_fde = fdeResult
  } catch (e) {
    results.real_feature_veri_fde = { error: String(e) }
  }

  return NextResponse.json(results)
}
