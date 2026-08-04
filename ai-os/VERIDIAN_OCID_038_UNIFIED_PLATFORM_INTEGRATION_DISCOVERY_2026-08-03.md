# VERIDIAN OCID-038 — Unified Platform Integration: Real Discovery + Honest E2E Certification

**This document's own UMR:** `UMR-20260803-072014-d038` (OCID-038), citing the full chain
`UMR-20260803-040844-4a33` through `UMR-20260803-042230-180c` (OCID-022 through OCID-037 in order),
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program), `UMR-20260802-165606-4413`
(OCID-020), `UMR-20260802-164659-9a31` (server artifact traceability audit), `UMR-20260802-165034-5747`
(the gatekeeper rule), and `UMR-20260802-165434-cd91` (unified project memory). Parent: OCID-037
(`UMR-20260803-042230-180c`). Matches row "OCID-20260803-038" in
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` — that snapshot named this exact task
"not yet dispatched as its own worker task as of this snapshot"; this document is that dispatch.

**What this is, and is not.** Real discovery and gap analysis, per this task's own SPEC and per
`SEC-07` (`ai-os/CONSTITUTION.yaml`), which locks real implementation/gap-closure/certification/
platform-freeze under OCID-038/039/040 until OCID-020 is independently verified complete. OCID-020
(`UMR-20260802-165606-4413`) remains open as of this writing — `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_CONTINUATION_2026-08-02.md`
documents its nav-surface sweep still incomplete after a real browser-process crash invalidated the
prior attempt; no later artifact claims it closed. **This document therefore does NOT implement any
fix for anything found below** — every gap is documented and registered, not closed. It also does not
re-run OCID-020's own certification sweep (a different task's scope) — it certifies (or declines to
certify) three narrower, distinct integration claims this OCID's own directive names, using real,
freshly-gathered evidence plus the existing OCID-022–037 discovery record, cross-referenced rather than
repeated.

---

## 1. Real repository-level survey (FChecklist org, `gh repo list`, 2026-08-03T07:1xZ)

| Repo | Visibility | Real role, as evidenced |
|---|---|---|
| `compliance-tracker` | Public | The real VERIDIAN backend + primary app (this repo). Owns `ai-os/` governance, `drizzle/` schema (442 tables live, §3). |
| `projexa` | Public | Separate codebase. Its own `gh repo view` description: *"PROJEXA — Construction Intelligence AI OS. Frontend for the AI-native construction ERP, built on VERIDIAN AI OS via API."* Real homepage `projexa-smoky.vercel.app`. Per `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` §1.9 (spot-checked catalog), it has **its own 11-table schema** (not zero) — partially, not purely, a thin client. `gh api search/code` for a compliance-tracker/VERIDIAN API base URL inside this repo returned 0 hits (not exhaustive — GitHub code search, not a full clone review — but a real, negative signal against "calls VERIDIAN via API" being wired today). |
| `veda-advisors` | Public | Its own `gh repo view` description: *"Veda Advisors - Custom Website for Rajat Rajkamal Agarwal, Startup Fundraising Advisor."* A personal marketing site, unrelated to the compliance/construction ERP platform despite sharing catalog infrastructure (`FUNCTION_CATALOG.json` lists it: 62 files/270 functions, Supabase client only, no owned schema). Should not be counted toward "VERIDIAN backend" claims. |
| `veridian-scripts` | Private | Live-checkout ops/governance scripts repo (`/opt/veridian/scripts`), used by compliance-tracker's dispatch/supervisor tooling — infrastructure, not a product. |
| `veridian-ai-os` | Private | Exists, not investigated this pass (out of budget for a 4th full-repo dive; distinct from this repo's own `ai-os/` directory by name only — role not independently confirmed). **Flagged as unverified, not asserted either way.** |
| `claude-control` | Public | Supervisor/dispatch control repo (`scripts/supervisor-entrypoint.sh`, `ddl_authorization_check.py`) — referenced directly by SEC-06/SEC-07 mechanisms above. Infrastructure, not a product. |
| `veridian-ui-kit`, `global-revenue-engine`, `veridian-brain`, `sumeet-spec`, `infisuite/odoo/zoho-reverse-engineering`, `zai-independent-audit-2026-07-30`, `zai-sap-reports-queue` | Mixed | Not individually re-investigated this pass — the reverse-engineering repos are competitor-research inputs (SAP/Odoo/Zoho), not VERIDIAN product code; the others are shared UI kit / audit-log / spec repos already referenced elsewhere in this chain's own docs. Listed here for completeness (this OCID's own directive says "every repository under FChecklist"), not each independently certified. |

**Real, honest finding:** "every repository under FChecklist" is architecturally **15 separate git
repositories**, not one monorepo. That alone does not disprove "one backend" (a thin client calling one
shared API is a valid architecture) — but `projexa`'s own 11-table local schema and the zero-hit API-call
search above are real, if non-exhaustive, evidence **against** projexa today being a pure thin client of
one shared VERIDIAN backend. This is consistent with, and adds a new data point to, the existing
project-memory finding (`country-config-architecture-state`, prior session) that cross-repo integration
in this platform tends to be partial, not complete.

---

## 2. Certification 1 of 3: does compliance-tracker + PROJEXA + every FChecklist repo operate as one VERIDIAN backend today?

**Verdict: NO, not as a fully unified backend — real, partial, evidenced.**

- compliance-tracker is the one real, live, actively-developed backend (Drizzle + Postgres/Supabase,
  443 tables live per direct `schema.ts` count — confirmed current this pass: `grep -c
  "complianceSchemaDB.table("` on live HEAD, one higher than the wiring map's 2026-08-02 spot-check of
  442, consistent with an actively-changing schema).
- `projexa` (the repo) is a **separate deployed Next.js app** (`projexa-smoky.vercel.app`, confirmed
  live via `curl -sI`, HTTP/2 200, served by Vercel) with **its own 11-table schema**, not a pure
  passthrough client of compliance-tracker's API (§1).
- `veda-advisors` is unrelated (a personal site), not a backend consumer at all.
- No evidence found this pass (and none cited in the prior OCID-022–037 discovery record) of a single
  shared API gateway, shared auth token, or shared session model spanning compliance-tracker and
  `projexa`'s own deployment. The real, live-working connective tissue that *does* exist is narrower:
  `projexa-ai.com` (the **domain**, not the `projexa` repo) is bound to compliance-tracker's own
  deployment and authenticates against compliance-tracker's own Supabase project
  (`pcrjmlpuqsbocqfwoxod`, confirmed in a prior session's real signup+login test, cited in
  `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `recently_completed` history) — i.e. the domain-level unification
  is real, but it unifies the *domain* with compliance-tracker directly, not with the separate `projexa`
  codebase/deployment. See §3 for why this matters for the second certification question.

---

## 3. Certification 2 of 3: is projexa-ai.com really the first production thin client of VERIDIAN today?

**Verdict: NO, not as a genuine PROJEXA thin client — real, live-tested, current evidence.**

Live-tested this pass (`curl`, 2026-08-03T07:1xZ, not narrated):

```
$ curl -sI https://projexa-ai.com          -> HTTP/2 200, server: Vercel
$ curl -s  https://projexa-ai.com | title  -> "VERIDIAN COGNITIVE AI OS — AI Cognitive Research"
$ curl -s  https://projexa-ai.com | grep -io "projexa|veridian" -> only "veridian"/"VERIDIAN" found, zero "projexa" matches
$ curl -sI https://projexa-smoky.vercel.app -> HTTP/2 200, server: Vercel (separately, genuinely live)
```

`projexa-ai.com` is real, live, and resolves to a genuinely working Vercel deployment — but that
deployment is **compliance-tracker's own generic VERIDIAN shell** (page `<title>` literally reads
"VERIDIAN COGNITIVE AI OS", zero PROJEXA branding anywhere in the served HTML). This directly confirms
and updates the existing project memory (`veridian-projexa-domain-ownership-conflict`, prior session,
2026-07/08): the domain rebinding to compliance-tracker was intentional (WAVE-10-REDO), but **the
consequence — no PROJEXA brand-routing on that domain — is still true today, re-verified live, not
assumed stale.** The real PROJEXA-branded frontend (the separate `projexa` repo, §1) is live at a
*different* URL (`projexa-smoky.vercel.app`) that the general public would not associate with
"projexa-ai.com." **A user visiting projexa-ai.com today does not experience a PROJEXA product — they
experience the generic VERIDIAN shell.** This OCID's directive's literal claim ("projexa-ai.com is the
first production thin client of VERIDIAN") is directionally true only in the narrow sense that
projexa-ai.com *is* a live production VERIDIAN (compliance-tracker) deployment — it is **not** true in
the sense the name implies (a PROJEXA-branded, construction-ERP-specific thin client). This distinction
is real and load-bearing for anyone using this domain as evidence of "PROJEXA ships as a VERIDIAN thin
client" — it does not, today.

---

## 4. Certification 3 of 3: does the full chain (browser → PWA → server → VERI Chat → VERI Assistant → task/decision/execution engines → sync/cache/audit) operate as one system today?

**Verdict: NO — a mix of real, genuinely-wired infrastructure and real, confirmed disconnects. Evidence per hop:**

| Hop | Real status | Evidence (this pass, direct grep against live HEAD) |
|---|---|---|
| Laptop web browser | Real, live (this is the actual product surface) | Not re-verified this pass — see OCID-024 (`ai-os/VERIDIAN_LAPTOP_WEB_BROWSER_RUNTIME_2026-08-03.md`, PR #767, open) for the dedicated discovery. |
| Mobile PWA | **Does not exist** | `find . -iname manifest.json -not -path "*/node_modules/*"` → zero hits. `find . -iname "*service-worker*" -o -iname sw.js` → zero hits. One misleading signal found: `src/app/api/veri-chat/share-target/route.ts`'s own top comment references "the PWA Web Share Target (see public/manifest.json's...")" — **that file does not exist**; the comment describes a PWA integration point for a manifest that was never created. Confirms and re-verifies the prior OCID-034 finding ("no PWA, zero manifest.json/service-worker matches"), now cross-checked against a second, more specific signal (the aspirational code comment). |
| VERI Chat | Real files exist, **not wired to Mother Router / the AI dispatch layer** | `grep -n "MotherRouter\|mother-router\|ai-router\|/api/ai/team" src/lib/services/veri-chat-service.ts src/components/veri-chat/veri-chat-context.tsx` → zero hits, both files. Confirms `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` §3 item 4's own spot-check, independently re-run this pass with the same negative result. |
| VERI Assistant | **Not a real, distinct component anywhere in the codebase** | `grep -rln "VERI Assistant\|veri-assistant\|VeriAssistant" src/` → zero hits in `src/`. The term exists only in `ai-os/` governance prose (`IMPLEMENTATION_MATRIX_2026-08-02.md`, the OCID-040 snapshot), consistent with the OCID-034 discovery's own characterization: "an internal routing-migration workstream name rather than a distinct user-facing product." |
| Task engine | Real, genuinely wired — the most solidly built hop found this pass | `src/lib/task-execution-engine.ts` has **36 real importing call sites** across `app/api/v1/projexa/assistant/route.ts`, `app/api/ai/orchestrate/route.ts`, 20+ service files, and `lib/engines/engine-invocation.ts` (confirmed by direct `grep -rl` count, not asserted). |
| Decision/routing engine (Mother Router) | Real, wired to 2 real API entrypoints | `grep -rln "mother-router\|MotherRouter" src/app` → `app/api/ai/team/dispatch/route.ts` and `app/api/ai/orchestrate/route.ts` (plus that route's own test file). |
| Task engine ↔ decision/routing engine | **Not wired to each other** | `app/api/ai/orchestrate/route.ts` imports `resolveMotherRouterModel` from `mother-router.ts` directly (line 7, real, active), but the only reference to `task-execution-engine.ts` in that same file is a **code comment** (line 254: "...or task-execution-engine.ts's..."), not an import or call. `grep -n "task-execution-engine\|TaskExecutionEngine" src/lib/ai-router/mother-router.ts` → zero hits. Two genuinely real, independently well-built engines, confirmed not calling each other at this integration point. |
| Sync engine | Real | `src/lib/services/dynamic-chain-directory-service.ts` exists and itself imports `task-execution-engine.ts` — a real, working sync↔task-engine connection (the one clean cross-engine wire found this pass). Dedicated discovery: `ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` (OCID-028, **merged**, PR #774). |
| Cache/discovery engine | Real, partial | `ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` exists (file confirmed present); per OCID-034's own discovery, only L0 (browser intent cache/mode pills) and L5 (context-cache) layers are real/partial — not independently re-verified line-by-line this pass, cited not re-derived. |
| Audit/traceability | Real, and the most mature layer in this whole chain | `ai-os/MASTER_INDEX.yaml`, `superboss-register.sqlite`'s `wiring_registry` (7,918 rows, 99.7% `VERIFIED_MATCH`), `umr_tasks`, `ai-os/boss/COMPLETED.yaml` — all confirmed present and actively written to by this very task's own protocol. |

**Real, honest conclusion for §4:** this is not "one system" today. It is several genuinely real,
independently well-built subsystems (task engine, Mother Router, sync engine, audit/traceability) with
at least one confirmed missing wire between two of the most central ones (task engine ↔ decision/
routing engine), plus two hops that are aspirational rather than real (PWA — zero files; VERI
Assistant — zero code, name only), plus one hop (VERI Chat) that is real but deliberately/accidentally
isolated from the AI dispatch layer.

---

## 5. Zero-duplication check across the OCID-022–040 chain (live `gh pr list`, 2026-08-03T07:2xZ)

Real, current PR states (supersedes the OCID-040 snapshot's point-in-time table, which is now several
hours stale — 3 more PRs merged since):

| OCID | PR | State |
|---|---|---|
| 022 (End User Experience Foundation) | #765 | OPEN |
| 023 (Universal End User Work Model) | #768 | OPEN |
| 024 (Laptop Web Browser Runtime) | #767 | OPEN |
| 025 (Mobile PWA + VERI Chat Runtime) | #766 | OPEN |
| 026 (Deterministic Execution and AI Escalation Runtime) | #775 | OPEN |
| 027 (Global Knowledge Discovery and Reuse Runtime) | #771 | OPEN |
| 028 (Unified Synchronization Runtime) | #774 | **MERGED** |
| 029 (Universal Organization Runtime) | #773 | OPEN |
| 030 (Universal Decision Engine) | #772 | OPEN |
| 031 (Universal Software Execution Engine) | #781 | **MERGED** |
| 032 (Universal Task Lifecycle Runtime) | #780 | OPEN |
| 033 (Universal End User Work Orchestration Runtime) | #778 | OPEN |
| 034 (Universal Context and Predictive Runtime) | #779 | **MERGED** |
| 035 (Universal Capability Discovery / Continuous Platform Evolution) | **#777 AND #782, both OPEN** | **real, current duplication — see below** |
| 036 | (displaced into #782's title, per that PR's own honest header) | — |
| 037 (Universal Knowledge and Service Catalog) | **none found** | Not yet dispatched as its own worker task — `gh pr list --search "037 in:title"` returns zero results, matching the OCID-040 snapshot's own finding, still true. |
| 038 (this document) | this task | in progress |
| 039/040 | #769 (040 snapshot, MERGED); no dedicated 039 artifact (by design — OCID-040 snapshot's own §1 row 39 explains 039/040 overlap, not re-litigated here) | — |

**Real, newly-found duplication this pass:** PR #777 ("OCID-035 VERIDIAN Continuous Platform Evolution
Runtime v1.0") and PR #782 ("OCID-036 dispatch, real content OCID-035 VERIDIAN Universal Capability
Discovery and Evolution Runtime...") are **both currently open and both claim to be real content for
OCID-035**, under two different titles ("Continuous Platform Evolution" vs. "Capability Discovery and
Evolution"). This was not resolved by either PR as of this reading — flagged here as a real, live,
unresolved zero-duplication violation for whoever reviews/merges either PR next; not silently ignored.
Registered as a gap below (§6).

**No collision found for this document itself:** `ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md`
(sync-specific) and `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md` /
`_CONTINUATION_2026-08-02.md` (PROJEXA UI/UX click-through bugs under OCID-020, a different program)
are the only pre-existing docs with overlapping keywords ("unified," "certification") — both confirmed
distinct in scope from this document's cross-repo/cross-layer integration-certification subject, by
direct read.

---

## 6. Real gaps found, registered (not fixed)

Registered in `ai-os/MASTER-TRACKER.yaml`'s `real_gaps_not_yet_built` this pass, summarized here for
this document's own record:

1. **`GAP-OCID038-TASKENGINE-MOTHERROUTER-UNWIRED`** — task-execution-engine.ts and mother-router.ts,
   both real and independently well-built, are not wired to each other; `app/api/ai/orchestrate/route.ts`
   imports both concepts but connects them only via a code comment, not a call.
2. **`GAP-OCID038-NO-PWA`** — no `manifest.json`, no service worker, anywhere in the repo, despite a
   real code comment in `veri-chat/share-target/route.ts` describing PWA integration as if it existed.
3. **`GAP-OCID038-VERICHAT-NOT-DISPATCH-WIRED`** — VERI Chat's real service/context files have zero
   references to the Mother Router / AI dispatch layer (re-confirms, does not newly discover, the
   OCID-034/wiring-map finding — registered here because it is directly load-bearing for this OCID's
   own "one system" certification question, not previously registered as its own tracked gap).
4. **`GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH`** — `projexa-ai.com` serves compliance-tracker's
   generic VERIDIAN shell, not the real PROJEXA-branded app (live separately at
   `projexa-smoky.vercel.app`); re-confirms and updates prior project memory with fresh, live evidence
   (2026-08-03) rather than letting it go stale.
5. **`GAP-OCID038-OCID035-DUPLICATE-PRS`** — PR #777 and PR #782 both currently claim real content for
   OCID-035 under different titles; unresolved as of this reading.
6. **`GAP-OCID038-PROJEXA-OWN-SCHEMA`** — the `projexa` repo's own description states it is "built on
   VERIDIAN AI OS via API," but it has its own 11-table local schema and no evidence (this pass's
   GitHub code search) of calling a shared VERIDIAN API — the "thin client via API" architecture is
   not confirmed as actually wired in code; may be intentional (local caching/offline) or may be a
   real architectural drift from the repo's own stated design intent. Not independently resolved this
   pass — flagged for whoever picks up cross-repo integration work.

---

## 7. Explicit non-certifications (per this OCID's own directive, stated honestly, not silently omitted)

This document does **not** certify:
- That compliance-tracker, PROJEXA, and every FChecklist repository operate as one unified VERIDIAN
  backend today (§2: real, evidenced NO).
- That `projexa-ai.com` is a genuine production PROJEXA thin client today (§3: real, evidenced NO —
  it is a live VERIDIAN/compliance-tracker deployment on that domain, not a PROJEXA experience).
- That the full browser→PWA→server→VERI Chat→VERI Assistant→engines→sync/cache/audit chain operates
  as one system today (§4: real, evidenced NO — several real subsystems, at least one confirmed
  missing wire, two hops that do not exist in code at all).
- Any implementation, gap closure, or fix for anything found above — locked by `SEC-07` pending
  OCID-020, per this task's own explicit instruction.
- OCID-020 itself (a separate, already-dispatched certification effort, not repeated or re-scored here).
- Platform freeze.

**What this document does affirmatively confirm, with real evidence:** compliance-tracker's own core
infrastructure (task engine, Mother Router, sync engine, audit/traceability layer) is genuinely built
and genuinely wired within itself — the gaps found are integration gaps *between* real subsystems and
*between* repos, not evidence that the underlying engineering across OCID-022–037 doesn't exist. The
15-repo, partially-connected reality described above is a real, current snapshot, not a claim that no
progress has been made.

---

## 8. Handoff to OCID-039

Per `SEC-07`'s explicit, ordered unlock sequence (OCID-020 verified → OCID-038 implementation →
OCID-039 production certification → OCID-040 final certification+freeze), and per this task's own
explicit instruction to stop after discovery/gap-analysis without implementing: **this document hands
off to OCID-039 exactly the honest, evidenced state above** — three real "NO, not yet" certifications,
6 registered gaps, one live unresolved duplication (PR #777/#782), and one still-fully-open upstream
gate (OCID-020). OCID-038's own real *implementation* work (as distinct from this document's discovery)
remains correctly locked behind OCID-020 per SEC-07 and is not attempted here. Whoever picks up real
OCID-038 implementation next should start from §6's gap list rather than re-discovering it, and should
re-verify OCID-020's status fresh (state on this server has been observed to drift within minutes —
see project memory `veridian-live-concurrent-state-drift`) rather than trusting this document's
snapshot as still current after any meaningful delay.

**Canonical artifact created:** this file. Amends the existing UMR chain (cites but does not replace
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` and
`ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`); does not start a new one.

---

## 9. Discovery Brief Addendum (2026-08-04) — `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` and `GAP-OCID038-PROJEXA-OWN-SCHEMA`

Per PM decision `UMR-20260804-011851-676b` (citing `UMR-20260802-173631-ca85` OCID-021 and
`UMR-20260803-042801-ec4b` OCID-038): after `GAP-OCID038-TASKENGINE-MOTHERROUTER-UNWIRED` closed
(PR #856, merged `622db105`), the PM correctly declined to authorize implementation on either of
these 2 remaining gaps, since neither had a real written discovery brief — only §6's short narration.
**This section is that brief. Discovery and documentation only — no implementation, no routing
change, no schema change was made while writing it.** Every claim below is live-tested or read
directly from source on 2026-08-04, not carried forward unverified from §1–§8's 2026-08-03 snapshot.

### 9.1 `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH`

**This is NOT an accidental misconfiguration — it is the documented result of a deliberate,
Owner-approved decision, and the "mismatch" framing needs to be read precisely.**

**What routing does today, live-verified:**
- `projexa-ai.com` / `www.projexa-ai.com` are domains registered directly through Vercel (registrar
  = Vercel, nameservers `ns1/ns2.vercel-dns.com`) — confirmed live via `vercel domains inspect
  projexa-ai.com` (2026-08-04T01:2xZ): both domains are currently assigned to Vercel project
  `veridian-compliance-ai` (this repo's own deployment). `vercel projects ls` confirms
  `veridian-compliance-ai`'s own production URL is literally `https://projexa-ai.com`; the separate
  `projexa` Vercel project's production URL is `https://projexa-smoky.vercel.app` (no custom domain
  attached to it).
- This is NOT the original/default state — it is the result of a real, explicit, three-step history,
  fully documented in `ai-os/boss/completed-work/wave10-dns-cutover.md` and
  `ai-os/boss/COMPLETED.yaml`'s `WAVE-10-REDO` entry: (1) Wave 10 (pre-2026-08-02) originally cut
  both domains from the standalone `projexa` project to `veridian-compliance-ai`, explicitly
  documented as "the final step of the VERIDIAN/PROJEXA brand-layer merge" (10-wave plan, Owner
  pre-authorized); (2) an **undocumented** reversal happened around 2026-07-27, moving both domains
  back to the standalone `projexa` project, discovered later with zero record of why/who/when; (3) the
  real Owner, given this finding directly, explicitly decided (`UMR-20260802-134939-145d`, 2026-08-02)
  to revert to the Wave 10 state — executed live via the Vercel API, independently re-verified at the
  time (`GET /v9/projects/veridian-compliance-ai/domains/projexa-ai.com` → 200, `verified=true`).
  **The current live state (domains on `veridian-compliance-ai`) is therefore the Owner's own most
  recent explicit decision, re-confirmed as recently as 2 days before this brief — not drift, not an
  oversight.**
- Live-reconfirmed today (2026-08-04): `curl -sI https://projexa-ai.com` → `HTTP/2 200`,
  `server: Vercel`, `x-powered-by: Next.js`; page `<title>` is literally `VERIDIAN COGNITIVE AI OS —
  AI Cognitive Research`; zero "projexa" (case-insensitive) matches in the served HTML. Separately,
  `https://projexa-smoky.vercel.app` → `HTTP/2 200`, `<title>PROJEXA — Construction Intelligence AI
  OS</title>`, real PROJEXA content, genuinely live and separate.
- The API surface is unaffected by any of this: `curl` against both
  `https://veridian-compliance-ai.vercel.app/api/v1/projexa/products` and
  `https://projexa-ai.com/api/v1/projexa/products` return the identical `401` (auth required, not
  `404`) — the same real backend, reachable through either hostname. **The domain issue is scoped
  entirely to the anonymous-visitor marketing/landing experience, not to API connectivity, which
  already works correctly through either domain.**

**What the mismatch concretely, precisely is — root-caused to a specific, already-known, already-named
code boundary, not a vague "wrong branding":**
- `src/lib/services/org-branding-service.ts`'s `resolveBranding(orgId)` is the single function every
  render path uses for branding. It is **org-scoped**, resolved from `organisations.primaryProductBranchId`
  → `product_branches.displayName`, and only ever runs **post-login/post-org-resolution**. Its own
  code comment (added Wave 5, 2026-07-21, unchanged since) states plainly: *"Deliberately NOT
  Host-header/domain-based -- this repo has no tenant-routing middleware yet... Domain-based
  resolution belongs to the later DNS/Vercel cutover wave, once projexa-ai.com is actually aliased to
  this deployment; until then, org.primaryProductBranchId is the only signal that exists."*
- `organisations.customDomain` (added Wave B, 2026-07-17, `drizzle/0221_wave_b_white_label_branding.sql`)
  exists specifically to eventually drive this — but has been, in that same wave's own words,
  "stored-but-unrouted" since it was added. No middleware, layout, or route in this repo reads the
  Host header and resolves an org by `customDomain` today — confirmed via `grep -rn` for any
  `headers().get("host")` / Host-header read joined against `organisations` — no such call site exists.
- Wave 10 itself (the wave that actually completed the DNS cutover, 2026-08-02) explicitly tested for
  and found this exact gap, and explicitly deferred it: *"the anonymous public '/' marketing page
  served at projexa-ai.com currently shows compliance-tracker's default... branding, not PROJEXA
  branding... I did not find (and did not build) any hostname-to-brand resolution for the logged-out
  landing page... the anonymous landing page's brand-by-domain treatment reads as a separate,
  pre-existing gap, not something this wave's brief asked to fix."* **The OCID-038 discovery
  document's own §3 (2026-08-03) re-found the identical live symptom independently, but without
  citing this precise, already-documented root cause and its 2-wave paper trail** — this addendum
  closes that citation gap.
- Consequently: a PROJEXA org's own **authenticated, logged-in** users already see correct PROJEXA
  branding when their org's `primaryProductBranchId` resolves correctly (Wave 5's real, working fix).
  It is specifically and only the **anonymous, logged-out** landing page — at any custom domain, not
  just `projexa-ai.com` — that has no hostname-awareness and always falls back to the platform
  default (`DEFAULT_BRAND_NAME = "VERIDIAN AI OS"`).

**Real, live data checked today (2026-08-04) that bears directly on how scoped a real fix would be:**
- `SELECT * FROM compliance.organisations WHERE custom_domain IS NOT NULL` returns exactly **1 row**
  total, platform-wide: a synthetic test fixture (`Brand-Test-Org-A-5553236` →
  `brandtest-orga.example.com`). **Zero real organisations, including any of the 6 real PROJEXA orgs
  provisioned in Wave 9, have `customDomain` set to `projexa-ai.com` or `www.projexa-ai.com`.** Even
  if hostname-based branding resolution were built today, there is currently no data connecting that
  specific domain to any specific org's branding — this is a second, independent precondition, not
  just a missing code path.
- A real Wave-9-provisioned PROJEXA org (`Acme Test Construction`,
  `05886eb3-40bf-4b04-9bce-8d188da573af`) has `primaryProductBranchId` set
  (`5fceebcd-0a7a-4448-ae2b-a72637124f13`) — but a direct `psql` read of `compliance.product_branches`
  shows exactly **1 row total**, `branch_key='grc'` ("VERIDIAN AI GRC") — no row matching that id, and
  no "projexa"-named branch at all. **This finding should be treated as a possible 3rd occurrence of
  the already-tracked `GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY`** (2 independent prior
  occurrences already documented: a live `403` from `requireErpEnabled()` that could only happen if an
  `'erp'` branch row resolved successfully server-side, and a confirmed-real Mother Router audit-log
  write, both contradicting a direct external read showing the relevant table effectively empty) —
  **not fresh, standalone proof that no PROJEXA branch exists.** That gap's own recommendation (a live
  Vercel-side diagnostic, not another external read) applies equally here and has not been done for
  this specific question.

**The real, still-open product question — precisely scoped, not "fix the domain":**
Building hostname-aware branding resolution is a real, bounded, buildable piece of engineering (read
`Host` header in middleware or the root layout → look up an org by `customDomain` → resolve branding
before falling back to the platform default). It is **not**, by itself, an obvious green light,
because of one real, unresolved product question this session should not decide unilaterally: **is
there a single, canonical "PROJEXA" identity to show an anonymous visitor at all?** The platform's own
architecture is genuinely multi-tenant — 6+ real, separate PROJEXA-provisioned organisations exist,
each with its own `veridian_credentials` bridge, none of them "the" PROJEXA org. Two different real
product directions are both consistent with the evidence above, and only the Owner/PM can say which is
intended:
1. **"PROJEXA is a real, separate consumer-facing brand"** — in which case `projexa-ai.com`'s
   anonymous page needs a platform-level PROJEXA marketing identity (distinct from any one tenant's
   own branding, the same way `DEFAULT_BRAND_NAME` is a platform-level default today), and a
   `customDomain` row would need to be set for a real, designated PROJEXA org (or a new
   platform-level, non-tenant-scoped branding concept would need to be built — a materially different
   scope than "fix `resolveBranding()`").
2. **"PROJEXA is being merged into a single VERIDIAN-branded platform"** — in which case the Wave 10
   author's own framing ("the final step of the VERIDIAN/PROJEXA brand-layer merge") and the Owner's
   own 2026-08-02 re-confirmation of the current VERIDIAN-branded state are the intended end state
   already, PROJEXA is correctly one internal "product branch"/vertical rather than its own
   domain-level brand, and **what §3/§9 have both been calling a "mismatch" may not actually be a bug
   to fix at all.**
This document takes no position on which of the two is correct — that is the real Owner-level call
the original gap's recommendation named, now precisely scoped to this one question rather than a
vague "should the domain route somewhere else."

### 9.2 `GAP-OCID038-PROJEXA-OWN-SCHEMA`

**Fresh, direct evidence substantially updates (not just adds a data point to) the original finding.**
The 2026-08-03 discovery's own "0 hits" result came from `gh api search/code` — GitHub's own code
search, which that entry's own text already flagged as "not exhaustive." A real, direct read of the
repo's own current content (fresh `git clone`, `grep -rl` on real files, not GitHub's index) finds
substantial, real, live wiring.

**What the local schema concretely is, read directly (2026-08-04):** `projexa/src/lib/db/schema.ts`
now defines **12** tables (was 11 at the 2026-08-03 discovery date — the schema is actively evolving).
All 12 are tenant/auth/billing/UI-collaboration concerns, not construction-domain data:
`organizations`, `memberships`, `veridianCredentials` (a real bridge table: one row per PROJEXA org,
storing that org's own `veridian_org_id` + `veridian_api_key`, RLS-locked to `service_role` only),
`assistantQueries` (local history of dispatched calls), `conversations` /
`conversationParticipants` / `messages` (a chat UI), `profiles`, `notifications`, `todos`,
`workProgressPhotos`, `contactRequests`. **None of the 12 store BOQ, budgets, schedules, invoices, or
any other construction-domain data.** The schema file's own top comment states this explicitly and
precisely: *"PROJEXA's own tenant/auth/billing schema. All construction domain data (BOQ, progress,
site diary, budgets, etc.) lives in VERIDIAN -- see src/lib/veridian-client.ts. Nothing
construction-related is stored here."*

**What real evidence shows about the "built on VERIDIAN AI OS via API" claim, checked directly rather
than assumed from the comment alone:**
- `src/lib/veridian-client.ts` (240 lines) is a real, substantial, live API client. Its own header:
  *"PROJEXA's only connection to construction data: every call goes through VERIDIAN's
  `/api/v1/projexa/*` surface with a Bearer API key."* `VERIDIAN_API_BASE` defaults to
  `https://veridian-compliance-ai.vercel.app/api/v1/projexa` — the exact same Vercel project §9.1
  found owns the `projexa-ai.com` domain. Its key-resolution chain
  (`getVeridianApiKey(organizationId)` → `veridianCredentials` table → `VERIDIAN_API_KEY` env-var
  fallback) matches, call for call, the real Wave 9/10 provisioning data already independently
  confirmed live in this repo's own `ai-os/boss/COMPLETED.yaml`.
- **51 real files** in the `projexa` repo import/call this client (`grep -rl "callVeridian\|
  veridian-client" src`), confirmed via a direct file-content search, not GitHub's index. Sampled call
  sites are genuinely construction/business-domain routes: `manpower-cost-report`, `sales-pipeline`,
  `schedule-tracker`, `punch-list`, `sales-invoices`, `products`, `schedule-tracker/import`, and more
  — all of these proxy to VERIDIAN rather than reading/writing a local table for that domain data,
  consistent with the schema file's own comment.
- A live `curl` (both `veridian-compliance-ai.vercel.app` and `projexa-ai.com` hostnames) against
  `/api/v1/projexa/products` returns `401` (endpoint exists, requires the real Bearer auth the client
  code implements), not `404` — the real API surface the client targets genuinely exists and responds.

**Revised assessment:** PROJEXA genuinely IS, today, live, a real, extensively-wired thin client of
VERIDIAN/compliance-tracker for construction-domain data — the repo's own description is accurate for
the application-data layer. This substantially updates §3's "Certification 2: NO, not as a genuine
PROJEXA thin client" verdict: that verdict was, on re-reading its own evidence, scoped narrowly to the
**anonymous-visitor branding experience** at the `projexa-ai.com` domain (§9.1's finding, a real,
separate, narrower issue) — not to whether PROJEXA's actual application architecture is a thin client,
which this fresh evidence answers **yes, genuinely, extensively**, contradicting §1's own "real,
if non-exhaustive, evidence **against** projexa today being a pure thin client" framing. §1's evidence
(the GitHub code-search 0-hit result) is the thing that should be treated as stale/superseded by this
addendum, not the other way around.

**What does NOT yet operate as one unified thing, precisely named (real, remaining gaps worth
distinguishing from the schema question, not previously named this precisely in this document):**
authentication/session. PROJEXA runs its own Supabase Auth project with its own `profiles` /
`memberships` tables — a PROJEXA user's login session is never exchanged for, or trusted by,
VERIDIAN's own session; the only cross-system trust boundary is the static, per-org, service-role-only
`veridian_credentials` API key used purely server-to-server. There is no user-level SSO between the
two systems. This is a real, separate, previously-undocumented-in-this-doc distinction: "one unified
backend for data" (true, per this addendum) and "one unified identity/session" (not true, confirmed
by reading both schemas directly) are two different claims that OCID-038's own directive's "one
system" language conflates.

**What the projexa repo's own schema investigation would concretely need to check next** (this part is
genuinely mechanical/investigative — unlike §9.1's domain question, it is not an Owner-level product
call, and is a reasonable real next step for whoever picks this up):
1. Spot-check (not exhaustively audit) a handful of the 51 `callVeridian`/`veridian-client` call sites
   to confirm none of them silently also read/write a local Postgres table for the same
   construction-domain data as a shadow/cache path — the schema file's own comment asserts this, but
   this addendum did not verify all 51 call sites individually, only that they exist and target
   genuinely construction-domain routes.
2. Confirm the auth-boundary/session finding above precisely (no PROJEXA-side code path exists that
   forwards or trusts a VERIDIAN session token) — this addendum found no such call site via grep, but
   did not exhaustively trace every auth-adjacent file in the ~51-call-site set.
3. If §9.1's hostname-based branding fix is ever pursued, confirm whether an anonymous (not-yet-
   logged-in) PROJEXA visitor's browser session would need to carry any "which VERIDIAN org"
   context before login, or whether that question is genuinely scoped to post-login only (current
   evidence: `resolveBranding()`'s own org-scoped, post-login design suggests the latter, but this
   was not independently re-verified against PROJEXA's own login flow in this pass).

### 9.3 Status

Both gaps' `ai-os/MASTER-TRACKER.yaml` entries are amended in the same commit as this addendum with a
cross-reference to this section, `status` left `open` for both (per the PM's explicit instruction: this
is discovery only, no implementation, no routing change, no schema change). Awaiting the real PM
decision informed by the above before any further action on either gap.
