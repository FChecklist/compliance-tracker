// PLATFORM-01 Wave 2, Workstream 5 (next-intl wiring). Central source of
// truth for which locales this app actually ships message catalogs for --
// messages/{locale}.json must exist for every entry here. Cookie/header
// based locale resolution (see request.ts), NOT URL-prefix routing (a
// `/en/`, `/hi/` scheme would be a much larger, riskier restructuring than
// this wave attempts -- see the plan file this implements).
export const locales = ["en", "hi"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";

export const localeLabels: Record<AppLocale, string> = {
  en: "English",
  hi: "हिन्दी",
};

export function isSupportedLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value);
}
