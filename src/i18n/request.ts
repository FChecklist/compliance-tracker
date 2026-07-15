// PLATFORM-01 Wave 2, Workstream 5 (next-intl wiring, compliance-tracker
// half). This is next-intl's "usage without i18n routing" pattern: no
// `/en/`, `/hi/` URL prefixes, no separate locale-routing middleware.ts.
// (Ground truth check before writing this: this repo has NO middleware.ts
// anywhere -- auth is enforced per-route via requireAuth(), not in Next.js
// middleware -- so there is nothing existing to layer locale routing
// "alongside", contrary to this task's original brief assumption. Since
// there's no middleware.ts to collide with, cookie-based resolution here
// needs no middleware.ts of its own either -- the simplest option that
// doesn't touch a system that doesn't exist.)
import { cookies } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import { defaultLocale, isSupportedLocale, type AppLocale } from "./locales"

export const LOCALE_COOKIE = "NEXT_LOCALE"

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value
  const locale: AppLocale = isSupportedLocale(cookieLocale) ? cookieLocale : defaultLocale

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
