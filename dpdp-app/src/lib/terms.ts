// The ticked boxes (owner rule): before a commitment the person ticks a box, never pre-ticked, and the SERVER refuses without it.
//   K2  at sign-up (opening the organisation / account)   K3  before paying online
// The version, the wording and the refusal sentence below are the same words as drizzle/0748_dpdp_terms_acceptance.sql and
// supabase/functions/_shared/terms.ts; src/lib/terms-acceptance.test.ts fails if any of the three drift apart or if the Terms page stops
// showing this version.

/** The version a tick is recorded against. Shown on the Terms page as "Version 2026-10-13". */
export const TERMS_VERSION = "2026-10-13"

export type TermsKind = "K2" | "K3"

/** Which words of each box are links, and where they go (opened in a new tab). The box text is `before + link + between + link + after`. */
export type TermsBox = {
  kind: TermsKind
  /** The whole sentence, exactly as agreed. */
  text: string
  /** The pieces in order: plain text, or a link. Joined, they equal `text`. */
  parts: readonly ({ text: string } | { text: string; href: string })[]
}

export const BOX_K2: TermsBox = {
  kind: "K2",
  text: "I have read and agree to the Terms & Conditions and the Privacy Policy.",
  parts: [
    { text: "I have read and agree to the " },
    { text: "Terms & Conditions", href: "/terms/" },
    { text: " and the " },
    { text: "Privacy Policy", href: "/privacy/" },
    { text: "." },
  ],
}

export const BOX_K3: TermsBox = {
  kind: "K3",
  text: "I agree to the Terms and the Refund Policy.",
  parts: [
    { text: "I agree to the " },
    { text: "Terms", href: "/terms/" },
    { text: " and the " },
    { text: "Refund Policy", href: "/refund/" },
    { text: "." },
  ],
}

/** What the person sees, beside the disabled button, until the box is ticked. */
export const TICK_TO_CONTINUE = "Please tick the box to continue."
export const CONSENT_REQUIRED_CODE = "consent-required"

/** True when an error from the database, the Edge Function or the mock says the box was not ticked. */
export function isConsentRequired(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const o = e as { hint?: unknown; code?: unknown; message?: unknown }
  return o.hint === CONSENT_REQUIRED_CODE || o.code === CONSENT_REQUIRED_CODE || o.message === TICK_TO_CONTINUE
}
