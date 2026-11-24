# DPDP flow evaluation, 100 steps x 6 processes (task D1, 24 Nov 2026)

Evaluation only. No product code was changed. Branch `dpdp/auth-send-email-hook-2026-11-07`, head `d1761cd0`. Owner points are numbered 1 to 10 as in the order of 24 Nov 2026 (1 firm-first with org path hidden, 2 sell through Firm / Accountant / non-accountant, 3 the Discover-Decide-Do bait and weekly rhythm, 4 simple step by step, 5 firm dashboard, 6 client dashboard, 7 AI link, 8 e-mail basis no password, 9 simple pages, 10 Moneypenny chat and credits). `rules` = the standing rules (simple English, no tick boxes, no "my"/"your", "co-organizer", AI does everything but pay, no invented facts).

## Test results (run in this runner, 24 Nov 2026)

| Command | Result |
|---|---|
| `bun install` | 190 packages installed |
| `bun run typecheck` | clean |
| `bun test` | **800 pass, 0 fail**, 12,277 expect() calls, 52 files |
| `bun run lint` | clean (no output) |
| `bun run build` (no Supabase values) | OK: tsc, facts check, vite build, PWA (7 files precached), sitemap (15 public pages), check-public-surface (3,106 checks), check-claims (0 banned words in 2,079 sentences), check-two-doors (553 checks) |
| `VITE_MOCK=1 bun run build` then `bunx playwright test --workers=2` (Chromium installed with `bunx playwright install --with-deps chromium`) | **242 passed, 0 failed, 0 skipped** in 3.0 minutes, 19 spec files, including `weekly-routine-mock.spec.ts`, `billing-mock.spec.ts`, `erasure-mock.spec.ts` |

No failing test names, so none to list. Not run: the Edge-function and database tests in the repo root (`src/lib/services/dpdp-*.test.ts`, 111 need `DATABASE_URL`), anything against the live site or live Supabase, real Razorpay, real e-mail. The 2026-10-02 `TEST-REPORT.md` and `AI-LINK-SIMULATION-REPORT.md` are used as earlier evidence and are named as such; I did not re-run them.

## How the ratings were made

Static reading of the code, the two earlier reports, the build checkers and the passing tests. Where I did not open the code, the row says NOT-EVIDENCED, not OK. File:line numbers are from this checkout; a `~` means approximate. The "100 steps" are my own breakdown of each process; the rows are short on purpose.

Ratings: OK, SMALL-GAP, GAP, MISSING, CONFLICT (the code does the opposite of an owner point or rule), NOT-EVIDENCED.

## Rating counts

| Process | OK | SMALL-GAP | GAP | MISSING | CONFLICT | NOT-EVIDENCED |
|---|---|---|---|---|---|---|
| P1 Visitor to Firm or Partner | 49 | 8 | 8 | 14 | 8 | 13 |
| P2 Buy, add client, client starts | 53 | 10 | 4 | 16 | 4 | 13 |
| P3 Weekly routine | 48 | 17 | 7 | 11 | 0 | 17 |
| P4 Dashboards | 49 | 9 | 4 | 16 | 1 | 21 |
| P5 AI link | 76 | 8 | 4 | 5 | 2 | 5 |
| P6 Payment and Moneypenny | 60 | 6 | 3 | 13 | 1 | 17 |
| **All 600** | **335** | **58** | **30** | **75** | **16** | **86** |

## Headline findings

1. **The product is the opposite of firm-first on the front door.** The home page offers two equal doors, "For professionals" and "For organisations - Doing it for ourselves" (`index.html:131-134`). The organisation path is reachable from many places and there is no switch to hide it (section "Organisation-direct path today" below).
2. **Nothing of Moneypenny exists in this repo.** Zero matches for "moneypenny" in `dpdp-app` and `supabase/functions/dpdp-*`. Payment is Razorpay through the IT Services pay frame (`src/lib/pay-frame.ts:1`), which is the right payee. Commission is paid in rupees with TDS (`src/lib/partner.ts`), not in credits.
3. **The home page has none of the owner's message.** No "DPDP is coming", no penalties line, no "not an IT job", no Discover/Decide/Do.
4. **"Decide" does not exist in code.** Code stages are Discover, Act, Confirm (`src/lib/weekly-routine.ts`). Mapping and every wording difference are in P3.
5. **The Firm dashboard shows done, not pending, with whom or ageing** (`src/components/CaClients.tsx:129-136, 205`). Ageing exists only as "N days late" on one job (`src/components/onepage/MyJobs.tsx:16`).
6. **The weekly sign-off lives on one device** (`WeeklyRoutine.tsx:48-55`). The server record is a draft migration not applied (`docs/proposed-migrations/0760_dpdp_weekly_run.sql`, `api.ts:116`). The firm cannot see it.
7. **Tick boxes are still used** in billing (`BillingPanel.tsx:277`), account opening (`Screens.tsx:6`), Sales Partner terms (`SalesPartner.tsx:207`), add client (`CaClients.tsx:71`) and AI link settings (`AiWorkLink.tsx:164,190`). The pay endpoint rejects a request without the box (`dpdp-pay/README.md`, K3).
8. **Good news.** E-mail-only sign-in already exists, with a typed code beside the link (`App.tsx:254-268`); no password and no Google sign-in exist anywhere (grep of `src`), so nothing to remove. A client "covered by firm" already pays nothing itself (`BillingPanel.tsx`, `platform-mode.ts:19`). The Sales Partner programme already lets anyone with a sign-in join (`SalesPartner.tsx:~192`). The AI link is strong: 76 of 100 AI-link rows are OK, and the AI cannot pay (no payment verb).
9. **Facts not verified.** "Compliance due 13 May 2027" is printed in the firm page title block and description (`dpdp-firm/index.html`, `facts.mjs`). I did not check it against the Rules text and printed no penalty number anywhere. See question Q11 in the design file.

## Organisation-direct path today: hidden or deleted?

**Nothing is hidden and nothing is deleted. Everything is fully live and public.** There is no switch.

| Where | What | Evidence |
|---|---|---|
| Home page | second door "For organisations" | `index.html:133` |
| Public page | `/dpdp-institution/`, in the sitemap and `llms.txt` | `dpdp-institution/index.html`; build log lists it among 15 public pages; `public/llms.txt:24` |
| Build checker | requires that page to exist, with a button to `/app/?edition=institution` | `src/lib/public-surface.mjs:278,305-317` (hiding the page needs a checker change, or the build fails) |
| App routes | `/app/?edition=institution` is read from the URL | `src/lib/landing.ts` `edition`; `Screens.tsx:255` `initialEdition` |
| Components | account opening has both buttons; add-client form lets a firm type a client as "institution" | `Screens.tsx:300-303`; `CaClients.tsx:25` |
| Plans and billing | institution plan, price line, billing lines | `Screens.tsx:241`, `billing-state.ts:87,185-197` |
| Job lists | generated per edition including institution | `scripts/generate-job-pages.mjs:75` |
| Edge functions | none is org-direct specific by name (`dpdp-pay`, `dpdp-monday-email`, `dpdp-lifecycle-email`, `dpdp-ai-link`, etc.); the product kind travels as data (`drizzle/0747` pay order product variation) | function list; bodies not read in full |

Note: `scripts/check-two-doors.mjs` is not about these two audiences; it is the wall between the AI link and the public site. It does not block hiding the organisation door.


## P1. A visitor arrives, understands, and becomes a Firm or Partner (sign-up and e-mail verification)

Rows: step | rating | evidence | gap | owner points. Paths are under `dpdp-app/`. "no evidence" = I did not open that code.

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Visitor types dpdp.veridian-aios.com | NOT-EVIDENCED | `wrangler.toml`, `public/_redirects` not opened | Host routing not checked from this runner (no live access) | 2 |
| 2 | Page loads fast, static | OK | `index.html` is static HTML; build output 3106 public-surface checks pass | none | 9 |
| 3 | First screen shows a headline | SMALL-GAP | `index.html:129` "DPDP compliance that outlasts the person who set it up." | Not the owner's bait (DPDP is coming, penalties are high, CA/CS/auditor reminds the client) | 3 |
| 4 | Headline says DPDP is coming | GAP | `index.html:129` | No "coming" line on the home page | 3 |
| 5 | Headline says penalties are high | MISSING | grep for "crore" in `facts.mjs`, `index.html`, `dpdp-firm/index.html`: no hit | Home says nothing about penalties. A new line is fine only if cited to the Act | 3 |
| 6 | "It is not an IT job" | MISSING | `index.html` | Absent | 3 |
| 7 | "It is the job of the CA, CS or auditor to remind the client" | MISSING | `index.html:131-134` offers two doors, not this message | Absent | 3 |
| 8 | "First step is Discover, then a weekly independent follow-up" | MISSING | `index.html` | Absent; "One email a week" appears only as a small badge (`index.html:~138`) | 3 |
| 9 | Discover / Decide / Do shown in 3 short lines | MISSING | `index.html` | Not on the home page | 3,4 |
| 10 | "Not one-time, it is weekly" | GAP | `index.html` badge "One email a week" | Weak; no weekly message | 3 |
| 11 | Home speaks to three sellers (Firm, Accountant, non-accountant) | MISSING | `index.html:131-134` has 2 doors: "For professionals" and "For organisations" | Wrong two doors for the new model | 1,2 |
| 12 | Door "For organisations - Doing it for ourselves" is the org-direct path | CONFLICT | `index.html:133` | Must be hidden (point 1). Today it is the second of two equal doors | 1 |
| 13 | Home lets a non-CA accountant see "this is for me" | MISSING | `/partner/index.html` says "Become a Sales Partner" but is not linked as a main door | Hidden away from the home page | 2 |
| 14 | Home page uses simple English, short sentences | SMALL-GAP | `index.html:130` "hands each one to a named person, and keeps a dated record that is added to, not edited" | Long sentence, abstract words | 4,9 |
| 15 | No "my"/"your" in screen text | GAP | grep count `index.html` 19, `dpdp-firm/index.html` 14 hits of your/my; e.g. `index.html:138` "Never stores your documents" | Rule not met on the public pages | rules |
| 16 | "Host" reads "co-organizer" | NOT-EVIDENCED | grep "host" in `src/components` found only "host" meaning server host (`api.ts:319`) | No user-facing "host" found in what I searched; not proven everywhere | rules |
| 17 | Sample card shows a file with done/pending | OK | `index.html:~145-160` sample card (8 of 13 done) | Labelled "Sample data" - good | 5 |
| 18 | Sample card shows ageing | MISSING | sample card has "due this week" only | No days-late or ageing in the sample | 5 |
| 19 | Primary call-to-action button | SMALL-GAP | `index.html:131-134` two doors are links, text "Doing it for my clients" | Says "my" | rules |
| 20 | "Already have an account? Sign in" | OK | `index.html:140` links `/app/` | none | 8 |
| 21 | Page shows no password promise breakage | OK | "No accounts or passwords for stakeholders" `index.html:~137` | Fine, but wording says "stakeholders" only; sign-in for all is e-mail only (`App.tsx:254`) | 8 |
| 22 | Firm landing page exists | OK | `dpdp-firm/index.html:~h1` "DPDP compliance for all your clients, in one place" | Needs the new message | 1,3 |
| 23 | Firm page says who can sign off | NOT-EVIDENCED | not read | Needed for the Partner split | 2 |
| 24 | Firm page shows what the client sees | NOT-EVIDENCED | not read | | 6 |
| 25 | Firm page shows price | NOT-EVIDENCED | `Screens.tsx:239` `priceLine` reads plans from RPC | Live prices not seen from here | 10 |
| 26 | Firm page "Start free" goes to /app/?edition=firm | OK | `src/lib/public-surface.mjs:317` pattern; `e2e/editions-signup.spec.ts` | none | 1 |
| 27 | Institution page exists and is crawlable | CONFLICT | `dpdp-institution/index.html`, `public/llms.txt:24`, `sitemap` (15 pages) | Org-direct page is public and in the sitemap; must be hidden | 1 |
| 28 | Institution page "Start free" opens org sign-up | CONFLICT | `public-surface.mjs:317` `href="/app/?edition=institution"` | Same | 1 |
| 29 | `/partner/` page exists | OK | `partner/index.html` | Title "Become a Sales Partner" only | 2 |
| 30 | `/partner/` says non-CA accountants welcome | GAP | `SalesPartner.tsx:~192` "Anyone with a VERIDIAN sign-in can join" | Open to all but no accountant message | 2 |
| 31 | Partner terms page | OK | `partner/terms/` | none | rules |
| 32 | Pricing page | NOT-EVIDENCED | `/pricing/` in sitemap, not read | | 10 |
| 33 | Visitor can read Terms before signing | OK | `/terms/` in sitemap | | rules |
| 34 | About page | NOT-EVIDENCED | `about/index.html` not read | | |
| 35 | AI-assistant page for visitors | OK | `ai-assistant/index.html`, `e2e/agent-by-role.spec.ts` | | 7 |
| 36 | llms.txt describes the model | GAP | `public/llms.txt:23-24` lists firm and institution | Says org-direct exists | 1,7 |
| 37 | Visit tracking (analytics) | OK | `functions/api/visit.ts`, `VISITOR-ANALYTICS.md` | none | |
| 38 | Referral `?ref=` kept | OK | `src/lib/landing.ts:14` | | 2 |
| 39 | Sales Partner `?sp=` kept | OK | `landing.ts:18` | Outranks ref at account opening | 2 |
| 40 | `?edition=` kept | OK | `landing.ts` `edition`, `Screens.tsx:255` `initialEdition` | | 1 |
| 41 | A new `?role=` / `?kind=` for Firm / Accountant | MISSING | `landing.ts` | No such parameter | 2 |
| 42 | Click "Start" opens /app/ | OK | `app/index.html`, `App.tsx` | | 8 |
| 43 | App boots, shows a loading state | OK | `App.tsx:97` phase "booting" | | 9 |
| 44 | URL hash errors handled | OK | `App.tsx:71-75`, `landing.ts` | | 8 |
| 45 | Signed-out screen asks for e-mail only | OK | `App.tsx:354` `SignIn`; `signInWithOtp` `App.tsx:254` | No password field anywhere | 8 |
| 46 | No password route exists | OK | grep `signInWithPassword` in `src`: no hit | | 8 |
| 47 | Google sign-in | OK | grep `signInWithOAuth`/"oauth" in `src`: no hit | Does not exist, so nothing to keep or remove | 8 |
| 48 | E-mail input validated | NOT-EVIDENCED | `Screens.tsx` SignIn not read line by line | | 8 |
| 49 | Sign-in screen wording | SMALL-GAP | `signin-benefits.ts` not read; `Screens.tsx` has your/my (15 hits) | Rule on "your" | rules |
| 50 | Magic link sent with a redirect to /app/ | OK | `App.tsx:254` `emailRedirectTo /app/` | | 8 |
| 51 | Same screen accepts a typed code | OK | `App.tsx:266-268` `verifyOtp type email`, `CheckYourEmail` `App.tsx:360` | Good for AI and for mail scanners | 8 |
| 52 | Auth e-mail sent through own hook | OK | `supabase/functions/dpdp-auth-send-email`, commit ebdb1a7f | Inert until hook is enabled (commit message) | 8 |
| 53 | Hook enabled in the live Supabase project | NOT-EVIDENCED | commit says "inert until the hook is enabled" | Cannot check from runner | 8 |
| 54 | Auth e-mail subject wording | OK | commit c72ff30e "subjects match the project's own wording" | | 8 |
| 55 | Auth e-mail "verified" proves ownership | OK | Supabase OTP, only the mailbox owner has the code | | 8 |
| 56 | Resend link button | OK | `App.tsx:360` `onResend` | | 8 |
| 57 | Link expired screen | OK | `App.tsx:357` `LinkExpired` | | 8 |
| 58 | Use another address | OK | `App.tsx:357,360` `onUseAnother` | | 8 |
| 59 | Rate limit on sign-in mails | NOT-EVIDENCED | Supabase auth setting, not in repo | | 8 |
| 60 | Session returns via onAuthStateChange | OK | `App.tsx:266` comment | | 8 |
| 61 | After sign-in the app loads the person's page | OK | `App.tsx` `load` calls `dpdp_my_page` | | 8 |
| 62 | New e-mail with no membership sees "Open an organisation" | CONFLICT | `App.tsx:363` `OpenOrganisation` | Every new person is steered to create an org or firm; org option is not hidden | 1 |
| 63 | Choice "For professionals" / "For organisations" | CONFLICT | `Screens.tsx:300-303` two buttons | Org button must be hidden behind one switch | 1 |
| 64 | Firm form asks firm name | OK | `Screens.tsx:310` | | 1 |
| 65 | Firm form asks kind of firm | SMALL-GAP | `Screens.tsx:224-228` CA, CS, Cost accountant, Legal, Audit | No "Accountant Partner / bookkeeper" kind | 2 |
| 66 | Professional body number (ICAI/ICSI) declared | OK | `Screens.tsx:224-226` `declared: true` | Self-declared, not verified | 2 |
| 67 | Non-CA accountant can open an account | GAP | `Screens.tsx:224-228` | No kind for them; only `/partner/` sales route | 2 |
| 68 | Plain notice line with Terms link (no tick box) | CONFLICT | `Screens.tsx:6` `TermsCheckbox`; `TermsBox.tsx:2` `TICK_TO_CONTINUE` | Uses a checkbox. Owner rule: no tick boxes | rules |
| 69 | Account opened through RPC | OK | `api.ts` `dpdp_create_my_org` (AI-LINK report names it) | | 1 |
| 70 | Opening records Terms version | OK | `drizzle/0748_dpdp_terms_acceptance.sql` per `dpdp-pay/README.md` | | rules |
| 71 | Account kind stored as `firm`/`institution` only | GAP | `billing-state.ts:87` `accountType: "firm" \| "institution"` | No third value for Accountant Partner | 2 |
| 72 | Firm becomes owner of its page | OK | `Screens.tsx:293` text; `e2e/editions-signup.spec.ts` | | 1 |
| 73 | First visit for a firm | OK | `CaPartnerFirstVisit.tsx`; `acceptance-70` FIRST-10 | That component is for a CA named by a client org, a different thing | 5 |
| 74 | Sales Partner sign-up: accept terms | CONFLICT | `SalesPartner.tsx:207` checkbox "I have read ... and I accept" | Tick box | rules |
| 75 | Sales Partner opens from the sign-in | OK | `App.tsx:363,383` `onOpenPartner`, `partnerOpen` | | 2 |
| 76 | Partner name, payout details | OK | `SalesPartner.tsx` `hasPayoutDetails` | Cash payout (INR, TDS), not credits | 2,10 |
| 77 | Partner gets a link `?sp=` | OK | `landing.ts:18` | | 2 |
| 78 | Partner earns 20% of each yearly payment | SMALL-GAP | `SalesPartner.tsx:~192` text "20% of each yearly payment ... on every renewal" | In rupees, not Moneypenny credits; not on weekly plan | 2,10 |
| 79 | Partner commission becomes payable after N days | OK | `SalesPartner.tsx:263` | | 2 |
| 80 | Partner dashboard shows lines | OK | `SalesPartner.tsx:255-289` | | 2 |
| 81 | Link a supervising Firm by e-mail invitation | MISSING | grep in `src`, `supabase/functions` | No such concept | 2 |
| 82 | Accountant Partner flagged "may not sign statutory reports" | MISSING | `ai-link router`, `PARTNER_SIGN` verb exists (`api-definition.ts:118`) but no kind check | Needs a rule | 2 |
| 83 | "For a professional to confirm" label | MISSING | grep | Absent | 2 |
| 84 | Duplicate sign-up with same e-mail | NOT-EVIDENCED | RPC SQL not read | | 8 |
| 85 | Hostile names handled | OK | `TEST-REPORT.md` "sign-up with hostile names ... as designed" (2026-10-02 rehearsal) | Reported by earlier test, not re-run | 8 |
| 86 | Referral chain tests | OK | `src/lib/referral-chain.test.ts` in 800 passing tests | | 2 |
| 87 | Sign out | OK | `App.tsx:363` `onSignOut` | | 8 |
| 88 | Returning visitor signs in and lands on dashboard | OK | `App.tsx` phase "app" | | 4,5 |
| 89 | Visitor on a phone | NOT-EVIDENCED | `e2e/gates-phone-a11y-pwa.spec.ts` exists, not run (see summary) | | 9 |
| 90 | Visitor with screen reader | OK | `e2e/agent-by-role.spec.ts`, `site-css-contrast.test.ts` | | 9 |
| 91 | Install as app (PWA) | OK | `build-pwa: 7 files precached` in build output | | 9 |
| 92 | Language other than English | GAP | `AI-LINK-SIMULATION-REPORT.md` S4: "Page/law text is English only" | Not an owner point | |
| 93 | Public claims checked | OK | build `check-claims`: 0 banned words in 2079 sentences | | rules |
| 94 | Penalty/date statements cite the Act | NOT-EVIDENCED | `facts.mjs` has "13 May 2027" on firm page title block; I did not check it against the Rules text | **Must verify against official text before any public line; not verified here** | rules |
| 95 | Public pages leak no AI-link internals (wall) | OK | build `check-two-doors`: 553 checks pass | | 7 |
| 96 | Hidden switch for org-direct path | MISSING | grep `showDirect`/`VITE_` in `src/lib`: only mock/supabase vars | No switch exists | 1 |
| 97 | A visitor can reach Moneypenny Chat | MISSING | grep "moneypenny" -i whole `dpdp-app` and `supabase/functions/dpdp-*`: 0 hits | No mount point | 10 |
| 98 | Email-first wording on home | SMALL-GAP | `index.html:~137` | "No accounts or passwords" covers stakeholders only | 8 |
| 99 | Sitemap lists only the pages that should be public | CONFLICT | build log lists `/dpdp-institution/` | Org page is listed | 1 |
| 100 | End of P1: a Firm or Accountant exists and is verified | SMALL-GAP | firm yes via `OpenOrganisation`; accountant only as Sales Partner | Accountant path is split from the weekly routine | 2 |

### Top 10 faults, ranked by harm

1. Home page has no owner message and offers the wrong two doors (rows 3-13)
2. Organisation-direct door, page, sitemap, llms.txt all live and public (rows 12, 27, 28, 36, 99)
3. No hidden switch for the organisation path (row 96)
4. No Accountant Partner kind; account kind has only `firm`/`institution` (rows 65, 67, 71, 81-83)
5. Tick boxes at account opening and Sales Partner terms (rows 68, 74)
6. No Moneypenny Chat mount (row 97)
7. `your`/`my` throughout public pages (row 15)
8. Penalty and date claims not verified against the Act and Rules (row 94)
9. New e-mail with no membership is steered to open an organisation (rows 62-63)
10. Auth e-mail hook may still be off live (row 53)

### Organisation-direct path in this process

Door, page, sitemap, llms.txt, `?edition=institution` and the account-opening button are all live (rows 12, 27, 28, 36, 63, 99). Hidden: none. Deleted: none.


## P2. The Firm or Partner buys (Moneypenny credits), adds a client by e-mail, and the client verifies and starts

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Firm is signed in and sees its page | OK | `App.tsx:374` `Screens`/`CaClients` | | 5 |
| 2 | Free trial starts at opening | OK | `dpdp-lifecycle-email/index.ts:5` "30-day free trial" | | 10 |
| 3 | Trial pack, month, year are the three ways to pay | OK | `dpdp-pay/logic.ts:35` (drizzle/0755) | No "weekly plan" exists | 10 |
| 4 | Prices come from the database, not code | OK | `billing-state.ts:5` comment | I could not read live prices; none invented here | 10 |
| 5 | Price shown before paying | OK | `Screens.tsx:239` `priceLine`, `billing-state.ts:185-197` ladder lines | | 10 |
| 6 | Firm price includes N clients, then per extra client | OK | `billing-state.ts:208-212` `clientsLine` | Per-client price, not "client's paid weekly plan" | 10 |
| 7 | Billing panel opens | OK | `BillingPanel.tsx` (360 lines) | | 10 |
| 8 | Payment method is Moneypenny credits | MISSING | grep "moneypenny" -i: 0 hits in `dpdp-app`, `supabase/functions/dpdp-*` | Whole payment path is direct Razorpay | 10 |
| 9 | Payee is IT Services by Rajat Agarwal via Razorpay, through the central service | SMALL-GAP | `dpdp-pay/README.md` "registered IT Services pay frame" (`hop`) and Ledger C "central ledger of IT Services by Rajat Agarwal" | Order is created by `dpdp-pay` itself with own Razorpay keys, then goes to a "hop" frame. Central-service-only not proven | 10 |
| 10 | Terms accepted with plain notice line | CONFLICT | `BillingPanel.tsx:92,277` `TermsCheckbox`; `dpdp-pay/README.md` K3 box: 400 "Please tick the box to continue." | Tick box is enforced server side too | rules |
| 11 | "Pay online" button | OK | `BillingPanel.tsx:153-156` `startOnlinePayment` | | 10 |
| 12 | Payment disabled when keys missing | OK | `dpdp-pay/README.md` 503 `not_enabled`; `TEST-REPORT.md` live 503 on both endpoints | Online payment not switched on live as of 2026-10-02 | 10 |
| 13 | Alternative: declare a bank/UPI payment | OK | `PaymentDue.tsx`, `OwnerPaymentAdmin.tsx` (claim, owner approves) | Manual route, owner confirms | 10 |
| 14 | Payment confirmed by webhook | OK | `dpdp-pay/README.md` webhook, `logic.ts:144-200` | | 10 |
| 15 | Amount comes from the database, not the browser | OK | `dpdp-pay/README.md` "browser sends no amount" | | 10 |
| 16 | Receipt/invoice e-mail | OK | `supabase/functions/dpdp-invoice-email`, `payment-proof-mail.ts` | Not run | 10 |
| 17 | Firm adds a client | OK | `CaClients.tsx:23-80` `AddClientForm` | | 1,5 |
| 18 | Client name required | OK | `CaClients.tsx:33` | | |
| 19 | Client kind chosen: firm or institution | CONFLICT | `CaClients.tsx:25` `product: "firm" \| "institution"` | A client that is an organisation is typed "institution", which is exactly the org-direct product kind; hiding org-direct must not hide this | 1 |
| 20 | "Set it up for them" with owner e-mail | SMALL-GAP | `CaClients.tsx:27-36,71` checkbox + `ownerEmail` | Optional; default is "Nothing is emailed" (`CaClients.tsx` HowTo) | 6,8 |
| 21 | Tick box on the form | CONFLICT | `CaClients.tsx:71` checkbox | Owner: no tick boxes | rules |
| 22 | E-mail format check | OK | `CaClients.tsx:35` | Message says "untick" | rules |
| 23 | RPC creates client org | OK | `api.ts:149-150` `dpdp_create_client_org(p_name,p_product,p_owner_email)` | | 1 |
| 24 | Client gets an e-mail invitation | NOT-EVIDENCED | no invitation sender found in `supabase/functions/dpdp-*` list (ai-link, audit, inbound-mail, invoice-email, lifecycle-email, monday-email, partner-email, pay, track); RPC SQL not read | Possibly the first Monday e-mail is the only message | 6,8 |
| 25 | Invitation says who invited | NOT-EVIDENCED | | | 6 |
| 26 | Client verifies by e-mail | OK | same OTP path `App.tsx:254-268` | Verified e-mail must match owner e-mail given; match logic in SQL not read | 8 |
| 27 | Client sees only its own org | OK | `acceptance-70` ROLES; `dpdp-cross-tenant-rpc` tests exist but live-DB, 111 skipped (TEST-REPORT) | Not run here | 6 |
| 28 | Client's first visit | OK | `FirstVisitWizard.tsx`, `CaPartnerFirstVisit.tsx` | | 4 |
| 29 | Firm can open a client's file | OK | `CaClients.tsx:6-9` comment; `Open` button | | 5 |
| 30 | Firm gives each job to a person | OK | `CaClients.tsx` HowTo step 4 | Manual, one by one | 4 |
| 31 | Client count cap on trial pack | OK | `billing-state.ts:215` cap rule; `:195` "trial pack covers up to N clients" | | 10 |
| 32 | Add many clients at once (CSV) | MISSING | `CaClients.tsx` form is one client | A firm with 40 clients adds 40 times | 4 |
| 33 | Firm sees client status after invite (invited, verified, started) | GAP | `CaClients.tsx:205` columns Client, As, Done, Where it is | No "invited / not yet verified" state | 5 |
| 34 | Remind a client who has not verified | MISSING | | | 3 |
| 35 | Accountant Partner buys | MISSING | no accountant kind (P1-67) | | 2 |
| 36 | Accountant Partner adds a client | MISSING | same | | 2 |
| 37 | Supervising Firm link by invitation | MISSING | grep: nothing | | 2 |
| 38 | Commission on client's paid plan | SMALL-GAP | `SalesPartner.tsx:~192` 20% of yearly, `dpdp-pay/README.md` `dpdp.referral_commission` | Applies to referred orgs; a firm's own clients are not "referred". Unclear how client plan is paid | 2,10 |
| 39 | Commission in Moneypenny credits | MISSING | `README.md` Ledger C: `/api/pay/commission` `accrued` -> paid via payout run in rupees with TDS (`partner.ts:statementCsv`) | Cash with TDS today | 2,10 |
| 40 | Commission mechanism reused | OK | exists, see rows 38-39 | Adopt as BOSS says | 2 |
| 41 | Per-client weekly plan price | MISSING | `dpdp-pay/logic.ts:35` only pack, month, year | No weekly plan in code; BOSS wording "client's paid weekly plan" needs a decision (question Q3) | 10 |
| 42 | Who pays: firm or client | GAP | `billing-state.ts:118` "what an account pays a month ... extra-client price" = firm pays | Client org never pays directly. OK for firm-first | 1,10 |
| 43 | Client org billing screen hidden from client | NOT-EVIDENCED | `BillingPanel` role gating not read | | 6 |
| 44 | Online payment: window opens | OK | `BillingPanel.tsx:208` comment; `pay-frame.ts` | | 10 |
| 45 | Payment failure message | OK | `BillingPanel.tsx:208` "cannot be opened" text | | 10 |
| 46 | Retry after failure | OK | `dpdp-pay` each press = new `payment_attempt` (README Ledger C) | | 10 |
| 47 | Double payment flagged | OK | README "flagged second payment" | | 10 |
| 48 | Access never locks for non-payment | OK | `TEST-REPORT.md` "scan: access never locks" | Product rule | 10 |
| 49 | Trial reminders 10, 3, 0 days | OK | `dpdp-lifecycle-email/index.ts:5` | | 10 |
| 50 | Renewal reminders 30, 7 days | OK | same `:7` | | 10 |
| 51 | Reminder not sent twice | SMALL-GAP | `index.ts:12-17` claim table; `TEST-REPORT.md` O-2 open: mark failure can resend | Known open fault O-2 | 10 |
| 52 | Reminder wording | NOT-EVIDENCED | `renderReminder` not read | | rules |
| 53 | Firm profile card | OK | `ProfileCard.tsx` | | |
| 54 | Firm's practice declared | OK | `Screens.tsx:224` | | 2 |
| 55 | Partner payout details | OK | `SalesPartner.tsx` | | 2 |
| 56 | Partner statement CSV | OK | `partner.ts:statementCsv`, `partner.test.ts` | | 2 |
| 57 | Owner approves payouts | OK | `OwnerPartnerPayouts.tsx` | | 2 |
| 58 | Test mode for practice | OK | `platform-mode.ts:1-19`, `TestModeBanner.tsx` | | 10 |
| 59 | Test banner wording | OK | `platform-mode.ts:6` | | 10 |
| 60 | Client org opens directly with no firm | CONFLICT | `Screens.tsx:303` institution button | See org-direct status | 1 |
| 61 | Client invited by firm becomes owner of its org | NOT-EVIDENCED | SQL not read | | 6 |
| 62 | Firm remains linked to the client | OK | `dpdp_my_clients` `api.ts:143` | | 5 |
| 63 | Client can remove the firm | NOT-EVIDENCED | | | 6 |
| 64 | Firm can transfer a client | MISSING | | Not asked by owner; ignore | |
| 65 | Referral code on client sign-up | OK | `landing.ts:14` | | 2 |
| 66 | Add-client screen wording: "your", "client's" | SMALL-GAP | `CaClients.tsx` 3 hits of your/my; heading "All your clients at a glance" | Rule | rules |
| 67 | Add-client works on a phone | NOT-EVIDENCED | | | 9 |
| 68 | AI can add a client | MISSING | AI verbs `api-definition.ts:118` list ADD_PERSON, not add client | AI can add a person, not an org | 7 |
| 69 | AI can pay | OK | no payment verb in `api-definition.ts` | Owner rule: AI must not pay. Confirmed absent | 7 |
| 70 | Firm sees clients' names and counts only | OK | `dpdp_my_clients` | | 5 |
| 71 | Firm-level plan summary line | OK | `billing-state.ts:185-197` |  | 10 |
| 72 | Yearly per client under Rs 50 line | OK | `billing-state.ts:150-166` computed, not typed |  | 10 |
| 73 | Festive offer wording | OK | `billing-state.ts:208-212` `offerLabel` |  | 10 |
| 74 | Rupee formatting | OK | `formatRupees` in `billing-state.ts`, `billing-state.test.ts` |  | 10 |
| 75 | Billing state: trial / awaiting / active | OK | `billing-state.ts` `subscriptionState`; `ai-link brief.ts:81` |  | 10 |
| 76 | Trial countdown time zone | OK | `db-time.ts`, TEST-REPORT B-2 fixed |  | 10 |
| 77 | Owner pending claims | OK | `OwnerPaymentAdmin.tsx` |  | 10 |
| 78 | Reject claim returns to trial | SMALL-GAP | TEST-REPORT O-4 open | Known fault | 10 |
| 79 | Approve claim with no edition shows raw error | SMALL-GAP | TEST-REPORT O-5 open | Cosmetic | 10 |
| 80 | Refunds | MISSING | TEST-REPORT 'no refund code exists' | Policy page `/refund/` exists | 10 |
| 81 | Invoice e-mail with GST | NOT-EVIDENCED | `dpdp-invoice-email` not read |  | 10 |
| 82 | Payment proof mail | OK | `payment-proof-mail.test.ts` in 800 pass |  | 10 |
| 83 | Razorpay-only rule enforced by test | OK | `razorpay-only.test.ts` | Rule says Razorpay only; Moneypenny credits are a different, central layer | 10 |
| 84 | Moneypenny credit balance shown | MISSING | no hit |  | 10 |
| 85 | Moneypenny credit top-up | MISSING | no hit |  | 10 |
| 86 | Moneypenny credit spend for firm plan | MISSING | no hit |  | 10 |
| 87 | Moneypenny credit commission | MISSING | no hit |  | 2,10 |
| 88 | Central service contract known to this repo | NOT-EVIDENCED | not in `dpdp-app`; `Ledger C` calls `/api/pay/site-summary`, `/api/pay/commission` (README) | Those are the nearest existing central calls; their host is not named in what I read | 10 |
| 89 | Client invitation e-mail through Resend | NOT-EVIDENCED | see row 24 |  | 8 |
| 90 | Invitation is e-mail based only | NOT-EVIDENCED |  |  | 8 |
| 91 | Firm sees invited-not-verified | GAP | see row 33 |  | 5 |
| 92 | Client first dashboard is simple | SMALL-GAP | `OnePageView.tsx`, `RoleWelcome.tsx` | Full Part-by-Part table; owner wants a simple view | 6,9 |
| 93 | Client sees which firm serves it | NOT-EVIDENCED |  |  | 6 |
| 94 | Client sees contact of firm | NOT-EVIDENCED |  |  | 6 |
| 95 | Client can ask firm a question (Moneypenny Chat) | MISSING | no hit |  | 10 |
| 96 | Add-client form hint 'Nothing is emailed to anybody yet' | SMALL-GAP | `CaClients.tsx` HowTo | Conflicts with e-mail-first onboarding unless invite is default | 8 |
| 97 | Firm uses SalesPartner link for its own clients | GAP | `landing.ts:18` | Referral and client creation are two separate paths | 2 |
| 98 | Audit trail of firm actions | OK | `AuditLogPanel.tsx`, `dpdp-audit` |  | 5 |
| 99 | Erasure request flow | OK | `e2e/erasure-mock.spec.ts` exists |  | 6 |
| 100 | End of P2: client verified and started | SMALL-GAP | rows 24,26,28 | Invitation path not evidenced | 6,8 |

### Top 10 faults, ranked by harm

1. Moneypenny credits purchase and spend do not exist (rows 8, 84-87)
2. Commission is cash with TDS, not credits (row 39)
3. No weekly plan price; only pack, month, year (row 41)
4. Accountant Partner cannot buy or add clients (rows 35-37)
5. No evidence of a client invitation e-mail; the form says nothing is e-mailed yet (rows 20, 24, 96)
6. Terms tick box enforced by the server (rows 10, 21)
7. Firm cannot see invited / verified / started per client (rows 33, 91)
8. No bulk add of clients (row 32)
9. Client kind 'institution' in the firm's add-client form is the org-direct product kind (row 19)
10. Known open billing faults O-2, O-4, O-5 (rows 51, 78, 79)

### Organisation-direct path in this process

Add-client form can still create `institution` clients (row 19); that use is wanted under firm-first, so hide only the direct sign-up. Institution plan and price line stay live.


## P3. The weekly routine for one client: Discover, Decide, Do, reminders, e-mails, ageing

**Mapping (owner word to code word).** Discover = Discover (code stage id `know`). Decide = no stage; its work (what, when, who) is split between Discover step 3 and Act steps 1-2. Do = Act (the work) plus Confirm (id `check`, the proof). Code order: Discover, Act, Confirm. Owner order: Discover, Decide, Do. Every place where the wording differs is listed in rows 5-10 and 24-37.

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Owner word Discover maps to code stage 'Discover' (id `know`) | OK | `src/lib/weekly-routine.ts`:21 `name: "Discover"`, id `know` | Id is 'know', name matches | 3 |
| 2 | Owner word Decide maps to code stage ... none | GAP | `src/lib/weekly-routine.ts`: only Discover, Act, Confirm | No stage named Decide; the what/when/who work is spread over Discover step 3 and Act steps 1-2 | 3 |
| 3 | Owner word Do maps to code 'Act' (do the jobs) | SMALL-GAP | `src/lib/weekly-routine.ts` stage `act`, 'Do this week's jobs' | Wording differs: Act vs Do | 3 |
| 4 | Owner 'Do: confirm that it is done' maps to code 'Confirm' (id `check`) | SMALL-GAP | `src/lib/weekly-routine.ts`: stage `check` named Confirm; id is 'check'; comment line 6 says 'the Check stage' | Three names for one stage (Confirm, check, Check). Owner puts confirm inside Do | 3 |
| 5 | Wording difference: tab title 'Your weekly routine' | SMALL-GAP | `WeeklyRoutine.tsx:55` | 'Your' breaks the no 'my/your' rule | 3,rules |
| 6 | Wording difference: intro 'Discover, Act, Confirm' | SMALL-GAP | `WeeklyRoutine.tsx:57` | Owner words are Discover, Decide, Do | 3 |
| 7 | Wording difference: Discover promise 'what data you hold, who holds it and where it lives' | SMALL-GAP | `src/lib/weekly-routine.ts`:22 | Owner: what data, where it is, with whom. Close; 'you hold' has 'you' | 3 |
| 8 | Wording difference: Act promise | SMALL-GAP | `src/lib/weekly-routine.ts`:~34 'each with a name and a date' | Owner's Decide says what to do, when, who. This is Decide text under the name Act | 3 |
| 9 | Wording difference: Confirm promise | OK | `src/lib/weekly-routine.ts`:44 'Make sure the week's work really happened, and keep the proof' | Close to the owner's Do | 3 |
| 10 | Wording difference: doer label 'Your device' | SMALL-GAP | `src/lib/weekly-routine.ts`:15-17 `DOER_LABEL` | 'Your' | rules |
| 11 | Wording in the weekly e-mail subject | NOT-EVIDENCED | `dpdp-monday-email/render.ts:283` `subjectFor` not read |  | 3 |
| 12 | Monday e-mail uses Discover/Decide/Do words | NOT-EVIDENCED | not read |  | 3 |
| 13 | Weekly means every week | OK | `src/lib/weekly-routine.ts` `cadence()` last, next, missed weeks; `WeeklyRoutine.tsx` rhythm strip |  | 3 |
| 14 | Routine screen placed top of the signed-in page | OK | `WeeklyRoutine.tsx:8`, `data-testid=weekly-routine` |  | 3,4 |
| 15 | Routine reachable by a Firm for each client | NOT-EVIDENCED | `WeeklyRoutine` takes one `orgId`; firm opens a client's file (`CaClients.tsx` Open) | Firm cross-client weekly view not found | 5 |
| 16 | Routine record kept on server | SMALL-GAP | `api.ts:116` comment 'proposed migration 0760, not applied yet'; `docs/proposed-migrations/0760_dpdp_weekly_run.sql` | Draft only; the RPCs `dpdp_weekly_runs`, `dpdp_weekly_log` do not exist live (not checked live; the repo says not applied) | 3 |
| 17 | Fallback when server record missing | OK | `WeeklyRoutine.tsx:41-46` allSettled; 'no error is shown' | Good | 3 |
| 18 | Weekly sign-off kept on device only | GAP | `WeeklyRoutine.tsx:48-55` `localStorage checkedKey`; header comment line 11 | The Firm cannot see a client's sign-off; it is lost on another device | 3,5 |
| 19 | Sign-off button 'This week is checked' | OK | `src/lib/weekly-routine.ts` Confirm step 3 |  | 3 |
| 20 | Sign-off stored with date and person | SMALL-GAP | device key + `logWeeklyRun` best effort | Server part not live | 3 |
| 21 | Discover step 1: helper reads data on Monday | OK | `src/lib/weekly-routine.ts` Discover step 1; `dpdp-monday-email` | Helper = e-mail job; no real discovery of data, it re-reads the list the org entered | 3 |
| 22 | Discover finds data automatically | GAP | same | Owner's Discover is what data, where, with whom. Code reads the list, does not discover; discovery is by questions to people | 3 |
| 23 | Discover asks: what data | NOT-EVIDENCED | `dpdp-ai-link/playbook*.ts` not read |  | 3 |
| 24 | Discover asks: where is it | NOT-EVIDENCED | not read |  | 3 |
| 25 | Discover asks: with whom (vendors) | NOT-EVIDENCED | job list has 'List vendors who hold data' (`index.html` sample) | Present as a job, not as a weekly question | 3 |
| 26 | Discover step 2: ask AI 'what changed since last week' | OK | `src/lib/weekly-routine.ts` Discover step 2 |  | 7 |
| 27 | Discover result: new data, people, systems | SMALL-GAP | `src/lib/weekly-routine.ts` | Describes what the AI will say; no stored 'data register' evidenced | 3 |
| 28 | Decide: what to do | SMALL-GAP | job list from RPC per kind | Jobs are pre-made, not decided weekly | 3 |
| 29 | Decide: when (due date) | OK | `ai-link` verb SET_DUE; `JobsTable.tsx` due/late |  | 3 |
| 30 | Decide: who (assign) | OK | verb ASSIGN; `CaClients.tsx` step 4 |  | 3 |
| 31 | Decide as its own screen | MISSING |  | One screen showing what/when/who for the week | 3,4 |
| 32 | Do: tap Mark done | OK | `JobActions.tsx`; `e2e/role-todo-view.spec.ts:28` |  | 3 |
| 33 | Do: Mark done by AI | OK | `api-definition.ts:118,186` MARK_DONE as draft, person confirms | By design a human confirms | 7 |
| 34 | Do: Not mine / give it to someone | OK | `obligation_not_my_job` in `KIND_STAGE` |  | 3 |
| 35 | Do: stuck | OK | `obligation_stuck` |  | 3 |
| 36 | Do: offline save | OK | `DeviceCopy.tsx`, `e2e/device-copy.spec.ts` |  | 9 |
| 37 | Confirm: counts done/open/late | OK | `weekly-routine.ts` `checkCounts` |  | 3,5 |
| 38 | Confirm: independent follow-up by a firm person | GAP | sign-off is by 'the owner' (Confirm step 2 text) | Owner wants independent follow-up by CA/CS/auditor; code says the client owner confirms | 3 |
| 39 | Weekly record of who did what | OK | `dpdp_org_history`, `AuditLogPanel.tsx` |  | 3 |
| 40 | Ageing of open jobs in days | SMALL-GAP | `onepage/JobsTable.tsx:79` 'N days late'; `MyJobs.tsx:16` | Only 'days late' per job; no bucket (0-7, 8-14, 15+), no age since created | 5 |
| 41 | Ageing by person | MISSING | `NotMeWaiting.tsx` exists, not by days |  | 5 |
| 42 | Reminder to person for late job | NOT-EVIDENCED | `device-copy/reminders.ts` counts overdue on device; e-mail rule for late jobs not read |  | 3 |
| 43 | Device reminder notification | OK | `src/lib/device-copy/reminders.test.ts` 'overdue vs due within 3 days' | Only on the person's own device | 3 |
| 44 | Monday e-mail exists | OK | `supabase/functions/dpdp-monday-email/index.ts`, README |  | 3 |
| 45 | Monday e-mail one-click Done / Cannot | OK | `render.ts:117` `ActionLinks done, cannot, neverHadAny` |  | 3,8 |
| 46 | Monday e-mail carries AI work link | OK | `ai-link-email.ts`; `render.ts:138` DO_NOT_FORWARD |  | 7 |
| 47 | Monday e-mail to owners and coordinators | OK | `render.ts:111-112` |  | 3 |
| 48 | Monday e-mail to the Firm about its clients | NOT-EVIDENCED | `dpdp-monday-email` recipients: owners, coordinators; a firm digest not found | Firm weekly summary across clients | 3,5 |
| 49 | Monday e-mail only on Monday, per week key | OK | `dpdp_billing_notice_mark p_week_key` pattern in lifecycle; monday uses digest |  | 3 |
| 50 | Dry run when no key | OK | `dpdp-monday-email/README.md`, `index.ts` dryRun |  | 3 |
| 51 | Deliverable address check | OK | `dpdp-lifecycle-email/index.ts:23` `isDeliverableAddress` |  | 8 |
| 52 | Unsubscribe page | OK | `src/unsubscribe.tsx`, `api.ts:436` | Stops the weekly e-mail; statutory notices continue | 3 |
| 53 | lifecycle-email: trial and renewal reminders | OK | `dpdp-lifecycle-email/index.ts:5-7` | These are billing reminders, not weekly routine | 10 |
| 54 | lifecycle-email send window and catch-up | OK | `index.ts:12-17` |  | 10 |
| 55 | lifecycle-email duplicate risk | SMALL-GAP | TEST-REPORT O-2 | Open | 10 |
| 56 | lifecycle-email cron live | NOT-EVIDENCED | TEST-REPORT: first slot 2026-10-02, not seen running |  | 10 |
| 57 | Monday-email cron live | NOT-EVIDENCED |  |  | 3 |
| 58 | Latency of Edge functions | SMALL-GAP | TEST-REPORT O-3 21 s tails | Open, monitor | 9 |
| 59 | Weekly view in mock | OK | `e2e/weekly-routine-mock.spec.ts` (commit d1761cd0) | See e2e results in summary | 3 |
| 60 | Weekly routine unit tests | OK | `src/lib/weekly-routine` tests in the 800 passing |  | 3 |
| 61 | Missed week shown | OK | `cadence` missed weeks |  | 3,5 |
| 62 | Next run shown | OK | `WeeklyRoutine.tsx` rhythm |  | 3 |
| 63 | Latest log line per stage | OK | `stageLog` |  | 3 |
| 64 | 'Nothing recorded yet' instead of invented run | OK | `weekly-routine.ts:4-5` header | Good: no fake data | 3 |
| 65 | Routine on a phone | NOT-EVIDENCED |  |  | 9 |
| 66 | Routine step text sentence length | SMALL-GAP | `src/lib/weekly-routine.ts`:25-27 | Some sentences are long ('Your device keeps your changes safe, even without internet, and sends them when you are back online') | 4,9 |
| 67 | Routine uses 'owner' for client person and 'owner' for platform owner | SMALL-GAP | `OwnerReview.tsx` vs routine text | Two meanings of 'owner' | 4 |
| 68 | Weekly plan priced weekly | MISSING | see P2-41 |  | 10 |
| 69 | Per-week report for the client | OK | `ai-link` `/report` kinds (`router.ts:472`) |  | 6 |
| 70 | Per-week report for the firm | MISSING |  |  | 5 |
| 71 | Firm can nudge a client's person | MISSING |  | Reminder by firm | 3 |
| 72 | Firm nudge e-mail | MISSING |  |  | 3 |
| 73 | Escalation after N weeks late | MISSING |  |  | 3,5 |
| 74 | Weekly digest of what the AI changed | OK | `render.ts:151` AI actions since last Monday email |  | 7 |
| 75 | Undo of an AI change | OK | `AiUndoConfirm.tsx` |  | 7 |
| 76 | Week boundary definition (Monday, IST) | NOT-EVIDENCED | `dayLine` UTC; routine times shown 'UTC' (`WeeklyRoutine.tsx:13`) | Times in UTC for Indian users | 9 |
| 77 | Statutory notices continue after unsubscribe | OK | `api.ts:436` comment |  | 3 |
| 78 | Grievance officer wording | OK | `grievance-wording.test.ts` |  | rules |
| 79 | Consent recorded/withdrawn counted in Act | OK | `KIND_STAGE` |  | 3 |
| 80 | Organisation-created counted in Discover | OK | `KIND_STAGE` |  | 3 |
| 81 | 'AI link created' counted in Discover | OK | `KIND_STAGE` |  | 7 |
| 82 | Routine for a client org with no jobs yet | NOT-EVIDENCED |  |  | 3 |
| 83 | Routine for a new client in week 1 | NOT-EVIDENCED |  |  | 3 |
| 84 | Weekly sign-off reminder to owner | MISSING |  |  | 3 |
| 85 | Firm sees sign-off per client | MISSING |  |  | 5 |
| 86 | Mapping table kept in code comments | MISSING |  | This document's mapping is the first record | 3 |
| 87 | Rename plan: Act to Do, add Decide | MISSING |  | See design chunk C2 | 3 |
| 88 | Public 'weekly' promise matches product | GAP | `index.html` 'One email a week' | Product promise is e-mail, not routine | 3 |
| 89 | Weekly reports on /ai/ page | OK | `router.ts:488` `REPORT_TITLE` |  | 7 |
| 90 | Law lookup in weekly work | OK | `law.ts`, `router.ts:438` |  | 7 |
| 91 | Hindi weekly text | GAP | AI-LINK report S4 | English only | 9 |
| 92 | Error shown when History fails | OK | `WeeklyRoutine.tsx:41-46` `failed` |  | 9 |
| 93 | Both sources fail | OK | same |  | 9 |
| 94 | Test coverage of weekly e-mail | OK | `supabase/functions/dpdp-monday-email` tests under root `src/lib/services/dpdp-*.test.ts` (111 skipped need DB) | Not run here | 3 |
| 95 | End of P3: week complete, proof kept | SMALL-GAP | rows 18-20 | Sign-off local; no firm-side view | 3,5 |
| 96 | Spare check: routine stage names consistent across e-mail, app, AI page | NOT-EVIDENCED | not compared |  | 3 |
| 97 | Spare check: weekly e-mail link opens routine | NOT-EVIDENCED |  |  | 3 |
| 98 | Spare check: routine screen reachable with keyboard only | NOT-EVIDENCED |  |  | 9 |
| 99 | Spare check: routine contrast | OK | `site-css-contrast.test.ts` (site css only) | App css not covered | 9 |
| 100 | Spare check: public home page promises the same three stages as the app | GAP | `index.html` has no stage names | Home and app do not yet say the same thing | 3 |

### Top 10 faults, ranked by harm

1. Sign-off stored on one device only; server record is an unapplied draft (rows 16, 18, 20, 85)
2. No Decide stage; Act holds Decide's work (rows 2, 8, 28, 31)
3. Confirm is by the client owner, not an independent follow-up by the firm (row 38)
4. Firm cannot nudge a client or see sign-off (rows 70-73, 85)
5. Discover reads the list the org typed; it does not find data (row 22)
6. Wording differs from owner's words in 8 places (rows 3-10)
7. Ageing is per job only (rows 40-41)
8. Monday e-mail wording and firm digest not evidenced (rows 11-12, 48)
9. Times shown in UTC for Indian users (row 76)
10. lifecycle e-mail may resend (O-2, row 55) and cron liveness not evidenced (rows 56-57)

### Organisation-direct path in this process

The routine is the same for both kinds; nothing to hide.


## P4. The dashboards: Firm view and client view (done, pending, with whom, ageing)

Owner points 5 and 6 ask for four things on both views: done, pending, with whom, ageing. Rows 8-10, 15-17, 34-35 and 100 are the answer.

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Firm signs in and lands on a dashboard | OK | `App.tsx:374`; `CaClients.tsx` |  | 5 |
| 2 | Firm dashboard is the first thing seen | SMALL-GAP | `role-todo-view.spec.ts:49` 'CA partner sees the five-step guide and a dashboard across all clients' | Five-step guide is shown first (`CaClients.tsx` HowTo) | 5 |
| 3 | Dashboard heading | SMALL-GAP | `CaClients.tsx:129` 'All your clients at a glance' | 'your' | rules |
| 4 | Card: number of clients | OK | `CaClients.tsx:132` |  | 5 |
| 5 | Card: jobs done across all clients (percent) | OK | `CaClients.tsx:133` | Done only | 5 |
| 6 | Card: signed off count | OK | `CaClients.tsx:134` |  | 5 |
| 7 | Card: need attention (red) and amber | OK | `CaClients.tsx:135` `ragFor` |  | 5 |
| 8 | Pending count across clients | GAP | cards show done %, not 'pending N' | Owner wants done AND pending | 5 |
| 9 | With-whom summary across clients | MISSING | table columns `CaClients.tsx:205` Client, As, Done, Where it is | No column for who holds the pending jobs | 5 |
| 10 | Ageing summary across clients | MISSING | same | No days-late, no bucket | 5 |
| 11 | Per-client row: name | OK | `CaClients.tsx:205` |  | 5 |
| 12 | Per-client row: 'As' (role of the firm) | OK | `CaClients.tsx:205` |  | 5 |
| 13 | Per-client row: done N of M | OK | `CaClients.tsx` `done`,`total` |  | 5 |
| 14 | Per-client row: where it is (stage) | OK | `whereItIs`, from `dpdp_my_clients` | Stage words not read | 5 |
| 15 | Per-client row: pending | GAP |  |  | 5 |
| 16 | Per-client row: oldest late job in days | MISSING |  |  | 5 |
| 17 | Per-client row: who is holding it | MISSING |  |  | 5 |
| 18 | Per-client row: last weekly sign-off | MISSING | see P3-18 |  | 5 |
| 19 | Per-client row: invited/verified state | MISSING | see P2-33 |  | 5 |
| 20 | Sort by worst first | NOT-EVIDENCED | `ragFor` used for cards; sort not read |  | 5 |
| 21 | Filter by status | NOT-EVIDENCED | `FilterChips.tsx` is for the job table, not clients |  | 5 |
| 22 | Open a client | OK | `CaClients.tsx` Open |  | 5 |
| 23 | Back to all clients | NOT-EVIDENCED | `page|clients` view flag `App.tsx:53` |  | 5 |
| 24 | RAG colours have words, not colour only | NOT-EVIDENCED |  |  | 9 |
| 25 | Dashboard is one screen on a laptop | NOT-EVIDENCED |  |  | 9 |
| 26 | Dashboard on a phone | NOT-EVIDENCED |  |  | 9 |
| 27 | Firm dashboard e2e test | OK | `role-todo-view.spec.ts:49`, `year-simulation.spec.ts:67` | Results in summary | 5 |
| 28 | Firm sees data of own clients only | OK | `dpdp_my_clients` RPC; cross-tenant tests live DB (skipped here) | Not run | 5 |
| 29 | Accountant Partner dashboard | MISSING |  | Same as Firm, plus supervising-firm line | 2,5 |
| 30 | Supervising firm sees partner's clients | MISSING |  |  | 2,5 |
| 31 | Client dashboard exists | OK | `OnePageView.tsx`, `MyJobs.tsx`, `DoThisNow.tsx` |  | 6 |
| 32 | Client opens on 'What you have to do' | OK | `MyJobs.tsx` (default view); `role-todo-view.spec.ts:20` | Simple list: good | 6,9 |
| 33 | Client sees done count | OK | `Seal.tsx`, `PartsTrack.tsx` |  | 6 |
| 34 | Client sees pending count | OK | `MyJobs.tsx`, `NotMeWaiting.tsx` |  | 6 |
| 35 | Client sees with whom (person) | SMALL-GAP | `JobsTable.tsx` has owner column in full list | In the simple list the person is shown only for 'mine' | 6 |
| 36 | Client sees ageing | SMALL-GAP | `MyJobs.tsx:16` 'Was due {date} · N days late' | Per job only; no summary | 6 |
| 37 | Client sees late first | OK | `weekly-routine.ts` Act step 1 'late first, then due soon'; `DoThisNow.tsx` |  | 6 |
| 38 | Client sees which firm serves it | NOT-EVIDENCED |  |  | 6 |
| 39 | Client sees its weekly sign-off | SMALL-GAP | device only |  | 6 |
| 40 | Client sees weekly routine panel | OK | `WeeklyRoutine.tsx` |  | 6 |
| 41 | Client dashboard simple for non-experts | SMALL-GAP | `PartsTrack.tsx`, `PolicySection.tsx`, `Timeline.tsx`, `Seal.tsx` all on one page | Many sections | 6,9 |
| 42 | Client sees only own org | OK | `acceptance-70` ROLES; RLS tests live-DB skipped |  | 6 |
| 43 | Role views: owner, staff, group member | OK | `e2e/acceptance-70.spec.ts` ROLES-01..24 |  | 6 |
| 44 | Staff sees only own jobs | OK | AI-LINK report S3; `reminders.test.ts` |  | 6 |
| 45 | Full table reachable | OK | `role-todo-view.spec.ts:37` 'full list is one tap away' |  | 6 |
| 46 | Table grouped by Part with N of M done | OK | `acceptance-70` LAW-12 | Law labels | 6 |
| 47 | Waiting for step before | OK | `MyJobs.tsx:40` 'Waiting for the step before'; LAW-15 |  | 6 |
| 48 | Late tag | OK | LAW-14 |  | 6 |
| 49 | Date format dd Mon | OK | LAW-13 |  | 6 |
| 50 | Nobody looking after a control | OK | `NotMeWaiting.tsx`, ROLES test 'N controls have nobody looking after them' |  | 6 |
| 51 | Seal / certificate | OK | `Seal.tsx` | Do not claim legal effect: not read | 6 |
| 52 | History timeline | OK | `Timeline.tsx` |  | 6 |
| 53 | Audit log | OK | `AuditLogPanel.tsx`, `dpdp-audit` |  | 6 |
| 54 | First-visit wizard | OK | `FirstVisitWizard.tsx` |  | 6 |
| 55 | Role welcome | OK | `RoleWelcome.tsx` |  | 6 |
| 56 | Share ask on decision-makers | OK | `ShareVeridian.tsx`, `brand-share-leak.spec.ts` | Extra page content, owner wants simple | 9 |
| 57 | Brand line on every private page | OK | `BrandLine.tsx` |  | rules |
| 58 | Billing panel on the client dashboard | NOT-EVIDENCED | role gating | Client of a firm should not see a pay screen | 1,6 |
| 59 | PaymentDue notice on the client dashboard | NOT-EVIDENCED | `PaymentDue.tsx` |  | 1,6 |
| 60 | My data / erasure on client dashboard | OK | `MyData.tsx`, `erasure-mock.spec.ts` |  | 6 |
| 61 | AI work link on client dashboard | OK | `AiWorkLink.tsx` anchor `#ai-link-settings` `App.tsx:116` |  | 7 |
| 62 | Dashboard screen text uses no 'my' | GAP | `MyData.tsx` 12, `AiFirstSteps.tsx` 12, `PaymentDue.tsx` 12, `BillingPanel.tsx` 11 hits of your/my | Rule | rules |
| 63 | Dashboard screens use tick boxes | CONFLICT | `AiFirstSteps.tsx:70`, `AiWorkLink.tsx:164,190`, `CaClients.tsx:71` | Settings tick boxes; rule says none | rules |
| 64 | Dashboard says 'host' | OK | no user-facing 'host' found |  | rules |
| 65 | Co-organizer wording | NOT-EVIDENCED | grep 'co-organi' not run |  | rules |
| 66 | Dashboard data fresh | NOT-EVIDENCED | `refetch` after change |  | 4 |
| 67 | Dashboard offline | OK | `DeviceCopy.tsx` |  | 9 |
| 68 | Dashboard for AI (machine view) | OK | `/context`, `/jobs`, `/report` in `router.ts` |  | 7 |
| 69 | Firm report to print | NOT-EVIDENCED |  |  | 5 |
| 70 | Firm CSV export of all clients | MISSING |  |  | 5 |
| 71 | Client CSV export of jobs | OK | `AI-LINK` S4 'CSV' format |  | 6 |
| 72 | Ageing definition (what counts) | MISSING | `daysLate(row, now)` only | Must define: days since due; days since assigned | 5,6 |
| 73 | Ageing buckets agreed | MISSING |  | Recommend 1-7, 8-14, 15+ days | 5,6 |
| 74 | Ageing in the weekly e-mail | NOT-EVIDENCED |  |  | 3,5 |
| 75 | Ageing in the AI report | NOT-EVIDENCED | `renderReportMarkdown` not read |  | 7 |
| 76 | Dashboard load time | NOT-EVIDENCED | TEST-REPORT O-3 tails |  | 9 |
| 77 | Dashboard errors guided | OK | `GuidedError.tsx`, `guided-errors.spec.ts` |  | 9 |
| 78 | Dashboard colour contrast | NOT-EVIDENCED |  |  | 9 |
| 79 | Dashboard keyboard | NOT-EVIDENCED | agent-by-role covers public site |  | 9 |
| 80 | Screen reader names on buttons | OK | all e2e use getByRole |  | 9 |
| 81 | Number of top-level sections on client page | SMALL-GAP | see row 40 |  | 9 |
| 82 | Client sees 'what the firm did this week' | MISSING |  |  | 6 |
| 83 | Firm sees 'what the client did this week' | MISSING |  |  | 5 |
| 84 | Firm sees client's late jobs with names | MISSING |  |  | 5 |
| 85 | Firm sees client's AI link activity | NOT-EVIDENCED | `render.ts:151` is for the person |  | 5,7 |
| 86 | Firm can open client's History | OK | Open client = same page, role as CA partner |  | 5 |
| 87 | CA partner first visit text | OK | `CaPartnerFirstVisit.tsx`; FIRST-10 | '{org} named you as their CA partner' | 5 |
| 88 | Role 'CA partner' inside client org | OK | `acceptance-70` FIRST-10 | Used today when a client org names a CA | 2 |
| 89 | Role 'Accountant Partner' inside client org | MISSING |  |  | 2 |
| 90 | Clients table when zero clients | OK | HowTo step 1 |  | 5 |
| 91 | HowTo five steps | OK | `CaClients.tsx:~143` | Good teaching, simple | 4 |
| 92 | HowTo step 4 manual, one job at a time | SMALL-GAP |  | Slow for 30+ jobs | 4 |
| 93 | Bulk assign | MISSING |  |  | 4 |
| 94 | Client counts cap messages | OK | `billing-state.ts:215` |  | 10 |
| 95 | Done percentage rounding | NOT-EVIDENCED |  |  | 5 |
| 96 | Seal wording 'certificate is ready' | SMALL-GAP | `CaClients.tsx` HowTo 'the certificate is ready' | Claim check: certificate effect not verified | rules |
| 97 | Firm view e2e on mock data | OK | `acceptance-70.spec.ts` |  | 5 |
| 98 | Firm view tested with 100 clients | NOT-EVIDENCED |  |  | 5 |
| 99 | Client view tested with 300 jobs | NOT-EVIDENCED |  |  | 6 |
| 100 | End of P4: both dashboards show done, pending, with whom, ageing | GAP | rows 8-10, 15-17, 34-35 | Done: yes. Pending: client yes, firm no. With whom: firm no. Ageing: per job only | 5,6 |

### Top 10 faults, ranked by harm

1. Firm dashboard has no pending, with-whom or ageing (rows 8-10, 15-17, 100)
2. Five-step guide shows before the dashboard (row 2)
3. Client simple list shows ageing per job only, no summary (rows 35-36)
4. No ageing definition or buckets agreed (rows 72-73)
5. No Accountant Partner or supervising-firm dashboard (rows 29-30, 89)
6. Client page has many sections, not simple (rows 41, 81)
7. Tick boxes and `your`/`my` on dashboard screens (rows 62-63)
8. No firm CSV/report across clients (row 70)
9. Client billing / payment-due visibility for a covered client not evidenced (rows 58-59)
10. Large-account behaviour (100 clients, 300 jobs) not tested (rows 98-99)

### Organisation-direct path in this process

The client dashboard is the same screen for firm-made and directly made organisations; nothing to hide, but 'covered by firm' decides whether billing shows.


## P5. The AI link: AI reads the instruction page, works step by step, stops at payment

Accepted: the verbs in rows 24-31 at the stated levels. Not accepted: anything else (see rows 40-48 for the exact errors the AI sees). Source of the verdicts is mostly the 2026-10-02 live simulation (`AI-LINK-SIMULATION-REPORT.md`) plus code reading; I did not re-run it.

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Person decides to use an AI | OK | `AiWorkLink.tsx`, `AiFirstSteps.tsx` |  | 7 |
| 2 | Link is made by a signed-in person only | OK | `dpdp_ai_link_create` as person (AI-LINK-SIMULATION-REPORT setup) |  | 7,8 |
| 3 | AI link tied to the verified e-mail of the person | OK | same, JWT email claim |  | 8 |
| 4 | Link length choice 1, 7, 30 days | OK | `AiWorkLink.tsx:170-171` |  | 7 |
| 5 | Level 0 read-only is the default | OK | `AiWorkLink.tsx:190` Level 1 is an opt-in box |  | 7 |
| 6 | Level 1 switch is a tick box | CONFLICT | `AiWorkLink.tsx:190` | Owner: no tick boxes | rules |
| 7 | Hide e-mails switch is a tick box | CONFLICT | `AiWorkLink.tsx:164` |  | rules |
| 8 | Link shown once and copied | OK | `AiPasteOptions.tsx`, `copy-prompt.ts` |  | 7 |
| 9 | Two-line paste for the chatbot | OK | `AiWorkLink.tsx:89` fetched from the link itself |  | 7 |
| 10 | Copy page keeps token in URL fragment | OK | `copy-prompt.ts:5-8` | Good: no token in logs | 7 |
| 11 | AI opens `/ai/<token>` | OK | `functions/ai/[[path]].ts`, `_proxy.ts` |  | 7 |
| 12 | First page is the instruction manual | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:48 'This manual. Also at /manual.md and /manual.json' |  | 7 |
| 13 | Short version `?brief=1` | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:48 |  | 7 |
| 14 | Manual states who the AI works for | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:56 `/context` |  | 7 |
| 15 | Manual lists controls | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:63 `/jobs` |  | 7 |
| 16 | Manual gives the playbook per control | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:78 playbook |  | 7 |
| 17 | Manual gives the plain meaning of a law code | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:86 `/law/` | Law text source and currency: not verified here | 7,rules |
| 18 | Manual offers reports | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:93 |  | 7 |
| 19 | Manual offers history | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:101 |  | 7 |
| 20 | Instructions are step by step (one control at a time) | OK | AI-LINK report: 'start with first job', 'Sequence followed in all sessions' | Evidence is the 2026-10-02 simulation, not re-run | 7,4 |
| 21 | The AI works through the weekly routine Discover, Decide, Do | GAP | `playbook.ts`, `brief.ts` not read for stage words; code stages are Discover, Act, Confirm | No evidence that the AI brief follows the weekly routine as a sequence | 3,7 |
| 22 | AI asks the person one question at a time | OK | AI-LINK report S1-S3 |  | 7 |
| 23 | AI offers numbered options | OK | same |  | 7 |
| 24 | Verb NOTE | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:109 | Level 1 | 7 |
| 25 | Verb SET_DUE (owner only) | OK | AI-LINK report: staff 403 'Only the owner can ...' |  | 7 |
| 26 | Verb ASSIGN (owner only) | OK | same | Assign to a stranger is 400 | 7 |
| 27 | Verb MARK_NA | OK | Level 1 list in report |  | 7 |
| 28 | Verb MARK_DONE | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:186 draft only; confirmation link for person | AI cannot finish a job alone: by design | 7 |
| 29 | Other Level 2 verbs OWNER_CONFIRM, MANAGER_CHECK, PARTNER_SIGN, DELETE, ADD_PERSON, REMOVE_PERSON, CHANGE_SIGNER, PUBLISH, EXPORT_PERSONAL_DATA | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:118 | All need a human to confirm | 7 |
| 30 | Owner point 7: AI may do everything a person can except pay | SMALL-GAP | Level 2 list above | AI cannot confirm anything with legal weight. A person's confirmation click is needed. Owner said 'everything a person can do EXCEPT payments' - this is stricter than that; see question Q6 | 7 |
| 31 | AI cannot pay | OK | no payment verb in the list above; `dpdp-pay` needs a signed-in browser session with the Terms box | Confirmed by absence; no test names this | 7 |
| 32 | AI cannot reach `/dpdp-pay` | NOT-EVIDENCED | `functions/ai/_proxy.ts` only forwards to dpdp-ai-link | Not proven by a test | 7 |
| 33 | AI cannot change code or config | OK | AI-LINK report: 'No such path 404; PUT/DELETE 405' |  | 7 |
| 34 | AI cannot add a client organisation | GAP | no verb | Firm cannot ask an AI to add 30 clients | 2,7 |
| 35 | AI cannot send a client invitation | GAP | no verb |  | 6,7 |
| 36 | AI cannot read across clients for a firm | NOT-EVIDENCED | `/org` read-only view for 'CA' (`api-definition.ts:147` mentions CA) | Firm-level AI link across clients not confirmed | 5,7 |
| 37 | Error 400 plain English | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:201 |  | 7 |
| 38 | Error 401 no token | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:202 |  | 7 |
| 39 | Error 403 level or authority | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:203 | 'has legal weight' message seen in report | 7 |
| 40 | Error 404 no such path or control | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:204 | No hint if the job exists in another org | 7 |
| 41 | Error 405 wrong method | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:205; `index.ts:432` 'Use <methods> for this path.' |  | 7 |
| 42 | Error 410 expired or revoked | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:206 | Same answer for guessed link | 7 |
| 43 | Error 413 too large | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:207 | 8 KB limit | 7 |
| 44 | Error 429 rate limit | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:208 120 per minute | Report: 130 burst gave 120 x 200 then 429 | 7 |
| 45 | Error 500 nothing echoed | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:209 |  | 7 |
| 46 | Error body has `error` and a `hint` | OK | `index.ts:86` `fail(status, error, hint)` |  | 7 |
| 47 | Chatbots that can only GET (no POST) | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:220 `GET /drafts?_method=POST&_body=...` | Good design for chat tools | 7 |
| 48 | Draft URL back to the person (`#draft=`) | OK | `App.tsx:71-75`, `e2e/step5-by-role.spec.ts:55` |  | 7 |
| 49 | Person confirms the draft in the browser | OK | `DraftConfirm.tsx` |  | 7,8 |
| 50 | Confirm requires sign-in by e-mail | OK | `DraftConfirm.tsx`, 'sign in and confirm' in `api-definition.ts:117` |  | 8 |
| 51 | Undo link | OK | `AiUndoConfirm.tsx`, `ai_action_undone` in KIND_STAGE |  | 7 |
| 52 | AI actions listed in Monday e-mail | OK | `render.ts:151` |  | 7 |
| 53 | Suggestions pool for improvements | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:125-132 |  | 7 |
| 54 | Phone numbers refused in suggestions | OK | AI-LINK report S1 |  | rules |
| 55 | Link can be revoked by the person | OK | `dpdp_ai_link_revoke` (report S6) | UI button not read | 7 |
| 56 | Revoked and expired look the same | OK | report S6 |  | 7 |
| 57 | Cross-org read blocked | OK | report S7 and `dpdp-cross-tenant-rpc` tests (skipped here) |  | 7 |
| 58 | Cross-org write blocked | OK | report S7 `ai_action` with other `org_id` = 0 |  | 7 |
| 59 | Staff sees only own jobs through AI | OK | report S3 |  | 7 |
| 60 | Emails hidden option | OK | `AiWorkLink.tsx:164` |  | 7 |
| 61 | AI instruction page is not indexed | OK | `robots.txt` `/ai/` disallow; `_headers` noindex; `check-two-doors` (b) |  | 7 |
| 62 | Public pages do not name AI link internals | OK | `check-two-doors` (a) 553 checks pass |  | 7 |
| 63 | Public page tells AI how to sign up | SMALL-GAP | `ai-assistant/index.html`, `agent-by-role.spec.ts` (passes: AI can drive public site to the e-mail step) | The AI stops at the e-mail step, as the owner wants (point 8: e-mail is the basis) | 7,8 |
| 64 | AI can read the public site as text | OK | `public/llms.txt`, `llms-full.txt` | They still describe org-direct (P1-36) | 7 |
| 65 | AI can fill the sign-up form | OK | `agent-by-role.spec.ts` by accessible names |  | 7 |
| 66 | AI can click the e-mailed link | NOT-EVIDENCED | by design the human does it |  | 7,8 |
| 67 | AI can type the e-mailed code | OK | code field exists (`App.tsx:266`) | Person must read the mail | 7,8 |
| 68 | AI instructions for the Firm: add client | MISSING |  |  | 5,7 |
| 69 | AI instructions for the weekly routine | SMALL-GAP | `WeeklyRoutine` Discover step 2 'ask AI what changed since last week' | Only one AI step is named | 3,7 |
| 70 | AI sees ageing | SMALL-GAP | `/jobs` filters; `report` kinds summary, by-person, by-law, by-part | No 'by-age' report | 5,7 |
| 71 | AI report kinds | OK | `router.ts:472-497` `REPORT_TITLE` |  | 7 |
| 72 | AI sees 'with whom' | OK | by-person report |  | 7 |
| 73 | AI marks job done step by step | SMALL-GAP | draft + confirm per job | Each Mark done needs a person click; 30 jobs, 30 clicks | 7 |
| 74 | Batch draft confirm | MISSING |  | One confirm for N drafts | 7 |
| 75 | AI for Accountant Partner: legal points flagged for professional | MISSING |  |  | 2,7 |
| 76 | AI never invents facts | SMALL-GAP | `law.ts` serves law text; 'whether it is in force today' `api-definition.ts:86` | Source text and dates not verified by me | rules |
| 77 | Law codes and dates cite the official source | NOT-EVIDENCED | `law.ts` not read | Must be checked against the Act and Rules | rules |
| 78 | AI link stress: 20 KB body | OK | report: 413 |  | 7 |
| 79 | AI link e2e | OK | `e2e/ai-work-link.spec.ts` in 242 pass |  | 7 |
| 80 | AI link unit tests | OK | `ai-work-link.test.ts`, `ai-proxy.test.ts`, `audit-ai-read-migration.test.ts` |  | 7 |
| 81 | AI link simulation 2026-10-02 verdicts | OK | `AI-LINK-SIMULATION-REPORT.md` S1-S7 PASS | S5 was run by tester, not by the sub-agent | 7 |
| 82 | Simulation re-run for new Firm-first flow | MISSING |  |  | 7 |
| 83 | Hindi | GAP | report S4 |  | 9 |
| 84 | AI link and Moneypenny Chat are different | OK | no Moneypenny code | Chat is to be mounted later; AI link is the product's own | 10 |
| 85 | Chat mount point exists | MISSING | grep: 0 hits |  | 10 |
| 86 | AI link settings anchor `#ai-link-settings` | OK | `App.tsx:112-118` |  | 7 |
| 87 | AI first steps panel | OK | `AiFirstSteps.tsx` | tick box line 70 | 7 |
| 88 | AI paste options | OK | `AiPasteOptions.tsx` |  | 7 |
| 89 | Device copy for AI | OK | `DeviceCopy.tsx` |  | 9 |
| 90 | AI cost to firm | NOT-EVIDENCED |  | Who pays the AI's own tokens: the person's own chatbot | 10 |
| 91 | AI output stored | OK | `ai_action` table (report) |  | 7 |
| 92 | AI tells person when it fails | SMALL-GAP | error text is for the AI; no screen-level 'AI failed' for the person |  | 7 |
| 93 | Error messages the AI sees are short | OK | `supabase/functions/dpdp-ai-link/api-definition.ts`:201-209 |  | 7 |
| 94 | Wrong date format error | OK | report: 'bad date' clean 4xx |  | 7 |
| 95 | Unknown verb error | OK | report 400 |  | 7 |
| 96 | Missing reason error | OK | report |  | 7 |
| 97 | Invalid JSON error | OK | report |  | 7 |
| 98 | Wrong content type error | OK | report |  | 7 |
| 99 | Mangled token | OK | report 410 |  | 7 |
| 100 | End of P5: AI completes the weekly steps and stops at payment | SMALL-GAP | rows 20, 29-30, 35-36 | AI stops at every legal point, not only at payment; no firm-level verbs; no weekly-sequence brief | 7 |

### Top 10 faults, ranked by harm

1. No firm-level AI verbs: add client, invite client (rows 34-35, 68)
2. AI brief not evidenced to follow the weekly Discover-Decide-Do order (row 21)
3. Every Mark done needs a person click, no batch confirm (rows 73-74)
4. Level 1 and e-mail-hide tick boxes (rows 6-7)
5. Owner rule 'AI can do everything except pay' is stricter in code: legal-weight verbs need a person (row 30)
6. No 'by age' report for AI (row 70)
7. Chat mount missing (row 85)
8. Simulation not re-run for Firm-first flow (row 82)
9. Law text source and dates not verified by me (rows 17, 76)
10. English only (row 83)

### Organisation-direct path in this process

The AI link is product-neutral; nothing to hide. `llms.txt` and `/ai-assistant/` still describe the organisation door.


## P6. Payment and Moneypenny credits, receipts, failure and retry, test mode; Moneypenny Chat mount

Direct Razorpay through the IT Services pay frame exists and is well tested. Moneypenny credits and Chat do not exist in this repo.

| # | Step | Rating | Evidence | Gap | Pt |
|---|---|---|---|---|---|
| 1 | Moneypenny credits concept in this repo | MISSING | grep -i moneypenny in `dpdp-app` and `supabase/functions/dpdp-*`: 0 hits | Payment is Razorpay via IT Services pay frame, not credits | 10 |
| 2 | Payee is IT Services by Rajat Agarwal | OK | `pay-frame.ts:1-3` frame on `itservices-rajat-agarwal.pages.dev/payframe/` |  | 10 |
| 3 | No card field on own site | OK | `pay-frame.ts:3`; `razorpay-only.test.ts` |  | 10 |
| 4 | Razorpay window runs in a frame, origin allow-listed | OK | `pay-frame.ts:5-6` |  | 10 |
| 5 | Message from other origin ignored | OK | `pay-frame.ts:6` |  | 10 |
| 6 | Cancel by buyer is silent | OK | `pay-frame.ts` `PayFrameError.cancelled` |  | 10 |
| 7 | Order created by Edge function | OK | `dpdp-pay/README.md` POST /dpdp-pay | Own Razorpay keys on the Edge function | 10 |
| 8 | Order amount from database | OK | README |  | 10 |
| 9 | Plan choice: pack, month, year | OK | `dpdp-pay/logic.ts:35` |  | 10 |
| 10 | Server refuses month/pack for an org with no account | OK | `BillingPanel.tsx` comment `yearOnly` |  | 10 |
| 11 | Client covered by firm has nothing to pay | OK | `BillingPanel.tsx` `coveredByFirm`; `platform-mode.ts:19` | Firm-first billing is partly there already | 1,10 |
| 12 | How a client becomes 'covered by firm' | NOT-EVIDENCED | `account.coveredByFirm` field from RPC; SQL not read | Need to confirm it is automatic for firm-created clients | 1,10 |
| 13 | Terms acceptance before paying | CONFLICT | `BillingPanel.tsx:92,277`; README K3 'Please tick the box to continue' | Tick box, enforced by server (400) | rules |
| 14 | Terms version recorded | OK | `drizzle/0748` |  | rules |
| 15 | Verify endpoint checks Razorpay signature | OK | README `/verify` |  | 10 |
| 16 | Razorpay asked what really happened | OK | README |  | 10 |
| 17 | Webhook HMAC check | OK | README `X-Razorpay-Signature` |  | 10 |
| 18 | Webhook: wrong amount refused | OK | `logic.ts:200` `amount_mismatch` |  | 10 |
| 19 | Webhook: wrong currency refused | OK | `logic.ts:186` `currency_mismatch` |  | 10 |
| 20 | Webhook: wrong org refused | OK | `logic.ts:186` `org_mismatch` |  | 10 |
| 21 | Webhook: unknown order 404 | OK | README |  | 10 |
| 22 | Webhook: duplicate delivery | OK | `dpdp.ledger_event_seen` |  | 10 |
| 23 | Webhook: temporary fault 500 so Razorpay retries | OK | README |  | 10 |
| 24 | Booking idempotent | OK | README 'duplicate' |  | 10 |
| 25 | Second payment flagged | OK | README |  | 10 |
| 26 | Ledger A, B, C carry same id `DPD-dpdp_<attempt>` | OK | README Ledger C |  | 10 |
| 27 | Every Razorpay attempt stored | OK | `dpdp.ledger_payment_attempt` |  | 10 |
| 28 | Fee and GST on fee stored | OK | README |  | 10 |
| 29 | Owner ledger report by month | OK | `POST /dpdp-pay/ledger` |  | 10 |
| 30 | Site summary to central service | OK | README `POST /api/pay/site-summary` | Host not named in what I read | 10 |
| 31 | Commission to central service | OK | README `POST /api/pay/commission` |  | 2,10 |
| 32 | Commission on refunded sale | SMALL-GAP | README: flagged, never cancelled in B | Owner policy decision open | 2,10 |
| 33 | Receipt e-mail | OK | `dpdp-invoice-email`, `payment-proof-mail.ts` | Not run | 10 |
| 34 | Receipt wording and GST | NOT-EVIDENCED |  |  | 10 |
| 35 | Receipt shown on screen | NOT-EVIDENCED | `PaymentDue.tsx` not read line by line |  | 10 |
| 36 | Payment status pill: checking / received / active | OK | `BillingPanel.tsx` `pillLabel` |  | 10 |
| 37 | Failure: window cannot open | OK | `BillingPanel.tsx` `onlineOffNote`: 'Online payment is not available right now. Please try again in a few minutes, or write to PAY_EMAIL' |  | 10 |
| 38 | Failure: Try again button | OK | `onlineOffNote` `setOnlineOff(false)` |  | 10 |
| 39 | Failure: bank declines | NOT-EVIDENCED | Razorpay window shows it; our screen after decline not read |  | 10 |
| 40 | Retry creates a new attempt | OK | README Ledger C |  | 10 |
| 41 | Payment on a phone | NOT-EVIDENCED |  |  | 9 |
| 42 | Online payment live | GAP | TEST-REPORT 2026-10-02: 503 `not_enabled` on both endpoints | State today not checkable from this runner | 10 |
| 43 | Manual claim route when online off | OK | `OwnerPaymentAdmin.tsx`, TEST-REPORT claim tests |  | 10 |
| 44 | Owner approves claim | OK | same |  | 10 |
| 45 | Owner rejects claim | SMALL-GAP | TEST-REPORT O-4 | Open fault | 10 |
| 46 | Approve with no edition | SMALL-GAP | TEST-REPORT O-5 | Cosmetic | 10 |
| 47 | Refund process | MISSING | TEST-REPORT 'no refund code exists'; `public/refund/index.html` policy | Policy only | 10 |
| 48 | Test mode flag from database | OK | `platform-mode.ts:1-11` |  | 10 |
| 49 | Test banner on app pages only | OK | `platform-mode.ts:15` `showTestBanner` |  | 10 |
| 50 | Test payment only for a test account not covered by firm | OK | `platform-mode.ts:19-21` |  | 10 |
| 51 | No real e-mail in Test mode | OK | `platform-mode.ts:6` banner text; e-mail gate `email-off.test.ts` |  | 10 |
| 52 | Razorpay test keys | NOT-EVIDENCED | Edge secrets |  | 10 |
| 53 | Mock billing e2e | OK | `e2e/billing-mock.spec.ts` in 242 pass |  | 10 |
| 54 | Billing state unit tests | OK | `billing-state.test.ts` |  | 10 |
| 55 | Pay logic unit tests | OK | root `src/lib/services/dpdp-pay-logic.test.ts` (not run here) |  | 10 |
| 56 | Pay ledger tests | OK | `dpdp-pay-ledger.test.ts` (not run here) |  | 10 |
| 57 | Access never locks | OK | TEST-REPORT scan test | Product rule; `needsPayment` includes LOCKED state name | 10 |
| 58 | State name LOCKED exists in code | SMALL-GAP | `BillingPanel.tsx` `state === 'LOCKED'` | Name conflicts with 'access never locks'; check meaning | 10 |
| 59 | Price shown inc/exc GST | NOT-EVIDENCED |  |  | 10 |
| 60 | Festive offer wording | OK | `offerLabel` |  | 10 |
| 61 | Money formatting | OK | `formatRupees` |  | 10 |
| 62 | Per-client extra price | OK | `billing-state.ts:208-212`; drizzle 0756 'extra client price rs50' | Number comes from DB, not printed by me | 10 |
| 63 | Who may open the billing panel | NOT-EVIDENCED | role gate not read | Must be firm owner only | 1,10 |
| 64 | AI cannot open billing | OK | no verb; Level 2 list |  | 7 |
| 65 | Payment in the Firm's page | NOT-EVIDENCED |  |  | 10 |
| 66 | Payment for Accountant Partner | MISSING |  |  | 2,10 |
| 67 | Moneypenny credit purchase | MISSING |  |  | 10 |
| 68 | Credits spent on plan | MISSING |  |  | 10 |
| 69 | Credit balance on screen | MISSING |  |  | 10 |
| 70 | Credits shared across other products | MISSING |  | Same credits as other products needs the central service API | 10 |
| 71 | Commission paid in credits | MISSING | `partner.ts` rupees and TDS | Today a cash payout with TDS statement | 2,10 |
| 72 | Partner payout run (monthly, 11th) | OK | `dpdp-partner-email` job statements on the 11th 09:00 IST |  | 2 |
| 73 | Payable after N days | OK | `SalesPartner.tsx:263` |  | 2 |
| 74 | Partner terms version | OK | `SalesPartner.tsx:207` | Tick box | rules |
| 75 | TDS shown | OK | `partner.ts:statementCsv` |  | 2 |
| 76 | Commission rate 20% yearly | SMALL-GAP | `SalesPartner.tsx:~192` | Rate printed in a screen string; check it comes from the DB (`d.` fields used elsewhere) | 2,10 |
| 77 | Moneypenny Chat mount point | MISSING | grep 0 hits; `src/main.tsx`, `App.tsx` not mounting any chat | Needs a no-op container + one config flag | 10 |
| 78 | Chat mount does not break pages if absent | NOT-EVIDENCED |  | A no-op must render nothing | 10 |
| 79 | Chat on public pages | MISSING |  |  | 10 |
| 80 | Chat on firm dashboard | MISSING |  |  | 10 |
| 81 | Chat on client dashboard | MISSING |  |  | 10 |
| 82 | Chat respects the wall (no token leaks) | NOT-EVIDENCED | `check-two-doors` would need to learn the chat |  | 10 |
| 83 | CSP allows later chat script | NOT-EVIDENCED | `public/_headers` not read |  | 10 |
| 84 | Payment e-mail from one address | OK | `PAY_EMAIL` constant; `mail-outbound.ts` |  | 8 |
| 85 | Payment text has no 'my/your' | GAP | `BillingPanel.tsx` 11, `PaymentDue.tsx` 12 hits |  | rules |
| 86 | Receipts to the e-mail of payer | NOT-EVIDENCED |  |  | 8 |
| 87 | Invoice number format | NOT-EVIDENCED |  |  | 10 |
| 88 | Currency INR only | OK | `currency_mismatch` rule |  | 10 |
| 89 | Payment audit trail | OK | ledger C |  | 10 |
| 90 | Owner pay admin | OK | `OwnerPaymentAdmin.tsx` |  | 10 |
| 91 | Owner accounts admin | OK | `OwnerAccountsAdmin.tsx` |  | 10 |
| 92 | Payment page text sentence length | NOT-EVIDENCED |  |  | 4 |
| 93 | Payment steps count for a firm | SMALL-GAP | choose plan, tick, pay, wait, receipt | Could be 2 steps | 4 |
| 94 | Trial pack up to N clients | OK | `billing-state.ts:195` |  | 10 |
| 95 | Weekly plan | MISSING | P2-41 |  | 10 |
| 96 | Firm pays for client, client sees 'covered' | OK | `coveredByFirm` |  | 1,6 |
| 97 | Client sees what firm paid | NOT-EVIDENCED |  |  | 6 |
| 98 | Payment errors for AI | OK | AI has no payment path |  | 7 |
| 99 | Payment e2e in real browser with Razorpay | NOT-EVIDENCED | only mock; live Razorpay not run |  | 10 |
| 100 | End of P6: firm pays with credits, receipt, credits commission | GAP | row 1 and the Moneypenny rows above | Razorpay path works; credits layer absent | 10 |

### Top 10 faults, ranked by harm

1. No Moneypenny credits: purchase, balance, spend (rows 1, 67-70)
2. Commission paid as cash with TDS (row 71)
3. No Chat mount (rows 77, 79-81)
4. Terms tick box, server enforced (row 13)
5. Online payment was off live on 2026-10-02 and I cannot check today (row 42)
6. No refund code, policy only (row 47)
7. Claim reject/approve faults O-4, O-5 (rows 45-46)
8. State name LOCKED vs 'access never locks' (row 58)
9. No weekly plan (row 95)
10. Payment copy uses `your`/`my` (row 85)

### Organisation-direct path in this process

Institution plan is payable online by an organisation itself (`BillingPanel.tsx`, `Screens.tsx:241`). Under firm-first it should be hidden unless the switch is on, while `coveredByFirm` keeps working.

