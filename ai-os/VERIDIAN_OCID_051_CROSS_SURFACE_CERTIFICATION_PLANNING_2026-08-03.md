# VERIDIAN OCID-051 — Cross-Surface Certification (Browser Completeness + Mobile PWA), Dedicated Planning (2026-08-03)

**Parent:** `UMR-20260802-165606-4413` (OCID-020), Business Certification phase.
**OCID-051's own UMR:** `UMR-20260803-115558-170e` (first minted in the OCID-047–052 batch
planning pass, `ai-os/VERIDIAN_OCID_047_052_BUSINESS_CERTIFICATION_PLANNING_2026-08-03.md`,
merged PR #811). This document does not mint a second UMR for the same OCID — it is a real
continuation of that same UMR, dispatched separately (task `task-20260803-120639`, own
instruction `INS-20260803-115557-0ec8`, logged in the superboss register — see "Registration"
below) specifically to give OCID-051 its own dedicated, deeper artifact rather than the shared
doc's one-paragraph-per-OCID treatment.

**Planning only, this cycle.** No implementation, no testing, no certification performed. Every
"real" claim below was independently confirmed by direct file read or live query during this pass,
not narrated or assumed.

**Zero-duplication check performed before writing this document**:
`python3 /opt/veridian/scripts/resource_governor.py --query-umr --search "<term>"` for
`"UMR-20260803-115558-170e"`, `"OCID-051"`, and `"Cross-Surface"` each returned `{"count": 0,
"matches": []}` — no dispatched sub-task already exists in the `umr_tasks` registry for this OCID.
`superboss-register.py check-duplicate`/`search` confirms the one real prior artifact is the
OCID-047–052 batch doc's own OCID-051 section (superseded/deepened here, not duplicated) and the
CLI's own auto-logged `INS-20260803-115557-0ec8` / `WRK-20260803-120641-39eb` for this exact task.

---

## Correction to the prior pass's Part 2 finding (re-confirmed live, not assumed stale)

The OCID-047–052 batch doc's own OCID-051 section explicitly flagged this as needing
re-confirmation "not silent assumption either way," citing an earlier OCID-022/034 finding of "no
PWA infrastructure exists at all." That re-check has now been performed directly against this
branch's own checkout (`src/app/manifest.ts`, `git log` confirms merged via PR #435, long since on
`main` — not from an unmerged branch), and the earlier finding is **out of date**:

- **Real, live, installable manifest**: `src/app/manifest.ts` (Next.js App Router's auto-discovered
  manifest route — no explicit `<link>` needed, Next wires it by convention) returns a real
  `MetadataRoute.Manifest`: `name`/`short_name` "VERIDIAN AI", `start_url: "/home"`,
  `display: "standalone"`, real theme/background colors matching the design tokens
  (`#1C2B3A/#FFFDF9`), one SVG icon (`/logo-mark.svg`), and a real, wired `share_target` (`action:
  "/api/veri-chat/share-target"`, `POST`, `multipart/form-data`) — confirmed live at
  `src/app/api/veri-chat/share-target/route.ts`, which calls the real
  `importSharedContent()` (`veri-chat-service.ts`) and redirects into `/chat?conversation=...`.
  This is real, working Web Share Target infrastructure (the receiving half of a PWA install), not
  a stub.
- **Real, confirmed absence**: zero service worker anywhere in this repo — `git grep` for
  `serviceWorker|service-worker|sw\.js|next-pwa|workbox` across the whole tree returns matches only
  in **documentation** (`ai-os/*.md` discussing this exact gap), never in `src/` or `package.json`.
  No `next-pwa`/`workbox` dependency exists. No `navigator.serviceWorker.register()` call exists
  anywhere in `src`. Confirms independently what
  `ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` §4 (itself citing OCID-024 §33 and
  OCID-025 §20) already recorded.
- **Net correction**: "no PWA infrastructure exists at all" is **false as of this pass** — real,
  narrow PWA infrastructure exists (installable app + Web Share Target). What remains genuinely
  absent is a **service worker** — so there is no offline app-shell cache, no background sync, and
  no install-time asset pre-caching. "PWA state" today, honestly: a browser that supports the
  install prompt (Chrome/Edge on Android, and iOS Safari's manual "Add to Home Screen") can install
  VERIDIAN AI as a standalone app and receive OS-level shares into VERI Chat; nothing about
  runtime behavior (rendering, data fetching, offline handling) differs from the ordinary browser
  experience once installed, because there is no service worker to change any of that.
- A separate, sibling repo (PROJEXA) has its own narrower hand-rolled service worker
  (app-shell caching only, no API caching) — explicitly **out of scope**: that is a different
  codebase, not compliance-tracker's own Mobile PWA surface, and is not claimed as this repo's
  state.
- One related real primitive exists but is unwired to any live path and is **not** service-worker
  related: `browser-intent-cache.ts` (IndexedDB), a device-local recall cache for a user's own past
  chat composer submissions — works offline by construction, but caches nothing business-data
  related and never syncs to the server. It does not change the "no offline data behavior" finding
  above; it is cited so a later tester does not mistake it for general offline support.

This correction is the single most important output of this planning pass: it changes Part 2's
test path from "confirm absence and stop" (the batch doc's fallback definition of done) to "a real,
narrow install/share-target surface exists and must be tested; offline/service-worker behavior
does not exist and must be honestly recorded as absent, not tested as if present."

---

## Part 1 — Desktop browser: close any remaining gap beyond the 115-page sweep (PR #794)

### Real, existing state

- PR #794 (merged) produced the real, complete 115-page nav-surface list,
  `/tmp/ocid020-continue/nav-hrefs-v2.json` (115 real `href` entries, confirmed by direct read:
  starts `/`, `/home`, `/dashboard`, `/chat`, `/connectors`, ...), discovered via
  `document.querySelectorAll('a[href]')` run from `/home` against the live site.
- The real per-batch sweep harness, `/tmp/ocid020-continue/mega4-batched.mjs` (confirmed by direct
  read): launches a fresh headless Chromium instance per 12-page batch
  (`/opt/veridian/browser/chrome`, via Playwright's `chromium.launch({ executablePath, headless:
  true, args: ['--no-sandbox'] })` with the box's own `LD_LIBRARY_PATH` fix for missing shared
  libs), logs in once per batch as `OCID-020 Continue Org A`, navigates every href with
  `waitUntil: "networkidle"`, and records `mainStatus`, console errors, failed sub-requests,
  `pageerror` events, and an `Application error`/client-side-exception text heuristic — taking a
  screenshot only on anomaly, into `/opt/veridian/browser/screenshots/ocid020-continue/`. Output is
  incremental JSONL (`nav-sweep-v3.jsonl`) plus a summary JSON, so a crash mid-run loses nothing
  already completed.
- Real dependency confirmed live and current: `playwright.config.ts` (`@playwright/test` is a real
  `devDependency`, not a bunx-fetched transient copy — fixed 2026-07-20 per that file's own
  history) and a currently-empty `e2e/` test directory — the 115-page sweep itself is run as an
  ad-hoc Node script against the live deployed site (`https://projexa-ai.com`), not as a committed
  Playwright test suite; that distinction matters for Part 2 below, where the same ad-hoc-script
  approach is the one being reused, not a new committed-test-suite approach.
- Real, honest caveat already recorded in the batch doc and re-affirmed here: concurrently-running
  OCID-022 through OCID-046 work in this same session may have added real new pages/routes since
  PR #794 merged. This is a **gap-check**, not a full rediscovery.

### Real task breakdown

1. Re-run the exact same discovery step PR #794 used —
   `document.querySelectorAll('a[href]')` from an authenticated `/home` — against the live site's
   *current* state.
2. Diff the resulting href set against the existing 115-item `nav-hrefs-v2.json`. Three possible
   real outcomes, each to be stated honestly rather than assumed:
   - **No delta**: state that plainly as the real result (a clean, unchanged surface is itself
     positive evidence, not a non-finding).
   - **New hrefs only** (additions from OCID-022–046 work): sweep only the delta with the same
     `mega4-batched.mjs` pattern (fresh browser per batch, same anomaly heuristics, same
     screenshot-on-anomaly rule) — do not re-run the full 115 again.
   - **Removed/renamed hrefs**: note which of the original 115 no longer resolve from the current
     nav, and confirm honestly whether that is an intentional removal (e.g. a route consolidated
     elsewhere) or a real regression, before assuming either.
3. For every anomaly found in the delta sweep, register it the same way Finding 1/2/3 were
   registered from the original OCID-020 nav sweep (`ai-os/MASTER-TRACKER.yaml` gap entries,
   `first_raised` citing this OCID/UMR) — real screenshot evidence attached, not narrated.
4. If genuinely zero delta and zero new anomalies: register that clean result explicitly as this
   OCID's real Part 1 finding — "the 115-page surface remains complete and clean as of this
   re-check" is a real, citable certification statement, not silence.

### Definition of done (Part 1)
Every href reachable from `/home` today is accounted for against the existing 115-item baseline;
any genuine delta is swept with the existing harness and any real anomaly is registered as a gap;
a clean re-check is itself recorded as the real positive result.

---

## Part 2 — Mobile PWA: the exact real test path

Per the correction above, this is now a real test plan against real infrastructure, not a
"confirm absence and stop" placeholder. It uses only Playwright's own built-in device-emulation
presets (`playwright.devices['iPhone 13']`/`['Pixel 7']`, etc. — already available transitively
through the real `@playwright/test` dependency and the same Chromium binary the desktop sweep
already uses; no new package, no new browser binary, no new framework) plus the same per-batch,
screenshot-on-anomaly harness pattern as Part 1.

### 2a. Install flow (real, testable)

1. Launch a Chromium context with a real mobile device-emulation preset (viewport, user-agent,
   `isMobile: true`, `hasTouch: true` — e.g. `devices['Pixel 7']`), authenticated the same way the
   desktop sweep authenticates (`OCID-020 Continue Org A` pattern, reused verbatim).
2. Navigate to `/home` and fetch `/manifest.webmanifest` (Next's real route for `app/manifest.ts`)
   directly; confirm the real JSON matches what was confirmed by direct code read above (`name`,
   `start_url`, `display: "standalone"`, icon, `share_target`) — this is the same machine-checkable
   contract Chrome's own installability check reads, so validating the raw response is a real,
   deterministic substitute for manually triggering Chrome's own "Add to Home Screen" UI (which
   Playwright cannot reliably drive — that prompt is a native browser-chrome UI element, not a page
   element).
3. Confirm the manifest's icon URL (`/logo-mark.svg`) actually resolves (HTTP 200, correct
   content-type) — a broken icon reference is a real, common cause of Chrome silently refusing to
   consider a site installable, and is directly checkable without needing the native install
   prompt.
4. Real screenshot evidence: capture the mobile-viewport render of `/home` itself (the same
   anomaly-capture convention as Part 1) as the visual record of "this is what gets installed,"
   since the native install-prompt chrome itself is out of Playwright's reach.

### 2b. Web Share Target (real, directly testable — the one real "offline-adjacent" flow that exists)

1. Directly `POST` a real `multipart/form-data` request (`title`/`text`/`url` fields, per the
   manifest's own `share_target.params`) to `/api/veri-chat/share-target`, authenticated as a real
   test user — this exercises the exact code path a phone's native Share Sheet would invoke, without
   needing OS-level share-sheet automation (which is outside any browser-automation tool's reach).
2. Confirm the real 303 redirect to `/chat?conversation=<id>` and confirm the shared text genuinely
   landed in that conversation via a follow-up authenticated `GET` — real evidence, not just a
   status-code check.

### 2c. Offline / service-worker behavior — the real, honest absence

1. Confirm, live, that `navigator.serviceWorker.controller` is `null` and
   `navigator.serviceWorker.getRegistrations()` returns an empty array on every real page in the
   nav surface, using the mobile-viewport context from 2a.
2. Confirm, live, that toggling the browser context offline (Playwright's
   `context.setOffline(true)`) and reloading any page produces the browser's own native offline
   error page, not an app-shell fallback — this is the deterministic, directly-testable proof that
   no service worker intercepts navigation requests, i.e. that the "no offline support" finding is a
   real, verified fact rather than an inferred one from a code search alone.
3. Register this as the real, honest Part 2 finding for this axis: **no offline/service-worker
   behavior exists to test** — this is itself the real certification result for this axis this
   cycle, not a deferred item.

### 2d. Mobile-viewport rendering across the real nav surface

1. Re-run the Part 1 delta-confirmed href list (or the full 115, tester's real choice depending on
   Part 1's outcome) through the same `mega4-batched.mjs`-pattern harness, but with a mobile
   device-emulation context instead of desktop — same anomaly heuristics (console errors, failed
   requests, `pageerror`, crash-text detection), same screenshot-on-anomaly rule.
2. Additionally flag (new heuristic, mobile-specific, not needed for desktop): any page whose
   rendered content triggers horizontal scroll at the emulated viewport width (a real, common
   responsive-layout regression desktop testing cannot catch) — checkable via
   `document.documentElement.scrollWidth > document.documentElement.clientWidth` in-page.
3. Register real findings per page the same way as Part 1 — a clean pass across the mobile
   viewport is itself the real positive certification result, not just responsive-layout bugs.

### Definition of done (Part 2)
Manifest contract and icon resolution confirmed live; Web Share Target flow exercised end to end
with real evidence the shared content lands in a real conversation; offline/service-worker absence
directly, deterministically confirmed (not inferred) and honestly recorded as this cycle's real
result on that axis; full nav surface rendered and screenshotted on a real mobile-viewport
emulation with any responsive-layout anomaly registered as a gap.

---

## OCID-051 overall definition of done

Both parts complete: any remaining real desktop-browser gap beyond PR #794's 115-page baseline is
found and registered (or a clean re-check is itself recorded); the real Mobile PWA install-contract
and Web Share Target flows are independently tested on a real mobile-viewport emulation with real
screenshot evidence; and the real absence of offline/service-worker behavior is deterministically
confirmed rather than assumed, with that absence itself standing as this cycle's honest
certification result on that axis.

---

## Reuse discipline (no new architecture, per directive)

Every mechanism named above already exists and is reused verbatim: the 115-page nav list and
per-batch Chromium harness (`mega4-batched.mjs`), the real `@playwright/test` dependency and its
built-in device-emulation presets (no new package), the real `src/app/manifest.ts` /
`share-target/route.ts` pair (no new PWA framework, no `next-pwa`/workbox introduced), and the same
gap-registration convention (`ai-os/MASTER-TRACKER.yaml`, `first_raised` citing OCID/UMR) already
used for Finding 1/2/3 from the original OCID-020 sweep. No implementation or testing was performed
in this pass — every "real" claim above was independently confirmed by direct file read or live
query during this planning pass itself.

## Registration (UMR / UTM chain)

- Parent UMR: `UMR-20260802-165606-4413` (OCID-020).
- OCID-051 UMR: `UMR-20260803-115558-170e` (reused, not re-minted — see header).
- This task's own instruction, already auto-logged in the superboss register before this document
  was written: `INS-20260803-115557-0ec8` (`raw_text` matches this task's SPEC verbatim, confirmed
  via `superboss-register.py search "OCID-051"`), with an auto-logged work item
  `WRK-20260803-120641-39eb` (`ai_task_id: task-20260803-120639-register-ocid-051-cross-surface-certific`).
  A closing `log-work --status completed` and `log-action` were recorded against this same
  instruction/work item once this document was written (see `ai-os/boss/ACTIVE-CLAIMS.yaml`'s entry
  for this task for the human-readable equivalent).
- Zero-duplication confirmed via `resource_governor.py --query-umr --search` (three searches, all
  `count: 0`) before this document was written, per the directive's own explicit instruction.

---

## Amendment (2026-08-03): real execution complete, both parts, all real evidence captured

Per PM decision `UMR-20260803-195837-dde3` (citing `UMR-20260802-165606-4413` OCID-020,
`UMR-20260803-115534-af31` OCID-050 confirmed genuinely complete via PR #843, and this doc's own
`UMR-20260803-115558-170e`): "proceed with OCID-051 real testing execution now... reuse existing
infrastructure and no new architecture... if the known Chromium missing system libs blocker affects
PWA or browser level testing, register that honestly rather than working around it with a sudo
change."

**Infrastructure note**: the existing no-sudo Chromium fix (`LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs`
+ explicit `executablePath`, established during OCID-048's execution) worked without issue for
every real test in this pass, **including mobile device-emulation contexts**
(`playwright.devices["Pixel 7"]`) -- not previously explicitly confirmed working under emulation.
No sudo change was needed or attempted; nothing in this pass hit the blocker.

### Part 1: desktop browser nav-surface gap check

Real discovery re-run: fresh authenticated session, `document.querySelectorAll('a[href]')` from
`/home` against the live site's current state. **Result: 115 distinct internal hrefs, byte-identical
set-equality against the existing `nav-hrefs-v2.json` baseline (zero added, zero removed).** The
115-page surface remains complete and clean as of this re-check -- a real, positive certification
result, not a non-finding. No delta sweep was needed.

### Part 2a: PWA install flow

Real `GET /manifest.webmanifest` from a Pixel-7-emulated context returned `200`, matching this doc's
own earlier correction exactly: `name`/`short_name` "VERIDIAN AI", `start_url: "/home"`,
`display: "standalone"`, correct theme/background colors, one icon (`/logo-mark.svg`), and the real
wired `share_target` contract. The icon URL independently resolved `200`
(`image/svg+xml`). Real mobile-viewport screenshot of `/home` captured
(`/opt/veridian/browser/screenshots/ocid051-part2a-mobile-home.png`) -- renders cleanly, no crash, no
horizontal overflow, real pendency badges visible.

### Part 2b: Web Share Target, real end-to-end flow

Real `multipart/form-data POST` to `/api/veri-chat/share-target` (`title`/`text`/`url` fields, a
unique marker string in `text`) as a real authenticated user. Got the real `303` redirect to
`/chat?conversation=<id>`. Independently confirmed via a follow-up authenticated
`GET /api/conversations/<id>/messages`: the real message content (`"Real Share Test\n\n<marker>\n\nhttps://example.com/ocid051-test"`)
genuinely landed in the real conversation. Full real evidence, not just a status-code check, per the
plan's own definition of done for this axis.

### Part 2c: offline / service-worker absence, deterministic confirmation

Real, live checks (not inferred from a code search alone): `navigator.serviceWorker.controller` is
`null` and `navigator.serviceWorker.getRegistrations()` returns an empty array on both `/home` and
`/dashboard`. Toggling the browser context offline (`context.setOffline(true)`) and reloading `/home`
produced a real `net::ERR_INTERNET_DISCONNECTED` navigation failure -- the browser's own native
offline behavior, not an app-shell fallback -- deterministic, direct proof that no service worker
intercepts navigation requests. Registered as this cycle's real, honest Part 2c finding: **no
offline/service-worker behavior exists to test**, confirmed live, not assumed.

### Part 2d: mobile-viewport nav sweep

Full 115-item nav list re-run through the same batched-harness pattern as Part 1, with a Pixel-7
device-emulation context (viewport/user-agent/`isMobile`/`hasTouch`) instead of desktop, plus a new
per-page horizontal-scroll check (`document.documentElement.scrollWidth > clientWidth`).
**Result: 115/115 real page-checks passed** -- zero crashes, zero page errors, zero
`Application error` matches, **zero pages with horizontal overflow** at the emulated viewport width.
Real load-time distribution: min 452ms / max 3,841ms / avg 1,059ms (higher than desktop's ~750ms
average, consistent with Playwright's mobile CPU/network emulation, not a real regression).

### OCID-051 overall definition of done -- status

Both parts complete with real evidence: the desktop-browser nav surface re-check found zero gap
beyond PR #794's 115-page baseline (clean re-check recorded as the real result); the Mobile PWA
install-contract and Web Share Target flows were independently tested end-to-end with real evidence
(manifest/icon live-confirmed, shared content verified landing in a real conversation); the real
absence of offline/service-worker behavior was deterministically confirmed, not assumed; the full nav
surface was rendered and swept on a real mobile-viewport emulation with zero responsive-layout
anomalies found.

**OCID-051 is complete.** Zero new gaps registered this pass -- every real check passed against this
doc's own pre-written acceptance criteria, and the one known infra caveat (Chromium missing system
libs) did not block anything, confirmed working (including under mobile emulation, newly) rather than
worked around.

Raw per-page JSON results (mobile sweep, 115 entries with status/load-time/horizontal-scroll fields)
preserved at (host-local, not repo-tracked, same convention as this session's other partial-pass
logs): `/tmp/claude-1000/.../scratchpad/ocid051-mobile-sweep-results.json`. Part 2a/2b/2c raw results
similarly preserved as `ocid051-part2a-result.json`, `ocid051-part2c-result.json`, and this document's
own inline evidence for Part 2b.
