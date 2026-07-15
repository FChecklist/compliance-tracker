"use client"

// PLATFORM-01 Wave 2, Workstream 5. Minimal, real switcher so the next-intl
// wiring is actually demonstrable end-to-end (not just scaffolded) --
// changes the NEXT_LOCALE cookie via the setLocale Server Action, then
// refreshes so the current page re-renders with the new locale's messages.
// Deliberately tiny (a native <select>, no extra UI library) -- this is the
// reference pattern's proof-of-life, not a designed settings feature.
import { useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { locales, localeLabels, type AppLocale } from "@/i18n/locales"
import { setLocale } from "@/i18n/actions"

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleChange = (next: string) => {
    startTransition(async () => {
      await setLocale(next)
      router.refresh()
    })
  }

  return (
    <select
      aria-label="Language"
      value={locale}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value)}
      className={className ?? "text-[11px] bg-transparent border border-ct-border rounded-md px-1.5 py-0.5 text-ct-muted"}
    >
      {locales.map((l: AppLocale) => (
        <option key={l} value={l}>
          {localeLabels[l]}
        </option>
      ))}
    </select>
  )
}
