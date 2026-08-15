import { cookies } from "next/headers"
import { LOCALE_COOKIE } from "@/i18n/request"

// VERIDIAN Review Framework remediation, "Multi-Language AI Responses" gap
// (2026-07-18): every LLM system prompt in this codebase (chat.ai_thread_
// system, help.ai_assistant_system, etc.) has always been silent on
// language -- there was no instruction anywhere telling the model which
// language to reply in, despite the UI already shipping a real language
// switcher (src/i18n/locales.ts, next-intl, LanguageSwitcher.tsx). AI
// response translation was therefore "unconfirmed" by construction: a
// Hindi-UI user asking VERI Chat a question got whatever language the
// model's own default happened to be, not a deliberate choice.
//
// Deliberately decoupled from src/i18n/locales.ts's `locales` list: that
// list is constrained by which UI message catalogs actually exist
// (messages/{locale}.json must exist for every entry -- a real, large
// professional-translation undertaking to grow). An LLM needs no such
// catalog to reply fluently in another language -- the real gap was a
// missing INSTRUCTION, not a missing catalog -- so this list is
// deliberately broader than the 2 UI-chrome locales, without claiming to
// have translated the UI itself into any of them.
export const AI_RESPONSE_LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
  ru: "Russian",
  id: "Indonesian",
}

export function isKnownAiResponseLocale(value: string | undefined | null): value is keyof typeof AI_RESPONSE_LANGUAGES {
  return !!value && value in AI_RESPONSE_LANGUAGES
}

// Appended (not substituted) so a template's own task instructions/output-
// format requirements stay authoritative -- same posture as prompt-os-
// resolver.ts's VERI_PERSONA_DIRECTIVE, which this sits alongside on every
// call site that opts in. "Respond in X by default, but match the user's
// own language if different" covers both the common case (org has picked a
// UI language, wants replies in it) and the case where a user asks in a
// language other than their own UI setting.
export function languageDirectiveFor(locale: string): string {
  const language = AI_RESPONSE_LANGUAGES[locale]
  return `\n\nLanguage: respond in ${language} by default. If the user's own message is clearly written in a different language, respond in that language instead. This governs tone/language only -- it never changes a required output format (e.g. JSON field names/structure stay exactly as instructed above).`
}

// Server-side only -- reads the same NEXT_LOCALE cookie the UI's own
// language switcher sets (src/i18n/actions.ts's setLocale, read by
// src/i18n/request.ts for next-intl's own UI-string rendering), so a user's
// one language preference now also drives AI-generated response language,
// not just UI chrome. Returns undefined for an unset/unrecognized cookie
// (e.g. a value from a future UI locale this table hasn't been extended to
// yet) so callers fall back to resolvePromptTemplate's existing no-locale
// behavior rather than injecting a directive for an unknown language name.
export async function getPreferredAiResponseLocale(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const value = cookieStore.get(LOCALE_COOKIE)?.value
  return isKnownAiResponseLocale(value) ? value : undefined
}
