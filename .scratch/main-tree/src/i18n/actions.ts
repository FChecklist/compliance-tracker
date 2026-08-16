"use server"

// PLATFORM-01 Wave 2, Workstream 5. Server Action backing LanguageSwitcher --
// sets the same NEXT_LOCALE cookie request.ts reads, 1 year expiry (a locale
// preference is a long-lived choice, same posture as this app's theme
// cookie). No account-level persistence here (organisations.country drives
// the compliance-engine registry in Workstream 6, a separate axis from a
// user's own UI-language preference) -- this is intentionally just a
// browser-local preference, matching next-intl's own documented pattern for
// apps without i18n routing.
import { cookies } from "next/headers"
import { isSupportedLocale } from "./locales"
import { LOCALE_COOKIE } from "./request"

export async function setLocale(locale: string): Promise<void> {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`)
  }
  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  })
}
