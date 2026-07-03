// Wave 22 (Prompt Operating System, Langfuse-inspired) -- replaces every
// hardcoded LLM system-prompt string literal in the codebase with a real,
// versioned, labeled row. Raw `db` client, no tenant context -- prompt
// content is a platform-governed asset (same posture as orchestra_layers/
// module_registry), not per-org data, so this mirrors
// orchestra-model-resolver.ts's own precedent for platform-level reads.
import { db, promptTemplates, promptVersions } from "@/lib/db"
import { and, eq } from "drizzle-orm"

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

  return version.content
}
