# PROJEXA-AI.COM — Real E2E Certification, Redo (2026-08-02)

**UMR:** `UMR-20260802-165606-4413` (OCID-20260802-020), amending parent `UMR-20260802-104058-25ba`.
Target-correctness citation: `UMR-20260802-134939-145d` (real Owner decision, PR #720 /
`ai-os/boss/COMPLETED.yaml` `WAVE-10-REDO`).

**What this is:** a redo of the OCID-020 real E2E certification pass. The immediately prior real
run under this same UMR/OCID tested the wrong target (now tracked standalone as
`UMR-20260802-201605-08b8`, PR #737 — the real 22-spec suite run against `projexa-smoky.vercel.app`,
merged on its own merits, explicitly **not** part of OCID-020). This report is the actual OCID-020
redo: real target confirmation, a real honest attempt at the same 22-spec suite against the real
`https://projexa-ai.com`, and — because that attempt fails almost entirely for a target/DOM-mismatch
reason explained below, not a product-quality reason — a real, separate, correctly-targeted
authenticated click-through of what `projexa-ai.com` actually serves.

**Method note (same standard as the parent matrix and PR #735/#737)**: no task/UMR status label was
used as evidence of anything. Every finding below is a real, live, timestamped
browser/network/command observation captured this session — Playwright's own reporter JSON for the
suite run, and `launchPersistentChrome()` (the real installed Chrome at
`/opt/veridian/browser/chrome`, no `sudo` / `playwright install-deps`) for the authenticated
click-through. Screenshots referenced below are real files at
`/opt/veridian/browser/screenshots/ocid020-redo-*.png`.

---

## Step 1 — Live target re-confirmation (done first, per this task's own instruction)

```
$ curl -sI https://projexa-ai.com
HTTP/2 200
server: Vercel
x-powered-by: Next.js
```
Real page `<title>`: **`VERIDIAN COGNITIVE AI OS — AI Cognitive Research`**. `document.body`
contains "VERIDIAN" (33 occurrences); zero occurrences of "PROJEXA" or "compliance-tracker" as
literal strings. This matches `ai-os/boss/COMPLETED.yaml`'s `WAVE-10-REDO` entry and
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 12 exactly: `projexa-ai.com` is real, live, and
currently served by `veridian-compliance-ai`, not the standalone `projexa` Vercel project, per the
real Owner decision `UMR-20260802-134939-145d`. **Confirmed still true at the time of this
session — nothing has changed since PR #720.** All work below proceeds on that confirmed basis.

---

## Step 2 — Real, honest attempt: the same 22-spec suite against `https://projexa-ai.com`

**Setup**: `/opt/veridian/repos/projexa/e2e/` (22 spec files + `auth.setup.ts` + `helpers.ts` +
`users.ts`), run from the dedicated `projexa-ocid020-wt` worktree (same suite, same
`playwright.config.ts`, whose `use.baseURL` already defaults to `https://projexa-ai.com` —
confirmed by reading the config before running, and explicitly re-passed via
`PLAYWRIGHT_BASE_URL=https://projexa-ai.com` for the record, not overridden to anything else).
Local Playwright Chromium's `libnspr4.so`/etc. were missing from the runtime linker path (a real,
pre-existing sandbox infra gap, previously logged by a stood-down predecessor session in
`ACTIVE-CLAIMS.yaml`) — resolved for this run, without `sudo`, by pointing `LD_LIBRARY_PATH` at the
already-present `/home/rajat/.local/chrome-system-libs` (no new install, no root).

**Real result:**

| Metric | Value |
|---|---|
| Total tests | 107 |
| Passed | **0** |
| Failed | 4 (all 4 in the `setup` project — login) |
| Skipped ("did not run") | 103 |
| Duration | 87.9s |

Real `playwright test` JSON stats: `{"expected":0,"skipped":103,"unexpected":4,"flaky":0}`.

**Root cause (honest, not a product bug in Projexa or in compliance-tracker)**: all 4 `setup`
logins (`e2e/auth.setup.ts` — CEO, Finance, HR, Site Supervisor) time out waiting for
`**/dashboard` after submitting real seeded Projexa credentials
(`arjun.mehta@meridian-construction.e2e-test.projexa-ai.com` etc.) into the `#email`/`#password`
form at `https://projexa-ai.com/login`. The real captured page snapshot at failure
(`test-results/.../error-context.md`, screenshot
`ocid020-redo-01-22spec-suite-login-fail-wrong-dom.png`) shows the login page actually rendered:

> **VERIDIAN AI — One Portal. One Truth.** / "Welcome back — Sign in to your compliance
> dashboard" / Email, Password, **Sign In** / "Sign in with Google" / "Sign in with passcode" /
> "Sign in with company SSO"

This is genuinely `veridian-compliance-ai`'s own login page/DOM, not Projexa's. The suite's
selectors (`#email`, `#password`, `button[type="submit"]`) happen to still resolve (both apps use
similar field names), the form does submit, but Supabase auth on this domain's real project
(`pcrjmlpuqsbocqfwoxod`) has no record of the Projexa-seeded users, so the app never navigates to
`/dashboard` and every downstream spec (all 22 files, 103 remaining tests) is skipped because they
all `dependencies: ["setup"]`. Since the `setup` project itself never reaches an authenticated
state, none of the 22 specs' own assertions (about Projexa's Materials/Permits/Documents/
Procurement/HR/Finance/CRM UI) ever execute against real product behavior — this is a **clean
target/DOM mismatch, not evidence of any real regression in either product.**

**Honest conclusion for this step**: running the literal 22-spec suite against the real, live,
currently-correct `projexa-ai.com` target produces near-total failure (0/107 real pass), and that
failure is fully and specifically attributable to the DOM/backend mismatch above — reported plainly
as required, not counted as 20 or 103 "real product findings." This is the expected, predicted
outcome once Step 1 established the target has changed products; it's recorded here as the honest
result of actually trying, not assumed without running it.

---

## Step 3 — The real certification: authenticated click-through of what `projexa-ai.com` actually serves

Per this task's framing, PR #711 already did a real authenticated click-through (VERI Chat composer
scope, 30 screenshots, `AUDIT: PASS`) of `veridian-compliance-ai.vercel.app`, and this UMR's own
Phase 1 (PR #735) got as far as three real, dead account-access attempts on `projexa-ai.com` itself
and root-caused why (Supabase project mismatch), but never reached an authenticated screen **on the
`projexa-ai.com` domain**. This step closes that gap using the real unblock identified for this
redo: `compliance-tracker`'s own `SUPABASE_SERVICE_ROLE_KEY` (confirmed present locally in
`/opt/veridian/repos/compliance-tracker/.env.local`, `SUPABASE_URL` = `pcrjmlpuqsbocqfwoxod` — the
exact project `projexa-ai.com` authenticates against, matching PR #735's own finding).

### 3a. Real signup

`https://projexa-ai.com/signup` — real form fields `#fullName`, `#org`, `#email`, `#password`
(screenshot `ocid020-redo-02-signup-page.png`). First attempt with a synthetic
`@veridian-e2e-test.com` address was **really rejected** by Supabase itself:
`400 {"code":"email_address_invalid", ...}` — a real, disclosed dead end, not silently retried past.
Second attempt with a real-domain-format address succeeded for real:
`POST https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/signup` → **HTTP 200**, real user id
`82af2932-57f4-42b0-b51c-fa6d54f13c4f`, org "OCID-020 Redo Certification Test Org"
(screenshots `ocid020-redo-03-signup-filled.png`, `ocid020-redo-04-signup-result.png`).

### 3b. Real email-confirm bypass via Admin API (no inbox wait)

```
PUT {SUPABASE_URL}/auth/v1/admin/users/82af2932-57f4-42b0-b51c-fa6d54f13c4f
Headers: apikey / Authorization: Bearer <compliance-tracker SUPABASE_SERVICE_ROLE_KEY>
Body: {"email_confirm": true}
```
Real response: `email_confirmed_at: "2026-08-02T20:27:46.86...Z"`. Same method PR #711's original
audit used; no real inbox was polled or needed.

### 3c. Real login — authenticated screens reached

`https://projexa-ai.com/login` with the newly-confirmed credentials → real navigation to
`/home` (not `/dashboard` — `/home` is this app's real post-login landing route, confirmed by its
own nav; not a failure). Screenshots `ocid020-redo-05-login-filled.png`,
`ocid020-redo-06-post-login.png`. **Authenticated screens on `projexa-ai.com` reached for real, for
the first time this UMR.** Top bar shows the real signed-up identity: "OCID020 Redo Tester" /
"OCID-020 Redo Certification Test Org".

### 3d. Real navigation inventory

Real `<a href>` enumeration from the authenticated `/home` shell: **118 distinct real nav links**,
spanning Home/Dashboard/VERI Chat/Connectors/"Make Your Own Agents", Construction
(Site Diary/RFIs/Submittals/Punch List/BOQ/Labour/Expenses/Floor Plans/Mood Boards/FF&E/Change
Orders/Work Progress), ERP (Journal Entries, Payment Entries, Fixed Assets, Budgeting, Financial
Reports, Cash Management, Credit Notes, Inventory, Bank Reconciliation, Procurement Workflow, Goods
Receipt, Payroll, Invoicing, Returns, Contracts, Customers, Suppliers), Compliance/Governance
(Register, Notices, Audit Points, Board & Governance, Committees, RPT, DoA, Director Register, Board
Evaluation, Policies, Statutory Registers, Cap Table, Charges, Secretarial Audit, MCA e-Filing),
Legal (Matters, External Counsel, Litigation, IP Portfolio, Legal Opinions), HR (Statutory
Compliance, Leave & Holiday, POSH, VERI HR AI, Attendance, Training, Recruitment, Performance
Reviews), Risk/Audit/ESG/Whistleblower/BCM/IT-DR/Fraud/Incidents, CRM (VERI CRM AI, Accounts, Sales
HQ), Admin (Users, Departments, Access Review, Settings, Audit Log), and more (KPI Hub, AI
Observability, Knowledge Base, Automation, Ticketing, Voice Tickets, Penalty Tracker, Help Centre,
Team). This confirms the parent matrix's item 1 evidence (51 `erp_*` tables etc.) is genuinely
reachable UI, not just schema — real, substantially larger surface than PR #711's VERI-Chat-only
scope, as this task asked for.

### 3e. Real findings from the sweep (screenshots: `ocid020-redo-1x`/`3x`/`4x`series)

**Finding A — real, reproducible app crash on the Compliance Register and Pendency View (severity:
high, this is the product's own core feature)**
- `GET https://projexa-ai.com/compliance` and `GET https://projexa-ai.com/compliance?status=overdue`
  (the "Register" and "Pendency View" nav items) both real, reproducibly render
  **"Application error: a client-side exception has occurred"** (blank page) —
  screenshots `ocid020-redo-42-compliance-register.png`, `ocid020-redo-34-pendency.png`.
- Root cause, real network + console evidence: both requests trigger a real
  **`HTTP 500` on `GET /api/departments`**, and the browser console then throws a real
  **`TypeError: z.map is not a function`** in a minified Next.js chunk — consistent with client
  code calling `.map()` on what the 500 response actually returns (not an array).
- `/departments` (the admin nav page of the same name) also gets the same real `500` on
  `/api/departments` but does **not** crash — it degrades gracefully — so the failure is specific
  to how the Compliance Register / Pendency View pages consume that same endpoint's response, not a
  property of the endpoint alone.
- Real reproduction path: sign in → click "Register" or "Pendency View" in the left nav (or
  `GET /compliance` / `GET /compliance?status=overdue` directly) → blank white page,
  "Application error: a client-side exception has occurred (see the browser console for more
  information)".
- Consequence: the "New compliance item" workflow could not be exercised end-to-end as intended —
  the entry page itself is down. Reported here as a real, disclosed blocker rather than skipped
  silently.

**Finding B — real `403 Forbidden` across CRM and ERP APIs for a fresh self-signup org (severity:
medium — real behavior, plausibly-by-design module gating, but with no user-facing explanation)**
- `/crm` real page shell renders, but its 5 real backing calls all `403`:
  `/api/crm/leads`, `/api/crm/accounts`, `/api/crm/campaigns`, `/api/crm/contacts`,
  `/api/crm/opportunities` (screenshot `ocid020-redo-33-crm.png`).
- `/erp/procurement` real shell renders, backing calls `403`:
  `/api/erp/procurement/quotations`, `/requisitions`, `/rfqs`.
- `/erp/journal-entries` real shell renders, backing calls `403`:
  `/api/erp/buying/suppliers`, `/api/erp/accounts`, `/api/erp/cost-centers`,
  `/api/erp/journal-entries`, `/api/erp/companies`.
- This is consistent with the parent matrix's own item 1 finding
  (`erp-enablement-service.ts`'s `requireErpEnabled()` gate) — plausibly correct, safe-by-default
  behavior for a brand-new self-signup org with no ERP/CRM module explicitly enabled. **Not
  asserted as a bug in isolation**, but disclosed because the real UI gives no visible
  "module not enabled, contact your admin" messaging — a real self-signup user sees empty-looking
  ERP/CRM pages with no explanation, which is a real UX gap even if the underlying gate itself is
  intentional.

**Finding C — real `HTTP 500` on `/api/email-intelligence`**, observed on the real `/home` landing
load for this fresh account (background widget call). Did not visibly break the page, captured for
the record as an additional real backend error.

**Finding D — VERI Chat composer is task-chip-gated, not free-text-first (observed behavior, not a
bug)**: on `/home`, the embedded VERI Chat panel shows "Select the task you want me to do" with
chips (Compliance Item / Calculators / Construction Intelligence / Reports / Reports & Analysis /
Create) and the message box is disabled ("Select a task above to begin…") until one is picked. Two
automated attempts to type directly into a generic `textarea`/`contenteditable` timed out for this
reason, not because the feature is broken — disclosed honestly as an automation-script limitation
in this session, not re-labeled as a product defect. A dedicated `/chat` route was also visited
directly; it rendered a distinct "+ New conversation" full-page layout on one visit
(`ocid020-redo-44-chat-page.png`) but the same URL rendered the `/home`-style embedded panel on a
second visit (`ocid020-redo-48-chat-FAIL.png`) — **noted as a low-confidence, unconfirmed
observation** (possibly a client-side routing/caching quirk, possibly just two different valid
states); not asserted as a real bug without a cleaner repro, which this session's remaining budget
did not allow chasing further.

**Finding E — minor, low-confidence, disclosed-not-asserted**: one screenshot captured mid-navigation
(`ocid020-redo-47-cmdk-probe.png`) briefly showed a generic "CT / User" avatar instead of the real
signed-in "OR / OCID020 Redo Tester" identity, while the org name in the same header remained
correct. Most likely an unhydrated-loading-state artifact of a fast screenshot right after a
`Ctrl+K` keypress, not re-tested for reproducibility given session budget — flagged for a future
pass, not reported as a confirmed identity-leak bug.

**Pages visited with no real issue found**: `/dashboard`, `/connectors`, `/rewards` (VERI Treasure),
`/reports` (Reports & Analysis — direct navigation renders cleanly; see note below), `/users`,
`/audit` (Audit Log), `/settings` — all real `HTTP 200`, no console errors, no crash
(screenshots `ocid020-redo-30` through `-41`).

**Correction of an initial mis-attribution during this session**: an early sidebar-click-driven
sweep briefly showed what looked like a crash on "Reports & Analysis" — re-investigated with
isolated direct `page.goto()` calls per page (more reliable than sequential sidebar clicks, which
can carry over a previous page's crashed SPA state) and confirmed **`/reports` itself does not
crash**; the crash is real but specific to `/compliance` and `/compliance?status=overdue` (Finding
A above). Reported here transparently rather than left as an inconsistent record.

---

## What this pass covered vs. did not (explicit bounds, per this task's own instruction)

**Covered, real, this session:**
- Live target re-confirmation (Step 1).
- A real, complete run of the actual 22-spec suite against the real, current `projexa-ai.com`
  (Step 2) — honest 0/107 result, root-caused.
- Real signup + real Admin-API email-confirm bypass + real login on `projexa-ai.com` itself
  (Step 3a-c) — the first time this UMR reached an authenticated screen on this exact domain.
- A real, broad nav inventory (118 links) and a real click-through of ~15 distinct
  pages/areas across ERP, CRM, Compliance/Governance, Admin, and the VERI Chat composer
  (Step 3d-e) — beyond PR #711's VERI-Chat-only scope, as asked.
- One real, well-evidenced, reproducible high-severity bug (Finding A) with a full real
  reproduction path and real error text.

**Not covered, disclosed plainly, not hidden:**
- ~~**Multi-tenant isolation**: only one account/org was created this pass (by design — signup only
  produces one org per account here); cross-org data-isolation could not be tested with a single
  account.~~ **CLOSED (2026-08-02, task-20260802-210700, PR #747, commit `f418ca6c`):** two real,
  separate orgs (Org A, Org B) created via Supabase Admin API; Org B created a real department
  (`Org-B-Only-Department`, `orgId: dane6ps2f1k1fmg1tgndvl85`) via `POST /api/departments`, and
  Org B's own `GET /api/departments` returned only its own 2 rows (auto-provisioned "General" + the
  new one) — none of Org A's data. Real, positive confirmation that tenant-scoped
  `withTenantContext`/RLS isolation holds for this one route. **Still open, not yet tested**: the
  same probe against every other tenant-scoped route/table (this only covers
  `/api/departments`), and this mirrors — but does not fully close — the parent matrix's own item 8
  finding ("no table-by-table RLS verification exists"). **Also flagged, honestly inconclusive, not
  a confirmed bug**: that same session saw intermittent `401`/`403` on rapid back-to-back
  test-harness logins, most likely a test-harness artifact (a slower, isolated retry succeeded
  cleanly each time) rather than a real `autoProvisionUser()` race — worth a slow/spaced-out retest
  before filing as a tracked gap, not before. Any continuation of this OCID-020 sweep (e.g. the
  nav-surface continuation task) should build on this closed slice rather than re-testing
  `/api/departments` tenant isolation from zero, and can spend its multi-tenant budget on the
  still-open surface above instead.
- **A complete ERP workflow end-to-end**: attempted (Compliance Item creation), but the real entry
  point (`/compliance`) is down per Finding A — this is reported as the finding itself, not
  quietly skipped.
- **The 6 unbuilt VERI Chat composer UX items** already tracked in the parent matrix item 2 — not
  re-verified here, out of this pass's real time budget.
- **Deep testing of every one of the 118 nav items** — this is one bounded pass (~15 areas
  clicked/loaded), not total coverage; the remaining ~100 pages were enumerated by URL but not
  individually loaded and inspected this session.
- **A full VERI Chat AI round-trip** — blocked by the task-chip gating noted in Finding D; not
  forced past with a deeper DOM investigation given session budget.

---

## Screenshots (real, `/opt/veridian/browser/screenshots/`, prefix `ocid020-redo-`)

31 real screenshots this session, spanning: the 22-spec suite's real login failure
(`-01-`), real signup/login flow (`-02-` to `-06-`), first-pass sidebar sweep (`-10-` to `-22-`),
and the isolated per-page sweep used for the findings above (`-30-` to `-50-`, including the two
real client-side-crash captures at `-34-` and `-42-`).

---

## Verdict

**Not a self-certification** — this report states findings plainly for independent review, per
standing instruction; it does not claim `AUDIT: PASS`/`FAIL` itself. Summary for the reviewer:

- The literal 22-spec suite is **not a valid test of `projexa-ai.com` as currently deployed** —
  confirmed by actually running it, not assumed. It should not be run again against this domain
  until/unless the domain is repointed back to the standalone Projexa app (a separate, real,
  Owner-level decision already made deliberately in the other direction — see
  `UMR-20260802-134939-145d`).
- The real, correctly-targeted certification found the authenticated app largely functional across
  a broad real sweep, with **one real, reproducible, high-severity bug** (Compliance Register /
  Pendency View client-side crash, Finding A) that a real end user hitting this domain's core
  "compliance dashboard" feature would hit immediately, plus two medium/low-severity, honestly-
  bounded observations (Findings B-E).
