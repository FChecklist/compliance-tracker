# Veridian DPDP completion report, 15 October 2026

App: https://app.veridian-aios.com (Cloudflare Pages `veridian-dpdp-app`), database Supabase `pcrjmlpuqsbocqfwoxod`. Hosting is Cloudflare only; nothing was deployed to Vercel, no money was spent, no DNS was touched, the internal AI features that were switched off are still off.

## Percent table
| Part | Done | Pending (Claude can do) | Owner-only |
|---|---|---|---|
| 1. Gate checklist, each gate proved by a test | 90% (16 of 18 fully proved; 2 proved by unit tests only) | 5% (live Razorpay test-mode order) | 5% (real payment, real sign-up with a throw-away account) |
| 2. Defects and copy | 100% of defects the new tests found (3 pages that scrolled sideways on phones, wording that overstated, missing HSTS); spelling pass found no mistakes | 0% | 0% |
| 3. PR #2055 (silent on-device reminders) | 100%: conflict resolved, CI green, merged | 0% | 0% |
| 4. Data-audit findings that Claude can fix | 55% (see section 4) | 35% | 10% |
| 5. Extraction prepared, not executed | 100% of the preparation (`DPDP_EXTRACTION_SECRETS_NEEDED_2026-10-15.md`) | 0% | execution waits for the owner's go and secrets |
| 6. Every change through PR, CI green, deployed, live verified | 100% (PR #2158 and PR #2055, deploy runs green, live pages checked) | 0% | 0% |
| **Overall** | **about 85%** | **about 10%** | **about 5%** |

## 1. Gates and the proof for each
"CI" means the GitHub run on the merge commit (Lint, Type Check, Build, Unit Tests, dpdp-app typecheck/lint/test/build, dpdp-app e2e in real Chromium: 221 browser tests passed, 0 failed). "Live" means run against https://app.veridian-aios.com today.

| # | Gate | Proof | Result |
|---|---|---|---|
| 1 | Public pages answer, 404 page, withdrawn pages redirect, robots/sitemap/llms | `dpdp-app/scripts/live-smoke.mjs` (live, 98 checks) and `src/lib/public-surface.test.ts` (2,453 checks in CI) | Pass |
| 2 | Sign-up and order flow | `e2e/editions-signup.spec.ts`, `agent-by-role.spec.ts`, `step5-by-role.spec.ts`, `acceptance-70.spec.ts` (CI, mock mode, real Chromium) | Pass. A real sign-up needs a throw-away mailbox: owner-only |
| 3 | Razorpay test-mode flow | `src/lib/services/dpdp-pay-ledger.test.ts` (order, webhook signature, attempt rows, refunds, commission body) | Unit-proved. No real card or UPI entered, as ordered. A live test-mode order needs a signed-in session: not run |
| 4 | Ledger C against central ledger B | same test file; cron `dpdp-ledger-tick` 48 of 48 runs succeeded in the last 24 h | Pass. Zero real payments exist, so real-row reconciliation is not yet seen |
| 5 | Partner commission | `dpdp-pay-ledger.test.ts` (`syncCommissions`), `src/lib/partner.test.ts`, `referral-chain.test.ts`; cron `dpdp-partner-mail` 48 of 48 | Pass |
| 6 | E-mails | `dpdp-billing-mail*.test.ts`, `payment-proof-mail.test.ts`, `public-wording.test.ts` (reads every receipt and reminder text); 1,246 mails logged | Pass |
| 7 | Consents | `consent-page.test.ts`, `dpdp-consent-page.pglite.test.ts`, `terms-acceptance.test.ts` | Pass |
| 8 | 29-minute rule tick | `SUMMARY_EVERY_MS = 29 min` pinned in `dpdp-pay-ledger.test.ts`; migration 0750; cron 48 of 48 | Pass |
| 9 | AI features gated or off as decided | unchanged by this work; in-app internal AI pages gated since PR #1941; AI work link still works for a user's own AI | Pass (not re-opened) |
| 10 | Accessibility | new `e2e/gates-phone-a11y-pwa.spec.ts`: language, one top heading, named links, buttons, images, fields on 15 public pages; `site-css-contrast.test.ts` | Pass |
| 11 | Phone fit 320, 375, 430 px | same spec, 45 page-width checks. It FAILED first on `/privacy/`, `/pricing/`, `/subprocessors/` (sideways scroll up to 74 px); fixed in `public/legal/legal.css`; now passes | Pass after fix |
| 12 | PWA | same spec: manifest, icons, offline worker; `device-copy.spec.ts`; reminders (PR #2055) | Pass |
| 13 | Logos | PR #2156 today; `/logo.svg` serves 200 live | Pass |
| 14 | Spelling | every public page and every in-app string checked against an English dictionary: no mistakes (British spelling is used throughout and is consistent) | Pass |
| 15 | No "pending approval" or owner-note wording | `public-wording.test.ts` now also bans legal approval, owner's approval, review pending, owner told, not done yet | Pass |
| 16 | Security headers | HSTS (one year, not for subdomains) added to every page and the `/ai/` function, pinned in tests; live header present | Pass |
| 17 | Daily jobs run | 9 DPDP cron jobs, every run in 24 h succeeded; retention sweep is LIVE since 14 Oct | Pass |
| 18 | Audit trail records what it should | migration 0751: AI work link reads now leave an `ai_read` entry. Proved live with a rolled-back insert (0 to 1 entries, 0 failures) and a committed test | Pass |

Live browser run of the new gate spec against https://app.veridian-aios.com (real Chromium, after the deploy): 62 of 62 passed.

## 2. Defects fixed
- Three legal pages scrolled sideways on phones. Tables now stack row by row under 640 px.
- Home, llms text, disclaimer, privacy and sign-in said "cannot be edited" and "never stores your documents". Now: changes are added to the record, never overwritten; a payment proof you upload is kept privately.
- Privacy notice now names: e-mail text kept, payment-method details Razorpay returns (never a full card or UPI id), on-device items (offline copy, offline worker, referral code, session marker), the once-a-day on-device reminder.
- HSTS added.
- `OPERATIONS.md` no longer says "none of it is live" or "nothing deletes".

## 3. PR #2055 (silent reminders, web push slice 1)
Sound: it never asks for a push subscription, sends nothing to our server, shows at most one counts-only notification a day, shows no banner. It had a conflict with `App.tsx` (the test-mode banner added on main); resolved by keeping both. Re-ran CI (23 checks green; the cross-repo E2E is skipped by design) and merged. Deploy run green.

## 4. Data audit (`DPDP_DATA_AUDIT_2026-10-14.md`, section 5)
Fixed: D21 (AI reads now audited; the other audit tables were empty only because the last business event was 4 Oct, before the trail existed), D09 (HSTS), D04 and D22 (notice), D20 (notice), section 5.3 statements 1 to 4 and 7, stale OPERATIONS lines. Found already fixed since the audit: retention now live (D06), per-table retention for e-mail log and AI-link calls, overdue-ticket job (D16).
Still open, Claude can do, each is its own piece of work (proposed as a follow-up session): D13 erase or de-identify one person; D07 hash `consent_token.token` and `org_invite.code`; D05/D12 self-service "my data" and correction screen; D15 nomination form; D03 store a hash of the exact consent text shown.
Left as designed: the AI-link write-by-GET fallback (needed for chat assistants that cannot send a POST; same checks as a POST apply).
Owner-only or outside this repo: the Cloudflare Web Analytics script on parents' pages (Cloudflare dashboard switch, D17); signed vendor agreements (D18/D19); lawyer sign-off on the breach runbook (D11); Supabase Auth "OTP expiry" and "leaked password" dashboard settings (D07).

## 5. Extraction into a private repository
Prepared, not executed. Everything the owner must re-enter is in `DPDP_EXTRACTION_SECRETS_NEEDED_2026-10-15.md` (names only, no values).

## 6. Parked for the owner
`set-auth-smtp --apply`, lawyer sign-off, Resend cap, a real Rs 1 payment, a throw-away sign-up account, Cloudflare Web Analytics switch, extraction go-ahead and secrets.
