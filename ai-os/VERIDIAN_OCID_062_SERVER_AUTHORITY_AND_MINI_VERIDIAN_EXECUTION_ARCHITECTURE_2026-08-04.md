# VERIDIAN Server Authority and Mini VERIDIAN Execution Architecture — v1.0

**OCID-062.** Parent chain, as given by this task's own dispatch: `UMR-20260802-173631-ca85`
(OCID-021, the ERP Functional Completeness Master Program) → `UMR-20260802-165606-4413`
(OCID-020, the PROJEXA end-user certification sweep — the real gate `ai-os/CONSTITUTION.yaml`'s
`SEC-07` locks implementation behind; see "Honest disclosure" below for why this document does not
also repeat the retired literal label "the OCID-021 implementation lock").

**A UMR-fabrication disclosure, stated up front rather than glossed over:** this task was dispatched
by instruction text quoting the two parent UMRs above; it was **not** independently re-verified
against a live `umr_tasks`/`owner_dispatch_gateway` row in `/opt/veridian/ai-os/memory/superboss-register.sqlite`,
because that database is not reachable from this task's own working environment (a scratch clone,
not a supervised worker session with host access). Per the real, documented finding in
`ai-os/VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md` (OCID-034, its own header,
"a real citation-fabrication finding") and `ai-os/MASTER-TRACKER.yaml`'s
`GAP-SELF-MINTED-ARTIFACT-UMR-FABRICATION`, self-minting a UMR that was never independently queried
against that database is a known, real anti-pattern in this repo's history. This document does not
repeat it: it does **not** mint a new "OCID-062 dispatch UMR" of its own. It cites only the two
parent UMRs it was actually given, and states plainly that its own dispatch-row identity was not
independently confirmed. A future session with host/database access should verify it if that
matters for governance completeness.

**Status: documentation only.** This artifact implements no code, changes no database, changes no
UI, changes no UX, and adds no service worker, manifest, or PWA file. Per the PM's own instruction
for this dispatch: it authorizes "real architecture and specification writing only... producing a
real canonical architecture document describing the authoritative server responsibilities, the
Mini VERIDIAN primary execution responsibilities, and the local versus server execution order,
with real citations to the actual existing code in the browser and server runtimes today, honestly
distinguishing what already exists from what this document proposes." Real implementation of any
browser/PWA execution code is explicitly out of scope for this dispatch and needs a fresh PM
decision once OCID-024, OCID-025, and OCID-061 real discovery are further along (see §1).

---

## 0. "Mini VERIDIAN" — a new term, not a pre-existing component

**Stated explicitly, per this task's own directive:** the string "Mini VERIDIAN" appears nowhere in
`ai-os/` prior to this document (independently confirmed: `grep -ril "mini veridian" ai-os/` from a
fresh clone of `origin/main` returns zero matches other than this file once committed). **Mini
VERIDIAN is this document's own new term** for the real, already-partially-built collection of
client-side execution and storage mechanisms catalogued in §3 below — it is not an established
VERIDIAN product name, not a shipped feature, and not a claim that a unified "Mini VERIDIAN" runtime
exists today. Where this document uses the term, it means: *the sum of what already runs, or could
reasonably run, client-side in the end user's browser, as a coherent execution surface distinct from
the authoritative server.* Nothing under that name has been designed, named, or built by any other
OCID in this repo's history as of this writing.

---

## 1. This document's five real dependencies, cited honestly

This document was dispatched with five named dependencies. Their real, current state (independently
re-verified via `gh pr view` against `FChecklist/compliance-tracker` at the time of this writing,
2026-08-04) is reported here exactly as found — none is overstated as more settled than it is:

| OCID | Subject | PR | Real state |
|---|---|---|---|
| OCID-024 | `ai-os/VERIDIAN_LAPTOP_WEB_BROWSER_RUNTIME_2026-08-03.md` | #767 | **OPEN, not merged.** A real, detailed draft (641 lines), read directly from its branch for this document (§4 below draws on it). Cited as a draft, not settled fact. |
| OCID-025 | `ai-os/VERIDIAN_MOBILE_PWA_AND_VERI_CHAT_RUNTIME_2026-08-03.md` | #766 | **OPEN, not merged.** A real, detailed draft (483 lines), read directly from its branch for this document (§4 below draws on it). Cited as a draft, not settled fact. |
| OCID-031 | `ai-os/VERIDIAN_UNIVERSAL_SOFTWARE_EXECUTION_ENGINE_2026-08-03.md` | #781 | **MERGED** (2026-08-03T06:44:27Z). Read directly from `origin/main`. This document's strongest real foundation for server-side execution mechanics (§2 below cross-references it rather than restating it). |
| OCID-034 | `ai-os/VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md` | #779 | **MERGED** (2026-08-03T07:03:19Z). Read directly from `origin/main`. This document's strongest real foundation for context/browser/gap material (§2, §3, §6 cross-reference it rather than restating it). |
| OCID-061 | Universal input runtime mapping (mode pill/option chain, free chat, speech-to-text, API/webhook entry points, whether a shared "intent resolution layer" exists) | — | **Not started.** No worker has been dispatched for OCID-061 as of this writing; no findings exist anywhere in this repo. This document does not fabricate OCID-061 findings — where this document touches input-mapping ground (§4), it cites only what OCID-024/OCID-031/OCID-034 already found, and names the intent-resolution-layer question as unanswered pending OCID-061. |

Two of five dependencies are merged and load-bearing; two are real open drafts this document builds
on without treating as settled; one has not started. This document does not contradict or duplicate
either open draft — where it cites them, it says so explicitly and does not present their content as
merged fact.

---

## 2. What this document is, and is not

**What this is:** a synthesis, grounded in a dedicated discovery pass over the live
`compliance-tracker` browser and server runtime code (not a restatement of OCID-024/025/031/034 —
this document re-reads the actual source files directly and cites file:line evidence of its own),
answering three questions the PM's dispatch named: (1) what MUST stay server-authoritative and why,
(2) what "Mini VERIDIAN" (§0) could reasonably be scoped to run client-side, given what already does,
and (3) a concrete, clearly-labeled-proposed local-vs-server execution handoff sequence.

**What this is not:** not a new architecture for the execution engine (OCID-031 already owns that
ground — see its own §1–§35, cross-referenced not restated below), not a new context/prediction
model (OCID-034 already owns that ground), not an implementation of anything, not a PWA/manifest/
service-worker design (explicitly out of scope per the PM's own instruction), and not a
certification that anything below "works end to end" — `SEC-07` (`ai-os/CONSTITUTION.yaml`) locks
certification behind OCID-020, and this document, being documentation-only, does not attempt to
unlock or bypass that gate.

---

## 3. Authoritative server responsibilities — real, cited, and why they must stay server-side

Every item below is real, already-enforced code, not a proposal. It stays server-side for concrete,
citable reasons: RLS/tenant isolation, credential custody, non-repudiable audit trail, or
billing/credit-governance integrity — the same four reasons OCID-031's own §1 ("execution
principles") and §29 ("multi-tenant execution") establish, cross-referenced here rather than
re-derived.

### 3.1 Authentication and identity

`requireAuth()` (`src/lib/supabase/auth-guard.ts:270`) is the single, mandatory entry point every
API route in this codebase calls (per `CLAUDE.md`'s own rule), returning an `AuthContext` carrying
identity, org, and role together. `requireAuthOrApiKey()` (`auth-guard.ts:392`) extends the same
model to API-key callers, with an explicit role-floor so a scoped key cannot act below a route's
minimum role. **Why server-only:** the Supabase session token and the role/org resolution it drives
are exactly the boundary between "this browser tab claims to be user X" and "this request is
authenticated as user X" — a client cannot self-certify its own identity or role, per this
codebase's own `ROLE_RANK` role-hierarchy mechanism (`auth-guard.ts`, referenced near line 42),
which has a documented real historical bug (6 newer roles once fell through to rank 0) showing it is
actively maintained, security-relevant code, not a stub.

### 3.2 Tenant isolation (RLS)

`withTenantContext()` (`src/lib/db/tenant-scoped.ts:65`) runs a transaction under the dedicated
`app_runtime` Postgres role (RLS-enforced, not the plain `postgres`-role bypass some unmigrated
routes still use), setting `app.current_org_id`/`current_client_ids`/`current_user_id` via
`set_config()`. **Why server-only:** RLS is a database-enforced boundary — the moment tenant scoping
is decided or trusted client-side, cross-org data leakage becomes possible regardless of what the UI
displays. OCID-031's own §29 documents this mechanism is used pervasively but **not every route is
migrated onto it yet** — a real, honest, currently-open gap, not fixed by this document.

### 3.3 Database writes

All persisted state (tasks, conversations, messages, engine invocations, audit rows) is written
through Drizzle against Postgres, inside `withTenantContext()` transactions where tenant scoping
applies. OCID-031 §1's four non-negotiable properties (one identifier, traceable/auditable via
`logActivity()`, chained to the existing UMR/artifact index, "AI never executes software
responsibilities") all describe this write path. **Why server-only:** a client-side write bypasses
RLS, bypasses `logActivity()`'s same-transaction audit guarantee, and cannot be trusted as the
system of record — the same reasoning `src/app/api/prompt-compiler/execute/route.ts`'s own header
comment states plainly (§4.2 below).

### 3.4 The Mother Router's model resolution

`resolveModel()` (`src/lib/ai-router/mother-router.ts:594`) is the real, unifying AI model/provider
registry + versioned routing policy + audit log across `software_team`/`end_user_org`/
`sales_marketing` scopes. **Why server-only:** it holds provider API keys, enforces
`model-tier-eligibility.ts`'s `checkTierEligibility()` gate (restricting which models may attempt
judgment-tier work), and writes `logRoutingDecision()` audit rows — none of which a browser can hold
or enforce without exposing credentials or becoming trivially bypassable. **Honest, disclosed
limitation, restated from the file's own header, not new here:** 35 other files still call
`model-tier-eligibility.ts`/`orchestra-model-resolver.ts`/`roster.ts`/`llm-client.ts` directly,
bypassing the Mother Router — a documented, deliberate, still-open partial migration, not
contradicted by this document.

### 3.5 Deterministic-vs-AI dispatch and its now-real visible signal

`src/lib/llm-routing-gate.ts`'s `tryDeterministicRoute()` runs before any LLM call in VERI Chat's
`chat-service.ts::generateAiReply()` path (two of `intent-engine.ts`'s intents — `check_status`,
`generate_report` — resolve with zero LLM cost); `dialogue-script-executor.ts`'s
`runDialogueScriptTurn()` runs next; only then does `resolveModelConfig()`/`callLLM()` fire. This
routing logic and its enforcement are entirely server-side and stay that way — a client cannot be
trusted to honestly report whether it "would have" used a deterministic path instead of an AI one,
since credit/cost governance depends on the true answer.

This session's own prior work closed a real, related gap: `GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL`
(`ai-os/MASTER-TRACKER.yaml`, `status: resolved`) found the primary `/home` chat surface rendered a
deterministic reply and a genuine AI-escalated reply identically — zero visible distinction, despite
the routing itself working correctly. The fix, confirmed real in this document's own discovery pass
(`src/components/veri-chat/HomeThreadSlot.tsx:38`, `withSourceTypeLabel()`), now derives a visible
label from the server-supplied `confidenceLabel` field. **Honest limitation, carried forward from
that gap's own closing note:** the fix was verified via unit tests on the derivation function; a
live browser re-render of `/home` showing the label was not re-confirmed in this document's own
pass. This is cited as real evidence of the *pattern* this document generalizes in §5.2 below (the
server decides, and must keep deciding, whether a given response was software-deterministic or
AI-escalated — the client's job is to render that server-supplied fact honestly, never to compute or
claim it itself).

### 3.6 Engines, workflows, reports (deterministic SOFTWARE)

`src/lib/engines/*` (32 files: accounting, costing, GRC, analytics, compliance, etc.) are pure,
deterministic functions invoked exclusively through `engine-invocation.ts`'s `invokeEngine()` (§3 of
OCID-031, cross-referenced not restated). `report-engine-service.ts`'s `executeReportDefinition()`
and the per-domain workflow FSMs (`construction-billing-workflow-service.ts`,
`grc-workflow-engine.ts`) are likewise server-only. **Why server-only:** "engines compute, AI never
invents a number" (`grc-workflow-engine.ts`'s own header discipline, cited by OCID-031 §1) is a
correctness/compliance guarantee — a browser-side reimplementation of a compliance-critical
calculation (tax, deadline, risk score) would be a second, unauditable source of truth, exactly the
class of duplication `superboss-register.py check-duplicate` (OCID-031 §27) exists to prevent.

### 3.7 Audit and billing

`src/lib/audit.ts`'s `logActivity()`, `src/lib/audit-event-triggers.ts`'s named-event audit creation,
and the Mother Router's `logRoutingDecision()` (§3.4) are the real audit trail. Credit/AI-spend
governance (referenced throughout `ai-os/COST-CONTROL.md` and this codebase's "software first, AI
second, minimal credits only when needed" discipline, cited in `execute/route.ts`'s own header) is
enforced at the same server boundary. **Why server-only:** an audit or billing record a client could
forge or omit is not an audit or billing record — non-repudiability requires the write to happen
where the client cannot intercept or suppress it.

### 3.8 If a self-hosted local model joins this list: Ollama, not a new architecture

**Real, targeted addition — closes OCID-064 (`UMR-20260804-072532-a02d`, `UMR-20260804-073906-3dd0`).
Documentation only; nothing built or installed by this addition.** OCID-064's own incoming prompt was
independently compared against this document's §3/§4 content and against OCID-061's real input-intake
discovery; every element it described — local tool calling, context injection to prevent identifier
hallucination, a deterministic (non-model-trusted) confidence calculation, and an identity envelope
carrying brand/organization/task fields — was already covered above and in §5 below, with one genuine
exception: **Ollama** as a specific, named local-inference mechanism.

Ollama (`https://ollama.com`) is architecturally distinct from every client-side option already
inventoried in §4: it is a **real local server process** (not in-browser) that exposes a REST API
compatible with the OpenAI SDK's chat-completions/tool-calling shape
(`POST /api/chat` / `POST /v1/chat/completions`). This makes it the concrete mechanism for a
**self-hosted local model** — one running on infrastructure this organization controls, but off the
Mother Router's managed-provider path — should that ever become part of the real deterministic
execution path this document describes. It is **complementary to, not a replacement for**, the
already-covered browser-side options:

| Mechanism | Where it runs | Transport | Status in this codebase |
|---|---|---|---|
| `webllm-engine.ts` (§4.1) | In-browser, WebGPU | none (in-process) | Real, tested, unwired to live chat (`GAP-MINI-VERIDIAN-CLIENT-EXECUTION-UNWIRED`, §3.9 below cross-ref) |
| `transformers-engine.ts` (§4.1) | In-browser, WASM/CPU | none (in-process) | Real, tested, unwired to live chat |
| Ollama | Local server process (not the browser) | HTTP, OpenAI-compatible | Not present in this codebase — named here as a real, available mechanism only, nothing installed |

**Why this stays consistent with §3's own reasoning, not an exception to it:** a self-hosted Ollama
instance is still a server-side process from the browser's point of view — it does not change any of
the "why server-only" arguments in §3.1–3.7 (auth, tenant isolation, DB writes, Mother Router model
resolution, deterministic-vs-AI dispatch, engines, audit/billing all stay exactly where this document
already places them). What it *would* change, if ever wired in, is only the Mother Router's own
provider registry (`mother-router.ts:594`, §3.4) gaining one more real, self-hosted provider entry
alongside the existing external providers — not a new code path, not a new trust boundary, and not a
second parallel routing mechanism.

**Why function calling/tool use, not free chat, is the pattern that keeps it deterministic:** this
session's own reuse discipline (the Mandatory Governance Directive, `UMR-20260804-051521-fee4`/`-7099`)
applies here directly. A local model given a free-text prompt and allowed to answer conversationally is
exactly the "second, unauditable source of truth" §3.6 warns against for engines — its output cannot be
verified against a fixed contract. Ollama's own OpenAI-compatible `tools`/`tool_calls` support (the same
shape `tool-calling.ts`'s `BrowserToolRegistry`/`dispatchMcpToolCall` already uses client-side, §4.1)
constrains the model to selecting from a fixed, pre-declared function/parameter schema rather than
producing free-form text — the same discipline that lets `llm-routing-gate.ts`'s `tryDeterministicRoute()`
(§3.5) and the engines (§3.6) stay auditable: **the schema is fixed and server-defined; the model
picks, it does not invent.** Any real future wiring of a self-hosted Ollama instance should follow this
same constraint — tool/function-call dispatch against a declared schema, never an open-ended chat
completion trusted as authoritative — matching exactly how this document already requires every other
AI-touched path in §3 and §5 to work.

**Explicitly out of scope for this addition:** no Ollama install, no server process, no Mother Router
provider-registry change, no code. This is a documentation note that the mechanism exists and how it
would need to be wired if a fresh PM decision ever authorizes it — real installation and wiring remain
a future implementation decision, gated the same as every other item in this document behind a real,
separate PM authorization.

---

## 4. Mini VERIDIAN — real local/client execution today, and what it could reasonably scope to

This section inventories what genuinely runs client-side today (not proposed — confirmed by direct
file read in this document's own discovery pass), then names, explicitly labeled as proposed, what
Mini VERIDIAN (§0) could reasonably own next.

### 4.1 Real, today: the browser execution tier system (built, largely unwired to live chat)

`src/lib/browser-execution/` is a real, tested (58 tests passing per
`ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`) five-tier client compute system:

- **`tier-detection.ts`** — honest feature detection for each tier (`navigator.ml` for NPU,
  `window.ai`/`window.LanguageModel` for Chrome Built-in AI, `navigator.gpu` for WebGPU/lite-LLM,
  a browser-presence check for Transformers.js, and an always-available server fallback). Every
  detector reports what is real right now — never assumes.
- **`tier-orchestrator.ts`** — `planExecution()` picks the highest-priority available tier
  (`TIER_PRIORITY = ["npu", "builtin-ai", "lite-llm", "transformers", "server"]`) and reports the
  real fallback chain; `requiresServerEscalation()`, `shouldAttemptWebLlm()`,
  `shouldAttemptNpu()`/`shouldAttemptBuiltinAi()` are the real gates for whether each tier's actual
  inference should run.
- **`webllm-engine.ts`** — real, wired model install (`Qwen2.5-0.5B-Instruct-q4f16_1-MLC` via
  `@mlc-ai/web-llm`), attempted only when WebGPU is genuinely present.
- **`transformers-engine.ts`** — real embeddings/tool-selection via `Xenova/all-MiniLM-L6-v2`
  (`@huggingface/transformers`), explicitly scoped to embeddings/classification, not generation.
- **`npu-engine.ts`** — real WebNN inference path, gated on `navigator.ml` presence.
- **`worker-pool.ts`** — a real multi-worker pool with `SharedArrayBuffer`/`Atomics` coordination.
- **`cross-tier-storage.ts`** / **`model-cache.ts`** — real OPFS/Cache-API/IndexedDB storage,
  priority-ordered, used for tier-local model-weight caching (`IndexedDbModelCache`).
- **`sync-engine.ts`** — real offline-queue coalescing logic (create/update/delete conflict
  resolution for queued changes against the same entity), built fresh for this increment after
  confirming (via `git log --all --diff-filter=A` and `gh pr view 54`) that a previously-cited prior
  offline-queue precedent did not actually exist in this repo.
- **`tool-calling.ts`** — real client-side MCP-shaped tool dispatch (`BrowserToolRegistry`,
  `dispatchMcpToolCall`), zero network hop, fully client-side.

**The honest, load-bearing gap, confirmed independently in this document's own pass, not
restated from memory:** per that status doc's own "left open" section and independently confirmed
by re-reading `VeriComposer.tsx`'s imports directly (`grep -n "browser-execution" src/components/veri-chat/VeriComposer.tsx`
finds exactly one import), **none of the tier system's actual model-inference engines
(`webllm-engine.ts`, `transformers-engine.ts`, `npu-engine.ts`) are wired into VeriComposer's live
send path.** The only real integration point is `client-compile.ts`'s `compileInBrowser()` (§4.2),
which uses `tier-orchestrator.ts` for tier *selection/telemetry* only — it does not invoke any
tier's actual model inference. This is installed-and-tested-but-largely-unwired infrastructure, not
a live production execution path, and this document does not describe it as more integrated than
that.

### 4.2 Real, today: the browser-native FIRST execution pass (wired, deterministic-only)

`src/lib/browser-execution/client-compile.ts`'s `compileInBrowser()` is real, wired, and running in
production today: `VeriComposer.tsx`'s `runBrowserFirstPass()` (line 243) calls it on every chat
send, then fire-and-forget `POST`s the result to `/api/prompt-compiler/execute`. This module's own
header cites the real Owner directive it implements: *"The browser-native AI platform makes the
complete machine language output of the end user prompt and gives to the SOFTWARE to execute. FIRST
execution in the browser-native AI platform, SECOND execution in the SERVER by the SOFTWARE."*
Concretely, the FIRST pass:

1. Picks a tier via `planExecution()` (§4.1) — today this only ever affects which tier is
   *reported*, since no tier's actual model runs yet (§4.1's gap).
2. Runs `analyzeLightweight()` (phase_2's real Layer-2 classifier, reused unmodified — deliberately
   not a second, browser-flavored classifier) — real, deterministic, client-side JS, not a model.
3. Reports `{analysis, tier, fallbackChain, compileMs}`.

`src/app/api/prompt-compiler/execute/route.ts` is the real SECOND execution: `requireAuth()`-gated,
recomputes the full pipeline (`runPipeline()`) from `rawText` using real DB-backed org/user context,
and — this is the load-bearing security property — **never trusts the client's `browserCompiled`
telemetry for anything authoritative.** Its own header states this explicitly: the browser's result
is accepted "ONLY as non-authoritative telemetry." This is real, live, already-correct
"software-first-pass, server-second-pass-authoritative" behavior — not a design this document
invents, but the single strongest piece of real prior art for §5's proposed handoff sequence.

### 4.3 Real, today: narrow, structured local storage

- **`src/lib/browser-intent-cache.ts`** — a real IndexedDB store (`veridian-intent-cache`),
  client-only recall of a user's own past composer submissions (mode + chain path + text),
  explicitly scoped to zero-AI-cost, zero-network-round-trip, offline-capable recall. Its own header
  is explicit that "encrypted" from the originating spec is *not* implemented as literal
  encryption-at-rest — origin isolation is the real protection, named honestly rather than
  overclaimed.
- **`model-cache.ts`'s `IndexedDbModelCache`** — real tier-local model-weight caching (§4.1),
  explicitly scoped to per-engine weight storage, not general app state.
- **Four narrow `localStorage` uses**, independently reconfirmed by this document's own
  `grep -rn "localStorage" src/` pass: `GlobalChatDock.tsx` (chat-draft persistence),
  `OnboardingChecklist.tsx` (completion state), `resizable.tsx` (react-resizable-panels' own
  panel-size persistence), and `visitor-id.ts`/`VisitorIntelligence.tsx`/`signup/page.tsx`
  (anonymous pre-login visitor id). **Honest correction to an older repo claim, found in this
  document's own pass:** `ai-os/CONSTITUTION.yaml` (line 759) states "Zero indexedDB... usage
  anywhere," dated 2026-07-14 — that claim predates the phase_5 browser-execution work (2026-07-27
  onward) and is now stale; real IndexedDB usage exists today via `browser-intent-cache.ts` and
  `model-cache.ts`. This document does not edit `CONSTITUTION.yaml` (out of scope) but names the
  drift so a future pass does not treat that line as current.

### 4.4 Real, confirmed absence: no PWA install/offline execution surface

`src/app/manifest.ts` (Next.js 16's native manifest route, merged via PR #435) is real: it returns a
live, installable `MetadataRoute.Manifest` (`name: "VERIDIAN AI"`, `start_url: "/home"`,
`display: "standalone"`, a working `share_target` wired to `POST /api/veri-chat/share-target`).
**Real, confirmed absence, independently re-verified in this document's own pass**
(`git grep -niE "serviceWorker|service-worker|sw\.js|next-pwa|workbox"` across the full repo,
excluding `node_modules`): **zero service worker exists anywhere.** No offline app-shell cache, no
background sync, no push-notification handling. This matches `ai-os/VERIDIAN_OCID_051_CROSS_SURFACE_CERTIFICATION_PLANNING_2026-08-03.md`'s
own independently-confirmed finding and OCID-034's own §7 ("PWA context") finding; this document adds
no new information here, it re-confirms the existing one and cites it as the reason Mini VERIDIAN
cannot, today, own any genuinely offline execution — there is no service worker to run it in, and
building one is explicitly out of this dispatch's scope (§ header, PM instruction).

### 4.5 Proposed (not built): Mini VERIDIAN's reasonable scope

Everything below is **explicitly proposed**, not existing. It is scoped tightly to what §4.1–§4.3's
real infrastructure already makes plausible, not invented from nothing:

- **Tier-aware local response for narrow, low-stakes intents.** Where `tier-orchestrator.ts`
  selects `lite-llm`/`transformers`/`npu`/`builtin-ai` (§4.1) and the request is a genuinely
  low-stakes, non-authoritative one (e.g., drafting composer text before send, local search/recall
  over `browser-intent-cache.ts`'s own store, embedding-based tool suggestion via
  `transformers-engine.ts`'s existing `selectToolByEmbeddingSimilarity`), Mini VERIDIAN could
  reasonably run that tier's real (already-built, already-tested) inference client-side instead of
  only reporting which tier *would* have run (§4.1's current behavior). This is wiring existing,
  tested engines into an existing, live send path — not new engine-building.
- **Never for anything in §3.** Nothing proposed here extends into auth, tenant-scoped writes,
  engine computation, Mother Router model resolution, deterministic-vs-AI dispatch decisions, or
  audit/billing — §3's reasoning (RLS, credential custody, non-repudiable audit, billing integrity)
  applies identically regardless of how capable a local model becomes. A locally-run small model can
  draft or suggest; it cannot authorize, write, or bill.
- **Structured local cache expansion**, narrowly, following `cross-tier-storage.ts`'s existing
  OPFS→Cache-API→IndexedDB priority pattern — e.g., caching capability-tree structure
  (`BROWSER-06`/`BROWSER-07`, `ai-os/CONSTITUTION.yaml`, confirmed `NOT_YET_BUILT` by OCID-024's own
  draft) for faster repeat renders, always subject to the server re-validating on next write (same
  non-authoritative-telemetry pattern as §4.2).
- **Explicitly not proposed here:** a service worker, an offline write queue with real
  sync-to-server wiring, or any new PWA surface — all out of scope per this dispatch's own hard
  constraint (§ header).

---

## 5. Local vs. server execution order — a proposed, concrete handoff sequence

**Everything in this section is proposed.** It generalizes the one real, live pattern already
proven correct in production (§4.2's FIRST/SECOND execution) to the fuller Mini VERIDIAN scope named
in §4.5, without claiming any of the generalization itself is built.

### 5.1 Real precedent this proposal extends (not invents)

`compileInBrowser()` → `POST /api/prompt-compiler/execute` (§4.2) is the one real, live, already-
correct instance of "browser runs a real FIRST pass, server runs an authoritative SECOND pass that
never trusts the first." This proposal is that same shape, generalized from "always deterministic
JS classification" to "whichever real tier `tier-orchestrator.ts` already selects, when the request
is low-stakes enough to qualify."

### 5.2 Proposed sequence

1. **User action in VeriComposer** (real UI, unchanged).
2. **Mini VERIDIAN FIRST pass (proposed extension of the real §4.2 pass):**
   a. `planExecution()` selects a tier (real, §4.1).
   b. `analyzeLightweight()` runs (real, §4.2) — unchanged.
   c. **Proposed, new:** if the selected tier is not `server` AND the request matches a narrow,
      pre-approved low-stakes class (§4.5 — composer draft assistance, local intent recall, tool
      suggestion ranking), that tier's real engine (§4.1) runs locally and its result is shown
      immediately, labeled as a **local, unverified suggestion** — never as a completed action,
      never as an authoritative answer, matching `ai-reply-gate.ts`'s existing
      `detectFalseActionClaim()` discipline (never claim an action was taken that wasn't).
   d. The FIRST pass's full result (analysis + whatever local suggestion was shown, if any) is sent
      to the server exactly as `browserCompiled` is today (§4.2) — **non-authoritative telemetry
      only, never trusted for anything server-side decides.**
3. **Server SECOND pass (real mechanism, §3, unchanged):** `requireAuth()` →
   `withTenantContext()` → `runPipeline()` recomputes the full, authoritative result from `rawText`
   and real DB-backed context. `llm-routing-gate.ts`'s deterministic-vs-AI decision (§3.5) runs here,
   server-side, exactly as it does today — Mini VERIDIAN's local tier selection in step 2 never
   substitutes for this decision, it only possibly pre-populated a UI suggestion the user still has
   to actually submit through this same authoritative path.
4. **Escalation, if needed (real mechanism, §3.4/§3.6):** if the server pass needs an actual AI call
   (Mother Router `resolveModel()`, tier-eligibility-gated), that happens here, server-side, same as
   today — never client-side, never bypassing `enforcePolicy()`/`checkTierEligibility()`.
5. **Response, labeled honestly (real mechanism, §3.5, extended in scope only):** the rendered
   result carries the server-determined source label (`withSourceTypeLabel()`'s real pattern,
   `HomeThreadSlot.tsx:38`) — deterministic, AI-escalated, or (proposed, new) **locally-suggested-
   then-server-confirmed**, so the end user can always tell which of the three actually produced
   what they're looking at, generalizing the same transparency principle OCID-020's own certification
   work already found and fixed as a real gap (§3.5).

### 5.3 What this proposal explicitly does not change

Nothing above alters `requireAuth()`, `withTenantContext()`, `enforcePolicy()`,
`checkTierEligibility()`, `logActivity()`, or `resolveModel()` — every server-authoritative
mechanism in §3 keeps deciding exactly what it decides today. This proposal only asks: for a narrow,
already-fenced class of low-stakes requests, should the *first thing the user sees* come from a
real, already-built local tier instead of a network round trip, on the condition that it is always
re-verified/superseded by the same real server pass that already runs today. It does not weaken any
of the five guardrails AGENTS.md Rule 9 protects, and does not change what gets audited, billed, or
persisted.

---

## 6. Real vs. Proposed — summary table

| Item | Real today | Proposed here |
|---|---|---|
| `requireAuth()` / `withTenantContext()` / RLS | Yes — pervasive, load-bearing | — |
| Mother Router model resolution, tier eligibility | Yes — real, with a documented partial-migration gap (35 bypassing files) | — |
| Deterministic-vs-AI dispatch gate (`llm-routing-gate.ts`) | Yes — real, server-side | — |
| Visible deterministic-vs-AI label on `/home` | Yes — real, recently fixed (`withSourceTypeLabel()`) | Extend the same label to a third value: "locally-suggested-then-server-confirmed" (§5.2) |
| Browser FIRST pass / server SECOND pass (deterministic JS only) | Yes — real, live, wired (`compileInBrowser` → `/api/prompt-compiler/execute`) | Generalize the FIRST pass to optionally include real local model inference for a narrow low-stakes class (§5.2 step 2c) |
| 5-tier browser execution system (NPU/Built-in AI/lite-LLM/Transformers/server) | Yes — real, tested (58 tests), **not wired to VeriComposer's live send path** | Wire specific tiers into specific narrow send-path moments (§4.5) |
| `browser-intent-cache.ts` (IndexedDB intent recall) | Yes — real, live, used by `IntentCommandPalette.tsx` | — |
| `cross-tier-storage.ts` (OPFS/Cache-API/IndexedDB) | Yes — real, tested, used for tier model-weight caching only | Extend to capability-tree/report-data caching (§4.5) |
| `sync-engine.ts` (offline conflict-resolution logic) | Yes — real, tested, **not wired to any live offline queue or server sync endpoint** | Not proposed further here — out of scope (needs OCID-025/PWA implementation, not this dispatch) |
| Service worker / offline execution | **No — confirmed zero anywhere in the repo** | **Not proposed here** — explicitly out of scope per this dispatch's own hard constraint |
| `manifest.ts` (installable PWA shell, Web Share Target) | Yes — real, live, merged | — |
| "Mini VERIDIAN" as a named, unified client runtime | **No — this document's own new term (§0), not a shipped component** | The scoping and handoff sequence this document proposes (§4.5, §5) |

---

## 7. Honest gaps and uncertainties, not glossed over

- **OCID-061 has not started.** This document does not know what OCID-061's discovery will find
  about a shared "intent resolution layer" — where this document touches input-mapping ground (mode
  pills, option chains, chat, speech-to-text via `whisper-client.ts` per OCID-025's draft), it
  reports only what OCID-024/031/034 already found and explicitly defers the intent-resolution-layer
  question to OCID-061.
- **OCID-024 and OCID-025 are open drafts, not merged.** Their content, cited in §4 above, could
  still change before merge. This document's own §4 findings were independently re-derived from the
  live source tree, not solely trusted from those drafts, specifically so this document does not
  become invalid if either draft changes materially before merging.
- **This document's own dispatch UMR was not independently verified** (see the disclosure under the
  title) — a real, disclosed limitation of working from a scratch clone without host/database access,
  not a claim that it doesn't matter.
- **§4.1's "unwired" finding is a point-in-time confirmation, not a guarantee it stays true.** A
  concurrent session could wire one of these engines into `VeriComposer.tsx` at any time, given how
  active this repo's parallel-worker model is (confirmed elsewhere in this document's own discovery:
  PR numbers advanced from #865 to #875 within this document's own research window). A future reader
  should re-grep `VeriComposer.tsx`'s imports before trusting this section as current.
- **This document does not certify §5's proposal is safe, performant, or correct to build.** It is a
  documentation-only architecture proposal, explicitly not an implementation plan, and explicitly not
  a certification — per `SEC-07`, real implementation of any part of it needs a fresh PM decision, as
  the dispatch itself states.

---

## 8. Readiness

This document hands off: (a) a cited, current inventory of what is genuinely server-authoritative
and why (§3), (b) a new, explicitly-labeled-as-new term ("Mini VERIDIAN," §0) scoping what already
exists client-side and what could reasonably extend it (§4), and (c) one concrete, clearly-proposed
local/server handoff sequence generalizing the one real pattern already proven in production (§5).
It does not implement, certify, or unlock anything — `SEC-07`/OCID-020 remain the real gate for that,
exactly as every sibling document in this OCID chain has correctly observed. A future implementation
OCID should wait for OCID-024, OCID-025, and OCID-061 to progress further (per this dispatch's own
instruction) before treating §5's sequence as ready to build.

Canonical artifact created: this file
(`ai-os/VERIDIAN_OCID_062_SERVER_AUTHORITY_AND_MINI_VERIDIAN_EXECUTION_ARCHITECTURE_2026-08-04.md`).
Amends the existing canonical-artifact index (`ai-os/OS.yaml`) and `ai-os/MASTER-TRACKER.yaml`; does
not start a new UMR chain.
