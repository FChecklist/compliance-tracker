// The Terms version a ticked box is recorded against, and the wording of the boxes. ONE constant per place that needs it, and a test
// (dpdp-app/src/lib/terms-acceptance.test.ts) fails if any of them differ:
//   - drizzle/0748_dpdp_terms_acceptance.sql   dpdp.terms_current_version() / dpdp.terms_box_text()  (the database is the authority)
//   - dpdp-app/src/lib/terms.ts                what the app sends and shows
//   - this file                                what the Edge Functions check before they call the database
//   - dpdp-app/public/terms/index.html         "Version 2026-10-13"
// Changing the version means changing all of them in one commit; a client still sending the old one is refused by the database
// ("Please tick the box to continue.", consent-required) until its box is ticked against the new one.
export const TERMS_VERSION = "2026-10-13"

export const BOX_K2 = "I have read and agree to the Terms & Conditions and the Privacy Policy."
export const BOX_K3 = "I agree to the Terms and the Refund Policy."

/** The one sentence and code for every refusal, from the database and from the Edge Function alike. */
export const CONSENT_REQUIRED_MESSAGE = "Please tick the box to continue."
export const CONSENT_REQUIRED_CODE = "consent-required"
