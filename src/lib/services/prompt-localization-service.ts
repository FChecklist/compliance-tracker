// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-localization.
// Distinct from translation (prompt-translation-service.ts): translation
// converts language only; localization is a SECOND real LLM pass, layered
// on top of an existing translation, that adapts date/number formats and
// phrasing to be culturally appropriate for the target locale -- e.g. a
// prompt instructing "format the date as DD/MM/YYYY" for en-GB-style
// locales vs "MM/DD/YYYY" for en-US, or a formal/informal register
// appropriate to the locale's business culture. Never invents formatting
// conventions -- grounds the LLM call in real Intl.DateTimeFormat/
// Intl.NumberFormat sample output for the target locale, stored alongside
// the result so a reviewer can see exactly what ground truth the model was
// asked to match.
import { db, promptTranslations, promptLocalizations } from "@/lib/db"
import { eq } from "drizzle-orm"
import { resolvePlatformModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson } from "@/lib/llm-client"
import { AI_RESPONSE_LANGUAGES, isKnownAiResponseLocale } from "@/lib/ai-response-locale"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { requirePromptPermissionForUser } from "./permission-service"
import { translatePromptVersion, getCachedTranslation } from "./prompt-translation-service"
import type { PromptOsContext } from "./prompt-os-service"

const LOCALIZATION_MODEL_LAYER_KEY = "task_oa"

export type PromptLocalizationResult = {
  id: string
  promptTranslationId: string
  localizedContent: string
  formattingSamples: Record<string, string>
  provider: string
  model: string
  createdAt: string
}

function serializeLocalization(row: typeof promptLocalizations.$inferSelect): PromptLocalizationResult {
  return {
    id: row.id, promptTranslationId: row.promptTranslationId, localizedContent: row.localizedContent,
    formattingSamples: row.formattingSamples as Record<string, string>,
    provider: row.provider, model: row.model, createdAt: row.createdAt.toISOString(),
  }
}

/** Real (not fabricated) date/number formatting ground truth for a locale, via the runtime's own Intl support -- what the LLM is asked to match. */
export function localeFormattingSamples(locale: string): Record<string, string> {
  const sampleDate = new Date(Date.UTC(2026, 2, 4)) // 2026-03-04 -- unambiguous day/month for format comparison
  const sampleNumber = 1234567.89
  return {
    date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(sampleDate),
    number: new Intl.NumberFormat(locale).format(sampleNumber),
    currency: new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(sampleNumber),
  }
}

export async function getCachedLocalization(promptTranslationId: string) {
  return db.query.promptLocalizations.findFirst({ where: eq(promptLocalizations.promptTranslationId, promptTranslationId) })
}

/**
 * Localizes a prompt version for `targetLocale`: ensures a translation
 * exists first (translating on demand via prompt-translation-service.ts
 * rather than duplicating that LLM-call plumbing), then runs a second LLM
 * pass over the translated content to adapt date/number formatting and
 * phrasing to match real Intl-derived samples for that locale. Returns the
 * cached localization for this translation when one already exists, unless
 * `force` is set.
 */
export async function localizePromptVersion(
  ctx: PromptOsContext,
  input: { versionId: string; targetLocale: string; force?: boolean }
): Promise<PromptLocalizationResult> {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.localization.create")

  if (!isKnownAiResponseLocale(input.targetLocale)) {
    throw new ServiceError(`Unknown locale: ${input.targetLocale}`, 400)
  }

  const translation = (await getCachedTranslation(input.versionId, input.targetLocale))
    ?? (await (async () => {
      const result = await translatePromptVersion(ctx, { versionId: input.versionId, targetLocale: input.targetLocale })
      return db.query.promptTranslations.findFirst({ where: eq(promptTranslations.id, result.id) })
    })())
  if (!translation) throw new ServiceError("Failed to resolve a translation to localize", 502)

  if (!input.force) {
    const existing = await getCachedLocalization(translation.id)
    if (existing) return serializeLocalization(existing)
  }

  const modelConfig = await resolvePlatformModelConfig(LOCALIZATION_MODEL_LAYER_KEY)
  if (!modelConfig) throw new ServiceError("No AI model configured for prompt localization", 503)

  const languageName = AI_RESPONSE_LANGUAGES[input.targetLocale]
  const samples = localeFormattingSamples(input.targetLocale)

  const { data } = await callLLMJson<{ localizedContent: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey,
    `You are a localization specialist adapting an already-translated ${languageName} AI system prompt for real-world use in the "${input.targetLocale}" locale. This is NOT a translation task -- the text is already in ${languageName}. Your job is to adapt any date examples, number/currency formatting examples, and register/phrasing (formal vs informal, business conventions) to genuinely match this locale, using these real formatting samples as ground truth: date format "${samples.date}", number format "${samples.number}", currency format "${samples.currency}". Preserve every placeholder token exactly (e.g. {{variable_name}}) and the exact instruction meaning/structure. Respond with strict JSON: {"localizedContent": string}.`,
    translation.translatedContent,
    { jsonMode: true, expectedKeys: ["localizedContent"] },
    modelConfig.fallback
  )

  if (!data.localizedContent?.trim()) {
    throw new ServiceError("Localization returned empty content", 502)
  }

  const existing = await getCachedLocalization(translation.id)
  const [row] = existing
    ? await db.update(promptLocalizations)
        .set({ localizedContent: data.localizedContent, formattingSamples: samples, provider: modelConfig.provider, model: modelConfig.model })
        .where(eq(promptLocalizations.id, existing.id))
        .returning()
    : await db.insert(promptLocalizations).values({
        promptTranslationId: translation.id, localizedContent: data.localizedContent, formattingSamples: samples,
        provider: modelConfig.provider, model: modelConfig.model, createdById: ctx.userId,
      }).returning()

  return serializeLocalization(row)
}
