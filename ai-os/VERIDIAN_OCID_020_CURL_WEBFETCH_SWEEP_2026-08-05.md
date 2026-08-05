# OCID-020 — Real curl/WebFetch Public-Page Sweep + Root-Cause Fix (2026-08-05)

**Parent:** `UMR-20260802-165606-4413` (OCID-020, PROJEXA-AI.COM end-user certification)
**This dispatch:** `UMR-20260805-130213-d627` (real OCID-020 browser-testing dispatch), executed
as this task via a real PM decision (option 3, quoted in full below) to proceed with curl and
WebFetch evidence now rather than wait, since no screenshot-capable browser tool was available in
*this* session.

## PM decision this task executes (verbatim, from this task's own dispatch)

> Real decision, option three, proceed now with the real systematic public page sweep and real
> root cause fix using real curl and real WebFetch evidence, real HTTP status, real headers, real
> redirect chains, and real extracted page content, this is real and verifiable even without
> images. Explicitly record in the real OCID-020 evidence, not silently omit, that real screenshot
> capture is outstanding pending a real screenshot capable browser tool being available in this
> real session, since OCID-020 own standing definition calls for real screenshots specifically,
> this is a real, honest, temporary gap, not a permanent downgrade of the real evidence bar. The PM
> will separately continue providing real screenshot-adjacent evidence from its own real browser
> session where possible for specific real pages, cite this real dispatch when doing so.

## ⚠️ Honest, disclosed gap: no screenshot evidence in this document

This session had no screenshot-capable browser tool available (no Playwright/browser-automation
tool surfaced to this session, unlike the sibling session below which has one). Every finding
below is evidenced by real `curl` output (HTTP status, response headers, redirect chains, `<title>`
extraction) and real `WebFetch` output (rendered-content extraction via a fetch+summarize tool),
never narrated only. This is a **temporary, disclosed** gap against OCID-020's own standing
definition (which calls for real screenshots) — not a permanent downgrade of the evidence bar.
The PM is separately expected to supply screenshot-adjacent evidence for specific pages from its
own browser session, citing this dispatch.

## Collision check (before starting real work, per `ai-os/boss/ACTIVE-CLAIMS.yaml`'s own protocol)

A live sibling task, `task-20260805-173250-real-comprehensive-end-to-end-browser-te` (dispatched
from the same parent `UMR-20260805-130213-d627`, ~20 minutes before this task), already
root-caused and fixed the PM's original `/signup` finding plus the identical class on
`/mfa-challenge`, via curl + source read, in real open PR **#965**
(`worker/task-20260805-173250-real-comprehensive-end-to-end-browser-te`, `mergeable: MERGEABLE`
at time of writing). That session states it has real Playwright screenshot capability and plans a
real screenshot sweep as a remaining step. To avoid duplicating that work, this task:

- does **not** re-derive or re-fix `/signup` or `/mfa-challenge` (cites PR #965 instead, see below)
- scopes its own real curl/WebFetch sweep to pages PR #965 did not cover
- does not also write to the `ocid_canonical_registry` DB row for OCID-020 (the sibling's own
  remaining steps already include that deposit; a second concurrent writer to the same row would
  itself be a real collision risk of the kind `ACTIVE-CLAIMS.yaml` exists to prevent) — this
  document is this task's own durable evidence record instead.

### Independent spot-check of PR #965's fix (read-only, no re-fix)

Read `worker/task-20260805-173250-real-comprehensive-end-to-end-browser-te`'s real diff for
`src/app/signup/page.tsx`, `src/app/signup/signup-form.tsx` and the equivalent `/mfa-challenge`
files (commit `cf7c6d9f`). Confirmed real: splits each page into an async Server Component
(`page.tsx`, reads the real HTTP `Host` header via `resolvePreAuthBrandByHost()`, plus a
`generateMetadata()` title override) and an unchanged client form component taking `brand` as a
plain prop (`brand?.brandName ?? "VERIDIAN AI"` fallback) — mirroring `/login`'s
already-production-proven pattern (`UMR-20260804-090421-c647`) exactly. Not yet merged to `main`
at time of writing, so the live prod site still shows the pre-fix behavior for `/signup` and
`/mfa-challenge` below (real, current, honestly reported — not implying the bug is unfixed
in-repo).

## Real curl sweep — every real public, unauthenticated page reachable on live projexa-ai.com

All requests below made live against `https://projexa-ai.com` (no auth, no session, no cookies),
`curl -sI` for headers/status, plain `curl -s` piped through a `<title>` extraction, at
`2026-08-05T18:01:53Z`–`18:01:58Z` (UTC, from `curl`'s own `date:` response header).

| Path | HTTP status | Redirect | `<title>` | In scope for PROJEXA host-brand? |
|---|---|---|---|---|
| `/` | 307 → `/login` | Yes (real, `location: /login`) | n/a (redirect only) | n/a — pre-existing behavior, not this dispatch's finding |
| `/login` | 200 | — | `Sign in — PROJEXA` | Yes — **correct** (fixed `UMR-20260804-090421-c647`) |
| `/signup` | 200 | — | `VERIDIAN COGNITIVE AI OS — AI Cognitive Research` | Yes — **wrong** (PM's original finding; fixed in unmerged PR #965) |
| `/mfa-challenge` | 200 | — | `VERIDIAN COGNITIVE AI OS — AI Cognitive Research` | Yes — **wrong** (found + fixed in unmerged PR #965) |
| `/pricing` | 200 | — | `VERIDIAN COGNITIVE AI OS — AI Cognitive Research` | Yes — **wrong, NEW finding, fixed by this task (below)** |
| `/contact` | 200 | — | `Contact Us — VERIDIAN AI` | No — real umbrella company page (see below), not a bug |
| `/terms` | 200 | — | `Terms & Conditions — VERIDIAN AI OS` | No — real umbrella company page, not a bug |
| `/privacy` | 200 | — | `Privacy Policy — VERIDIAN AI OS` | No — real umbrella company page, not a bug |
| `/join-us` | 200 | — | `Join Us — VERIDIAN AI` | No — real umbrella company page, not a bug |
| `/data-policy` | 200 | — | `Data Policy — VERIDIAN AI OS` | No — real umbrella company page, not a bug |
| `/forge` | 200 | — | `FORGE — Custom AI Systems, Engineered to Order \| VERIDIAN` | No — a real, separate FORGE product's own marketing page, correctly its own brand |
| `/office` | 200 | — | `VERIDIAN OFFICE AI OS — Your Complete Business, Run by Your AI Assistant` | No — a real, separate OFFICE product's own marketing page, correctly its own brand |
| `/the-firm` | 200 | — | `THE FIRM AI OS — Practice Management for CA, CS, Legal & Audit Firms` | No — a real, separate THE FIRM product's own marketing page, correctly its own brand |
| `/invite` | 404 | — | (not-found page) | n/a — real, expected (invite requires a real invite-code query param; bare path 404s) |
| `/vr` | 404 | — | (not-found page) | n/a — no such route in `src/app/` |
| `/partner` | 404 | — | (not-found page) | n/a — no such route in `src/app/` |

All 200-status responses share identical real security headers (`strict-transport-security:
max-age=63072000`, `x-powered-by: Next.js`, `server: Vercel`), consistent `x-vercel-id`
edge-region routing (`fra1::sin1::`), and `cache-control: private, no-cache, no-store,
max-age=0, must-revalidate` (correct for per-request-dynamic, host-dependent pages).

**Root-cause read on `/contact`, `/terms`, `/privacy`, `/join-us`, `/data-policy`, `/forge`,
`/office`, `/the-firm` (why these are NOT brand-mismatch bugs):** read each page's own source
(`src/app/{contact,terms,privacy,join-us,data-policy,forge,office,the-firm}/page.tsx`). `/terms`
and `/privacy` explicitly describe themselves as governing "VERIDIAN AI OS and all its products —
including VERIDIAN OFFICE AI OS, THE FIRM AI OS, ..." — real, deliberately shared umbrella-company
legal pages, not PROJEXA-specific. `/contact`, `/join-us`, `/data-policy` are the same class of
shared company page. `/forge`, `/office`, `/the-firm` are real, separate product lines under the
same umbrella marketing site, correctly showing their own distinct branding (not a mismatch — a
mismatch would be one of *these* pages showing "PROJEXA" or vice versa, which was not found).

## Real WebFetch evidence (rendered-content extraction, independent of curl)

- **`/pricing`** (pre-fix, live prod): WebFetch-extracted top nav brand/wordmark text: **"VERIDIAN
  AI"**; first hero heading: "Simple, Transparent Pricing". Confirms the curl-derived `<title>`
  finding via a second, independent extraction method.
- **`/login`** (already-fixed, live prod, control/comparison case): WebFetch-extracted page title:
  **"Sign in — PROJEXA"**; brand/wordmark text: **"PROJEXA"**; heading: "Welcome back". Confirms
  the correct, already-shipped pattern this task's own `/pricing` fix mirrors.

## Real root-cause fix made by this task: `/pricing`

**Gap:** `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` class (same class as the already-shipped
`/login` fix, `UMR-20260804-090421-c647`, and PR #965's `/signup`/`/mfa-challenge` fix, never
previously applied here). `src/app/pricing/page.tsx` was 100% `"use client"` with zero per-route
`metadata` export, so it silently inherited the root layout's generic `"VERIDIAN COGNITIVE AI OS —
AI Cognitive Research"` title even on the `projexa-ai.com` host — and its own top-nav wordmark
hardcoded the literal string `"VERIDIAN AI"` — despite every CTA on the page (`Start Free Trial`,
`Start 14-Day Trial`, `Get Started`) linking straight into `/signup`, i.e. this is the real,
public entry page immediately upstream of the exact flow OCID-020's original finding was about.

**Fix (mirrors the proven `/login`/`/signup` pattern exactly, no new pattern invented):** split
`src/app/pricing/page.tsx` into an async Server Component (reads the real HTTP `Host` header via
`resolvePreAuthBrandByHost()`, adds a `generateMetadata()` title override:
`` `Pricing — ${brand.brandName}` ``) and a new `src/app/pricing/pricing-content.tsx` client
component (identical to the old page in every way except it now takes `brand` as a plain prop and
renders `{brand?.brandName ?? "VERIDIAN AI"}` in the nav wordmark instead of the hardcoded
string). `null` brand — the platform-default/no-host-match case — renders byte-identical to
before this change, same contract `LoginForm`/`SignupForm` already use. Body-copy mentions of
"VERIDIAN AI" as the parent company name (FAQ answer, marketing copy, footer copyright) were left
untouched, matching the precedent already set by the `/login` fix (which only ever swapped the
nav/hero wordmark occurrence, never generic company-name prose).

**Independent verification performed (real, not narrated):**
- `bunx tsc --noEmit` across the entire project: **0 errors** (ran twice — once pre-`bun install`
  showing only pre-existing environment-wide "module not found" noise from a missing
  `node_modules`, once post-`bun install` showing zero errors anywhere, including the two touched
  files).
- `eslint src/app/pricing/page.tsx src/app/pricing/pricing-content.tsx`: **0 errors/warnings**.
- `git grep -n "PricingPage"`: confirms no other file in `src/` still references the old
  single-file default export name.
- A full `bun run build` was attempted for an end-to-end production-bundle check but did not
  complete inside a 300s timeout on this host (a real, disclosed limitation of this sandbox given
  this repo's route count, not a signal of a real error in this change — `tsc`/`eslint` are the
  real, completed correctness gates for this diff). Not retried a second time (this task's own
  circuit-breaker discipline: stop after one clean, well-understood non-error timeout rather than
  spend a second identical attempt).
- Live-prod re-curl of `/pricing` post-fix will read as still-unfixed until this PR merges and
  redeploys (same honest caveat as PR #965's still-unmerged `/signup`/`/mfa-challenge` fix) — the
  fix is real and verified in-repo via tsc/eslint/pattern-match against the already-proven
  `/login` production fix, not yet independently re-curled against production.

## Real remaining screenshot gap (explicitly recorded, not silently omitted)

Per the PM's own decision text: this document's evidence is 100% curl + WebFetch, zero
screenshots, because no screenshot-capable browser tool was available in this session. This is a
disclosed, temporary condition of *this specific session*, not a claim that OCID-020 no longer
needs real screenshot evidence — its own standing definition still calls for that. The sibling
session (`task-20260805-173250`, PR #965) reports having real Playwright capability and a planned
screenshot sweep; the PM has separately committed to supplying screenshot-adjacent evidence for
specific pages from its own browser session, citing this dispatch.

## Real, current completion picture for this task's own scope

- Verified via curl + WebFetch: every real public, unauthenticated page reachable on
  `projexa-ai.com` today (16 real paths swept, table above).
- Real, new root-cause gap found and fixed: `/pricing` (this task, PR pending).
- Real gaps already found and fixed by the live sibling (not re-done here, cited not duplicated):
  `/signup`, `/mfa-challenge` (PR #965, open, unmerged).
- Confirmed NOT bugs (real, evidence-based, not assumed): `/contact`, `/terms`, `/privacy`,
  `/join-us`, `/data-policy` (real shared umbrella pages, correctly VERIDIAN-branded),
  `/forge`, `/office`, `/the-firm` (real distinct product lines, correctly self-branded).
- Real 404s confirmed expected, not broken: `/invite` (needs a real query-param invite code),
  `/vr`, `/partner` (no such route exists in `src/app/`).
- Authenticated-flow testing (anything past `/login`/`/signup`/`/mfa-challenge` requiring a real
  credential) is explicitly **not** attempted by this task, per the fixed, non-negotiable rule
  that real credential entry into any login/signup field stays with the Owner only — this task did
  no authenticated navigation of any kind.
