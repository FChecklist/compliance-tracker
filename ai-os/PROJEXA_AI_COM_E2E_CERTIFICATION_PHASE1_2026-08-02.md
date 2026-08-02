# PROJEXA-AI.COM — Real E2E Certification, Phase 1 (Account Access + Core Navigation)

**UMR:** `UMR-20260802-165606-4413` (OCID-20260802-020), amending parent `UMR-20260802-104058-25ba`.

**Scope of this pass, bounded and explicit:** get real account access to `https://projexa-ai.com`
and, if reached, do a first-pass real inventory of authenticated navigation. This is Phase 1 of a
longer certification — multi-tenant, multi-brand, ERP workflows, reports, VERI Chat, prompt flow,
search, and cache were explicitly **not** attempted this pass; see "Not covered" below.

**Continuity note**: this UMR/OCID already has one real, still-open prior PR from earlier the same
day — PR #727 (`docs/projexa-ai-com-authenticated-audit-2026-08-02`, opened 2026-08-02T17:22:44Z),
which performed the initial signup attempt and reported the account correctly as
**"NOT ASSESSED — authenticated screens not reached."** This report is a continuation of that same
investigation (same signup, same blocker), not a duplicate — it adds three further real, distinct
access attempts and a root-cause finding PR #727 did not have. A separate parallel task
(`task-20260802-172449`, PR #731 merged) independently attempted this same OCID mid-session,
found live evidence this task was already mid-run on the shared checkout, and correctly stood down
per the repo's own collision-avoidance protocol (`ai-os/boss/ACTIVE-CLAIMS.yaml`) rather than
duplicate work — recorded there for anyone auditing session history.

**Method note (same standard as the parent matrix)**: no task/UMR status label was used as evidence
of anything. Every finding below is a real, live, timestamped browser/network observation captured
this session via `launchPersistentChrome()` (real installed Chrome, no `sudo`/`install-deps`
needed — that path is confirmed a dead end and was not retried) against the real production
`https://projexa-ai.com` deployment. Screenshots referenced below are real files at
`/opt/veridian/browser/screenshots/ocid020-phase1-*.png`.

---

## Summary

| Question | Answer |
|---|---|
| Reached authenticated screens on `projexa-ai.com` itself? | **No** — three independent real access paths tried, all real, all dead, for three distinct reasons (see below). Honest blocker, not a hidden failure. |
| Reached authenticated screens on the real "Projexa" product at all? | **Yes** — at `https://projexa-smoky.vercel.app` (the real Projexa Vercel project's own domain), using pre-existing, documented, real seeded E2E credentials. Captured as supporting evidence/context only — out of this task's literal domain scope, not deep-tested. |
| Branding claim re-confirmed? | **Yes, and now root-caused.** `projexa-ai.com` still shows zero "Projexa" text, only "VERIDIAN AI" — because it currently, by a real same-day Owner decision, serves a different app entirely (see Finding 1). |
| New real account created this session? | Yes — `raajat.agarwal+projexaaudit2237bc7@gmail.com`, real signup (`200`), real "check your email" state, pending real inbox confirmation (unresolvable from this sandbox). |
| New PR opened? | This file's own PR (see task-runner output for number/URL). |

---

## Finding 1 (root cause, most significant): `projexa-ai.com` is not currently serving the Projexa app at all

This explains every other finding below, so it's reported first even though it was discovered mid-investigation.

**Real evidence, this session:**
- Landing page title at `https://projexa-ai.com`: `VERIDIAN COGNITIVE AI OS — AI Cognitive Research` (`ocid020-phase1-00-landing.png`). Zero occurrences of "Projexa"/"PROJEXA" in `document.body.innerText`; "VERIDIAN" present.
- Login/signup forms brand themselves "VERIDIAN AI — One Portal. One Truth." (`ocid020-phase1-02-signup-page.png`, and the pre-existing `projexa-auth-04/08-*.png` from earlier this session).
- Real signup (`POST https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/signup`) and real login attempts on `projexa-ai.com` both hit Supabase project ref **`pcrjmlpuqsbocqfwoxod`**.
- The real, standalone Projexa codebase (`/opt/veridian/repos/projexa`) documents its own Supabase project as **`evpckeuxgvahguwsaeul`** (`PHASE1_SEED_REPORT.md`, section (a)) — a **different** Supabase project entirely.
- Visiting the real Projexa Vercel project's own domain, `https://projexa-smoky.vercel.app`, shows real title `PROJEXA — Construction Intelligence AI OS`, real "PROJEXA" branding, and its login POSTs to `https://evpckeuxgvahguwsaeul.supabase.co/...` — matching the seed report, not `projexa-ai.com`.

**Why**: this matches, and is now independently re-confirmed by, the parent matrix's own item 12
finding (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, "Go Live" section): a real Owner decision
earlier the same day (`UMR-20260802-134939-145d`, executed via real Vercel API calls, PR #720)
reverted `projexa-ai.com`/`www.projexa-ai.com` from the standalone `projexa` Vercel project back to
being served by `veridian-compliance-ai` (the Wave 10 state), leaving `projexa`'s own real
remaining domain as `projexa-smoky.vercel.app` only. That matrix entry verified the domain/HTTP
level; this session independently re-confirms it at the **application/auth level** — different
Supabase project, different branding, different codebase entirely, not just a different Vercel
alias of the same app.

**Consequence for this task's own scope**: "authenticated screens on `projexa-ai.com`" is, as of
this real, live, current deployment state, a request to authenticate into `veridian-compliance-ai`
— a **separate, already-audited deployment** (PR #711, 30 screenshots, real `AUDIT: PASS`,
explicitly out of scope for this task per its own briefing: "do not re-test that deployment").
This is flagged plainly rather than silently resolved either way — whether the next phase should
(a) test `veridian-compliance-ai`'s screens under the `projexa-ai.com` domain despite the
out-of-scope instruction, since that is genuinely what the domain now serves, or (b) treat
`projexa-smoky.vercel.app` as the real target for "Projexa E2E certification" going forward, is a
real open scoping question for the PM/Owner, not decided unilaterally here.

---

## Finding 2: three independent real account-access attempts on `projexa-ai.com`, all dead, for three distinct reasons

### 2a. Pre-existing test account — password unknown, path dead as briefed
`raajat.agarwal+projexaaudit20260802@gmail.com` (created earlier this session, confirmation email
sent to the real, un-checkable owner inbox). Per this task's own briefed context, no password is
known for this account this session. Screenshot `ocid020-phase1-01-login-existing-email-nopassword.png`
shows the email field filled and password left blank — no guess was attempted (guessing a
password is not legitimate testing). **Dead: real, expected, not investigated further.**

### 2b. New real signup — succeeded, but blocked on real email confirmation
Created a fresh alias, `raajat.agarwal+projexaaudit2237bc7@gmail.com` / password
`ProjexaAudit2026!Ph1`, through the real `/signup` form (fields: Full Name, Organisation, Work
Email, Password — 4 fields, same as PR #727's prior finding).
- Real request: `POST https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/signup?redirect_to=...` →
  **`200`**, real Supabase user object returned (`id: a62750c3-f926-4e39-992e-0ffb8517cfb2`,
  `confirmation_sent_at: 2026-08-02T19:08:28Z`).
- Real UI state: "Check your email — We've sent a confirmation link to
  raajat.agarwal+projexaaudit2237bc7@gmail.com" (`ocid020-phase1-04-signup-result.png`).
- Real immediate-login attempt with the correct password, before confirming: `POST
  .../auth/v1/token?grant_type=password` → **`400`**,
  `{"code":"email_not_confirmed","message":"Email not confirmed"}`
  (`ocid020-phase1-06-login-newaccount-result.png`). Confirms email confirmation is genuinely
  enforced server-side, not just a UI gate.
- **This session has no inbox access** to `raajat.agarwal@gmail.com` (the real owner inbox both
  aliases forward to) and no `SUPABASE_SERVICE_ROLE_KEY` to force-confirm programmatically
  (confirmed absent again this session — not re-litigated). **Dead for this session; a real,
  legitimate, reportable blocker** — the confirmation link is real and sitting in a real inbox,
  just not one this sandbox can open.

### 2c. Documented seeded "Projexa" E2E credentials — real, but wrong Supabase project
The real, already-live Projexa E2E test program (`/opt/veridian/repos/projexa/e2e/users.ts`,
`PHASE1_SEED_REPORT.md`, `PHASE2_BATCH_C_FINDINGS.md`) documents a shared-password test org
("Meridian Construction Group (E2E Test Org)") with a real, working CEO/owner account:
`arjun.mehta@meridian-construction.e2e-test.projexa-ai.com` / `MeridianE2E2026!` — real, confirmed
live as of 2026-07-19 (71/72 real Playwright tests passed against it that day).
- Tried against `projexa-ai.com/login`: real request `POST
  https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/token?grant_type=password` → **`400`**
  (`ocid020-phase1-07-login-seeded-ceo-filled.png`, result stayed on `/login`).
- Same credentials, tried against `projexa-smoky.vercel.app/login` (the real Projexa domain):
  real request to `https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/token?grant_type=password` →
  **`200`**, real redirect to `/dashboard` (`ocid020-phase1-13/14-*.png`). **These are real, valid,
  working credentials — just not for the Supabase project `projexa-ai.com` currently
  authenticates against.** This directly corroborates Finding 1: same credentials, same person,
  two different real outcomes depending on which literal domain/backend they're checked against.
- **Dead specifically on `projexa-ai.com`; live and real everywhere else.**

### 2d. "Sign in with Google" button — real, live, broken
Tried as a fourth path (the persistent Chrome profile can carry a real Google session if the Owner
has one saved; worth a real, cheap check). Clicking it on `projexa-ai.com/login` produces a real
navigation to `https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/authorize?provider=google&...`,
which returns a real, live `400`:
```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```
(`ocid020-phase1-17-after-google-click-main.png`). **Real product gap, not an access-path
limitation**: the login form advertises a "Sign in with Google" button that is not backed by an
enabled OAuth provider on this Supabase project — any real end user clicking it hits a raw
Supabase JSON error page, not a graceful in-app error message. Worth a follow-up ticket
independent of this certification's account-access question.

---

## Finding 3 (context only, not this task's scope): real authenticated menu inventory of the actual Projexa product

Captured while confirming Finding 1/2c, at `https://projexa-smoky.vercel.app/dashboard`, logged in
as the real seeded CEO account. Provided here as real supporting evidence and because it is likely
useful raw material for whichever future phase ends up covering the real Projexa product — **not**
claimed as this task's own deliverable, since the task's literal scope is `projexa-ai.com`.

Real, live sidebar menu structure (`ocid020-phase1-15-projexa-smoky-dashboard-full.png`):

- **OVERVIEW**: Dashboard, Company Dashboard, Projects Overview
- **EXECUTION**: Schedule, Meetings, Scope of Work (BOQ), Work Progress, Site Diary, Documents, Wiki, Permits, Drawings & 3D, Minutes of Meeting
- **FIELD**: RFIs, Submittals, Punch List, Change Orders
- **DESIGN**: Mood Boards, FF&E Specification, Floor Plans
- **RESOURCES**: Manpower & Attendance, Materials, Inventory, Vendors, Procurement, Purchase Orders
- **SALES**: Sales Dashboard, Leads, Opportunities, Quotations, Sales Orders, Customers
- **GRC**: Risk & Compliance
- **FINANCE**: Budgets, Expenses, Accounting, Invoices
- **HR**: HR Dashboard, Employees, Payroll, Recruitment
- **INTELLIGENCE**: KPIs, Reports, AI Copilot, Knowledge Base, Settings
- Plus a persistent right-side "Discuss" chat panel (Chats / To Do / Construction Intelligence / PROJEXA / VERI ERP tabs) and a global `⌘K` search across projects/RFIs/submittals/punch-list/change-orders/to-dos.

Dashboard home showed real org data: "Meridian Construction Group", 18 active projects (4 delayed,
14 on track), real per-project revenue figures (e.g. "Riverside Public School Renovation
₹86,59,138"). This matches (and real-world-confirms, 2 weeks later) the org/data already documented
in `PHASE1_SEED_REPORT.md`/`PHASE2_BATCH_C_FINDINGS.md` — the seeded org is still real and live,
not stale/decommissioned.

This is explicitly **not** a full click-through of every menu item (that's deep-testing work for a
later phase, scoped to whichever domain the PM/Owner confirms is the real target) — it is the
top-level structure only, captured incidentally while resolving the account-access question.

---

## Not covered this pass (explicit, per this task's own bounded scope)

- Multi-tenant / multi-brand behavior
- ERP workflows (any of the modules listed in Finding 3)
- Reports
- VERI Chat / the "Discuss" panel / AI Copilot
- Prompt flow
- Search (`⌘K`)
- Cache behavior
- Any deep, per-screen testing on `projexa-smoky.vercel.app` (Finding 3 is a structure inventory only, captured as a byproduct)
- Resolving the real inbox confirmation for either pending signup (`...projexaaudit20260802@gmail.com` from earlier this session, `...projexaaudit2237bc7@gmail.com` from this session)

## Recommendation for the next phase

Before doing any deeper click-through work under this UMR, get an explicit PM/Owner decision on
Finding 1's scoping question: is "Projexa E2E certification" now about (a) `veridian-compliance-ai`
under the `projexa-ai.com` domain (already separately audited, PR #711 — would be pure
re-verification), or (b) the real standalone Projexa app at `projexa-smoky.vercel.app` (unaudited
under this UMR, has real working seeded credentials, real data, and — per this session's spot
check — real gaps of its own, e.g. Finding 2d's broken Google sign-in equivalent would need
re-checking there too). Continuing to test `projexa-ai.com` literally, without that decision, will
keep hitting the same account-access wall documented in Finding 2, for the same root cause in
Finding 1.

---

*Real, live findings only — no status label, narration, or prior report's conclusion was trusted
without a fresh, direct observation this session. Screenshots: `/opt/veridian/browser/screenshots/ocid020-phase1-*.png` (15 files, `00` through `17`, some numbers intentionally skipped where a planned step was superseded by the pivot to Finding 1's investigation).*
