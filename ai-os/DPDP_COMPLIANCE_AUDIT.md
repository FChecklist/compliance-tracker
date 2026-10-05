# VERIDIAN DPDP product: compliance self-audit

Date: 2026-10-05. Auditor: AI (research and evidence, **not legal advice, not a certification**).
Checklist: `C:\ct\tambola\docs\compliance\CHECKLIST_100.md` (rows marked D or TD: 128 rows). Law register: `REQUIREMENTS_REGISTER.md` (DPDP texts there were read from secondary sources only; re-check rule numbers against the Gazette).
Scope: live pages on `app.veridian-aios.com` and `dpdp.veridian-aios.com` (both serve identical files: /, /privacy/, /terms/, /disclaimer/, /refund/, /shipping/, /pricing/, /contact/, /partner/, /partner/terms/, /dpdp-firm/, /dpdp-institution/, /about/), `dpdp-app/`, `supabase/functions/dpdp-*`, `drizzle/` migrations, and READ-ONLY queries on Supabase project `pcrjmlpuqsbocqfwoxod` (schema, grants, RLS, cron, storage policies, row counts, advisor lints). No personal data value was read or printed. Nothing was written to any system. Worktree was on branch `feat/dpdp-signin-email`.

---

## (a) Executive summary

**Overall.** The legal pages are better than most products at this stage: a standalone Privacy Notice (v1.3), a Terms clause that works as a processor contract, a heavy Disclaimer, a named Grievance Officer, honest "we are not a certifier / not a consent manager / not legal advice" wording, and a build-time banned-word gate. The weak spots are not the pages. They are **promises the system does not yet keep** (retention, erasure, "nobody can edit", "never stores documents"), **a consent page that does not show the notice**, **an AI work link that is not personal-data-free**, and **missing governance documents** (breach runbook, records of processing, retention schedule, lawyer sign-off).

**Verdict by law (self-assessment, phase-in aware):**

| Law | Verdict |
|---|---|
| India DPDP Act 2023 / Rules 2025 | Substantive duties are not in force until about 13 May 2027 (register 1.0; re-check Gazette). Built-to-date: **partly aligned**. Biggest build gaps: erasure and retention (s8(7), Rule 8), consent notice content and withdrawal (s5, s6, Rule 3), children/guardian verification (s9, Rule 10), breach content (Rule 7), logs retention (Rule 6). |
| IT Act s43A / SPDI Rules 2011 (in force until May 2027) | **Partly aligned.** Privacy policy and grievance officer present. Partner PAN and bank data (sensitive data) stored in plain columns; not named in the notice. |
| CERT-In Directions 2022 | **Not evidenced.** No 6-hour reporting route, no 180-day log policy found. |
| GDPR / UK GDPR | **Not targeted** (business-only, India). If an Indian customer has EU data subjects: no SCCs, no TIA, no Art 27 decision recorded. Low priority until EU targeting. |
| US state laws / COPPA / CAN-SPAM | **Not applicable on current facts** (India-only, business-only). Reminder mail is relationship mail with an unsubscribe. Re-check if US users appear. |
| Consumer law / marketing claims (CPA 2019, FTC-style) | **Mostly sound**; three claims overreach ("nobody can edit", "never stores documents", legacy "nothing personal is in that link"). Billing page and receipt do not match the GST-invoice promise. |

**Counts (128 applicable rows):** PASS 26 | PARTIAL 61 | FAIL 22 | CANNOT VERIFY 13 | NOT APPLICABLE 6. See section (c) for each row.

**Honest limits.** This is a self-audit by an AI from code, migrations, live pages and read-only database metadata. It is not legal advice, not a certification, not a penetration test. Vendor dashboards (Cloudflare, Resend, Razorpay, Supabase auth settings, GitHub, Google) were not accessible. The legacy Next.js `/dpdp` app (Vercel) was read in source only.

**What the owner must confirm** is listed at the end of section (b).

---

## (b) Gap register (ranked by severity)

Owner key: product = engineering; customer = the organisation using the product; lawyer; vendor; owner = Rajat. Effort: S (under a day), M (days), L (weeks).

### CRITICAL

**GAP-01. Retention and erasure are promised but not built.**
Checks: F06, F07, F08, F09, A05, E01.
Wrong: Privacy Notice section 5 and Terms 6.3(g) promise export for 30 days after account end, then deletion or de-identification. No code or job does this. Live cron has only 7 DPDP jobs, all mail or clock jobs (`cron.job`: dpdp-legal-clocks, monday-digest, monday-retry, operator-digest, partner-mail, partner-statements, sales-lifecycle). No `delete from dpdp.organisation` or offboarding function exists in `drizzle/`. `OPERATIONS.md` says of `dpdp.mail_inbound`: "No retention period is set and nothing deletes or redacts anything". Live rows that carry personal data: identity 1072, email_send 1244 (recipient address + subject), login_token 43 (`request_ip`), mail_inbound 7 (first 4096 chars of body), ai_link 173; `ai_link_read`/`ai_link_seen` store IP prefix. The immutable `event` log keeps email addresses inside summary text forever, which collides with the erasure right.
Law: DPDP s8(7), Rule 8 (erase when purpose served; processors too); Rule 6/8(3) one-year logs; GDPR Art 5(1)(e), 17. Also a consumer-law problem: the notice states something untrue.
Severity: critical.
SUGGESTED FILLER: (1) Write a retention schedule (table: class, purpose, period, method) and put the same periods in the notice; suggested starting points: login_token and session 30 days after expiry; email_send body never kept and recipient+subject 13 months; ai_link and call logs 12 months (matches Rule 6 one year); mail_inbound 12 months after close; inbound excerpt redacted at close + 90 days. (2) Migration: `dpdp_retention_sweep()` plus pg_cron daily jobs for those classes. (3) `dpdp_offboard_org(org_id)` that exports (JSON/CSV) then, after 30 days, deletes or irreversibly de-identifies; for the append-only `event` log, replace personal strings with a stable pseudonym, keep the hash chain by re-sealing. (4) Until built, change the notice to say exactly what exists today ("on request we delete within 30 days by hand").
Owner: product + lawyer. Effort: L.

**GAP-02. The principal consent page (/p/, /act/, /copy/ family) does not show a notice and cannot be withdrawn.**
Checks: A01, A08, B02, B03, B04, D04, U02, L05.
Wrong: `dpdp-app/src/components/TokenPages.tsx` `ParentConsentPage` step "notice" shows only "Written plainly. <doc kind> v<version>" and the organisation name. The notice text, data list, purposes, rights, and the customer's grievance contact are not rendered; `dpdp_parent_consent_preview` returns only docKind, version, languages (`drizzle/0609`). `dpdp_parent_consent` records one answer, with `purpose_key` hard-coded `'consent'` and `language` hard-coded `'en'`. The link is single use; the "saved" screen says "ask the organisation for a fresh one" to change your mind. No guardian identity, no relationship, no verification method is recorded (Rule 10 routes); `consent_record` has no person link except `token_id` and a `contact_hash` on the token. `consent_token.token` is stored in plain text and the two tables have RLS off.
Law: DPDP s5 and Rule 3 (notice before consent, itemised), s6(1)-(4) (specific, informed, withdrawal as easy as giving), s9 and Rule 10 (verifiable parental consent). A "consent" with no visible purpose is the weakest possible proof.
Severity: critical (this is the product's core promise to schools).
SUGGESTED FILLER: Render the actual notice version text (store body in `notice_version` or link to a hosted copy) with per-purpose Yes/No; record purpose key, language, notice version, guardian name and relationship (typed), verification route used, and a hash of the page text shown. Add a "withdraw" link in every consent record page and in the confirmation (a new token that sets `withdrawn_at`). Show the customer's name, address and grievance contact on the page. State plainly in the school edition that the school, not VERIDIAN, decides whether parental consent is required (Fourth Schedule). Lawyer to review the wording.
Owner: product + lawyer. Effort: M.

### HIGH

**GAP-03. The AI work link is not personal-data-free; the claim in the legacy app says it is.**
Checks: S01, S02, C02, O03, S06.
Wrong: The current link (WO-013) returns colleagues' email addresses by default (`hide_emails` defaults false; the Monday e-mail link always sets it false, `drizzle/0663`, `0664`; only 19 of 173 live links hide emails). `/people`, `/jobs` `by`, `/history` summary and detail free text, the grievance officer's name and e-mail (`0694`), rights request refs and due dates are all returned. These go to whichever AI the person chooses. The Privacy Notice and Terms disclose that the AI provider is the user's own and say the user is responsible, which is honest. But the legacy Next.js page `src/app/dpdp/(app)/ai-link/AiLinkClient.tsx:87` still says "Nothing personal is in that link ... never the people inside it", and the older personal-data-free function (`drizzle/0425`) is no longer what the live link does. No re-identification review was found. The link is in an e-mail (Resend, recipient mailbox) and a URL path.
Law: DPDP s8(1) (customer stays responsible but vendor designed the exposure), s8(5); GDPR Art 25 (by default); marketing claim accuracy.
SUGGESTED FILLER: Make `hide_emails` default **true** for every new link and for the Monday e-mail link; return role labels not e-mails; strip or mask free-text `detail` for people; add a planted-identifier test (put a name/phone/e-mail in a note and assert the AI routes never return it unless the person's own). Delete the "Nothing personal" sentence in the legacy page or make it true. Add to the "Before you paste" box: "This gives your AI the names and e-mails of your colleagues unless you hide them."
Owner: product. Effort: M.

**GAP-04. Partner payout details (bank account, IFSC, PAN, UPI) stored in plain text; not named in the notice.**
Checks: R02, C06, G01, A09, A02.
Wrong: `dpdp.partner_payout_detail` has plain columns `account_number`, `pan`, `ifsc`, `upi_id` (`drizzle/0674`). Access is good (RLS on, no policy, no grant, masked views, only definer functions) and there are 0 rows today. The Privacy Notice section 2 lists no partner data and says "we do not intentionally collect ... financial credentials". PAN and bank data are "sensitive personal data" under the SPDI Rules. The Owner panel shows them in full and the payout CSV carries them.
Law: SPDI Rules 2011 rr 3, 5, 8; DPDP s8(5), Rule 6 (encryption or tokens); GDPR Art 32 if applicable.
SUGGESTED FILLER: Encrypt the four columns (pgsodium/Vault key, or application-side envelope encryption), keep a key-owner and rotation note, add partner data to the notice table ("payout details: UPI or bank, optional PAN; to pay you and file TDS; kept for the tax period"), add retention to the schedule, log every Owner view of full details (`access_log`), and add a deletion path that respects tax record keeping.
Owner: product + lawyer. Effort: M.

**GAP-05. Payment-proof storage bucket accepts any file from any signed-in user.**
Checks: G11, C06, G03, G07.
Wrong: Storage policy "dpdp payment proof insert" is `INSERT ... TO authenticated WITH CHECK (bucket_id = 'dpdp-payment-proofs')` with no path ownership, and the bucket has no size limit and no allowed-mime list (the other buckets do). No scan. The Supabase project is shared with the compliance-tracker app, so "authenticated" includes that product's users. Read is admin-only (good). Terms and home page say VERIDIAN "never stores your documents"; this bucket does store documents.
Law: DPDP s8(5) (safeguards), Rule 6; consumer-law accuracy of "never stores".
SUGGESTED FILLER: Add `owner = auth.uid()`-style path prefix in the policy (`name like auth.uid() || '/%'`), set `file_size_limit` (5 MB) and allowed mimes (pdf, png, jpeg), delete proofs 90 days after confirmation (retention job), add a "payment proofs are stored briefly" line to the notice and soften the "never stores documents" claim (see claims list).
Owner: product. Effort: S.

**GAP-06. 20 tables in schema `dpdp` have row-level security OFF, including identity, session and consent tables.**
Checks: G07, G01, C06, U09.
Wrong: RLS is off on: ai_link_seen, artefact_flag, band, consent_record, consent_token, daily_seal, data_location, identity, identity_email, library_version, login_token, membership, obligation_template, org_invite, partner, payment, referral, referral_commission, referral_event, session. Read-only grant check on 15 of them showed `anon` and `authenticated` hold no table grants; only `app_runtime` does (and payment, referral_commission, org_invite show no runtime grant at all). So browsers cannot reach them directly (they go through definer RPCs). Isolation for those tables therefore rests on application and RPC code, not the database. Privacy Notice section 6 says separation "is enforced in the database"; that is true for 65 of 85 tables, not for these. `consent_token.token` and `org_invite.code` are plain-text secrets.
Law: DPDP s8(5), Rule 6; SPDI r8.
SUGGESTED FILLER: Enable RLS (deny-all, no policy) on all 20 tables; add policies only where the browser role needs them; hash `consent_token.token` and `org_invite.code`; reword the notice to "separation of customers is enforced in the database and by access-controlled functions". Re-run `dpdp-cross-tenant-rpc.test.ts` against the changed schema.
Owner: product. Effort: M.

**GAP-07. Recipients and sub-processors are incompletely disclosed, and some locations are wrong.**
Checks: I02, I03, J01, A02, K02.
Wrong: Razorpay (payment links, webhooks) is named on Pricing and Contact but is absent from Privacy section 4 and Terms 6.6. Cloudflare is "global network" with no country. Inbound mail is received by Resend (apex MX `inbound-smtp.ap-northeast-1.amazonaws.com`, Tokyo), but the notice says Resend is in the United States; mail bodies containing personal data therefore also pass through Japan. GitHub (Actions smoke tests) carries no personal data, fine. No standalone sub-processor page; Terms say "we will keep the current list on the Privacy Notice" with no advance notice or objection route. Vendor DPAs were not visible.
Law: DPDP s5/Rule 3 (recipients), s16; GDPR Arts 13, 28(2), 28(4); Terms 6.3(d).
SUGGESTED FILLER: Add a `/subprocessors/` page (vendor, purpose, data, country, safeguard, date) and link it from Terms and Privacy; list Razorpay, Cloudflare (email routing, Pages, D1 telemetry), Resend (send US, receive Tokyo), Supabase (Mumbai, edge functions), Google (operator mailbox); commit to 30 days' e-mail notice of changes with a right to end the contract; file signed or accepted vendor DPAs (owner action).
Owner: product + owner. Effort: S.

**GAP-08. No breach or incident process: runbook, CERT-In route, Rule 7 fields.**
Checks: H01, H02, H03, H04, H05.
Wrong: No incident-response plan, severity levels, 24x7 contact or drill record found. No CERT-In 6-hour reporting route (point of contact, 180-day log retention in India, NTP). Terms 6.3(e) promise notice "without undue delay" with no hour limit. The `dpdp.breach` table holds became_aware_at, 72-hour `deadline_at`, person count, board and individual notified times and state only: no nature, data categories, likely consequences, mitigation or contact (Rule 7(1)). The 72-hour clock reminder works (`dpdp_legal_clocks`) and goes to owners and the coordinator.
Law: DPDP s8(6), Rule 7; CERT-In Directions 28 Apr 2022; IT Act s70B; GDPR Arts 33-34 if applicable.
SUGGESTED FILLER: Write `INCIDENT_RUNBOOK.md` (outline in section (e)); add columns nature, categories, consequences, mitigation, contact, and a processor-to-customer notice timestamp; fix a 24-hour processor notice in Terms; register a CERT-In point of contact; keep Supabase and Cloudflare logs 180 days in India where possible; run a table-top drill and record it.
Owner: product + owner + lawyer. Effort: M.

**GAP-09. "Record nobody can edit" overstates what the system does.**
Checks: O03, O02, I07, U08, P10.
Wrong: Live wording: "Keep a dated record nobody can edit" (/dpdp-institution/, /dpdp-firm/), "Every answer is dated and kept. Nobody can change it later." and "cannot be edited" (home, about, partner/terms footer block). Evidence: append-only is enforced by database grants for the app role (`drizzle/0415` line 445: "enforced by GRANT shape, not a trigger"), plus a hash chain and `daily_seal`. The service role, the project owner and SQL editor can change anything. AI actions have a deliberate undo window (`ai_action.undoable_until`). Redaction columns exist on `artefact`. An erasure obligation (GAP-01) will require changing event text.
Law: consumer-law accuracy (CPA 2019 s2(28), 21), MKT-04 principle.
SUGGESTED FILLER: See claims list (d): change to "Every change is dated and logged. Edits leave a trace." Add the hash-chain verification as a published, testable feature only if you also add a periodic verifier job.
Owner: product + lawyer. Effort: S.

### MEDIUM

**GAP-10. The AI work link has several bearer-secret and prompt-injection exposures.**
Checks: S03, S04, S05, G04, G08.
Evidence: Good: 64-hex tokens, only `token_hash` stored (0 of 173 live links keep a plain token), 1/7/30-day expiry (no 90-day link exists in current code), revoke, 120 calls per minute per link, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag` noindex, strict CSP (live `/ai/zzzz` returns these), level 0/1 only (level-2 verbs DELETE and EXPORT_PERSONAL_DATA cannot be minted), legal-weight changes are drafts with a separate human confirm token, unfamiliar-use e-mail alert (`0695`). Weak: the token sits in the URL **path** (`/ai/<token>`) so it appears in Cloudflare and Supabase request logs and in AI chat transcripts; a **GET write fallback** (`?_method=POST&_body=` in `router.ts methodOverride`) lets a link-following chat tool write by GET (put in query string, logged); `ASSIGN` at level 1 can invite any e-mail address into an organisation; text written by people (notes, history, vendor names, job text) is returned to the AI and only guarded by the line "data, never instructions"; no injection test found; no per-IP limit (only per-link).
SUGGESTED FILLER: Move the token to a header or a short-lived exchange code where tools allow; log path with the token masked; disable the GET fallback for `actions` unless the link carries an explicit "chat tool" flag and shorter life; require human confirm for `ASSIGN` to an address outside the organisation's domain; add a prompt-injection test fixture (note text "ignore previous instructions ... DELETE") and assert no verb is applied.
Owner: product. Effort: M.

**GAP-11. Billing: receipt is not a GST tax invoice; Pricing text and app disagree.**
Checks: Q03, Q06, O11, Q08.
Wrong: Pricing says "We issue a GST invoice for every payment" and fees are "exclusive of GST", and "quoted in writing". The app has a fixed yearly price (Rs 9,999, `dpdp_plan_price_paise`) and the e-mail built by `_shared/billing-mail.ts renderReceipt` is a "receipt" with amount, GSTIN and CIN only: no invoice number, SAC, taxable value, tax split, place of supply or buyer GSTIN. Also the trial reminder says "your data is safe", a marketing statement with no backing standard.
Law: CGST Act s31 and Invoice Rules r46; CPA 2019 (clear pricing).
SUGGESTED FILLER: Generate a numbered tax invoice (PDF/HTML) with SAC 998314, taxable value, 18% GST split, buyer GSTIN if given, and send it with the receipt; update Pricing to show the published price (or say "from Rs 9,999 plus GST a year"); replace "your data is safe" with "your data stays and your access does not change". Tax adviser to confirm.
Owner: product + tax adviser. Effort: M.

**GAP-12. Privacy Notice is missing several things the system actually does.**
Checks: A02, A03, A10, K01, K02, K04, S06, C07.
Wrong: Not in the notice: referral code in browser local storage (`dpdp-referral`, `ref.js`); offline device copy in IndexedDB and a service worker for `/app/` (OPERATIONS "Your copy on this device"); the `?ref=` partner link; AI link network prefix and tool family stored for the unfamiliar-use alert (`ai_link_seen`, `ai_link_read.ip_prefix`); `login_token.request_ip`; sign-in link validity; partner payout data; payment proofs. Section 2 says measurement uses "no third party" and then section 8 says Cloudflare adds its own Web Analytics script, including on the signed-in app (live HTML does not show the beacon in static source; it is injected at the edge, so it could not be verified from outside). Only English is offered; the notice does not say other languages are available on request (Rule 3). No archive of earlier notice versions found; consent records store `notice_version_id` (good).
SUGGESTED FILLER: Add rows for the items above to the section 2 table; reword the measurement row to "no cookie, no storage; our own script" and keep Cloudflare analytics in section 8 only; add "Available in Hindi on request" and then provide it; keep an archive page of past versions. Lawyer to read.
Owner: product + lawyer. Effort: S.

**GAP-13. Rights requests and grievances: clock and identity gaps.**
Checks: E02, E05, E08, U03.
Wrong: Mail intake is ticketed with a 90-day default due date and an acknowledgement (good: never-drop classifier, escalation by keyword), but "Nothing chases a ticket that passes its date" (OPERATIONS). Identity proofing is only a sentence in the notice ("we may ask you to prove who you are"); no step or field exists in `rights_request` or `mail_inbound`. Rights requests inside a customer (`dpdp.rights_request`, grievance tiers) have reminders only within 10 days of the 90-day limit and only to owners and the coordinator, not to the Company's own Grievance Officer for its own tickets. `DPDP_LEGAL_RESPONSE_DAYS` is set by the owner and counsel have not confirmed it.
SUGGESTED FILLER: Add an overdue-ticket job (daily digest line "OVERDUE") and a 10-day warning; add `verified_at`, `verified_by`, `verification_method` to tickets; keep a short reply template library; confirm response days with counsel (Rule 14 reported as 90 days; SPDI one month).
Owner: product + lawyer. Effort: S.

**GAP-14. Inbound mailbox keeps personal data indefinitely.**
Checks: U04, F06, F08.
Wrong: `dpdp.mail_inbound` stores from, to, subject and up to 4096 characters of the body with no retention period (7 rows now). Copies sit in the operator's Gmail and Resend's inbound store (retention unknown). Attachments are not stored (good). Operator notices go to a personal Gmail address (`raajat.agarwal@gmail.com`, per OPERATIONS).
SUGGESTED FILLER: Redact `excerpt` 90 days after close, delete the row after 12 months; move the operator mailbox to a company role mailbox with MFA; confirm Resend inbound retention and set the shortest.
Owner: product + vendor. Effort: S.

**GAP-15. Sign-in and web hardening.**
Checks: G03, G04, G05, G08, K05.
Evidence: Supabase advisor warns "Auth OTP long expiry" (more than one hour; the code comment says app login links expire in 15 minutes, so the Supabase Auth setting used by `signInWithOtp` needs checking) and "leaked password protection disabled" (low relevance, no passwords). Sessions last up to 30 or 90 days by level (`dpdp-auth-service.ts`). Live response headers on `/app/` and the public pages: no `Strict-Transport-Security`, no Content-Security-Policy; `/app/` returns two `Referrer-Policy` headers (strict-origin-when-cross-origin and no-referrer), the stricter one winning in browsers, but the Pages `_headers` comments say it should be one. 7 definer functions are callable by `anon` by design (token links), plus the two pgaudit trigger helpers.
SUGGESTED FILLER: Set Auth OTP expiry to 900 seconds or less; turn on HSTS (Cloudflare zone setting, include subdomains after checking mail hosts) and add a CSP to `_headers` for `/app/*`; fix the double Referrer-Policy; set an idle timeout for owner sessions; move pgaudit helper functions out of `public`.
Owner: product + vendor. Effort: S.

**GAP-16. Logs: Rule 6 one-year and CERT-In 180-day duties are not designed.**
Checks: G05, C07, F06.
Wrong: The notice says logs are kept "for a short operational period", which is vague and conflicts with Rule 6 / 8(3) (one year) and CERT-In (180 days in India). In-app logs: `event` (append-only, with hash chain), `access_log`, `ai_link_call`, `mail_outbound`. Cloudflare, Supabase Edge, Resend and GitHub log retention was not checked. Telemetry rows are kept 90 days (stated).
SUGGESTED FILLER: Decide one log policy (12 months for security logs without direct identifiers, 90 days for product telemetry), state it, confirm vendor settings, and align the notice.
Owner: lawyer + product. Effort: S.

**GAP-17. No governance documents; no lawyer sign-off.**
Checks: N01, N03, N04, N05, N06, N07, T01, T02, T03, T04, S08, U01, O01.
Wrong: No records of processing, DPIA, data inventory, compliance calendar, regulatory-watch log, DPO/representative decision note, or training record found. The job library, playbooks and law references were written by AI; 21 of 44 law codes carry "verify" notes (`docs/LAWYER-REVIEW-PACK.md`); the pages say plainly that no lawyer has reviewed them (honest, and good). A `claims-register.yaml` with a banned-word build gate exists (strong), but it does not hold per-claim evidence links.
SUGGESTED FILLER: Create the documents in section (e); send the existing review pack and these documents to a data-protection lawyer; record the sign-off date on each page.
Owner: lawyer + product. Effort: L.

**GAP-18. Consent-manager and "attestation" classification, and an unsafe public-page publish path (legacy app).**
Checks: O05, O06, O07, O08, U06, U08.
Wrong: Terms and Disclaimer say VERIDIAN is not a Consent Manager, but the product offers consent campaigns and tokens; whether that function needs registration from 13 Nov 2026 is a lawyer question (register IN-19). In the legacy Next.js app, `POST /api/dpdp/public-page/publish` lets an owner publish a live page with any `verifiedVia` value and no evidence check (`dpdp-governance-service.ts publishPublicPage`), and `AiLinkClient.tsx:87` still says "we sell you protection" (the register flags "protection" wording as a risk). The static live site has none of this wording. Whether the Next.js app is still reachable on Vercel was not verified.
SUGGESTED FILLER: Get a lawyer's classification of consent campaigns before 13 Nov 2026; require evidence (a recorded job, date, scope) before a page goes live and show date and scope on the page; delete or reword the legacy sentences; if the Next.js app is not live, remove its DPDP routes.
Owner: lawyer + product. Effort: M.

### LOW

**GAP-19. Reminder and digest mail classification and footer details.** (L01, L02, L03, U05) Mail classes exist in `mail-taxonomy.ts` but none is labelled transactional vs marketing. The Monday digest carries a billing banner (`0656`) and an AI-link promotion; the trial and renewal reminders are commercial relationship mail. One-click unsubscribe exists (statutory notices continue, by design). A postal address in the footer was not verified. DMARC is `p=quarantine` and a Resend DKIM key is published; the apex has no SPF TXT record visible (only a Google site verification TXT), so SPF alignment depends on Resend's return-path subdomain; check in Resend. Filler: classify each template in a table; add the registered address to every commercial mail; move DMARC to `p=reject` once reports are clean. Owner: product. Effort: S.

**GAP-20. Cross-border and EU/UK position not recorded.** (J03, J04, N04, D07) No SCCs, TIA or Art 27 decision exist, which is fine only while no EU/UK data subjects are in scope. Terms limit use to businesses but do not exclude EU/UK data. Filler: add a one-line scope in Terms ("for organisations in India; not for processing EU or UK residents' data without a written agreement") or prepare SCCs. Owner: lawyer. Effort: S.

**GAP-21. Shared database project.** (G03, G07, G09) The DPDP schema lives in the same Supabase project as the compliance-tracker product (585 organisations and 1072 identities in the `dpdp` schema; whether these are real or test was not established). Any signed-in user of the other product is an `authenticated` role in the same database (see GAP-05). No penetration test report, MFA evidence or restore test was found. Filler: move DPDP to its own Supabase project before real customers; run a restore test and an external pen test; confirm MFA on all vendor consoles. Owner: owner + vendor. Effort: L.

**GAP-22. Partner TDS and tax records.** (R03, R06, R07) TDS rate is unset until the owner sets it (a payout cannot be marked paid until then: good). No Form 16A or quarterly return step exists in the repo; no retention rule for partner records versus tax record keeping. Filler: add TDS return and Form 16A steps to the payout runbook; add a 8-year retention rule for payout ledgers. Owner: tax adviser. Effort: S.

**GAP-23. Staff access to customer data is not logged.** (U12, G03) `access_log` exists and `platform_admin` has an e-mail list, but operator reads through the Supabase SQL editor leave no application log. Filler: restrict SQL editor access to the owner with MFA, enable pgaudit for `dpdp` reads by staff, and review monthly. Owner: owner. Effort: M.

### What the owner must confirm (not verifiable by this audit)

1. Cloudflare: HSTS on, WAF and rate rules, log retention, Web Analytics beacon on `/app/`, D1 location, email routing retention, MFA.
2. Resend: inbound and outbound message retention, DPA accepted, click tracking OFF, region used, SPF record for the sending domain, plan daily cap.
3. Supabase: Auth OTP expiry, rate limits, MFA on dashboard, backup plan and point-in-time recovery, log retention, whether the 585/1072 rows are real customers.
4. Razorpay: merchant of record, account type, data stored, DPA.
5. GitHub and Google: MFA, access list for the repository and the operator mailbox.
6. Counsel: response days (90), Fourth Schedule reliance for schools, consent-manager question, s7(a) vs consent for staff, whether the "Protected Persons" clause is enforceable, SDF risk, retention periods.
7. Whether the legacy Next.js `/dpdp` app is still reachable anywhere.

---

## (c) Per-item results (128 rows)

Legend: P = PASS, PA = PARTIAL, F = FAIL, CV = CANNOT VERIFY, NA = NOT APPLICABLE. "Gap" points to section (b).

| ID | Sev | Result | Evidence / note | Gap |
|---|---|---|---|---|
| A01 | critical | PA | Public pages link to Privacy in footer on every legal page; token consent pages show no notice text (`TokenPages.tsx` ParentConsentPage). Sign-in page not checked. | 02 |
| A02 | high | PA | Privacy v1.3 has data, purpose, basis, recipients, retention, rights, Board route, contact; missing partner, payment proofs, AI prefix, device storage, Tokyo mail path. | 07, 12 |
| A03 | medium | F | English only; no "available in Eighth Schedule languages on request". | 12 |
| A05 | critical | PA | Section 5 states 30-day export then delete, "reasonable time", logs "short operational period"; not built. | 01, 16 |
| A08 | critical | F | Consent page shows customer name only; no customer grievance contact, no notice text. | 02 |
| A09 | high | PA | Standalone Privacy Notice, Terms, Disclaimer, partner terms exist and are versioned; partner payout data not covered. | 04, 12 |
| A10 | medium | PA | Notices carry version/date; `consent_record.notice_version_id` stored; no archive of old versions seen. | 12 |
| B02 | critical | PA | Explicit Yes/No buttons, none pre-ticked (good); the thing agreed to is not shown; weekly e-mail consent basis is the customer's invitation. | 02 |
| B03 | high | PA | Weekly e-mail has one-click unsubscribe (`/unsubscribe/`, statutory notices continue); principal consent cannot be withdrawn after use. | 02 |
| B04 | high | PA | `consent_record` stores token, purpose_key, granted, notice version, language, time; no export function found; no person link beyond token. | 02 |
| B07 | critical | P | Silence records nothing; token expires; "No" recorded as a valid answer (`0609`). | |
| B08 | medium | P | Free trial; "access never locks" (test `dpdp-access-never-locks.test.ts`); referral optional. | |
| C02 | high | PA | No ads, no model training, no sale stated; AI link exposes more than needed. | 03 |
| C05 | high | P | `principal_group` holds only label and `est_count`; no personal data. Counts are customer-typed so small-cell masking is not applicable. | |
| C06 | high | PA | Artefacts default `declare`/`never_stored` (4 of 4 rows); a `hold` mode with `storage_path` exists; payment proofs are stored; platform-admin-only read. | 05 |
| C07 | high | PA | Telemetry rules and tests (no IP, no query string, DNT/GPC honoured); other tables hold IP prefix and `request_ip`; vendor logs unchecked. | 12, 16 |
| D04 | critical | F | No guardian identity, relationship, verification route or Fourth Schedule flag recorded. | 02 |
| D05 | high | P | App holds only data categories and a `is_children_data` flag, no child records; digests and AI link do not profile children. | |
| D06 | medium | NA | India-only, business-only, no US targeting. Re-check if US users appear. | |
| D07 | medium | NA | No EU targeting; see GAP-20. | 20 |
| E01 | critical | P | `dpdp@veridian-aios.com` on every legal page; live end-to-end proven per OPERATIONS and notes (I did not send a test mail). | |
| E02 | high | PA | 90-day default due date, acknowledgement, escalation; no overdue chaser. | 13 |
| E05 | high | PA | Sentence in notice only; no verification step or field. | 13 |
| E06 | critical | CV | Static app has no principal "mydata" screen (`dpdp_my_page` is a member's job page); legacy `src/app/api/dpdp/mydata` not run; cross-tenant test file exists, not run. | 06 |
| E08 | medium | PA | `mail_inbound` has status, due, `closed_note`; `rights_request` has `answer_text`; no refusal-reason field. | 13 |
| E09 | medium | P | Notice: no sale, no ads; no third-party scripts in page source; GPC honoured by the telemetry script. | |
| F06 | high | F | No schedule; OPERATIONS says retention "the owner's call"; no jobs. | 01 |
| F07 | high | F | No export or off-boarding function exists. | 01 |
| F08 | high | CV | No cascade code; vendor retention not visible. | 01, 14 |
| F09 | medium | PA | Notice says invoices kept as law requires; no register. | 01, 22 |
| G01 | critical | PA | TLS in transit; AI tokens hashed (0 of 173 plain); Supabase default at-rest; PAN and bank plain; `consent_token.token` plain; no secret scan run by me. | 04, 06 |
| G03 | high | CV | `platform_admin` table and RLS on admin functions exist; vendor roles and MFA not visible. | 15, 21 |
| G04 | high | PA | Strong headers and hashed tokens on AI link; token in URL path; GET write fallback; fragment tokens for other links (good). | 10 |
| G05 | high | PA | App logs exist; retention vague; vendor logs unchecked; CERT-In not designed. | 08, 16 |
| G06 | medium | CV | Backup plan and restore test not visible. | 21 |
| G07 | critical | PA | 65 of 85 tables RLS-on; 20 off but not granted to anon/authenticated; `dpdp-cross-tenant-rpc.test.ts` exists (not run here). | 06 |
| G08 | high | PA | 120 calls per minute per AI link, 256-bit tokens, mail acknowledgement caps; sign-in rate limit not visible; no per-IP limit. | 10, 15 |
| G09 | high | CV | No pen-test or patch record found; advisor shows warnings only. | 21 |
| G10 | medium | PA | CI, many tests, claims gate; some tests run against the live database in a rolled-back transaction (`partner-lifecycle-live-test.mjs`, editions-roles test). | |
| G11 | high | F | Payment-proof bucket open to any signed-in user, no size or type limit, no scan. | 05 |
| H01 | critical | F | No incident plan or drill found. | 08 |
| H02 | critical | PA | Terms 6.3(e) "without undue delay"; no hour limit. | 08 |
| H03 | high | F | No CERT-In route. | 08 |
| H04 | medium | PA | Customer-facing breach table; no operator register. | 08 |
| H05 | high | PA | 72-hour clock and notified flags; missing Rule 7 content fields. | 08 |
| H07 | low | NA | No US residents in scope. | |
| I01 | critical | PA | Terms 6.3 is a written processor contract (instructions, confidentiality, security, sub-processors, breach, rights help, deletion); no audit right, no objection route, no CCPA terms. | 07 |
| I02 | high | PA | List in Terms 6.6 and Privacy 4; Razorpay missing; no countries; not standalone. | 07 |
| I03 | high | CV | Vendor DPAs not visible. | 07 |
| I05 | medium | PA | Notice section 1 separates roles clearly; partner and billing data gaps. | 04, 12 |
| I06 | high | PA | Own promise of no training is made; vendor settings (Resend retention) not visible. | 07, 14 |
| I07 | medium | PA | Disclaimer and cap are strong; "Protected Persons" enforceability flagged in `LEGAL-AUDIT-2026-09-30.md` F7; some marketing claims contradict reality. | 09 |
| I08 | low | CV | No continuity plan found; single vendors for DB, edge, mail. | 21 |
| I09 | high | P | Terms 6.2 to 6.4 explain the fiduciary/processor split for consents, rights and grievances. | |
| J01 | high | PA | Database in `ap-south-1` Mumbai (verified via project API); Resend send US, receive Tokyo; Cloudflare global; edge functions and D1 location not documented as a map. | 07 |
| J02 | medium | PA | Notice commits to follow s16 restrictions; no check log. | 17 |
| J03 | high | NA | No EU/UK data subjects in scope; see GAP-20. | 20 |
| J04 | medium | NA | As J03. | |
| J05 | medium | CV | Razorpay data residency not confirmed. | |
| K01 | high | PA | Notice mentions theme and session; omits referral code, IndexedDB device copy, service worker. | 12 |
| K02 | high | PA | "No cookies" is claimed only for measurement script (true per tests); other storage not classified. | 12 |
| K04 | medium | F | `ref.js` stores `dpdp-referral` in localStorage; notice silent. | 12 |
| K05 | medium | PA | No third-party scripts in static source; Cloudflare beacon is edge-injected and not verifiable from outside. | 12 |
| L01 | high | PA | Mail classes exist; no transactional/marketing classification. | 19 |
| L02 | high | PA | Unsubscribe present; commercial banner in digest; footer address not verified. | 19 |
| L03 | medium | PA | DMARC `p=quarantine`, DKIM published; apex SPF TXT not seen; bounce handling in code. | 19 |
| L05 | high | PA | Digest names the organisation and has one-click unsubscribe; consent mail is sent by the customer; language is English only. | 02 |
| L06 | medium | P | No SMS or WhatsApp provider in functions or app (word matches are prose only). | |
| M04 | low | NA | No US employees in scope. | |
| N01 | high | F | No records of processing. | 17 |
| N02 | high | P | Named Grievance Officer (Rajat Agarwal), role mailbox `dpdp@`, phone, response time stated on Contact and Privacy. Note: a personal mobile is published. | |
| N03 | medium | F | No DPO decision note. | 17 |
| N04 | high | F | No representative decision note (India-only scope is implied, not recorded). | 20 |
| N05 | high | F | No DPIA for children's consent, AI link or public page. | 17 |
| N06 | medium | PA | `OPERATIONS.md` and the law pack exist; no data inventory. | 17 |
| N07 | low | CV | No training record. | |
| O01 | critical | PA | `claims-register.yaml` plus build-time banned-word gate; no per-claim evidence link or review date. | 17 |
| O02 | critical | P | "No DPDP certification exists in India and we do not offer one" on every page; banned words (certified, guarantee, 100%) blocked at build; no seals. | |
| O03 | critical | F | Three promises are not literally true: "nobody can edit", "never stores documents", legacy "Nothing personal is in that link". Others check out (Mumbai database, no sale, no training). | 03, 05, 09 |
| O04 | medium | P | "Compliance due 13 May 2027" and "SPDI Rules apply until 13 May 2027" match the register. | |
| O05 | critical | P | Pages never say using VERIDIAN makes a customer compliant; Disclaimer and Terms say the opposite. | |
| O06 | critical | PA | Static site clean; legacy source sentence "we sell you protection" remains. | 18 |
| O07 | high | PA | "Not a consent manager" stated; product has consent campaigns, classification open; attestation is a customer sign-off in legacy app. | 18 |
| O08 | high | F | Legacy publish route has no evidence gate (static site has no public pages feature). | 18 |
| O09 | high | P | No ISO/SOC/pen-test claim made. | |
| O10 | medium | P | Sample data labelled "Sample"; "free AI assistant, you confirm every update" matches drafts and undo. | |
| O11 | medium | PA | Trial never locks (good); Pricing says quote-only but app has a fixed price; sign-up flow not tested for dark patterns. | 11 |
| P10 | medium | P | Event hash chain and daily seal; AI cannot make level-2 changes; legal-weight changes need human confirm. | |
| Q01 | high | P | Razorpay hosted payment link; no card fields in schema; `payment_attempt` holds Razorpay ids only. | |
| Q02 | high | CV | Razorpay agreement not visible. | |
| Q03 | medium | F | Receipt is not a GST tax invoice. | 11 |
| Q06 | medium | PA | `payment` rows are kept; no legal-retention register. | 01 |
| Q07 | medium | P | Billing tables (`payment`, `subscription`, `payment_attempt`) are separate from compliance content; billing covered in notice. | |
| Q08 | medium | P | Business-only (Terms 3); refund, delivery, contact, GSTIN, grievance officer pages exist. | |
| R01 | high | P | Partner terms: commission rules, 30-day payable, clawback on refund, independent contractor, no spam. | |
| R02 | critical | PA | Strong access control and masking; plain stored values; 0 rows. | 04 |
| R03 | high | PA | TDS fields and a gate on rate; no Form 16A or return process in repo. | 22 |
| R04 | high | P | Partners see counts only and never names; the code is disclosed in terms. | 12 |
| R05 | medium | P | Terms ban spam and unsolicited bulk messages; owner can pause or end. | |
| R06 | medium | PA | No partner retention rule. | 22 |
| R07 | medium | PA | Self-referral blocked at sign-up and payment; masked self view; correction and deletion by writing in. | 22 |
| S01 | critical | F | Live AI link returns colleagues' e-mails by default, officer name, free text. | 03 |
| S02 | high | F | No re-identification review found. | 03 |
| S03 | critical | P | Level 0/1, 1/7/30-day expiry, revoke, rate limit, drafts need confirm token, level-2 verbs not mintable. | |
| S04 | high | PA | Secret handling good; path token and GET fallback. | 10 |
| S05 | high | PA | "Data, never instructions" labelling; no injection test found. | 10 |
| S06 | high | PA | `ai_link_call` and `ai_link_read` logs; notice omits network prefix and tool family; no retention. | 12 |
| S07 | high | P | Drafts, confirm token, undo window, `ai_action` history. | |
| S08 | high | F | Library and playbooks AI-written, not lawyer-reviewed (stated on the pages). | 17 |
| S09 | high | P | Platform sends nothing to an AI vendor; user's own AI disclosed as not a sub-processor; internal AI off by default. | |
| S10 | medium | P | "Before you paste" consent block, Disclaimer 5 and Terms 6 explain what the AI can read and change. | |
| T01 | high | F | No compliance calendar. | 17 |
| T02 | high | PA | Build gates (claims, public surface) exist; no privacy review gate for new data fields. | 17 |
| T03 | medium | F | No regulatory-watch log. | 17 |
| T04 | critical | F | No dated lawyer sign-off. | 17 |
| T05 | low | CV | Insurance not visible. | |
| U01 | high | PA | 44 law codes, 21 with open "verify" notes; statuses match register. | 17 |
| U02 | high | PA | Campaign, token, record, audit trail exist; notice content missing; no bounce handling for consent mail. | 02 |
| U03 | high | PA | E-mail intake ticketed and escalated; web intake limited to e-mail; clocks and templates partial. | 13 |
| U04 | high | PA | Truncation deliberate and documented; access via SQL editor; retention absent. | 14 |
| U05 | medium | PA | Digest names people who are late and escalates by name; links not content copies. | 03 |
| U06 | high | CV | Only the legacy app has public pages; takedown not tested. | 18 |
| U07 | high | CV | No live principal self-service in static app; legacy route not tested. | 06 |
| U08 | high | PA | `event` chain plus legacy attest route; text version not recorded; customer's declaration wording not confirmed. | 09 |
| U09 | high | PA | RLS on `artefact`; 4 artefacts, none stored; export not seen. | 06 |
| U10 | high | P | Counts only; no re-identification surface. | |
| U11 | high | PA | See Q and R rows. | 04, 11, 22 |
| U12 | high | PA | `access_log` exists; SQL editor reads unlogged. | 23 |

---

## (d) Claims to soften or fix today

Owner rule: short sentences.

| Where | Exact current wording | Proposed short wording |
|---|---|---|
| /dpdp-firm/, /dpdp-institution/ | "Keep a dated record nobody can edit." | "Keep a dated record. Every change is logged." |
| /dpdp-firm/, /dpdp-institution/ | "A record nobody can edit ... Every answer is dated and kept. Nobody can change it later." | "A dated record. Edits leave a trace." |
| Home, About, partner/terms footer block | "Each answer is recorded with a date and cannot be edited, building the proof an organisation needs." | "Each answer is recorded with a date. Changes are logged. It helps you build proof." |
| Home hero | "keeps a dated record that nobody can edit." | "keeps a dated record. Changes are logged." |
| Home ("Never stores your documents"), About, Terms | "Never stores your documents" / "never stores documents" | "Keeps a fingerprint, not your document. Payment proofs are kept briefly." (after GAP-05 retention) |
| Privacy section 2 | "No cookie, no browser storage, no account, no third party" (website measurement row) | "No cookie. No storage. Our own script. Cloudflare adds its own page-speed counter." |
| Privacy section 4, Terms 6.6 | Resend "United States" only | "Resend: sends from the US, receives mail in Japan." |
| Privacy section 6 | "separation of one customer's data from another's enforced in the database" | "Customers are kept apart by database rules and access-controlled functions." (true after GAP-06) |
| Privacy section 5 | "within a reasonable time"; "a short operational period" | "within 30 days"; "12 months" (after the schedule exists) |
| Legacy `src/app/dpdp/(app)/ai-link/AiLinkClient.tsx:87` | "we sell you protection ... Nothing personal is in that link" | Delete. Or: "Your link can show names and e-mails. Hide them if you can." |
| Pricing | "Fees for other features are quoted in writing" (app shows Rs 9,999 yearly) | "Yearly plan: Rs 9,999 plus GST. Other plans: quoted." |
| Pricing | "We issue a GST invoice for every payment" | Keep only after a real tax invoice is sent (GAP-11). |
| Trial reminder e-mail | "your data is safe" | "your data stays and your access is unchanged" |
| Privacy section 7 | "within the time the law allows (and in any case within 90 days ...)" | "within 30 days where we can; never more than 90." (counsel to confirm) |

Already good and should stay: "Not a law firm", "No DPDP certification exists in India and we do not offer one", "It does not guarantee compliance", "Stored in India: the database is in Mumbai. Email goes through Resend, a US company" (add Japan receive), the sample-data labels.

---

## (e) Documents to create (short outlines)

1. **Standalone Privacy Notice check (v1.4).** Exists as v1.3. Add: partner data, device storage, AI link prefix, payment proofs, Razorpay, Tokyo mail path, languages offer, retention periods as built, log policy, notice archive. Outline: roles, data table (data, source, purpose, basis, retention), recipients and countries, rights, complaints, cookies and device storage, changes.
2. **Terms of Service.** Exists (v1.0). Add: sub-processor change notice with objection and end-of-contract right, 24-hour processor breach notice, audit right (reasonable, remote), data-return format, EU/UK scope sentence. Lawyer to re-check the Protected Persons clause.
3. **Data Processing Addendum.** Today Terms 6.3 is the DPA. Make a signable one-page DPA: subject matter, instructions, confidentiality, security measures list, sub-processors link, assistance with rights, breach notice in 24 hours, deletion or return in 30 days, audit, India law; optional Annex for CCPA service-provider terms and SCCs.
4. **Sub-processor list (`/subprocessors/`).** Table: vendor, purpose, data, country, safeguard, since; change-notice promise.
5. **Breach and incident runbook.** Severity levels; roles and 24x7 contact; first hour checklist; decision tree "personal data involved?"; customer notice template (24 hours); Board and individual intimation help (Rule 7 fields); CERT-In 6-hour report form; evidence preservation; post-incident review; drill log.
6. **Records of processing (controller and processor).** Per processing activity: purpose, data categories, subjects, recipients, transfers, retention, security measures, owner; reviewed twice a year.
7. **Grievance Officer notice.** One short page: name, role, mailbox, phone (consider a company phone), how to complain, acknowledgement in 48 hours, answer in 30 days, never more than 90, escalation to the Board; also a version the customer can paste for its own principals.
8. **Retention schedule.** Table with class, purpose, period, deletion method, legal basis (see GAP-01 starter periods); log policy; legal-hold rule for invoices, TDS and payout ledgers.
9. Also needed: a compliance calendar (13 Nov 2026 consent managers, 13 May 2027 duties, review dates), a DPIA for consent campaigns and the AI link, a data inventory, and a lawyer sign-off record.

---

*End of report. Self-audit by AI; not legal advice or certification. File left uncommitted by instruction.*
