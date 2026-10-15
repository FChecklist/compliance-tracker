// The magic link's landing URL is read exactly once, before the Supabase
// client is created. A SUCCESS hash (#access_token=...) is left untouched for
// detectSessionInUrl to consume; an ERROR hash (Supabase caps link expiry at
// 24h, so "opened Monday's email on Wednesday" lands here as
// error_code=otp_expired) and any ?email= hint are consumed and stripped so
// neither stays in the address bar or history.

export type Edition = "firm" | "institution"

export type Landing = {
  emailHint: string | null
  /** ?edition=firm|institution from a landing page's "Start free": which organisation the visitor is here to open. */
  edition: Edition | null
  /** ?ref=<code> from someone's share link (WO-DPDP-016): which referral this visitor arrived through, if any. */
  referralCode: string | null
  /** ?join=<code> from a colleague's invite link (WO-DPDP-016 Step 2): which organisation this visitor is here to join, if any. */
  joinCode: string | null
  /** ?sp=<code> from a Sales Partner's own link (drizzle/0734): outranks a ?ref= referral at account opening. */
  partnerCode: string | null
  /** ?src= or ?utm_source= : a campaign tag, kept as the account's source. */
  sourceTag: string | null
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
  const editionParam = query.get("edition")
  const edition: Edition | null = editionParam === "firm" || editionParam === "institution" ? editionParam : null
  // ?ref=<code>: same unambiguous 8-char alphabet dpdp_my_referral_code
  // generates (ABCDEFGHJKLMNPQRSTUVWXYZ23456789) -- loosely bounded here
  // (4-16 alphanumerics) since the RPC that actually resolves it is the
  // one source of truth for whether a code is real; this is just "does it
  // look like a code, worth remembering" so a stray ?ref= from an unrelated
  // link never gets carried around.
  const refParam = query.get("ref")
  const referralCode = refParam && /^[A-Za-z0-9]{4,16}$/.test(refParam) ? refParam : null
  // ?join=<code> (WO-DPDP-016 Step 2): the same "looks like a code, worth
  // remembering" bound as ?ref= -- dpdp_join_org_via_invite is the one
  // source of truth for whether it actually resolves to an organisation.
  const joinParam = query.get("join")
  const joinCode = joinParam && /^[A-Za-z0-9]{4,16}$/.test(joinParam) ? joinParam : null
  // ?sp= (a Sales Partner's code) and ?src= / ?utm_source= (a campaign tag): both kept with the FIRST link winning for 30 days.
  const spParam = query.get("sp")
  const partnerCode = spParam && /^[A-Za-z0-9]{4,16}$/.test(spParam) ? spParam : null
  const sourceTag = cleanSourceTag(query.get("src") ?? query.get("utm_source"))
  const hasToken = hash.has("access_token")
  const errorParams = hash.has("error") || hash.has("error_code") ? hash : query.has("error") || query.has("error_code") ? query : null
  const linkError = !hasToken && errorParams
    ? { expired: errorParams.get("error_code") === "otp_expired", description: errorParams.get("error_description") }
    : null

  if (edition) rememberEdition(edition)
  if (referralCode) rememberReferral(referralCode)
  if (joinCode) rememberJoin(joinCode)
  if (partnerCode) rememberFirstTouch(PARTNER_KEY, partnerCode)
  if (sourceTag) rememberFirstTouch(SOURCE_KEY, sourceTag)
  if (referralCode) markFirstSeen()
  if (emailHint || edition || referralCode || joinCode || partnerCode || sourceTag || linkError) {
    query.delete("email")
    query.delete("edition")
    query.delete("ref")
    query.delete("join")
    query.delete("sp")
    query.delete("src")
    query.delete("utm_source")
    if (linkError) {
      if (errorParams === hash) url.hash = ""
      else for (const k of ["error", "error_code", "error_description"]) query.delete(k)
    }
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  }
  return { emailHint, edition, referralCode, joinCode, partnerCode, sourceTag, linkError }
}

// ---- first link wins, for 30 days (drizzle/0734) ----
// A partner link and a campaign tag are kept with the moment the visitor FIRST arrived. A later link does not replace an earlier one until 30
// days have passed (the server enforces the same window from the timestamp we send). A partner code outranks a ?ref= referral on the server.
export const ATTRIBUTION_WINDOW_DAYS = 30
const PARTNER_KEY = "dpdp-partner"
const SOURCE_KEY = "dpdp-source"
const FIRST_SEEN_KEY = "dpdp-first-seen"
const VISITOR_KEY = "dpdp_vid"

export function cleanSourceTag(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase()
  return /^[a-z0-9_.-]{1,60}$/.test(v) ? v : null
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // a convenience, never a requirement
  }
}

/** The ISO time of the first remembered touch, or null when none is within the window. */
export function firstSeenAt(now: number = Date.now()): string | null {
  const v = readStore(FIRST_SEEN_KEY)
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) && now - t <= ATTRIBUTION_WINDOW_DAYS * 86_400_000 ? v : null
}

export function markFirstSeen(now: number = Date.now()): void {
  if (!firstSeenAt(now)) writeStore(FIRST_SEEN_KEY, new Date(now).toISOString())
}

/** Keep `value` under `key` only when nothing is remembered inside the window (first link wins). */
export function rememberFirstTouch(key: string, value: string, now: number = Date.now()): void {
  if (firstSeenAt(now) && readStore(key)) return
  writeStore(key, value)
  markFirstSeen(now)
}

export function recallPartner(): string | null {
  const v = firstSeenAt() ? readStore(PARTNER_KEY) : null
  return v && /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null
}

/** The campaign tag, or -- when there is none -- the visitor's own random id from the public-page tracker, as `vid.<hex>`, so the owner can join the account to its journey. */
export function recallSourceTag(): string | null {
  const tag = firstSeenAt() ? cleanSourceTag(readStore(SOURCE_KEY)) : null
  if (tag) return tag
  const vid = readStore(VISITOR_KEY)
  return vid && /^[a-f0-9]{8,64}$/.test(vid) ? `vid.${vid}` : null
}

// The edition a visitor chose on a landing page. The magic link they open
// later lands on a bare /app/ (no query), so it is kept on this device, the
// same way the address is.
const EDITION_KEY = "dpdp-edition"

export function rememberEdition(edition: Edition): void {
  try {
    localStorage.setItem(EDITION_KEY, edition)
  } catch {
    // a convenience, never a requirement: the visitor can still pick on the form
  }
}

export function recallEdition(): Edition | null {
  try {
    const v = localStorage.getItem(EDITION_KEY)
    return v === "firm" || v === "institution" ? v : null
  } catch {
    return null
  }
}

// The referral code a visitor arrived with (WO-DPDP-016), kept the same way
// as the edition: the magic link they open later lands on a bare /app/ (no
// query), so it must survive on this device between "Start free" and the
// moment dpdp_create_my_org actually runs.
const REFERRAL_KEY = "dpdp-referral"

export function rememberReferral(code: string): void {
  try {
    localStorage.setItem(REFERRAL_KEY, code)
  } catch {
    // a convenience, never a requirement: signup still works without it
  }
}

export function recallReferral(): string | null {
  try {
    const v = localStorage.getItem(REFERRAL_KEY)
    return v && /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null
  } catch {
    return null
  }
}

// The invite code a visitor arrived with (WO-DPDP-016 Step 2), kept the
// same way as the referral code -- the magic link lands on a bare /app/, so
// it must survive between "here's your invite link" and the moment the
// visitor is actually signed in and dpdp_join_org_via_invite can run.
const JOIN_KEY = "dpdp-join"

export function rememberJoin(code: string): void {
  try {
    localStorage.setItem(JOIN_KEY, code)
  } catch {
    // a convenience, never a requirement: they can still be named in manually
  }
}

export function recallJoin(): string | null {
  try {
    const v = localStorage.getItem(JOIN_KEY)
    return v && /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null
  } catch {
    return null
  }
}

/** Attempted once (success or a definitive bad-code failure) -- never retried forever on every load. */
export function clearJoin(): void {
  try {
    localStorage.removeItem(JOIN_KEY)
  } catch {
    // nothing to clean up if storage never worked in the first place
  }
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
