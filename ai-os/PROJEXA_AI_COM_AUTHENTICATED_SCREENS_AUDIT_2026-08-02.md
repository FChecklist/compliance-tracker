# PROJEXA-AI.COM Authenticated Screens Audit (2026-08-02)

**UMR:** `UMR-20260802-165606-4413` (OCID-20260802-020), amending parent
`UMR-20260802-104058-25ba` (the canonical 14-item implementation matrix,
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`).

**Scope:** live, browser-based, authenticated-screen testing of
`https://projexa-ai.com` itself — the one slice of tonight's testing that PR
#711 (`task-20260802-040340`, real completion audit against
`VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md`) explicitly did not
cover. PR #711's own "Remaining" section states this verbatim: *"Did not
attempt authenticated screens on projexa-ai.com itself (separate Supabase
project, no known credentials, would require a second signup+confirm
cycle)."* This report is that second cycle.

**Not acted on beyond this document.** Read-only investigation and one real
test-account signup attempt only. No app code was modified. Nothing was
merged. No `AUDIT: PASS`/`AUDIT: FAIL` verdict is asserted here — see the
honest verdict section at the end.

---

## 1. Real credential blocker (confirmed, not re-litigated)

Confirmed this session: the server's `VERCEL_ACCESS_TOKEN`
(`/opt/veridian/shared/.env`) cannot decrypt projexa's Vercel-side secrets.
Both paths return empty:

```
vercel env pull            → SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY etc. empty
GET /v10/projects/projexa/env?decrypt=true  → empty
```

This is a real permission gap, not a bug — it rules out the
force-confirm-via-service-role-key trick PR #711 used against
compliance-tracker's own Supabase project. Not retried here.

## 2. Public bundle extraction — SUCCEEDED

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` ship in
projexa-ai.com's client JS by Next.js convention. Real extraction:

```
curl https://projexa-ai.com/signup  → found new chunk not on the landing page:
  /_next/static/chunks/10hkkumgervj_.js
grep -bo "pcrjmlpuqsbocqfwoxod" 10hkkumgervj_.js → byte offset 223952
dd if=10hkkumgervj_.js bs=1 skip=223700 count=1200
  → "https://pcrjmlpuqsbocqfwoxod.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjcmptbHB1cXNib2NxZndveG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMTkxNTAsImV4cCI6MjA5Nzg5NTE1MH0.nH-nltFt8M3nJG_clP9Zw3_FsXtn-8mKrFeqdE414oU"
```

Confirmed by decoding the JWT payload in-line (base64url, not encrypted):
`{"iss":"supabase","ref":"pcrjmlpuqsbocqfwoxod","role":"anon","iat":1782319150,"exp":2097895150}`
— a real `role: anon` key for a real, distinct Supabase project
(`pcrjmlpuqsbocqfwoxod`), confirming projexa is on its own Supabase project,
separate from compliance-tracker's. This key powers only what Supabase's own
anon-role RLS allows (signup/login), the same as any browser visiting the
site gets — no elevated access was obtained.

**Note on the landing page itself:** the root `/` bundle (13 chunks
referenced from the HTML) contains no reference to `supabase` at all — only
`/signup` and `/login` load the chunk with the Supabase client. Anyone
auditing this by only fetching `/` would incorrectly conclude no keys ship
client-side.

## 3. Real signup attempt — account created, email confirmation required

Used `/opt/veridian/scripts/browser/persistent-profile.js` (real headless
Chrome, same tooling PR #711 used) to drive the real `/signup` and `/login`
pages end to end, with response/network capture.

**Real observation worth flagging (differs from this task's own briefed
context):** the briefing described projexa's signup form as "3 fields:
org/email/password" vs. compliance-tracker's 4. Live inspection of
`https://projexa-ai.com/signup` today found **4 fields**:
`#fullName` ("Rajesh Sharma" placeholder), `#org` ("Acme Financial Services
Pvt. Ltd."), `#email`, `#password` — matching the field *count* PR #711
attributed to compliance-tracker, not the field count previously briefed for
projexa. Also worth flagging: the page `<title>` is
`"VERIDIAN COGNITIVE AI OS — AI Cognitive Research"`, the login page reads
*"VERIDIAN AI — One Portal. One Truth. ... Sign in to your compliance
dashboard"*, and no occurrence of the string "Projexa" was found anywhere in
the landing, login, or signup page text/HTML fetched this session. This is
consistent with VERIDIAN being the parent research/company brand and
Projexa a product name that isn't surfaced on these particular pages, but it
is reported here as a real, directly observed discrepancy from the briefed
assumption rather than silently reconciled — it was not independently
resolved (e.g. by checking the `/products` marketing page) in this pass.

**Signup, real submission:**
- Test account: `raajat.agarwal+projexaaudit20260802@gmail.com` /
  full name "Audit Tester" / org "Projexa Audit Test Org" / a real generated
  password. Gmail plus-addressing routes to the real owner mailbox
  (`raajat.agarwal@gmail.com`) — this agent has no inbox access to that
  mailbox in this environment, so no confirmation link could be clicked.
- Real network call captured: `POST
  https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/signup?redirect_to=https%3A%2F%2Fprojexa-ai.com%2Fauth%2Fcallback`
  → **200**.
- Real resulting UI: *"Check your email — We've sent a confirmation link to
  raajat.agarwal+projexaaudit20260802@gmail.com. Click the link to verify
  your account and get started."*
- Screenshot: `projexa-auth-01-signup-page.png`,
  `projexa-auth-02-signup-filled.png`, `projexa-auth-03-signup-result.png`.

**Login attempt immediately after signup (testing whether email
confirmation is actually enforced, per this task's own instruction 2a):**
- Real network call: `POST
  https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/token?grant_type=password`
  → **400**, body: `{"code":"email_not_confirmed","message":"Email not
  confirmed"}`.
- Real rendered UI text included the literal string `"Email not confirmed"`.
- Screenshots: `projexa-auth-04-login-page.png`,
  `projexa-auth-05-login-filled.png`, `projexa-auth-06-login-result.png`,
  `projexa-auth-07-login-error-visible.png`.
- **Conclusion: email confirmation is genuinely enforced** on this Supabase
  project for password-grant login — this is not a gap this session could
  route around, and matches the honest expectation set in this task's
  briefing rather than a lucky "confirmation disabled" case.

**Alternate paths checked (per instruction 2b), inconclusive, not pursued
further:**
- `/login` also offers "Send magic link instead" and "Sign in with
  passcode" (reveals a 4-digit passcode field). Both plausibly route an OTP
  or link through the same email inbox this agent cannot access, so neither
  was expected to bypass the blocker.
- Real test: filled the email field, switched to passcode mode, clicked
  "Continue" — **no network call fired** (`netlog` empty) and the UI stayed
  on the same passcode-entry screen with no visible error. This does not
  confirm or rule out whether a "request passcode" step exists elsewhere in
  the flow; it was not investigated further given the underlying inbox
  constraint would block it either way. Screenshots:
  `projexa-auth-08-passcode-flow.png`,
  `projexa-auth-09-passcode-continue-result.png`.

## 4. Real, honest result: authenticated screens were NOT reached

This session did not obtain a real, logged-in session on projexa-ai.com. No
dashboard, workspace-setup, or module screen was viewed authenticated. No
business workflow (task/record creation) was attempted post-login, because
there was no post-login state to test from. This is reported plainly, per
this task's own instruction 4, rather than worked around with a fabricated
result.

---

## Findings table

Modeled on PR #711's table structure, adapted since there is no equivalent
mockup-to-production spec for projexa-ai.com (unlike compliance-tracker's
`VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md`) — columns reference what
was actually tested against, not a spec document that does not exist for
this product.

| Area tested | What was tested | Real status | Severity | Evidence |
|---|---|---|---|---|
| Public Supabase config exposure | Extract `NEXT_PUBLIC_SUPABASE_URL`/anon key from live client bundle | **CONFIRMED EXTRACTABLE** — expected/by-design Next.js behavior, not a vulnerability (anon key is meant to be public, gated by Supabase RLS); only ships on `/login`/`/signup` chunks, not the marketing root | informational | `chunks/10hkkumgervj_.js` byte offset 223952 (this session's scratch dir, not committed) |
| Signup form (`/signup`) | Real field inspection + real submission | **WORKS** — real Supabase signup call returns 200, real "check your email" confirmation state renders | n/a — working as designed | `projexa-auth-01/02/03-*.png` |
| Signup form field count/branding | Cross-check against this task's own briefed assumptions | **DISCREPANCY FOUND** — briefed as 3 fields/distinct "Projexa" branding; live site shows 4 fields and "VERIDIAN AI" branding, no "Projexa" text found on tested pages | informational (context-accuracy issue, not a product bug) | `projexa-auth-01-signup-page.png`, field dump in section 3 above |
| Email/password login, unconfirmed account | Real login attempt seconds after real signup | **BLOCKED BY DESIGN** — Supabase enforces `email_not_confirmed` (400), real error surfaced in UI | n/a — correct, expected auth behavior | `projexa-auth-04` through `07-*.png` |
| Magic-link / 4-digit passcode alternate login | Real click-through, one real "Continue" submission attempt | **INCONCLUSIVE** — no network call observed on the one attempt made; not pursued further (same inbox constraint applies regardless) | not assessed | `projexa-auth-08-*.png`, `09-*.png` |
| Authenticated dashboard / workspace setup / main modules / any business workflow | N/A — never reached | **NOT TESTED THIS SESSION** — blocked upstream by email confirmation + no service-role key + no inbox access | **coverage gap**, not a product defect | n/a |

---

## Honest go-live-readiness verdict — this slice only

**Scope of this verdict: projexa-ai.com's own *authenticated* screens only.**
It says nothing about the unauthenticated marketing/landing experience
(which loaded correctly, real content, during this session) and nothing
about compliance-tracker's own authenticated screens (already covered,
separately, by PR #711 with a real pass/fail breakdown).

**Verdict: NOT ASSESSED — genuinely could not be assessed this session, not
"assessed and failing."** The signup and pre-authentication login flows
themselves work correctly and match expected, secure Supabase Auth
behavior (email confirmation enforced, no bypass found). But zero
authenticated screens, zero workspace/dashboard/module UI, and zero business
workflows on projexa-ai.com were viewed or clicked through in this pass.
Readiness of the *authenticated* product surface remains **completely
unknown** from real evidence as of this report — this is a coverage gap in
tonight's testing, not a discovered defect, and it should not be read as
either a pass or a fail on the authenticated product itself.

**What would unblock a real follow-up pass**, in order of least to most
invasive:
1. Owner (or someone with inbox access to `raajat.agarwal@gmail.com`)
   manually clicks the real confirmation link already sent to
   `raajat.agarwal+projexaaudit20260802@gmail.com` (real account, already
   created, signup call returned 200) — a session could then log in with the
   already-known password and pick up authenticated testing immediately, no
   new signup needed.
2. Obtain real Vercel-decrypted access to projexa's `SUPABASE_SERVICE_ROLE_KEY`
   (currently confirmed empty via both `vercel env pull` and the Vercel API)
   to force-confirm programmatically, the same mechanism PR #711 used for
   compliance-tracker's own project.
3. Owner disables email confirmation on the `pcrjmlpuqsbocqfwoxod` Supabase
   project for testing purposes only (not recommended as a standing change;
   confirmation-required is the correct production posture, confirmed
   working as designed in section 3 above).

## Real screenshot evidence (this session, `/opt/veridian/browser/screenshots/`)

```
projexa-auth-00-landing.png
projexa-auth-01-signup-page.png
projexa-auth-02-signup-filled.png
projexa-auth-03-signup-result.png
projexa-auth-04-login-page.png
projexa-auth-05-login-filled.png
projexa-auth-06-login-result.png
projexa-auth-07-login-error-visible.png
projexa-auth-08-passcode-flow.png
projexa-auth-09-passcode-continue-result.png
```

## What this session did NOT cover (explicit, per instruction 4)

- Any authenticated projexa-ai.com screen (dashboard, workspace setup, main
  menus/modules) — blocked as described above.
- Any business workflow (task/record creation) on projexa-ai.com.
- The `/products` marketing page or any other unauthenticated route beyond
  `/`, `/login`, `/signup`.
- Whether the magic-link email, if clicked, would actually complete login
  (not sent to a reachable inbox).
- Full resolution of the branding/field-count discrepancy noted in section
  3 (flagged, not investigated to a root cause).

This is a first real pass at this specific slice, not exhaustive coverage —
consistent with PR #711's own framing of its compliance-tracker audit.
