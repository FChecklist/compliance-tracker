# R46 P6 — Performance Audit (3 Hard Classes)

**Source of truth for:** `platform.r43_queue` seq 20 (M12_PERF), ref A.5/A.8.
**Date measured:** 2026-08-24 (UTC), against real production —
`https://projexa-ai.com` (frontend) and its backing compliance-tracker API
(same Vercel deployment the assistant pipeline runs in), authenticated as
the real demo account (`democeo@projexa-ai.com`) via the same zero-password
`mint-session-r33` Edge Function flow `e2e/demo-gate-smoke.spec.ts` uses
(GoTrue `token_hash` → real session, no password typed or stored).

**Scope discipline (per R43 A.5/A.8's own gap text):** this file measures
ONLY the three HARD classes — feedback on keystroke/click, L0 cache hit,
navigation-to-rendered-skeleton. It does not attempt "all interactions
under 200ms," which the gap itself calls physically impossible. TARGET
classes (server read/L1 classify/report export) are out of scope for this
file.

**Verdict: 1 of 3 HARD classes passes. 2 of 3 fail badly (30-65×
target).** Numbers below are real, not estimated — see raw data and the
exact commands used to produce them. This is being reported honestly per
this gap's own oracle text ("report the average... All HARD classes
pass" is the target; this run shows it is not currently met for 2 of the
3 classes).

---

## Method note: why two different tools were used

The Browser tool's rendering-dependent primitives (`computer` screenshot,
`read_page` with compositing, `get_page_text`, `requestAnimationFrame`
inside `javascript_tool`) timed out with "the Browser pane is not
displayed, so the page is not compositing frames" in this headless
session — there is no visible pane to composite into. Plain JS execution
(`javascript_tool` without `requestAnimationFrame`), CDP-level
`read_network_requests`, and `navigate` all worked normally once the tab
was a **freshly created foreground tab** (`tabs_create` with
`foreground: true`) rather than a background tab. Class 1 and Class 3
below use real `performance.now()` / `PerformanceNavigationTiming`
readings taken inside the live page via `javascript_tool` — genuine
client-side timing, not curl. Class 2 and the Class-3 cross-check use
`curl -w "%{time_total}"` / `%{time_starttransfer}` per the task's own
"cross-check" instruction. Both methods agree on the two failing classes
(same order of magnitude), which rules out a browser-tool measurement
artifact.

---

## Class 1 — UI feedback latency < 100ms

**What "UI feedback" means here, precisely:** time from a user action to
the UI's OWN visible response (spinner / optimistic update / immediate
DOM change) — explicitly NOT a round trip to the server. The closest
real, non-fabricated proxy available: the theme toggle button
(`button[aria-label^="Switch to"]`, a real control in the live app's
topbar, confirmed present via `read_page` on `https://projexa-ai.com`
after authenticating) is a pure client-state interaction with **zero
network request** (confirmed: no fetch/XHR fired by this control — it
only flips a class on `<html>`). Measured via a `MutationObserver`
attached to `document.documentElement` before the click, capturing
`performance.now()` at click-dispatch and at the first attribute
mutation the click produced, run 5 times in the live production page
(`https://projexa-ai.com/dashboard`, authenticated).

| Run | Sync handler (ms) | Time to DOM mutation (ms) | DOM changed |
|---|---|---|---|
| 1 | 4.1 | 10.5 | yes |
| 2 | 1.1 | 5.0 | yes |
| 3 | 1.2 | 4.8 | yes |
| 4 | 3.1 | 16.9 | yes |
| 5 | 1.2 | 4.9 | yes |

**Median (time-to-DOM-mutation): 5.0ms.** Max: 16.9ms.

**Result: PASS** — 5/5 runs under 100ms, median ~20x under target.

**Honest limitation:** this measures one specific, verified-network-free
client interaction (theme toggle). It is a real proxy per the task's own
allowance ("Browser tool's network-request timing for when a client-side
state update fires"), not a claim that *every* click in the app responds
this fast — an interaction that waits on server data before showing
anything (no optimistic UI) would inherit Class 3's server-latency
numbers below instead. This file does not claim to have surveyed every
control in the app.

---

## Class 2 — L0 cache hit < 200ms

**Real L0 implementation found in this codebase** (grep for `L0`/`l0`
across `src/lib`, confirmed by reading the source, not assumed):
- `src/lib/segmentation/classify.ts` — `classifyL0()`, the "Level 0"
  ladder from M25/M26: acknowledgement list → phrase_map EXACT match →
  structural pattern (item-code + percent) → last-action recall → miss.
  Every tier is deterministic, $0, and — this is the actual definition of
  an "L0 hit" in this codebase — **never calls the AI adapter.**
- `src/lib/segmentation/pipeline.ts` — `runSubmission()`, which wires
  `classifyL0()` into the only live HTTP path that exercises it:
  `POST /api/v1/projexa/assistant` (compliance-tracker) via projexa's own
  `POST /api/assistant` proxy (`src/app/api/assistant/route.ts`,
  `callVeridian("/assistant", ...)`).

**What was measured:** 5 real `POST https://projexa-ai.com/api/assistant`
calls, authenticated, each with a `rawInput` engineered to hit
`classifyL0()`'s **tier-3 structural match** deterministically (an
item-code token + a percent, e.g. `"ZZ-AUDIT2-999 12% done"`) without
depending on any pre-seeded phrase_map row. Each response was inspected
to confirm the classification genuinely resolved at L0 with **no AI
call**: every run returned `functionId: "record_work_progress"` with the
task only failing later, at execution time, on `"no project resolved for
this task"` — proof the AI adapter was never reached (an L0 *miss* would
instead produce a chat message from the L1/AI path, e.g. "I can't do that
yet"). Fake, clearly-marked, non-existent item codes (`ZZ-AUDIT*-999`)
were used deliberately so no real BOQ line could ever match and no real
production data was touched; the only write is an audit-trail
`submissions`/`pipeline_tasks` row, which is this endpoint's normal,
intended behaviour for any real query, not test pollution.

`curl -s -m 20 -X POST https://projexa-ai.com/api/assistant -H "Cookie: sb-evpckeuxgvahguwsaeul-auth-token=<session>" -H "Content-Type: application/json" -d '{"rawInput":"ZZ-AUDIT<n>-999 1<n>% done","mode":"Projects"}' -w "%{http_code} %{time_total} %{time_starttransfer}"`

| Run | HTTP | time_total (s) | time_to_first_byte (s) | L0 tier confirmed |
|---|---|---|---|---|
| 1 | 201 | 6.396 | 6.394 | structural (no AI) |
| 2 | 201 | 7.247 | 7.245 | structural (no AI) |
| 3 | 201 | 3.965 | 3.963 | structural (no AI) |
| 4 | 201 | 13.887 | 13.879 | structural (no AI) |
| 5 | 201 | 8.442 | 8.441 | structural (no AI) |

(A 6th attempt, run before run 1 above and discarded from the 5, hard
`curl -m 20` timed out with no response at all — kept out of the median
as an invalid data point, but reported here as real evidence of tail
latency beyond 20s on at least one occasion.)

**Median: 7.247s (7247ms).**

**Result: FAIL — ~36× over the 200ms target.**

**Root-cause note (honest, not speculative beyond what was measured):**
`classifyL0()` itself is a fast in-process regex match plus at most one
indexed DB lookup — it is not the bottleneck. The measured 4-14s is the
**full HTTP round trip** through `POST /api/assistant`: Next.js
auth/session resolution, `withTenantContext()` RLS setup, a `submissions`
INSERT, the L0 classification, a `pipeline_tasks` INSERT, an
`executeTask()` attempt (its own DB query), and an UPDATE — each a
separate sequential `await`, each paying at least one Supabase
`ap-south-1` round trip (per this gap's own stated 50-150ms floor), plus
whatever Vercel serverless cold-start/compute cost sits on top. This is
real production latency on the one live endpoint that exercises this L0
ladder today, not a measurement artifact — it is corroborated by Class
3's independent measurement below showing the same multi-second order of
magnitude on ordinary page navigations.

---

## Class 3 — Navigation-to-rendered-skeleton < 200ms

**What was measured:** time from navigation start to
`domInteractive` (`PerformanceNavigationTiming.domInteractive` —
DOM parsing complete, the earliest point in the standard Navigation
Timing API at which a route's initial shell/skeleton markup exists in the
DOM) for 5 real navigations to 5 different authenticated routes on
`https://projexa-ai.com`, each a fresh full navigation (not a client-side
transition), read via `performance.getEntriesByType('navigation')` inside
the live page.

| # | Route requested | Resolved to | responseStart (ms) | domInteractive (ms) |
|---|---|---|---|---|
| 1 | `/schedule` | `/work-progress` (redirect) | 5037.8 | 6319.0 |
| 2 | `/permits` | `/permits` | 6373.1 | 10680.6 |
| 3 | `/documents` | `/documents` | 5924.8 | 6134.2 |
| 4 | `/rfis` | `/rfis` | 4949.6 | 5128.5 |
| 5 | `/reports` | `/reports` | 6953.3 | 7274.3 |

**Median domInteractive: 6319.0ms (6.32s).**

**Result: FAIL — ~32× over the 200ms target.**

**Cross-check (raw HTTP, curl, same 5 routes, same session cookie, per
the task's "curl as a cross-check" instruction):**

`curl -s -m 30 https://projexa-ai.com/<route> -H "Cookie: sb-evpckeuxgvahguwsaeul-auth-token=<session>" -w "%{http_code} %{time_starttransfer} %{time_total}"`

| Route | HTTP | time_to_first_byte (s) | time_total (s) |
|---|---|---|---|
| work-progress | 200 | 11.530 | 12.056 |
| permits | 200 | 6.282 | 6.642 |
| documents | 200 | 7.943 | 8.407 |
| rfis | 200 | 6.693 | 6.985 |
| reports | 200 | 12.138 | 27.490 |

The curl cross-check agrees with the browser-measured numbers to within
the same order of magnitude on every route (both tools independently show
multi-second, not sub-200ms, response), which rules out this being a
Browser-tool measurement artifact — it reflects real server-side latency
on `projexa-ai.com`, consistent with Class 2's finding above.

---

## Summary

| Class | Target | Median (5 real runs) | Result |
|---|---|---|---|
| 1. UI feedback (client-only) | <100ms | 5.0ms | **PASS** |
| 2. L0 cache hit (full HTTP round trip) | <200ms | 7,247ms | **FAIL (~36×)** |
| 3. Navigation → rendered shell | <200ms | 6,319ms | **FAIL (~32×)** |

**All 3 HARD classes do NOT currently pass.** Class 1 passes with large
margin. Classes 2 and 3 fail by roughly 30-65× the target, and are
corroborated by two independent measurement methods (in-browser
Performance API and raw curl). This is not attributable to the ap-south-1
RTT floor this gap's own text calls out (50-150ms) — the observed
latency is a full order of magnitude beyond that floor, pointing at
sequential per-request DB/compute cost (see Class 2's root-cause note)
rather than pure network RTT. Closing this gap for real would mean
profiling `POST /api/assistant` and the authenticated page-render path
for what is actually consuming the 4-14 seconds — out of scope for this
measurement-only audit.

## Raw data files (this session, not committed — see below)

Raw curl/JS output for every run above was captured to this session's
scratchpad during measurement; the tables above are the complete,
unedited numbers from those runs (no outliers dropped except the one
explicitly discarded hard-timeout noted under Class 2).
