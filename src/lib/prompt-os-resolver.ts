// Wave 22 (Prompt Operating System, Langfuse-inspired) -- replaces every
// hardcoded LLM system-prompt string literal in the codebase with a real,
// versioned, labeled row. Raw `db` client, no tenant context -- prompt
// content is a platform-governed asset (same posture as orchestra_layers/
// module_registry), not per-org data, so this mirrors
// orchestra-model-resolver.ts's own precedent for platform-level reads.
import { db, promptTemplates, promptVersions } from "@/lib/db"
import { and, eq } from "drizzle-orm"

// VERI persona directive, appended to every customer/product-facing prompt
// so identity stays consistent across every AI surface in the product
// without editing 10+ call sites individually -- this resolver is the one
// place all of them funnel through. Deliberately a SUFFIX, not a
// replacement: each template's own task instructions and output-format
// requirements (including strict-JSON ones like ai_router/orchestrate.*)
// stay authoritative; this only governs tone/identity in whatever natural-
// language text the model produces, so it can't break a JSON schema a
// template already demands.
//
// Excluded for any `ai_team.*` template: those are the VERIDIAN Cognitive
// AI OS Development + Guardrail Team (src/lib/ai-team/roster.ts) -- each
// has its own distinct professional identity (Senior Backend Engineer, QA
// Engineer, Chief Governance Officer, etc.) and addresses the Founder &
// CEO as "Boss" already, per their own seeded prompts. They are not VERI.
const VERI_PERSONA_DIRECTIVE = `\n\nIdentity: you are VERI, the user's AI Assistant inside VERIDIAN. Address the human user as "Boss" and refer to yourself as "Assistant" in any natural-language text you write directly to them. This governs tone only -- it never changes a required output format (e.g. JSON field names/structure stay exactly as instructed above).`

function isVeriPersonaTemplate(templateKey: string): boolean {
  return !templateKey.startsWith("ai_team.")
}

/**
 * Resolves the active, labeled version of a prompt template. Throws (fails
 * loud) if no such version exists -- silently falling back to a stale
 * hardcoded string would defeat the entire point of centralizing prompts
 * here, so a missing template/label is a real configuration error, not
 * something to paper over.
 */
export async function resolvePromptTemplate(templateKey: string, label: string = "production"): Promise<string> {
  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, templateKey) })
  if (!template) throw new Error(`Unknown prompt template: ${templateKey}`)

  const version = await db.query.promptVersions.findFirst({
    where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.label, label), eq(promptVersions.isActive, true)),
    orderBy: (t, { desc }) => desc(t.version),
  })
  if (!version) throw new Error(`No '${label}'-labeled version found for prompt template: ${templateKey}`)

  return isVeriPersonaTemplate(templateKey) ? version.content + VERI_PERSONA_DIRECTIVE : version.content
}
