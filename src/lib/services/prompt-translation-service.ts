// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-translation.
// Real translation of a stored prompt version's content into another
// language, using this codebase's existing AI-model-calling infrastructure
// (resolvePlatformModelConfig()+callLLMJson(), the same pattern
// orchestra-execution-logger.ts's own call sites use) -- persisted in
// compliance.prompt_translations so a given (version, locale) pair is only
// ever translated once, not re-translated on every request. Prompt content
// is platform-wide (no orgId, see prompt-os-service.ts's own header), so
// this resolves a model via resolvePlatformModelConfig() rather than an
// org's own resolveModelConfig() -- there is no tenant to charge this to.
import { db, promptVersions, promptTranslations } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { AI_RESPONSE_LANGUAGES, isKnownAiResponseLocale } from "@/lib/ai-response-locale"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requirePromptPermissionForUser } from "./permission-service"
import type { PromptOsContext } from "./prompt-os-service"

const TRANSLATION_MODEL_LAYER_KEY = "task_oa"

export type PromptTranslationResult = {
  id: string
  promptVersionId: string
  locale: string
  translatedContent: string
  provider: string
  model: string
  createdAt: string
}

function serializeTranslation(row: typeof promptTranslations.$inferSelect): PromptTranslationResult {
  return {
    id: row.id, promptVersionId: row.promptVersionId, locale: row.locale,
    translatedContent: row.translatedContent, provider: row.provider, model: row.model,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getCachedTranslation(promptVersionId: string, locale: string) {
  return db.query.promptTranslations.findFirst({
    where: and(eq(promptTranslations.promptVersionId, promptVersionId), eq(promptTranslations.locale, locale)),
  })
}

/**
 * Translates a prompt version's content into `targetLocale`. Returns the
 * cached row for this (version, locale) pair when one already exists,
 * unless `force` is set -- this is the real "doesn't re-translate on every
 * request" contract this gap item requires. Preserves placeholder tokens
 * (e.g. `{{variable}}`) and formatting exactly, translating only the
 * natural-language instruction text -- a mistranslated `{{variable}}` token
 * would silently break every template-rendering call site.
 */
export async function translatePromptVersion(
  ctx: PromptOsContext,
  input: { versionId: string; targetLocale: string; force?: boolean }
): Promise<PromptTranslationResult> {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.translation.create")

  if (!isKnownAiResponseLocale(input.targetLocale)) {
    throw new ServiceError(`Unknown locale: ${input.targetLocale}`, 400)
  }

  const version = await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, input.versionId) })
  if (!version) throw new ServiceError("Unknown prompt version", 404)

  if (!input.force) {
    const existing = await getCachedTranslation(version.id, input.targetLocale)
    if (existing) return serializeTranslation(existing)
  }

  const modelConfig = await resolvePlatformModelConfig(TRANSLATION_MODEL_LAYER_KEY)
  if (!modelConfig) throw new ServiceError("No AI model configured for prompt translation", 503)

  const languageName = AI_RESPONSE_LANGUAGES[input.targetLocale]
  const { data } = await callLLMJson<{ translatedContent: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey,
    `You are a professional technical translator. Translate the following AI system prompt into ${languageName}. Preserve every placeholder token exactly as written (e.g. {{variable_name}}), all markdown/formatting, and the exact meaning and instruction structure -- translate only the natural-language instruction text, never variable names, code syntax, or JSON field names. Respond with strict JSON: {"translatedContent": string}.`,
    version.content,
    { jsonMode: true, expectedKeys: ["translatedContent"] },
    modelConfig.fallback
  )

  if (!data.translatedContent?.trim()) {
    throw new ServiceError("Translation returned empty content", 502)
  }

  const existing = await getCachedTranslation(version.id, input.targetLocale)
  const [row] = existing
    ? await db.update(promptTranslations)
        .set({ translatedContent: data.translatedContent, provider: modelConfig.provider, model: modelConfig.model, updatedAt: new Date() })
        .where(eq(promptTranslations.id, existing.id))
        .returning()
    : await db.insert(promptTranslations).values({
        promptVersionId: version.id, locale: input.targetLocale, translatedContent: data.translatedContent,
        provider: modelConfig.provider, model: modelConfig.model, createdById: ctx.userId,
      }).returning()

  return serializeTranslation(row)
}

export async function listPromptTranslations(promptVersionId: string): Promise<PromptTranslationResult[]> {
  const rows = await db.query.promptTranslations.findMany({ where: eq(promptTranslations.promptVersionId, promptVersionId) })
  return rows.map(serializeTranslation)
}
