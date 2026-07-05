import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformModelConfig, resolveModelConfig, resolveClientModelConfig } from "@/lib/orchestra-model-resolver"
import { resolvePageAgentModelConfig } from "@/lib/personal-model-resolver"
import { callLLM } from "@/lib/llm-client"

/**
 * Temporary, one-time verification route (Wave 100 end-to-end AI Orchestra
 * test). Same shared-secret pattern as /api/internal/metric-alerts/run --
 * no user session for this kind of infra-level check. Removed after use,
 * matching the Wave 45 precedent (this codebase never leaves throwaway
 * test scaffolding in place).
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

const TEST_ORG_ID = "org_001"
const TEST_USER_ID = "user_mgr_fin"
const TEST_CLIENT_ID = "3948d27f-e0ee-4a64-a412-ae8b91b1cf2a"
const SYSTEM_PROMPT = "You are a test probe. Reply with exactly the word: PONG"
const USER_MESSAGE = "ping"

async function runLayer(label: string, resolve: () => Promise<{ provider: string; model: string; apiKey: string | null } | null>) {
  try {
    const resolved = await resolve()
    if (!resolved) return { layer: label, resolved: false, error: "resolver returned null" }
    if (!resolved.apiKey) return { layer: label, resolved: true, provider: resolved.provider, model: resolved.model, error: "no apiKey" }
    const result = await callLLM(resolved.provider as any, resolved.model, resolved.apiKey, SYSTEM_PROMPT, USER_MESSAGE, { maxTokens: 10 })
    return {
      layer: label,
      resolved: true,
      provider: resolved.provider,
      model: resolved.model,
      responseContent: result.content,
      usage: result.usage,
    }
  } catch (err) {
    return { layer: label, resolved: true, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const layer1 = await runLayer("Layer 1 (Platform)", () => resolvePlatformModelConfig("page_agent_oa"))
  const layer2 = await runLayer("Layer 2 (Org)", () => resolveModelConfig(TEST_ORG_ID, "page_agent_oa"))
  const layer3 = await runLayer("Layer 3 (Client)", () => resolveClientModelConfig(TEST_CLIENT_ID, TEST_ORG_ID, "page_agent_oa"))
  const layer4 = await runLayer("Layer 4 (Personal/PageAgent)", async () => {
    const r = await resolvePageAgentModelConfig(TEST_ORG_ID, TEST_USER_ID, TEST_CLIENT_ID)
    return r ? { provider: r.provider, model: r.model, apiKey: r.apiKey } : null
  })

  return NextResponse.json({ layer1, layer2, layer3, layer4 })
}
