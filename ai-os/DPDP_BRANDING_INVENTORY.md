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
| Sign-in / start screen (`/app/` signed out) | small card, "VERIDIAN DPDP", "Type your email and we send you a sign-in link. No passwords." | wide card (780 px), offer line, role pill, title "Sign in or start free", 7 one-line benefits (2 columns on wide, 1 on a phone), "Your email", the same button, reassurance, trust line, brand top right. Every line traces to `data/veridian-facts.yaml`, the pricing page or the disclaimer; claims not provable were left out (see below). |
| Public pages titles, favicon, OG, manifest | consistent within each group (see conflicts) | unchanged |
| 404, legal, pricing pages | "... — VERIDIAN DPDP" | unchanged |
| Invoice e-mail function (`dpdp-invoice-email`), lifecycle mails, inbound-mail auto-replies | own text, signature "-- VERIDIAN AI DPDP" | NOT yet moved to the shared header/footer (they send through the same sender; the receipt is the same builder family as billing). Next step. |
| PDFs and exports | none exist in the DPDP code; the AI's Markdown/CSV reports end with the two-line brand footer | unchanged; `dpdp-ai-link-token-hygiene.test.ts` checks they carry no link |

## Tests

- `src/lib/services/dpdp-mail-brand.test.ts`: renders each builder above and fails if the header or footer is missing.
- `src/lib/services/dpdp-auth-template.test.ts`: renders the sign-in template for DPDP and non-DPDP redirects.

## Sign-in screen: what each line rests on (so the owner can decide)

| Line | Evidence |
|---|---|
| Free to start. Pay only when you agree a price. | Pricing page: "Until a fee is agreed in writing you owe nothing." |
| Turns the DPDP Act into a list of jobs | facts `what_it_does` |
| Gives each job to the right person | facts `what_it_does` |
| One email a week. No passwords | facts `what_it_does` ("one email a week, with no accounts or passwords") |
| Every answer is dated and cannot be edited | facts `what_it_does`; the history is append-only in the database |
| Each job is linked to its legal source | facts `what_it_does` ("mapped to its legal source") |
| Your documents stay with you | disclaimer: the product "never stores documents" (it keeps the dated answer and a fingerprint) |
| Let your own AI help with the jobs | the AI work link (paste into any AI chat) |
| We use your email to sign you in and to send your invoices | the Auth sender and the invoice e-mail function |
| Built for India's DPDP Act. We do not certify compliance. | brand line (approved 22 Sep 2026) and the disclaimer |

Left out on purpose because it cannot be proved from the repo: "DPDP / GDPR compliant", "your data never leaves your control", "free AI assistant" as a promise on this screen (the free assistant is a separate public page), any retention period, any price. What the product actually does is in `data/veridian-facts.yaml`; the owner can add a claim there and it can then be shown here.

## Word counts (brevity rule)

| Text | Before | After |
|---|---|---|
| Monday e-mail, whole (plain text, one AI link) | 798 (after the first A+B+C pass; the original was shorter but had no 48 h, no steps, no warnings) | 476 |
| Monday e-mail, the AI block | 594 | 272 |
| Do-not-forward warning | 2 sentences, 28 words | 1 line, 14 words |
| Sign-in e-mail | n/a (was: "Follow the link below to sign in..." 22 words, plain) | about 115 words, three options |
| Check your email pop-up | 3 paragraphs plus 2 buttons | 1 sentence body, 1 small line |
