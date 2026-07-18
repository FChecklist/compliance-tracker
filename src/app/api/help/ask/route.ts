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
import { getPreferredAiResponseLocale } from "@/lib/ai-response-locale";

export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response } = await requireAuth();
  if (!user) return response!;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { question, currentPath } = await request.json();

  let systemPrompt: string;
  try {
    const locale = await getPreferredAiResponseLocale();
    systemPrompt = await resolvePromptTemplate("help.ai_assistant_system", "production", locale);
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

  const result = await callLLM(
    modelConfig.provider,
    modelConfig.model,
    modelConfig.apiKey,
    systemPrompt + "\n\nCurrent page: " + currentPath,
    question,
    undefined,
    modelConfig.fallback,
  );

  return NextResponse.json({ answer: result.content });
}