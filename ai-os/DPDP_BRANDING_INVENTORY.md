# VERIDIAN DPDP: branding inventory (2026-10-05)

Authority for names: `dpdp-app/src/lib/brand.ts` + `brand.test.ts` (the brand line "VERIDIAN · VERy INDIAN", approved 22 Sep 2026) and the app's own titles.
This is a first-pass audit made by reading the source. Where a touch point is not changed, it says why.

## Name conflicts (listed for the owner to settle, not guessed)

| Where | Name used |
|---|---|
| Public site pages (home, about, partner) | "VERIDIAN · VERy INDIAN — ..." |
| App shell, app/act/copy/p/unsubscribe pages, 404, legal pages, PWA manifest, Supabase Auth sender | "VERIDIAN DPDP" |
| E-mail From name (`mail-outbound.ts` DEFAULT_FROM), plain-text signatures, partner/billing/invoice mails | "VERIDIAN AI DPDP" |
| Monday digest header (before) | "VERIDIAN AI" + "DPDP"; footer "VERIDIAN AI — One Portal. One Truth." (that tagline belongs to the other product, Veridian AI, not DPDP) |
| Sign-in e-mail text the owner dictated | "Veridian DPDP" |
| AI manual and paste | "VERIDIAN" / "VERIDIAN DPDP" |

Not changed because it is wired into code and tests: the From name "VERIDIAN AI DPDP" (inbound-mail signature stripping and about 30 tests depend on it).
Decision needed: one of "VERIDIAN DPDP" or "VERIDIAN AI DPDP" for customer-facing text. The shared mail module has ONE constant (`MAIL_BRAND_NAME` in `supabase/functions/_shared/brand-mail.ts`), so changing the name later is a one-line edit plus the From name.

## Touch points

| Touch point | Before | After |
|---|---|---|
| Monday digest, statutory view | header "VERIDIAN AI / DPDP", footer carried the other product's tagline | text header and footer use the shared name; footer = name, support address, unsubscribe (no Privacy link: the statutory notices must not carry the public-site address, an existing owner rule) |
| Leak-clock and rights-clock notices | same shell | same as above |
| Billing receipt, trial and renewal reminders | plain "-- VERIDIAN AI DPDP" line only, no header | shared header, footer with support address, Privacy and Refunds links |
| Partner mails (6 kinds) | plain signature only | shared header and footer |
| Unfamiliar-use alert (new) | none | shared header and footer, no links at all |
| Sign-in e-mail (new, Supabase Auth template) | "Your sign-in link" | "VERIDIAN DPDP" bar, three options, footer with support address; other apps on the shared auth project keep the old text |
| AI-link paste and the e-mail's AI box | mixed | one sentence, "VERIDIAN" |
| Check your email screen | "In production..." was NOT present in this app (the owner's note refers to an older screen); plain card | eyebrow, brand mark top right next to close, passcode field, short copy |
| Public pages titles, favicon, OG, manifest | consistent within each group (see conflicts) | unchanged |
| 404, legal, pricing pages | "... — VERIDIAN DPDP" | unchanged |
| Invoice e-mail function (`dpdp-invoice-email`), lifecycle mails, inbound-mail auto-replies | own text, signature "-- VERIDIAN AI DPDP" | NOT yet moved to the shared header/footer (they send through the same sender; the receipt is the same builder family as billing). Next step. |
| PDFs and exports | none exist in the DPDP code; the AI's Markdown/CSV reports end with the two-line brand footer | unchanged; `dpdp-ai-link-token-hygiene.test.ts` checks they carry no link |

## Tests

- `src/lib/services/dpdp-mail-brand.test.ts`: renders each builder above and fails if the header or footer is missing.
- `src/lib/services/dpdp-auth-template.test.ts`: renders the sign-in template for DPDP and non-DPDP redirects.
