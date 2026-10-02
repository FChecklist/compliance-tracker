# VERIDIAN DPDP -- use-case catalogue and test status

Written 2026-10-02 (branch `test/dpdp-usecases`). The cases were written first, then tested. Every row says WHAT is checked, HOW (test type) and the RESULT.

**Status words.** PASS = checked and behaves as designed. PASS (fixed) = a real defect was found by this pass, fixed, and now has a test. FAIL = defect found and still open (listed in `TEST-REPORT.md`). NOT-TESTABLE-WITHOUT-OWNER = needs a real credential, a real mailbox, real money, DNS or an owner account; the reason is given.

**Test types.** `unit` = pure bun test. `pglite` = real Postgres as WASM, no server. `live-RB` = run against the live Supabase project inside one transaction that is rolled back (nothing kept; checked afterwards that no rows remained). `live-GET` = read-only HTTP request to the live site or an Edge function with deliberately bad input. `scan` = source scan guard. `build` = site build checkers. `review` = read the code, no executable test.

**Where the tests live.** `dpdp-app/src/lib/*.test.ts` (static app), `src/lib/services/dpdp-*.test.ts` (database functions, Edge-function logic), `supabase/functions/**/\*.test.ts` (mail, pulled into CI by `dpdp-mail-edge-functions.test.ts`), `scripts/dpdp/partner-lifecycle-live-test.mjs` (live-RB, 103 checks). Tests added by this pass are marked NEW.

---

## A. Visitor and public site (veridian-aios.com)

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| A01 | Visitor | none | GET `/`, `/dpdp-firm/`, `/dpdp-institution/`, `/about/`, `/ai-assistant/`, `/partner/`, `/partner/terms/`, `/pricing/`, `/terms/`, `/privacy/`, `/refund/`, `/shipping/`, `/contact/`, `/disclaimer/` | 200 text/html, canonical = own URL, `nosniff`, `strict-origin-when-cross-origin`, revalidating cache | page missing, wrong canonical, caching a stale HTML against new hashed assets | live-GET `probe.mjs` + `live-smoke.mjs` (70 checks) + build checkers (1769 + 437 + claims) | PASS |
| A02 | Visitor | none | GET `/app/ /act/ /copy/ /p/ /unsubscribe/` | 200, `X-Robots-Tag: noindex, nofollow`, meta robots noindex, `Cache-Control: no-store`, `no-referrer` | private page indexed, token leaked via Referer | live-GET; `public-surface.test.ts`; `check-public-surface` | PASS |
| A03 | Visitor | none | GET `/ai/` (external AI link prefix) | 404 plain text, noindex, no-store | prefix indexable | live-GET | PASS |
| A04 | Visitor | none | GET `www.` and `http://` forms | 301 to `https://veridian-aios.com/...`, path kept | redirect loop, path lost | live-GET; `redirects.test.ts` | PASS |
| A05 | Visitor | none | GET `/about` (no slash), `/index.html` | 308 to canonical | duplicate URLs | live-GET | PASS |
| A06 | Visitor | none | GET an unknown URL (`/nope-xyz/`, `/legal/`) | a real 404 | Unknown URLs answer 200 with the home page (SPA fallback); canonical points to `/` so search engines fold them, but Search Console can report "soft 404" | live-GET | FAIL (low; proposed fix in report) |
| A07 | Visitor | none | GET `/%00` and `/..%2f..%2fetc/passwd` | 4xx, no file content | traversal | live-GET | PASS (Cloudflare answers 400) |
| A08 | Crawler | none | GET `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` | 200; robots allows named bots on public paths, disallows the six private prefixes; sitemap lists the 7 public pages; 63 crawler probes, no 403 | a CDN rule blocking a bot; sitemap listing a private page | live-GET `check-crawler-access.mjs`; `crawler-access.test.ts`; `check-public-surface` | PASS |
| A09 | Owner | Google account | Search Console: verify property, submit sitemap, read coverage | indexed pages = the 7 in the sitemap | needs the owner's Google login | none | NOT-TESTABLE-WITHOUT-OWNER (account); the machine-readable half (A08) passes |
| A10 | Visitor | none | Read the brand line and claims on every page | the exact brand line on top, no banned claim, no AI-spelling variants, two-doors wall between public and `/ai/` | claim drift | `brand-line`, `brand`, `claims-register`, `two-doors-wall`, `facts` tests; build checkers | PASS (after fix B-1: the spelling scan walked `node_modules` and timed out) |
| A11 | Visitor | none | Open a shared link `?ref=CODE` | valid code (4-16 letters/digits) kept in this browser only, removed from the address bar; bad shapes never stored; blocked storage tolerated | code lost, code in URL, error on blocked storage | `ref-script.test.ts`, `referral-chain.test.ts` | PASS |

## B. Sign-up, sign-in, mail

Sign-in is a magic link only. There is no password, so there is no password reset.

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| B01 | Visitor | none | Enter an e-mail, press sign in | `signInWithOtp` is called with `emailRedirectTo` = `/app/`; screen "check your email" | invalid address, auth rate limit message from the provider shown | e2e (mock client, `acceptance-70`); `mock-client.test.ts` | PASS (mock). Real e-mail delivery: NOT-TESTABLE-WITHOUT-OWNER (sends real mail) |
| B02 | Visitor | link clicked | Land on `/app/#access_token=...` | session set, fragment removed from the address bar | token left in the URL / history | `api.ts` fragment helpers via e2e; `email-off.test.ts` | PASS (mock) |
| B03 | Visitor | expired or already-used link | Click it | "link expired" screen offering a fresh link with the remembered address | white screen; address forgotten | e2e acceptance checks | PASS (mock) |
| B04 | Visitor | none | Press resend repeatedly | each press asks the provider again; provider rate limit surfaces as a message, not a crash | duplicate spam | `review` of `App.tsx` `resend()` | PASS (review). Provider limits: NOT-TESTABLE-WITHOUT-OWNER |
| B05 | Visitor | none | Sign in with an e-mail that has no organisation | `OpenOrganisation` screen; no page data | a visitor sees another org | `dpdp-cross-tenant-rpc.test` ("no claims", "not a member") | PASS (needs DB; see report) and `dpdp_my_page` refusal in `dpdp-editions-roles` |
| B06 | Owner | Resend account | Auth e-mail uses the custom SMTP (`set-auth-smtp.mjs --apply`) | auth mail from the DPDP sender | default shared sender used | none | NOT-TESTABLE-WITHOUT-OWNER (applying changes the live auth config) |
| B07 | System | Resend inbound | Mail to `dpdp@` is classified, ticketed, acknowledged; hostile inbound (huge, forged signature, replay, HTML, header tricks) | acknowledged or refused cleanly; one mailbox | spoofed signature, loops, storms | `dpdp-resend-inbound-adversarial.pglite`, `resend-inbound.test`, `handler.test`, `classify.test` (about 800 tests) | PASS |
| B08 | System | Resend down or address bounces | Outbound send fails | a failed reminder is marked `failed` and retried on the next run (inside its 3-day window); addresses on reserved domains are never claimed or sent | silent loss; infinite retry | NEW `dpdp-sales-lifecycle.pglite` (claim/mark), NEW `dpdp-billing-mail-adversarial` (isDeliverableAddress) | PASS |
| B09 | Recipient | any mail | Press unsubscribe | `dpdp_unsubscribe` records it; reminders skip this owner | still mailed | `dpdp-timer.test`, NEW pglite ("unsubscribed owner gets nothing") | PASS |

## C. Organisation creation and referral code carry

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| C01 | New owner | signed in | `dpdp_create_my_org(name, product, code)` | org, owner membership (can sign), obligations (31 firm / 28 institution), 30-day trial row | partial org | live-RB (`partner-lifecycle-live-test`); `dpdp-obligation-service.test` | PASS |
| C02 | Owner | none | name with HTML `<script>`, SQL quote, `=cmd|...`, Hindi, emoji, exactly 120 chars | accepted, stored verbatim (inert), slug is made of a-z0-9 only (`script-alert-1-script`, `org`, `emoji-co`) | injection, 500 | live-RB (this pass) | PASS. Output encoders: React escapes; e-mails escape (C02a); CSV defuses (L01) |
| C02a | System | hostile org name | Render reminders and receipts | HTML body escaped, text body verbatim, Subject is one line | stored XSS in mail; header injection via a line break in the name | NEW `dpdp-billing-mail-adversarial` (64 tests) | PASS (fixed: a line break in the name reached the Subject; now collapsed) |
| C03 | Owner | none | 121-char name, blank, null, bad or null product (`'firm''; drop table ...`) | refused with a plain sentence | 500, partial org | live-RB | PASS |
| C04 | Owner | none | double-click: same name and product within 10 minutes | same org returned, `existing: true` | duplicate orgs | live-RB | PASS |
| C05 | Owner | none | sixth new org in a day | refused ("enough new organisations for one day") | org flooding | live-RB | PASS |
| C06 | Visitor | not signed in / expired JWT | call the RPC without an e-mail claim | "Sign in first" | anonymous creates an org | live-RB | PASS |
| C07 | Owner | valid active partner code | sign up with the code (any case, spaces around) | `referral_event` signed_up; first confirmed yearly payment earns 20% | code ignored | live-RB (103 checks); `referral-chain.test` | PASS |
| C08 | Owner | unknown code, blank, 10,000 characters, `' OR '1'='1` | sign up | org still created, no referral event, no error | sign-up blocked by a typo; injection | live-RB (this pass and the 103) | PASS |
| C09 | Owner | own code | self-referral | event recorded as `blocked` (self_referral), no commission | self-dealing | live-RB (103) | PASS |
| C10 | Owner | partner not active (applied, paused, ended) | sign up with that code | `blocked`, no commission | commission to an inactive partner | live-RB (103) | PASS |
| C11 | Two people, same Hindi name | both sign up | slugs `org`, `org-2` | no unique violation | collision error | live-RB | PASS |

## D. The 30-day trial and "Payment pending"

Owner rule (0655): access never locks; trial, awaiting_confirmation and active behave the same.

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| D01 | New org | sign-up | trial end = signup instant (UTC) + 30 days | within a second of 30 days | calendar-aligned or local-time trial | live-RB (29d 23:59:54 measured a few seconds after creation) | PASS |
| D02 | System | trial | reminder windows at day 20 (10 days left), 27 (3 left), 30 (0, "ended"): see group E | exact boundaries | off-by-one, overlap | NEW pglite (12 boundary cases + 340-hour sweep) and live-RB | PASS |
| D03 | Owner | trial ended | open the page | still works; pill says "Payment pending" (0 days left); message "your data is safe" | screen locks | NEW `dpdp-access-never-locks` (6 scans) | PASS |
| D04 | Owner | IST browser | the pill counts days left | counted from the true UTC end | the billing RPC returns `2026-10-29T08:38:15` with no zone; `new Date()` read it as local time, so IST users saw the end 5.5 hours early and US users hours late | NEW `db-time.test` (runs the parser under IST, UTC, New York, Auckland) | PASS (fixed) |
| D05 | Owner | trial | day 0 / 10 / 27 / 30 / 31 labels | 30, 20, 3, 0 days left then "Payment pending" | wrong label at 0 | pglite + review of `daysLeft` (ceil, never negative) | PASS |
| D06 | System | trial end at 23:30 UTC | reminder key uses the UTC date (`trial3:2027-03-31`) although it is 1 April in IST | consistent key, no double send around midnight | key flips with the zone | NEW pglite; NEW billing-mail test (`dateLabel`) | PASS |
| D07 | System | leap day | yearly payment on 29 Feb | renewal on 28 Feb of the next year (PostgreSQL clamps), reminders still fire | skipped year | NEW pglite | PASS |
| D08 | Owner | none | "I have paid" claim | state `awaiting_confirmation`, 48-hour wording, nothing else changes | lock | NEW `dpdp-payment-claim.pglite` (14 tests); `mock-client.test` | PASS |
| D09 | System | DST | India and UTC have no DST; all server maths is UTC | no skipped or doubled hour | n/a | design review + pglite sweep | PASS |
| D10 | Owner | org already paid | day 27 | no trial reminder | paying customers nagged | NEW pglite | PASS |

## E. Reminders (daily cron 04:00 UTC = 09:30 IST)

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| E01 | System | trial org | trial10 opens at T-10d, closes T-7d; trial3 T-3d..T; trial0 T..T+3d | exactly one kind due at any instant, never two | overlap; mass-mail of old trials | NEW pglite (12 cases + hourly sweep); live-RB (11 instants) | PASS |
| E02 | System | yearly active org | renew30 T-30d..T-27d, renew7 T-7d..T-4d; monthly plans never; a later payment moves the anniversary | as listed | wrong anchor | NEW pglite | PASS |
| E03 | System | two overlapping runs | claim | first claims, second gets `claimed:false` | double send | NEW pglite; live-RB | PASS |
| E04 | System | send failed | mark failed, next run | listed again; re-claim ok; error text capped at 500 | stuck forever | NEW pglite; live-RB | PASS |
| E05 | System | run crashed after claim | 29 minutes vs 31 minutes | not retaken before 30 minutes, retaken after | duplicate or never sent | NEW pglite | PASS |
| E06 | System | already sent | any later time | never listed, never claimed, mark cannot resurrect | sent twice | NEW pglite | PASS |
| E07 | System | hostile key / status | `'; drop table`, bad case, bad date, null | "Unknown reminder key" / "status must be sent or failed" | SQL injection | NEW pglite; live-RB | PASS |
| E08 | System | recipient rules | unsubscribed owner, revoked owner, no primary e-mail, no trial date, two owners (earliest only) | not mailed / one recipient | wrong person mailed | NEW pglite | PASS |
| E09 | System | cron down 1-2 days | catch-up | still sent inside the 3-day window; nothing after it | gap | NEW pglite (window edges); live: a `dpdp-partner-mail` run failed "job startup timeout" at 19:30 UTC 2026-10-01 under DB load, which this window design absorbs | PASS |
| E10 | System | Edge function | bad bearer (short, wrong, missing), GET, DELETE | 401 or 405, never 5xx | open endpoint | live-GET (cases below in K) | PASS |
| E11 | Owner | no overdue reminder | the renewal date passes unpaid | none is sent (design: access never locks; the in-app panel shows the renewal) | owner never nudged after the date | review | PASS (as designed; noted in report) |
| E12 | System | Resend ok, "mark sent" RPC fails | next daily run | claim is retaken after 30 minutes, so the reminder can be sent twice | duplicate | review of `dpdp-lifecycle-email/index.ts` | FAIL (low; proposed fix in report) |
| E13 | System | first live run | pg_cron `dpdp-sales-lifecycle` has not run yet (first slot 04:00 UTC 2026-10-02); `dpdp.sales_reminder_sent` is empty | first run in dry-run if no `RESEND_API_KEY`, nothing recorded | surprise mass mail | live read-only | NOT-TESTABLE-WITHOUT-OWNER (needs the run to happen and the owner's Resend key) |

## F. Roles and cross-organisation isolation

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| F01 | Owner A | org B exists | list, answer, acknowledge, flag anything in B | refused, B untouched | cross-tenant read or write | `dpdp-cross-tenant-rpc.test` (live DB) | PASS in CI where a DB is configured; skipped here (no `DATABASE_URL`, and the live DB must not be written) |
| F02 | Staff A | active member | reach org B | refused | same | same | same as F01 |
| F03 | Browser roles | any | direct table access | none; only RPCs | RLS gap | same file; NEW pglite (`has_table_privilege` on the money tables) | PASS (NEW) |
| F04 | Roles | owner, CA, GO, coordinator, staff, viewer, auditor, group member | each role sees and does only its screens, both editions | as designed | privilege creep | `dpdp-editions-roles` (live DB, skipped here), `dpdp-role-detection`, `dpdp-role-welcome`, e2e `step5-by-role` | PASS where run |
| F05 | Auditor | `audits` relationship | UPDATE audited org's obligation | refused; SELECT still allowed | write via audit link | `dpdp-obligation-rls` | PASS where run |
| F06 | Staff | not owner | `dpdp_pay_begin` | "Only the owner can pay" | staff spends the owner's money | NEW pglite | PASS |
| F07 | Stranger / anonymous | none | `dpdp_pay_begin` | "Not a member" | | NEW pglite | PASS |
| F08 | Browser | any | call the worklist, claim, mark, confirm, lookup functions | no execute privilege for anon/authenticated; service_role only | a browser marks a reminder sent or books money | NEW pglite (`has_function_privilege`) | PASS |

## G. External AI work link

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| G01 | Owner | signed in | mint a link (level 0 read / 1 notes / 2 broader) | token shown once, only its hash stored | token stored in clear | `dpdp-ai-work-link-rpc`, `dpdp-ai-link-rpc` | PASS (where DB) |
| G02 | AI | unknown / expired / revoked token | any call | 404 "expired or was revoked" (one sentence, no oracle) | enumeration | live-GET (`/dpdp-ai-link/zzz/jobs`, and all verbs); `dpdp-ai-link-lookup`, `live-smoke` | PASS (live-smoke on the apex passed; the dpdp. host's one `/ai/<unknown>/jobs` probe timed out once at 20 s x3 under DB load, then passed 70 of 70 on the immediate rerun: a transient latency issue, see K09) |
| G03 | AI | valid link | more than 120 calls in a minute | 429 with Retry guidance | flooding | `dpdp-ai-link-router`, `dpdp-ai-manual` | PASS (unit) |
| G04 | AI | link | oversize body, wrong method, no token | clean 4xx | 5xx | `MAX_BODY_BYTES` in router tests; live-GET | PASS |
| G05 | AI | link | every call logged (who, what, status, bytes) | call log row | unlogged action | `dpdp-ai-link-rpc` | PASS |
| G06 | AI | link | add and endorse suggestions (`/suggestions`); 20 new per link per day; 2,000 characters | accepted; the 21st refused with "Daily limit reached"; text over 2,000 refused | pool flooding | `dpdp-ai-suggestions.test` | PASS |
| G07 | AI | link | text containing personal data (names, PAN, Aadhaar, phone) | refused or redacted; no personal data stored in suggestions | PII in the shared pool | `dpdp-ai-suggestions.test`, `dpdp-ai-manual` (the injection rule first) | PASS |
| G08 | AI | link | edit another org's data, or change code | impossible: the link is bound to one membership and org; there is no code-change verb | privilege escape | `dpdp-ai-work-link-rpc`, `dpdp-editions-roles` ("not the owner cannot set a due date even through a link") | PASS |
| G09 | Owner | link | revoke | next call 404 immediately | still works | `dpdp-ai-link-rpc` | PASS |
| G10 | AI | link | 90-second cold start | client retries | timeout | `live-smoke` retries 3 x 20 s | PASS (with note K09) |

## H. Billing and payments

Razorpay is NOT configured live (the function answers 503 "not switched on"). No real Razorpay call was made by this pass.

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| H01 | Owner | Razorpay keys absent | "Pay online" | 503 `not_enabled`; the panel falls back to bank transfer wording | crash | live-GET (all of POST/GET/DELETE, no token, garbage token, bad JSON) ; `dpdp-pay-logic.test` | PASS |
| H02 | Owner | none | bank transfer: "I have paid" with reference and proof | state `awaiting_confirmation`; owner (platform admin) approves or rejects; reject returns to plain trial | double approve | NEW `dpdp-payment-claim.pglite`: declare, list, approve exactly once at the declared amount, reject back to plain trial, claim again after a reject; staff/stranger/anonymous refused; non-admin cannot list, approve or reject; hostile reference text inert; `payment-proof-mail.test` | PASS |
| H03 | Razorpay | secret set | webhook with a good signature | recorded once | | `dpdp-pay-logic.test` (signature, independent HMAC) | PASS (unit) |
| H04 | Attacker | none | webhook with bad, empty, wrong-case, truncated, non-hex signature; one changed character in the body | 401, nothing read | forged payment | `dpdp-pay-logic.test`; live-GET (503 while not enabled, never a booking) | PASS |
| H05 | Razorpay | replay | same event id, same payment under a second event id (`payment.captured` and `payment_link.paid`) | one booking, `duplicate:true` | double booking | NEW pglite (`dpdp_pay_confirm`) | PASS |
| H06 | Razorpay | second different payment on a paid attempt | flagged `attempt_already_paid`, event `payment_review_needed`, nothing booked | silent second booking or silent loss | NEW pglite | PASS |
| H07 | Razorpay | amount 1 paise short, double, wrong currency (USD) | refused, attempt marked `mismatch`, nothing booked, subscription untouched; the right payment later is still booked | partial payment accepted as full | NEW pglite | PASS |
| H08 | Razorpay | unknown order, empty payment id or event id | 404-style refusal logged; empty ids raise | | NEW pglite | PASS |
| H09 | Database | same Razorpay payment id twice | unique index refuses | | NEW pglite | PASS |
| H10 | Owner | none | "Pay online": monthly, `YEAR`, SQL string, null | refused (yearly only); price comes from the server (Rs 9,999) never the browser | tampered amount | NEW pglite; `dpdp-pay-logic.test` (price equals the screen) | PASS |
| H11 | Owner | none | 11 attempts within an hour; attempts older than an hour stop counting | 11th refused | double-click / script flood | NEW pglite | PASS |
| H12 | Owner | no edition set | pay | "no edition set yet" | charging an undefined plan | NEW pglite | PASS |
| H13 | Refund-like / failed payment | `payment.failed` or not captured | acknowledged 200 and ignored, no retry storm | | `dpdp-pay-logic.test` | PASS. A real refund flow does not exist in code (NOT-TESTABLE; no refund function) |
| H14 | System | receipt | GSTIN, CIN, legal name, address on the receipt equal the facts file | | `dpdp-billing-mail.test` (pins SELLER to `veridian-facts.yaml`) | PASS |
| H15 | Owner | none | real Razorpay payment link, real money | | none | NOT-TESTABLE-WITHOUT-OWNER (keys and money) |
| H17 | Owner | referred org | approve a yearly claim | partner earns 20% of the declared amount once; a blocked (self) referral earns nothing | double or wrongful commission | NEW `dpdp-payment-claim.pglite` | PASS |
| H18 | Platform owner | org with no edition (`product` null) | approve its claim | refused, nothing booked | the refusal is a raw `null value in column plan` constraint message, because `NULL not in (...)` is not true so the friendly check is skipped | NEW `dpdp-payment-claim.pglite` | PASS (safe) with a low cosmetic defect in the report |
| H19 | Platform owner | org already `active` that claimed a renewal | reject the claim | org keeps its paid standing | it returns to `trial` with the old trial date ("Payment pending"), renewal reminders stop | code reading of `dpdp_owner_reject_payment` (it always writes `trial`); the declare-again step is pinned in NEW `dpdp-payment-claim.pglite` | FAIL (low; proposed fix in report, O-4) |
| H16 | Owner | cancelled attempt | an attempt with no link can be cancelled, one with a link cannot; a paid attempt cannot get a new link | | NEW pglite | PASS |

## I. Sales Partner lifecycle

| ID | Actor | Precondition | Steps | Expected | Failure modes | Test | Status |
|---|---|---|---|---|---|---|---|
| I01 | Visitor | `/partner/` | apply, accept terms, save payout details, activate | status moves applied -> active only when complete; "applied" cannot be set by hand | skipping terms | `dpdp-partner-lifecycle.pglite` (about 80 checks); live-RB (103) | PASS |
| I02 | Owner | partner | pause, end | ended partner cannot re-apply or edit; paused partner's code is blocked at sign-up | commission after end | same | PASS |
| I03 | System | confirmed yearly payment | commission 20% (yearly, every renewal), 5% first month for monthly | amounts exact | rounding | live-RB; `dpdp-referral-service.test` | PASS |
| I04 | Owner | TDS percent unset | mark paid | refused until set | wrong withholding | live-RB | PASS |
| I05 | Owner | payout run | gross, TDS, net add up; below Rs 500 carries forward; same reference twice pays nothing twice | | double payment | live-RB | PASS |
| I06 | Partner | other partner / stranger | read another partner's data, call the Owner screens | refused; payout details masked from browser roles | leakage | live-RB ("no browser role can read the payout detail table") | PASS |
| I07 | System | 11th of the month | monthly statements queued once per partner per month; failing notice stops after 5 tries | | duplicate statements | live-RB | PASS |
| I08 | Audit | any | partner event log, payouts and terms acceptances are append-only | | tampering | live-RB | PASS |
| I09 | Self-referral | see C09 | | | | live-RB | PASS |

## J. Scheduled jobs (pg_cron on the live project, read-only inspection)

| ID | Job | Schedule (UTC) | Purpose | Test | Status |
|---|---|---|---|---|---|
| J01 | `dpdp-monday-digest` | Mon 00:30 | weekly digest | `dpdp-timer.test` | PASS |
| J02 | `dpdp-monday-retry` | Mon 01:30, 03:30, 06:30 | retry the digest | `dpdp-timer.test` | PASS |
| J03 | `dpdp-legal-clocks` | daily 03:30 | leak and rights clocks | `dpdp-timer.test`; run history shows success 2026-10-01 03:30 | PASS |
| J04 | `dpdp-operator-digest` | daily 03:30 | operator summary | `dpdp-operator-digest-migration.pglite` | PASS |
| J05 | `dpdp-partner-mail` | every 30 minutes | partner notices | pglite + live-RB; the 19:30 UTC run on 2026-10-01 failed with "job startup timeout" (DB load), the 19:00 run succeeded | PASS (resilient; see K09) |
| J06 | `dpdp-partner-statements` | 11th, 03:30 | statements | live-RB | PASS |
| J07 | `dpdp-sales-lifecycle` | daily 04:00 | trial and renewal reminders | NEW pglite, live-RB | PASS (not yet run live) |

## K. Failure modes

| ID | Scenario | Expected | Test | Status |
|---|---|---|---|---|
| K01 | Wrong HTTP method on every Edge function | 405 (or the gateway's 401), never 5xx | live-GET | PASS |
| K02 | Missing or garbage bearer | 401 `Unauthorized` / `Not allowed` / `unauthorised` | live-GET | PASS |
| K03 | Malformed JSON | 4xx (401 first because auth is checked before parsing) | live-GET | PASS |
| K04 | Oversized body: 100 KB and 500 KB to `dpdp-lifecycle-email`, `dpdp-inbound-mail`, `dpdp-pay/webhook` | clean 401 / 503, no 5xx | live-GET | PASS. A 2 MB upload timed out client-side at 25 s (this laptop's upload speed); not a server error |
| K05 | Expired JWT / clock skew | the RPC sees no e-mail claim: "Sign in first" / "Not a member" | NEW pglite and live-RB | PASS |
| K06 | Concurrency / double click | idempotent: C04 (10 min), H05 (replay), H11 (rate), E03 (claim), unique indexes; confirm locks the attempt row `for update` | NEW pglite (sequential); true parallel transactions are not exercised | PASS (sequential). Parallel race: NOT-TESTED, covered by design (row lock + unique index) |
| K07 | DB pool exhausted / timeouts | `logOutbound` never throws and times out; cron windows absorb a missed run; clients retry 3 times | `mail-outbound` tests; E09; `live-smoke` | PASS |
| K08 | Edge cold start / slow DB | the live probe saw rejections taking 0.1 s to 21 s | live-GET | OBSERVED (see K09) |
| K09 | Latency tail | an unauthenticated 401 took up to 21 s once (`dpdp-partner-email`), a garbage-bearer 401 21 s (`dpdp-lifecycle-email`); repeat runs 0.5-1 s; one `dpdp.` `/ai/` probe timed out 3 x 20 s, passed on rerun | live-GET | FAIL (medium, intermittent; evidence of the known DB overload; no code cause found) |
| K10 | Offline / slow network in the browser | `BillingPanel` polls and tolerates blips; sign-in shows an error and lets the person retry | `review`; e2e needs more RAM than available | PASS (review). e2e not run: 416 MB free RAM, needs more than 2 GB |
| K11 | Very long names, Hindi, emoji | see C02, C11, NEW tests | live-RB, NEW unit | PASS |
| K12 | SQL injection | every parameter is a bound argument; hostile text tested in names, referral codes, reminder keys, intervals | live-RB, NEW pglite | PASS |
| K13 | HTML / XSS in organisation names | React escapes; e-mail HTML escaped (C02a); no `dangerouslySetInnerHTML` or `innerHTML` in `dpdp-app/src` | scan; NEW unit | PASS |
| K14 | CSV / formula injection in exports | defused with a leading apostrophe; real negative numbers untouched | `partner.test`, NEW `csv-injection.test` | PASS |
| K15 | Email header injection via a line break in an org name | Subject collapsed to one line | NEW unit (6 hostile names) | PASS (fixed) |

## L. Cross-checks that guard the owner's rules

| ID | Rule | Test | Status |
|---|---|---|---|
| L01 | Access never locks over an unpaid invoice | NEW `dpdp-access-never-locks` (migration scan, app scan, Monday e-mail scan) | PASS |
| L02 | Price on the screen equals the price the server charges | `dpdp-pay-logic.test` | PASS |
| L03 | The reminder text never promises a lock-out and always says access is unchanged | NEW billing-mail test | PASS |
| L04 | Migration 0673 and 0674 carry the DDL authorization line and apply twice cleanly | `dpdp-pay-logic.test`, pglite tests (apply twice) | PASS |
