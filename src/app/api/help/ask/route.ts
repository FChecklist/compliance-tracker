// -- INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES ('help.ai_assistant_system','Help AI','Context-aware in-app help assistant') ON CONFLICT DO NOTHING;
// -- INSERT INTO compliance.prompt_versions (template_id, content, label, is_active)
// --   SELECT id, 'You are VERIDIAN''s in-app help assistant. Answer the user''s question based on which VERIDIAN module or page they are currently viewing (provided as "Current page"). Be concise and helpful. If you do not know the answer or the question is outside VERIDIAN''s scope, say so honestly rather than guessing.', 'production', true
// --   FROM compliance.prompt_templates WHERE template_key = 'help.ai_assistant_system'
// -- ON CONFLICT DO NOTHING;

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { resolvePromptTemplate } from "@/lib/prompt-os-resolver";
import { resolveModelConfig } from "@/lib/orchestra-model-resolver";
import { callLLM } from "@/lib/llm-client";
import { enforcePolicy, refusalMessageFor } from "@/lib/policy-enforcement-engine";
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai";
import { retrieveRelevantKbPages } from "@/lib/services/knowledge-base-service";
import { getPreferredAiResponseLocale } from "@/lib/ai-response-locale";
import { normalizeForLlm } from "@/lib/prompt-normalizer";
import { passesReplyGate } from "@/lib/ai-reply-gate";
import { redactPii } from "@/lib/pii-redaction";
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger";
import { compileStaticPrefix } from "@/lib/prompt-cache/compiler";
import { recordPromptCacheMetric } from "@/lib/prompt-cache/metrics";

// AI Architecture / Performance & Cost Efficiency gap-closure (2026-07-18,
// "AI Context Compression" finding): this route used to call callLLM
// directly with none of chat-service.ts's generateAiReply() pipeline --
// no normalizeForLlm (the actual context-compression mechanism in this
// codebase, stripping conversational filler before tokens leave the
// tenant), no ai-reply-gate check against a hallucinated action claim, no
// PII redaction before logging, and no orchestra_executions/prompt-cache
// observability at all, so a Help AI call was invisible to every cost/
// latency dashboard built on those tables. Wired in additively below --
// the widget's request/response contract ({ question, currentPath } ->
// { answer }) is unchanged.
const FALLBACK_ANSWER =
  "I wasn't able to give a reliable answer to that. Please rephrase, or check the relevant page directly.";

export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response } = await requireAuth();
  if (!user) return response!;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { question, currentPath } = await request.json();

  let systemPromptTemplate: string;
  try {
    const locale = await getPreferredAiResponseLocale();
    systemPromptTemplate = await resolvePromptTemplate("help.ai_assistant_system", "production", locale);
  } catch {
    return NextResponse.json({
      answer:
        "I'm sorry, the help assistant is not fully configured yet. Please contact your administrator to seed the help.ai_assistant_system prompt template.",
    });
  }

  // Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Agent Framework section):
  // Help AI takes a live free-text question -- the same risk shape as VERI
  // Chat, which already has this gate. This route never did.
  const policyDecision = enforcePolicy(
    { orgId, userId: dbUser?.id, domain: DEFAULT_DOMAIN, layerKey: "user_assistant_oa", eventType: "help.ask" },
    question ?? ""
  );
  if (!policyDecision.allowed) {
    return NextResponse.json({ answer: refusalMessageFor(policyDecision) });
  }

  const modelConfig = await resolveModelConfig(orgId, "user_assistant_oa");
  if (!modelConfig) {
    return NextResponse.json({ error: "No AI model configured" }, { status: 400 });
  }

  const systemPrompt = systemPromptTemplate + "\n\nCurrent page: " + currentPath;
  // Same static-prefix caching signal chat-service.ts uses -- the resolved
  // template + current page is identical across every question asked from
  // that page, regardless of which user/org sent it. The KB grounding block
  // below is per-question and deliberately kept OUT of this string (appended
  // to the message instead) so it doesn't fragment the cache fingerprint --
  // same reasoning chat-service.ts's generateAiReply() uses for
  // userContextBlock (see its own comment on that pattern).
  const { fingerprint: promptCacheFingerprint } = compileStaticPrefix(systemPrompt);
  const normalizedQuestion = normalizeForLlm(question ?? "");

  // AI Architecture / Explainability & Transparency gap-closure
  // (2026-07-18): "Explain Software Functionality" -- ground the answer in
  // the org's own knowledge base pages instead of pure freeform generation,
  // when anything relevant is actually indexed. Best-effort: a retrieval
  // failure falls back to the exact pre-existing ungrounded behavior rather
  // than blocking the question.
  const relevantPages = await retrieveRelevantKbPages({ orgId }, String(question ?? "")).catch(() => []);
  const groundingBlock = relevantPages.length > 0
    ? "\n\nRelevant knowledge base content (use this if it answers the question; say so honestly if it doesn't):\n" +
      relevantPages.map((p) => `--- ${p.title} ---\n${(p.content ?? "").slice(0, 1500)}`).join("\n\n")
    : "";
  const messageForLlm = normalizedQuestion + groundingBlock;

  const startedAt = Date.now();
  try {
    const { content: reply, usage } = await callLLM(
      modelConfig.provider,
      modelConfig.model,
      modelConfig.apiKey,
      systemPrompt,
      messageForLlm,
      { enablePromptCache: true },
      modelConfig.fallback
    );

    // Same software-first gate as chat-service.ts's generateAiReply() -- a
    // raw LLM claim of completed action must never reach the user
    // unfiltered, same reasoning even though Help AI has no tool-calling
    // surface either.
    const gateResult = passesReplyGate(reply);
    recordOrchestraExecution({
      orgId, userId: dbUser?.id, layerKey: "user_assistant_oa", eventType: "help.ask",
      input: { currentPath, systemPrompt: redactPii(systemPrompt), question: redactPii(normalizedQuestion) },
      output: gateResult.passed
        ? { reply: redactPii(reply), replyLength: reply.length }
        : { reason: gateResult.reason, matchedPhrase: "matchedPhrase" in gateResult ? gateResult.matchedPhrase : undefined },
      status: gateResult.passed ? "completed" : "gated",
      durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    });
    recordPromptCacheMetric({
      orgId, layerKey: "user_assistant_oa", fingerprint: promptCacheFingerprint,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    });

    if (!gateResult.passed) {
      return NextResponse.json({ answer: FALLBACK_ANSWER });
    }
    // Explicit "grounded or not" signal + sources -- the finding's own
    // recommended approach ("retrieve relevant chunks before answering").
    return NextResponse.json({
      answer: reply,
      sources: relevantPages.map((p) => ({ id: p.id, title: p.title, slug: p.slug })),
    });
  } catch (err) {
    console.error("Help AI reply failed:", err);
    recordOrchestraExecution({
      orgId, userId: dbUser?.id, layerKey: "user_assistant_oa", eventType: "help.ask",
      input: { currentPath }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json({ answer: "Something went wrong generating a reply. Please try again in a moment." });
  }
}
