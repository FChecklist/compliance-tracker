// THE ONE SWITCH for the organisation-direct path (owner order, 24 Nov 2026: firm-first redesign).
//
// A Firm (CA, CS, auditor or lawyer) or an Accountant Partner takes VERIDIAN and gives it to a client. An organisation taking the product
// directly is HIDDEN, not removed: every component, route handler, RPC and Edge Function stays in the repo and works when this is true.
//
//   false (default)  organisation-direct entry points are hidden or sent to the Partner door:
//                    - the home page offers only "Become a Partner" (no organisation door);
//                    - the sign-in "open an account" screen offers only the Firm account; an organisation link (?edition=institution) lands on the Partner door;
//                    - /dpdp-institution/ is redirected to /partner/ (public/_redirects, see ORG_DIRECT_REDIRECTS);
//                    - the app refuses to open an organisation account (openMyOrg in src/App.tsx).
//   true             all of that is back exactly as it was.
//
// To UNHIDE: set the constant below to true, delete the two "org-direct" lines from public/_redirects and point the two /dpdp-institutions lines back at /dpdp-institution/, and put the organisation door back on the home page
// (data in src/lib/home-copy.mjs). Then run `node scripts/generate-public-facts.mjs` and `node scripts/generate-home.mjs` and commit the regenerated files
// (the noindex tag on /dpdp-institution/ is removed by the first one; the build's --check steps fail until you do). src/lib/org-direct.test.ts fails if the constant and _redirects disagree.
//
// Plain ESM (.mjs) so scripts run under plain node can read it; the .d.mts next to it carries the types.
export const ORG_DIRECT_ENABLED = false

/** The two redirect lines that must exist in public/_redirects exactly when the switch is false. */
export const ORG_DIRECT_REDIRECTS = [
  "/dpdp-institution   /partner/   302",
  "/dpdp-institution/  /partner/   302",
]

/** Where the plural /dpdp-institutions address goes (301): straight to the Partner door while hidden, so there is one hop. */
export function institutionsPluralTarget(enabled = ORG_DIRECT_ENABLED) {
  return enabled ? "/dpdp-institution/" : "/partner/"
}

/** Which account types the open-an-account screen may offer. */
export function editionsOffered(enabled = ORG_DIRECT_ENABLED) {
  return enabled ? ["firm", "institution"] : ["firm"]
}

/** True when this edition may be opened directly (a Firm may always be opened). */
export function editionAllowed(edition, enabled = ORG_DIRECT_ENABLED) {
  return edition === "firm" || (edition === "institution" && enabled)
}

/** True when a visitor arrived for an organisation account that is hidden: the screen shows the Partner door instead. */
export function sendToPartnerDoor(edition, enabled = ORG_DIRECT_ENABLED) {
  return edition === "institution" && !enabled
}
