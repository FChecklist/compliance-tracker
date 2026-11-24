# DPDP firm-first design check (task D1, 24 Nov 2026)

BOSS's model, checked against the code at head `d1761cd0`. Evidence and row numbers: `DPDP-FLOW-100.md`. Nothing here was built.

**Verdict: adopt the model. I found no real problem with it.** Two things need an owner answer first: how Moneypenny credits are reached (the central service contract is not in this repo), and what "the client's paid weekly plan" means for commission (there is no weekly plan, only trial pack, month and year).

## The model

One door called Partner, three kinds of seller on the same screens:

- **Firm** (CA, CS, auditor, lawyer): can sign off reports and give advice.
- **Accountant Partner** (non-CA accountant or bookkeeper): runs the weekly Discover, Decide, Do routine as a reminder and follow-up service. May not sign statutory reports or give legal opinions. Anything of that kind reads "for a professional to confirm" and can link to a supervising Firm by e-mail invitation (optional).
- Both buy with Moneypenny credits, add clients by e-mail, and earn commission in Moneypenny credits on each client's paid plan.
- The client gets an e-mail invitation, verifies by e-mail, and sees only its own dashboard.

## What already exists

| Need | What exists | Evidence |
|---|---|---|
| E-mail sign-in, no password, typed code beside the link | yes; no password or Google code anywhere | `App.tsx:254-268`; grep `signInWithPassword`/`oauth` in `src`: none |
| Firm account with a kind of firm | yes: CA, CS, cost accountant, legal, audit | `Screens.tsx:224-228` |
| Firm adds a client, optionally with the client owner's e-mail | yes | `CaClients.tsx:23-80`, `api.ts:149` `dpdp_create_client_org` |
| Firm opens each client's file; role "CA partner" inside the client | yes | `CaClients.tsx`; `acceptance-70` FIRST-10 |
| Firm dashboard: clients, done %, signed off, need attention (red/amber) | yes | `CaClients.tsx:129-136` |
| A client covered by its firm pays nothing itself | yes | `BillingPanel.tsx` `coveredByFirm`; `platform-mode.ts:19` |
| Sales Partner programme open to anyone with a sign-in; 20% of yearly payment; monthly statements; TDS; payout | yes (in rupees) | `SalesPartner.tsx:~192, 255-289`; `partner.ts`; `dpdp-partner-email` |
| Payee IT Services by Rajat Agarwal via Razorpay pay frame | yes | `pay-frame.ts:1-3` |
| Full payment ledger A/B/C, webhook, retry, test mode | yes | `dpdp-pay/README.md`; `platform-mode.ts` |
| Weekly routine screen with three stages and rhythm strip | yes (Discover, Act, Confirm) | `WeeklyRoutine.tsx`, `weekly-routine.ts` |
| Monday e-mail with one-click Done / Cannot and AI link | yes | `dpdp-monday-email/render.ts:117-138` |
| AI link, levels 0/1/2, drafts, undo, rate limit, clean errors | yes; cannot pay | `dpdp-ai-link/api-definition.ts`; `AI-LINK-SIMULATION-REPORT.md` |
| Client simple "What you have to do" list with "N days late" | yes | `onepage/MyJobs.tsx:16` |
| Test mode and banner | yes | `platform-mode.ts` |

## What is missing or in conflict

1. **No hidden switch for the organisation-direct path**, and it is the front door today (`index.html:133`, `/dpdp-institution/`, `?edition=institution`, `Screens.tsx:300-303`). The build checker requires the institution page (`public-surface.mjs:278,305-317`), so hiding it needs a checker change in the same step.
2. **No Accountant Partner kind.** Account type is `firm | institution` only (`billing-state.ts:87`). The Sales Partner route exists but is not tied to running the weekly routine for clients.
3. **No supervising-Firm link**, no "for a professional to confirm" label, no rule that an Accountant Partner cannot sign. The Level 2 verb `PARTNER_SIGN` exists (`api-definition.ts:118`) but nothing checks the kind of seller.
4. **No Moneypenny anything**: no credits, no balance, no purchase, no commission in credits, no Chat mount. Zero grep hits.
5. **No Decide stage.** Code: Discover, Act, Confirm. Owner: Discover, Decide, Do.
6. **Firm dashboard lacks pending, with whom, ageing.** Client list lacks a summary of the same four things.
7. **Weekly sign-off is on one device only**; server table is a draft (`docs/proposed-migrations/0760_dpdp_weekly_run.sql`).
8. **No client invitation e-mail evidenced**; the add-client form says nothing is e-mailed yet.
9. **Home page has none of the owner's message.**
10. **Tick boxes** in five places and enforced by `dpdp-pay` (K3). **"your"/"my"** in about 15 files.
11. **No firm-level AI verbs** (add client, invite client) and no batch confirm.

## Mapping of the owner's words to code (for the rename)

| Owner | Code today | Plan |
|---|---|---|
| Discover: what data, where, with whom | Discover (id `know`) | keep name; add the "with whom" question to the AI brief and routine text |
| Decide: what to do, when, who | none (inside Act steps 1-2 and Discover step 3) | add a stage `decide`; move SET_DUE and ASSIGN into it |
| Do: confirm it is done | Act (do the jobs) and Confirm (id `check`, the proof) | name Act "Do"; keep a short "confirm" step inside it |

## Smallest set of changes

- One build-time flag `VITE_ORG_DIRECT` (default off) read in one file (`src/lib/org-direct.ts`) that gates the door, the page, the sitemap entry, the `llms.txt` line, the account-opening button and the institution price line. Code, RPCs and Edge functions stay. Existing organisation accounts keep working.
- Accountant Partner = a new value of the practice kind plus a `can_sign_off=false` flag, no new product, no new screens. Drafted as a proposed migration in `docs/proposed-migrations/`, as 0760 was; the owner applies it.
- Reuse the existing commission mechanism; only the payout currency changes, and only once the central credits service is known.
- Reuse `coveredByFirm` for "the firm pays".
- Add four fields to the client list RPC (pending, oldest days late, who holds most, last sign-off) and one pure `ageing.ts` shared by both dashboards.

## Build chunks (about USD 3 each)

Each chunk ends with `bun run typecheck`, `bun test`, `bun run build`, and the mock e2e specs it touches. Falsifiability: each new test is shown to fail with the change reverted.

| # | Chunk | Files | Tests |
|---|---|---|---|
| C1 | Hide organisation-direct behind one switch | new `src/lib/org-direct.ts`; `Screens.tsx`; `landing.ts`; `index.html`; `dpdp-institution/index.html`; `scripts/build-sitemap.mjs`; `src/lib/public-surface.mjs`; `public/llms.txt`; `CaClients.tsx` (keep institution client) | unit for the flag; e2e: no org door, `?edition=institution` ignored, firm can still add an institution client; public-surface and sitemap tests for both flag values |
| C2 | New home page with the bait message, three sellers, no "my/your" | `index.html`; `home.css`; `facts.mjs`; `public-surface.mjs`; `dpdp-firm/index.html` | `public-wording.test.ts`, `check-claims`, `home-themes.test.ts`, new wording test (no my/your); every penalty/date line carries a cited official source or is left out |
| C3 | Accountant Partner kind and "for a professional to confirm" | `Screens.tsx`; `partner/index.html`; `SalesPartner.tsx`; `api.ts`; `rpc-types.ts`; `docs/proposed-migrations/0761_*.sql`; AI brief text | form test; mock-client scenario; e2e: accountant sign-up, sign-off buttons show the label |
| C4 | Supervising-Firm invitation by e-mail | new RPC draft; `supabase/functions/dpdp-partner-email` (reuse); small UI in `SalesPartner.tsx` or firm page | unit for invitation states; e2e mock |
| C5 | Client invitation by e-mail as the default, statuses invited / verified / started | `CaClients.tsx` (remove tick box, e-mail first); `api.ts`; invitation e-mail in an existing function; RPC draft | form tests; e2e: add client, see "invited", then "started" in the mock |
| C6 | Rename to Discover, Decide, Do; mapping in code | `weekly-routine.ts`; `WeeklyRoutine.tsx`; `dpdp-monday-email/render.ts`; AI brief | update `weekly-routine` tests and `weekly-routine-mock.spec.ts`; a test that no screen still says "Act" or "Confirm" as a stage name |
| C7 | Firm dashboard: pending, with whom, ageing, last sign-off | `CaClients.tsx`; new `ageing.ts`; `api.ts`; RPC draft; `rpc-types.ts` | `ageing.test.ts` (buckets 1-7, 8-14, 15+ days late, to be confirmed by owner); e2e on mock with late jobs |
| C8 | Client dashboard: four-card simple view (done, pending, with whom, ageing) | `onepage/OnePageView.tsx`; `MyJobs.tsx`; `ageing.ts` | component tests; `role-todo-view.spec.ts` update |
| C9 | Server weekly sign-off (apply the 0760 draft after owner OK) and firm weekly digest | `docs/proposed-migrations/0760*`; `WeeklyRoutine.tsx`; `dpdp-monday-email` | migration replay test in PGlite; e2e |
| C10 | Tick boxes to a plain notice line with Terms link | `TermsBox.tsx`; `BillingPanel.tsx`; `Screens.tsx`; `SalesPartner.tsx`; `CaClients.tsx`; `AiWorkLink.tsx`; `AiFirstSteps.tsx`; `dpdp-pay` K3 rule; `terms.ts` | `terms-acceptance.test.ts` rewritten; server test for the notice version being recorded |
| C11 | Moneypenny Chat mount (no-op) | new `MoneypennyChatMount.tsx`; `App.tsx`; `public/_headers`; `check-two-doors.mjs` | renders nothing when off; wall test still green; mount appears when a flag and a script URL are set |
| C12 | Moneypenny credits: payment adapter | `pay-frame.ts` sibling; `dpdp-pay`; `BillingPanel.tsx` | mock adapter tests; blocked until Q9 is answered |
| C13 | Commission in credits (Firm and Accountant Partner) | `dpdp.referral_commission` flow; `partner.ts`; `SalesPartner.tsx` | blocked until Q4, Q9 |
| C14 | AI firm verbs (add client, invite client) and batch confirm; weekly-order brief; re-run the AI simulation | `dpdp-ai-link/*`; `DraftConfirm.tsx` | router tests; e2e `ai-work-link.spec.ts`; new simulation report |
| C15 | Wording sweep: "my/your", "host" to "co-organizer" | components, `index.html`, `dpdp-firm/index.html` | wording test over the built site and `src` strings |

Order: C1, C2, C6, C7, C8, C3, C5, C4, C10, C11, C9, C14, C15, then C12 and C13 once the owner answers. About 15 chunks, about USD 45 in all.

## Risks

- **Legal.** An Accountant Partner must not sign statutory reports or give legal opinions. Enforce in the database (sign verbs refused for that kind), not only in text. Counsel should read the "for a professional to confirm" wording.
- **Tick boxes.** The K3 box exists in `dpdp-pay` on purpose (`drizzle/0748`). Replacing it with a notice line changes what evidence of consent is kept. The owner's rule wins, but get the notice text and version recording agreed first.
- **Facts.** No penalty figure or date goes on a page unless it is copied from the official Act or Rules text with the source cited. I did not verify "13 May 2027" (already on the firm page) and printed no numbers.
- **Hiding is not removing.** Existing organisation accounts, their billing and reminders keep running. The institution page file stays, with `noindex`, so old links do not 404.
- **Build gate.** `check-public-surface` expects the institution page; C1 must change it in the same commit or the build fails.
- **Self-referral.** A firm earning commission on its own clients is different from referring strangers. Confirm the commission rules cover this (Q4).
- **Database changes by hand.** Proposed migrations are applied outside Drizzle's journal (see `CLAUDE.md`); the owner applies them. Draft SQL is not tested against the live schema.
- **Edge e-mail.** The auth hook is inert until enabled (commit `ebdb1a7f`). Invitations depend on it or on Resend being set.
- **Moneypenny is unknown to this repo.** Any design of C12/C13 is a guess until the contract is shown.
- **Latency.** Earlier report O-3 saw 21 s tails on Edge functions; a firm with many clients may feel it.
- **SQL not read.** I read no RPC bodies. Rows that depend on them are NOT-EVIDENCED.

## Questions for the owner, with a recommended answer

| # | Question | Recommended answer |
|---|---|---|
| Q1 | Where should the one switch for the organisation path live? | One build-time flag `VITE_ORG_DIRECT`, default off. Simple, visible in one file, no database needed. |
| Q2 | What happens to organisations already signed up directly? | They keep working. Only new direct sign-up is hidden. |
| Q3 | What is "the client's paid weekly plan"? Today there is only trial pack, month, year. | Keep month and year. "Weekly" is the routine, not the billing. Commission follows the client's paid plan. Do not add a weekly price unless you give one. |
| Q4 | Same commission for Firm and Accountant Partner? Does a firm earn on its own clients? | Same rate as today (read from the database, not typed in code), for both. Decide on own clients; recommend yes, paid on the client slot the firm buys. |
| Q5 | Who pays for the client: firm or client? | The firm, using `coveredByFirm`. The client sees "covered by your firm" style text (without "your"). |
| Q6 | AI may do everything a person can except pay. Today legal-weight actions need a person click. | Keep the person click for sign-off, delete and publish; allow one confirm for a batch of drafts. Tell me if you want less. |
| Q7 | May an Accountant Partner sign off? | No. Enforce in the database; show "for a professional to confirm". |
| Q8 | Tick boxes: how is Terms acceptance kept as evidence? | A plain line "By paying you accept the Terms" with the link; record the Terms version on the payment attempt. Counsel to approve. |
| Q9 | What is the Moneypenny credits contract (endpoints, rate, how a spend is confirmed)? | Share the central service spec. Build an adapter behind a flag against a mock first. |
| Q10 | Keep Google sign-in? | None exists in this app. Do not add one. |
| Q11 | Which official sentences may go on the home page about penalties and dates? | You or counsel pick the exact lines from the Act and Rules; I copy them with the source link. Until then use only "Penalties are high." |
| Q12 | What about `/dpdp-institution/`? | Keep the file, remove from sitemap and `llms.txt`, add `noindex`, show nothing in navigation. |
| Q13 | Ageing buckets? | 1-7, 8-14, 15 or more days late, counted from the due date. |
| Q14 | Weekly sign-off: by the client owner or by the firm? | By the firm (independent follow-up) with the client owner's confirmation shown beside it. |
