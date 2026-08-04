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

## 9. Discovery brief addendum (2026-08-04): real briefs for the two remaining held gaps

**Governing decision.** This task's SPEC (citing `UMR-20260802-173631-ca85` OCID-021 and
`UMR-20260803-042801-ec4b` OCID-038) confirms `GAP-OCID038-TASKENGINE-MOTHERROUTER-UNWIRED` (§6 item 1)
closed via PR #856 (merged, commit `622db105`, independently confirmed a real ancestor of `origin/main`).
It explicitly declines to approve proceeding on the two remaining gaps —
`GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` and `GAP-OCID038-PROJEXA-OWN-SCHEMA` — because neither has a
real written discovery brief, only the short §6 narration above. **This section is that brief.** Every
finding below is read-only investigation (live `curl`, direct file reads in both `compliance-tracker` and
the separate `projexa` repo's local checkout at `/opt/veridian/repos/projexa`) performed 2026-08-04. **No
implementation, routing change, or schema change is made in this session** — the real PM call is made
after reading this, per the SPEC's own explicit instruction.

### 9.1 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH — discovery brief

**What the mismatch concretely is.** `projexa-ai.com` is a real, live, working Vercel deployment — but
it serves compliance-tracker's own generic shell, not any PROJEXA-branded experience. Freshly re-verified
live this session (2026-08-04T01:21Z, not reused from 2026-08-03):

```
$ curl -sI https://projexa-ai.com           -> HTTP/2 200
$ grep -io "veridian\|projexa" <page html>  -> 33 "VERIDIAN" matches, 0 "projexa" matches
$ curl -sI https://projexa-smoky.vercel.app -> HTTP/2 200 (a separate, genuinely live deployment)
$ grep -io "veridian\|projexa" <page html>  -> 42 "PROJEXA" matches, 5 "VERIDIAN" matches (footer attribution)
```

§3's 2026-08-03 finding is confirmed still current, one day later, not stale: `projexa-ai.com`'s `<title>`
still reads "VERIDIAN COGNITIVE AI OS," and the real PROJEXA-branded frontend (the separate `projexa`
repo) is live only at the unrelated-looking `projexa-smoky.vercel.app` URL.

**What routing today actually does.** Direct code read of compliance-tracker this session, not assumed:
- No `middleware.ts` exists anywhere in this repo (`find . -maxdepth 1 -iname middleware.ts` and
  `src/middleware.ts` both confirmed absent).
- `next.config.ts` (39 lines, read in full) has no `rewrites`, `redirects`, or any hostname-conditional
  logic — its only customizations are `transpilePackages` (veridian-ui-kit), `serverExternalPackages`
  (`@memvid/sdk`), `next-intl` (locale from a cookie, not the URL/host), and Sentry.
- No PROJEXA-brand-detection code exists anywhere in `src/` — a repo-wide grep for
  `NEXT_PUBLIC_BRAND`/tenant-brand-switch/`PROJEXA` returns only compliance-tracker's own
  `src/app/api/v1/projexa/*` directory (51 subdirectories) — a **backend API namespace** for a
  construction-ERP domain, not any UI-facing brand switch. No `src/app/**/projexa` **page** directory
  exists in compliance-tracker at all — only the API surface.
- The domain binding itself is pure DNS/Vercel-alias, not application code: `projexa-ai.com` and
  `www.projexa-ai.com` are bound directly to the `veridian-compliance-ai` Vercel project (confirmed via
  `ai-os/boss/completed-work/wave10-dns-cutover.md`'s runbook and the real, quoted Owner directive in
  `task-20260802-141942-owner-decision--revert-projexa-ai-com-to`'s prompt: *"revert projexa-ai.com and
  www.projexa-ai.com back to the Wave 10 merge state, i.e. served by veridian-compliance-ai... vercel
  domains add projexa-ai.com veridian-compliance-ai --force"*).

So today's entire "routing" story is: an alias-level DNS/Vercel binding pointing the domain at
compliance-tracker's own deployment, with **zero code, anywhere in that deployment, aware of which
hostname a request arrived on.** A request to `projexa-ai.com/` and a request to compliance-tracker's own
primary domain hit byte-for-byte the same rendered output.

**What it would need to do differently.** Two structurally different paths exist (an Owner-level product
decision per the existing §6 recommendation, not decided here):
1. **Re-point the alias** at the separate `projexa` repo's own deployment (make `projexa-ai.com` an alias
   of the project currently only reachable at `projexa-smoky.vercel.app`) — pure infra/DNS, no app code
   change in either repo, but a genuine identity switch: today the domain authenticates against
   compliance-tracker's own Supabase project (`pcrjmlpuqsbocqfwoxod`, confirmed via the prior session's
   real signup+login test cited in `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `recently_completed` history);
   re-pointing would switch it to whichever Supabase project `projexa`'s own production env targets
   instead — anyone with an account through today's binding would be affected.
2. **Add real hostname-aware branding inside compliance-tracker** (e.g. a new `middleware.ts` reading
   `req.headers.get('host')` to swap logo/copy/theme when host === `projexa-ai.com`), keeping the domain
   bound to compliance-tracker's own backend. This requires genuinely new code (no such file exists
   today) and a decision about which UI the branded experience should actually be — compliance-tracker's
   own `/api/v1/projexa/*`-backed data with a new UI layer that doesn't exist yet, or a proxy/embed of the
   separate `projexa` repo's UI. Neither is a small mechanical change.

**What real evidence shows about which behavior is correct or wrong.** Neither "correct" nor "wrong" is
the right frame absent a stated intent — which is exactly why this needed a written brief rather than an
implementation guess. The *domain-to-compliance-tracker binding itself* is a deliberate, Owner-directed,
already-executed decision (quoted above) — not an accident, not a stale leftover from an earlier
reversal. What was **not** part of that directive, and has no recorded intent anywhere in this repo's
governance trail (the wave10 runbook, the owner-decision task prompt, or
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 12 "Go Live") is *branding on top of that binding*. The
Owner decision and its runbook are both scoped to which backend/Supabase project the domain authenticates
against — never to what the served HTML should visually be. So the honest, evidenced state is: the
routing decision was made and is working exactly as directed; the branding question was simply never
posed to the Owner and has no recorded answer either way. That is a materially narrower, and more
actionable, finding than "this is a bug" — it is an open product question, not a defect.

### 9.2 GAP-OCID038-PROJEXA-OWN-SCHEMA — discovery brief

**What the investigation needed to check, and what it found.** The existing §6 gap's own recommendation
said: "read the projexa repo directly (not GitHub code search only) to determine whether it genuinely
calls a shared VERIDIAN API anywhere." This session did exactly that — read
`/opt/veridian/repos/projexa`'s real local checkout directly, not GitHub's code-search index — and the
prior "0 hits" GitHub code-search finding (§1) turns out to be a **false negative**, not a true absence:

- `projexa/src/lib/veridian-client.ts` (241 lines, read in full) is a real, actively-used API client.
  Its base URL: `VERIDIAN_API_BASE = process.env.VERIDIAN_API_BASE_URL ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa"`
  (line 19) — a string a search for "compliance-tracker" (a plausible but wrong guess at the search term)
  would never match, since the live hostname is `veridian-compliance-ai`, not "compliance-tracker."
- 51 files under `projexa/src/app/api/**` call `callVeridian()` / `callVeridianRaw()` /
  `callVeridianBinary()` / `callVeridianUpload()` from that client (confirmed by direct `grep -rl` file
  count) — matching, 1:1 in count, compliance-tracker's own 51 subdirectories under
  `src/app/api/v1/projexa/` (confirmed by direct `find` count on both sides). A real, wired, symmetric API
  surface, not a naming coincidence.
- A real per-tenant credential/provisioning contract exists between the repos: `projexa`'s own
  `veridian_credentials` table (`schema.ts` line 43, one row per PROJEXA org: `veridian_org_id` +
  `veridian_api_key`) is populated by `provisionVeridianOrg()` (`veridian-client.ts` line 200), which
  calls `POST {VERIDIAN_API_ROOT}/platform/provision-org` — and compliance-tracker genuinely has that
  exact endpoint (`src/app/api/v1/platform/provision-org/route.ts`, confirmed present, live-read).
- Every other table in the local schema has a documented, non-duplicative rationale, confirmed by reading
  each table's own in-code comment directly, not inferred:
  - `organizations` / `memberships` — the local tenant/auth model, required because the VERIDIAN
    credential lookup needs a local org id to key off.
  - `profiles` / `notifications` / `todos` — local session/collaboration data; `notifications`'s own
    comment explicitly says it deliberately does not reuse compliance-tracker's differently-scoped
    role/RLS model, since PROJEXA's multi-tenancy and RLS convention genuinely differ.
  - `assistantQueries` / `conversations` / `conversationParticipants` / `messages` — explicitly documented
    in-code as "stand[ing] in for VERIDIAN's real async Tasks system," because VERIDIAN's `createTask()`
    requires a real user session that the server-to-server API-key path doesn't have — a documented
    workaround for a real integration gap, not silent duplication.
  - `workProgressPhotos` — explicitly documented as "Deliberately NOT a duplicate of VERIDIAN's real
    constructionWorkProgressEntries row... duplicating them here would let the two drift"; the one column
    it owns (a photo attachment) genuinely has no home in VERIDIAN today (no photo column, no reachable
    upload API).
  - `contactRequests` — anonymous marketing-site lead capture, mirroring compliance-tracker's own
    equivalent local table for the identical reason (visitor rows, not tenant data).

**Correction, immaterial to the finding, flagged for accuracy:** the existing gap detail (§6 item 6) cites
an "11-table schema"; a direct count of `pgTable(` calls in `projexa/src/lib/db/schema.ts` this session
found **12** (`organizations, memberships, veridianCredentials, assistantQueries, conversations,
conversationParticipants, messages, profiles, notifications, todos, workProgressPhotos,
contactRequests`) — off by one from the earlier spot-check, does not change the analysis above.

**Why this matters for OCID-038 platform integration certification.** This materially refines, not merely
confirms, §6 item 6 and — more significantly — updates §1/§2's own negative "zero-hit API-call search"
finding above, which was working from an incomplete signal (GitHub code search, not a direct repo read).
The `projexa` repo is a genuine, wired, real thin client of compliance-tracker's `/api/v1/projexa/*` and
`/api/v1/platform/*` surfaces, with its local schema limited to tenant/auth plumbing, a documented
Tasks-API workaround, one explicitly non-duplicative attachment table, and unrelated marketing-site data —
exactly the minimal local footprint a well-built thin client should have, not architectural drift from the
repo's own stated design intent. This is a stronger, more positive data point for §2's "does
compliance-tracker + PROJEXA operate as one backend" certification question than the original discovery
credited; it does not by itself flip §2's overall "NO, not as a fully unified backend" verdict (§2's other
findings — `veda-advisors` unrelated, no shared API gateway/auth token/session model spanning all
FChecklist repos, `projexa-ai.com`'s own brand mismatch per §9.1 above — still stand), but it removes one
specific piece of evidence (§1's "zero-hit search," "may be real architectural drift") that had been
counted against unification.

**What remains genuinely unverified — real follow-up, not done in this brief:**
1. This was a static/code-read investigation, not a live runtime trace. No request was actually sent
   through `projexa-smoky.vercel.app` and observed hitting compliance-tracker's `/api/v1/projexa/*` in
   real time this session (unlike §9.1's domain/brand finding, which *was* freshly live-curled). A real
   end-to-end trace — trigger one real PROJEXA action, confirm a corresponding request lands in
   compliance-tracker's own logs/DB — is the natural next verification step; not performed here, since it
   edges toward live-system probing beyond a documentation-only brief.
2. Whether `VERIDIAN_API_BASE_URL` / `VERIDIAN_PLATFORM_APPLICATION_KEY` / `DATABASE_URL` etc. actually
   hold real values in `projexa`'s **production** Vercel environment was not checked — only that a local
   `.env.local` file exists in the checkout (its contents were deliberately not read; local env files can
   hold live secrets, and reading them wasn't necessary to answer the architecture question).
3. The "51 vs 51" route-count match confirms the counts align and the provisioning endpoint was
   spot-checked by name; it does not confirm all 51 path strings pair up 1:1 with no orphans on either
   side — a full diff of both route lists was not performed.

### 9.3 What this addendum does not do

Per the SPEC's explicit instruction, this addendum makes **no implementation, routing, or schema change**
of any kind — not to compliance-tracker, not to the `projexa` repo, not to DNS/Vercel domain bindings.
`GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` and `GAP-OCID038-PROJEXA-OWN-SCHEMA` remain `status: open` in
`ai-os/MASTER-TRACKER.yaml`, unchanged by this session. The real PM call on both — informed by §9.1 and
§9.2 above — is made separately, by the Owner, not by this task.
