import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { organisations } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { buildPurposeClause, DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { resolvePageAgentModelConfig } from "@/lib/personal-model-resolver"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine"

// Wave 25 (PageAgent integration). This is the ONLY place a PageAgent LLM
// call ever reaches a real provider -- the browser never gets a real key
// or a real provider URL (see PageAgentInitializer.tsx). Everything here
// enforces server-side, never trusting client-computed state:
//
// The client sends its current `pathname`, not a "mode" boolean -- a
// compromised tab could lie about either, but a raw pathname is at least
// what the server itself decides the restriction from, rather than
// trusting a client's own conclusion about what that pathname means.
//
// /posh and /whistleblower are hard-rejected here, full stop (user
// decision, following a caught confidentiality gap): the original
// "read-only mode" design only filtered mutating tool-calls out of the
// PROVIDER'S RESPONSE, but never stopped the REQUEST -- the actual page
// content PageAgent reads -- from reaching Groq/OpenAI/a user's BYO
// endpoint in the first place. There is no content-redaction path here;
// the request is refused before any provider call is made, so no page
// content from these routes ever reaches an LLM through this proxy,
// regardless of what the client sends or omits.
//
// Known-provider baseURLs mirror llm-client.ts's own callLLM() switch
// (groq/openai only -- Anthropic/Google are NOT OpenAI-chat-completions-
// shaped, so are explicitly out of scope for this proxy in v1; the
// realistic BYOAI/local-model story is Groq/OpenAI/Ollama/any
// OpenAI-compatible custom endpoint).
const KNOWN_PROVIDER_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
}

function isRestrictedPath(pathname: string): boolean {
  return pathname.startsWith("/posh") || pathname.startsWith("/whistleblower")
}

// Best-effort extraction of the latest user turn's text, for the policy
// gate below -- content is usually a plain string, but the page-agent
// library can also send structured/multi-part content, hence the fallback.
function latestUserText(messages: unknown[]): string {
  const msgs = messages as { role?: string; content?: unknown }[]
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === "user") {
      const content = msgs[i].content
      return typeof content === "string" ? content : JSON.stringify(content ?? "")
    }
  }
  return ""
}

function injectPurposeClause(messages: unknown[]): unknown[] {
  const clause = buildPurposeClause(DEFAULT_DOMAIN)

  const msgs = [...messages] as { role?: string; content?: string }[]
  const systemIdx = msgs.findIndex((m) => m?.role === "system")
  if (systemIdx >= 0) {
    msgs[systemIdx] = { ...msgs[systemIdx], content: `${msgs[systemIdx].content ?? ""}\n\n${clause}` }
  } else {
    msgs.unshift({ role: "system", content: clause })
  }
  return msgs
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const startedAt = Date.now()
  try {
    const body = await request.json()
    const { messages, pathname } = body as { messages?: unknown[]; pathname?: string }
    if (!Array.isArray(messages)) return NextResponse.json({ error: "messages array is required" }, { status: 400 })

    const org = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.query.organisations.findFirst({ where: eq(organisations.id, orgId), columns: { pageAgentEnabled: true } })
    )
    if (!org?.pageAgentEnabled) {
      return NextResponse.json({ error: "PageAgent is disabled for this organisation" }, { status: 403 })
    }

    // Hard reject, before any provider call is made -- no page content
    // from these routes ever reaches an LLM through this proxy, regardless
    // of whether PageAgentInitializer.tsx is (or should have been) mounted
    // on the client for this request.
    if (isRestrictedPath(pathname ?? "")) {
      recordOrchestraExecution({
        orgId, userId: dbUser.id, layerKey: "page_agent_oa", eventType: "page_agent_action",
        input: { pathname }, output: { error: "PageAgent is disabled on this route" },
        status: "failed", durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ error: "PageAgent is disabled on this page" }, { status: 403 })
    }

    // Wave 46 (VERIDIAN AI Constitution, Policy Enforcement Engine): gated
    // before resolvePageAgentModelConfig even runs -- Page Agent is the
    // only surface here where the model receives live page content, so a
    // denied request never reaches resolvePageAgentModelConfig, a
    // provider, or any page content forwarding.
    const policyDecision = enforcePolicy(
      { orgId, userId: dbUser.id, layerKey: "page_agent_oa", eventType: "page_agent_action" },
      latestUserText(messages)
    )
    if (!policyDecision.allowed) {
      return NextResponse.json({ error: refusalMessageFor(policyDecision) }, { status: 403 })
    }

    const modelConfig = await resolvePageAgentModelConfig(orgId, dbUser.id)
    if (!modelConfig) {
      return NextResponse.json({ error: "No AI model configured for Page Agent. Configure one in Settings -> My AI or Settings -> AI Configuration." }, { status: 503 })
    }

    const targetUrl = KNOWN_PROVIDER_URLS[modelConfig.provider] ?? modelConfig.baseUrl
    if (!targetUrl) {
      return NextResponse.json({ error: `Provider '${modelConfig.provider}' requires a baseUrl and none is configured` }, { status: 503 })
    }

    const forwardedMessages = injectPurposeClause(messages)

    const providerRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(modelConfig.apiKey ? { Authorization: `Bearer ${modelConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, messages: forwardedMessages, model: modelConfig.model, stream: false }),
    })

    if (!providerRes.ok) {
      const errText = await providerRes.text().catch(() => "")
      recordOrchestraExecution({
        orgId, userId: dbUser.id, layerKey: "page_agent_oa", eventType: "page_agent_action",
        input: { pathname }, output: { error: errText.slice(0, 500) },
        status: "failed", durationMs: Date.now() - startedAt, provider: modelConfig.provider, model: modelConfig.model,
      })
      return NextResponse.json({ error: `Provider error ${providerRes.status}` }, { status: 502 })
    }

    const responseBody = await providerRes.json()

    const usage = responseBody?.usage
      ? { promptTokens: responseBody.usage.prompt_tokens ?? 0, completionTokens: responseBody.usage.completion_tokens ?? 0 }
      : undefined

    recordOrchestraExecution({
      orgId, userId: dbUser.id, layerKey: "page_agent_oa", eventType: "page_agent_action",
      input: { pathname }, output: { finishReason: responseBody?.choices?.[0]?.finish_reason },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error("Page Agent proxy error:", error)
    recordOrchestraExecution({
      orgId, userId: dbUser.id, layerKey: "page_agent_oa", eventType: "page_agent_action",
      input: {}, output: { error: error instanceof Error ? error.message : String(error) },
      status: "failed", durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ error: "Page Agent proxy failed" }, { status: 500 })
  }
}
