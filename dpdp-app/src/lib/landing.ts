// The magic link's landing URL is read exactly once, before the Supabase
// client is created. A SUCCESS hash (#access_token=...) is left untouched for
// detectSessionInUrl to consume; an ERROR hash (Supabase caps link expiry at
// 24h, so "opened Monday's email on Wednesday" lands here as
// error_code=otp_expired) and any ?email= hint are consumed and stripped so
// neither stays in the address bar or history.

export type Landing = {
  emailHint: string | null
  linkError: { expired: boolean; description: string | null } | null
}

let cached: Landing | undefined

export function readLanding(): Landing {
  // Memoised: React StrictMode runs state initialisers twice in dev, and the
  // second run would otherwise see an already-stripped URL.
  cached ??= parse()
  return cached
}

function parse(): Landing {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""))
  const query = url.searchParams
  const emailHint = query.get("email")?.trim().toLowerCase() || null
  const hasToken = hash.has("access_token")
  const errorParams = hash.has("error") || hash.has("error_code") ? hash : query.has("error") || query.has("error_code") ? query : null
  const linkError = !hasToken && errorParams
    ? { expired: errorParams.get("error_code") === "otp_expired", description: errorParams.get("error_description") }
    : null

  if (emailHint || linkError) {
    query.delete("email")
    if (linkError) {
      if (errorParams === hash) url.hash = ""
      else for (const k of ["error", "error_code", "error_description"]) query.delete(k)
    }
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }
  return { emailHint, linkError }
}

// The address a link was last requested for. Kept in localStorage rather
// than written into the link's own URL, so a fresh link can be requested in
// one click on this device without an email address ever riding in a query
// string.
const EMAIL_KEY = "dpdp-signin-email"

export function rememberEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email)
  } catch {
    // storage is a convenience here, never a requirement
  }
}

export function recallEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY)
  } catch {
    return null
  }
}
