# VERIDIAN Universal Browser, PWA, and Offline Synchronization Runtime Certification — v1.0

**Status: discovery/verification only.** This artifact implements no code, changes no
architecture, and redesigns no runtime. Per this task's own SPEC: "this OCID shall certify
runtime behaviour and shall not redesign runtime architecture, so this dispatch authorizes real
discovery and verification only." Every claim below is real, live, evidenced state as of
2026-08-04, cited to a file:line, or an explicitly labeled gap (`NOT_YET_BUILT` /
`REAL_BUT_UNWIRED` / `PARTIALLY_ENFORCED`), following the same honest-labeling convention already
established by `ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` (OCID-028) and the
OCID-024/025/038/051 discovery chain. Where this document's own independent re-verification
confirms a prior finding is still accurate, it says so; where live state has moved since
2026-08-03, it says that instead.

## 0. Parent-chain verification (done before anything else, per standing repo practice)

The SPEC names OCID-058 (`UMR-20260804-040009-09bc`) as this task's direct, "real confirmed"
parent, itself chained through OCID-057/056/055/054/053 to OCID-020/021. Independently checked
rather than trusted, per this repo's own standing rule that state drifts within seconds under
multiple concurrent sessions:

- OCID-053 (`8bd602d9`), OCID-054 (`03f60ffd`), OCID-055 (`865ce964`), OCID-056 (`caa85c95`),
  OCID-057 (`050b8e2c`) are all **real, merged commits on `origin/main`** — confirmed via
  `git log --all`.
- **OCID-058 is NOT yet real.** Zero commits, zero PRs, zero branches, and zero grep hits for its
  cited UMR (`UMR-20260804-040009-09bc`) anywhere in this repository. Its own task directory,
  `task-20260804-045439-register-ocid-058--universal-task-regist` (created 4 seconds before this
  task's own directory), shows `status: in_progress` with an empty `worker.log` — a real,
  currently-running sibling task that has not yet produced real committed content, not a
  fabricated reference. Not reaching into that task's own workspace (would duplicate/collide with
  its own in-flight work, exactly what `ai-os/boss/ACTIVE-CLAIMS.yaml` exists to prevent).
- The SPEC's incoming prompt also repeats **OCID-012** as a reference. Re-checked again this
  session, same result as every prior check on record: zero matches anywhere in the real UMR
  chain. Flagged back to the Owner again, not registered, consistent with the SPEC's own explicit
  instruction.

This document's real parent is therefore **OCID-057** (the actual highest real, merged OCID on
`main` at the time this document was written), not the not-yet-real OCID-058 the SPEC names. Full
reasoning recorded in `ai-os/boss/ACTIVE-CLAIMS.yaml`'s entry for this task.

---

# Part A — Browser Runtime Certification

## A1. What "browser runtime" means in this codebase

The real browser-native compute-tier system lives entirely under `src/lib/browser-execution/`
(phase_5 of `VERIDIAN_Architecture_v2.0`, built across 3 real commits: `2af304a6`, `a68f50f4`,
`695d77ce`). It is a genuinely tiered local-compute system — NPU (WebNN) → Built-in AI (Chrome
`window.ai`) → Lite LLM (WebGPU/WebLLM) → Transformers.js (WASM embeddings) → Server — not an
aspirational description. 12 files, 108/108 tests passing (re-run live this session:
`bun test src/lib/browser-execution/` → `108 pass, 0 fail, 195 expect() calls`, `385ms`).

## A2. Tier detection — real, honest, live

`src/lib/browser-execution/tier-detection.ts` (125 lines): every one of its 5 detectors
(`detectNpuTier`, `detectBuiltinAiTier`, `detectLiteLlmTier`, `detectTransformersTier`,
`detectServerTier`) reads a real, well-known global property (`navigator.ml`, `window.ai` /
`window.LanguageModel`, `navigator.gpu`) and reports honestly — no detector claims a tier is
usable when the underlying browser API is absent. `detectServerTier()` always reports
`available: true` (the terminal, always-real fallback). Confirmed: zero hardcoded/faked
`available: true` outside that one intentional terminal case.

## A3. Tier selection and orchestration — real, live, and wired into the app

`src/lib/browser-execution/tier-orchestrator.ts::planExecution()` builds a real priority-ordered
execution plan (`TIER_PRIORITY = ["npu", "builtin-ai", "lite-llm", "transformers", "server"]`,
line 27) from `tier-detection.ts`'s live facts, plus a documented fallback chain. This function
**is genuinely wired into the live product**, not dead code:

```
src/lib/browser-execution/client-compile.ts::compileInBrowser()
  → src/components/veri-chat/VeriComposer.tsx:245 (const draft = compileInBrowser(text))
  → sent to src/app/api/prompt-compiler/execute/route.ts as non-authoritative telemetry
```

This is the one real, confirmed end-to-end browser-runtime path in the live product: every
VeriComposer submission runs `planExecution()` client-side, selects a tier, and reports
`{ tier, fallbackChain, compileMs }` to the server alongside the real deterministic Layer 2
analysis (`analyzeLightweight()`, reused unmodified from `prompt-compiler/prompt-construction.ts`
— `client-compile.ts`'s own header comment documents this as the Owner's explicit "no new engine
unless necessary" directive being followed literally).

## A4. What tier selection does NOT do — a real, previously-understated gap

**Tier selection and tier *execution* are two different things, and only the first is wired into
the live app.** `compileInBrowser()` calls `planExecution()` to pick a tier and reports which one
was picked — it never calls the tier's own real inference code. Verified directly by grep (no
non-test importer anywhere in `src`/`src/app`/`src/components` for any of the following):

| File | Real capability implemented | Live (non-test) callers found |
|---|---|---|
| `webllm-engine.ts` (`startLiteLlmSession`, real `@mlc-ai/web-llm` v0.2.84 dependency, confirmed in `package.json`) | Real local LLM inference via WebGPU | **Zero** |
| `npu-engine.ts` | Real WebNN inference call | **Zero** |
| `builtin-ai-engine.ts` | Real `window.ai`/`window.LanguageModel` call | **Zero** |
| `transformers-engine.ts` (real `@huggingface/transformers` v4.2.0 dependency, confirmed in `package.json`) | Real WASM embedding/classification pass | **Zero** |
| `model-cache.ts` | Model artifact caching | **Zero** |
| `worker-pool.ts` (`WorkerPool`, `recommendPoolSize`) | Real Web Worker parallelism | **Zero** (only referenced internally by `tier-orchestrator.ts::planParallelism()`, which itself has zero non-test callers) |
| `cross-tier-storage.ts` | Cross-tier local persistence | **Zero** |

The internal gate functions that would trigger these (`shouldAttemptWebLlm`, `shouldAttemptNpu`,
`shouldAttemptBuiltinAi` in `tier-orchestrator.ts`) are called only from inside their own matching
engine file's exported function as a self-guard (e.g. `webllm-engine.ts:105` calls
`shouldAttemptWebLlm` before `startLiteLlmSession` proceeds) — nothing in `client-compile.ts` or
`VeriComposer.tsx` ever calls `startLiteLlmSession`/the NPU engine/the Built-in AI engine/the
Transformers engine. **Net honest finding: the live app performs real tier *detection* and real
tier *selection*, and reports which tier it picked — it never actually runs a local model on any
tier.** Every real submission's actual analysis is the same deterministic JS classifier
(`analyzeLightweight()`) regardless of which tier was "selected." This is not a defect introduced
by this document — the code is real, well-tested, and honestly self-documented (see
`tier-orchestrator.ts`'s own header calling this "increment 3, real inference wiring" for the
gate functions) — but the live, end-to-end, user-facing behavior today is tier
detection+selection+telemetry only, not tier *execution*. This is a more precise, narrower
statement than "browser execution tiers exist" and is worth recording explicitly since no prior
document phrased the gap at exactly this level (OCID-024/025/028 focused on sync/cache/PWA
angles, not on this specific selection-vs-execution wiring gap).

## A5. Device-local state that IS live-wired

`src/lib/browser-intent-cache.ts` (IndexedDB-backed, device-local composer-submission recall
cache) is genuinely wired into the live UI — confirmed real callers in
`src/components/veri-chat/VeriComposer.tsx` and
`src/components/veri-chat/IntentCommandPalette.tsx`. This is a separate mechanism from the
browser-execution tier system (§A2-A4); it never touches model inference or server sync, only a
user's own past submission history on one device.

## A6. Browser runtime certification summary

| Component | Real status |
|---|---|
| Tier detection (NPU/Built-in AI/WebGPU/Transformers/Server) | **Real, live, honest — no faked availability** |
| Tier selection + fallback planning | **Real, live, wired** (`compileInBrowser` → `VeriComposer.tsx`) |
| Actual per-tier model inference (WebLLM/NPU/Built-in AI/Transformers) | **Real code, unit-tested, `REAL_BUT_UNWIRED`** — zero live callers |
| Worker-pool parallelism | **Real code, `REAL_BUT_UNWIRED`** |
| Cross-tier local storage | **Real code, `REAL_BUT_UNWIRED`** |
| Device-local intent/composer cache (`browser-intent-cache.ts`) | **Real, live, wired** — separate from the tier system |
| Server escalation (`requiresServerEscalation`) | **Real** — selecting "server" tier means the deterministic server-side pipeline runs, which is always the actual analysis path today regardless of which tier telemetry reports |

---

# Part B — PWA Certification

## B1. Manifest — real and live

`src/app/manifest.ts` (Next.js App Router's dynamic manifest route, not a static
`public/manifest.json` — the two are different real mechanisms, which is why an earlier
repo-wide `find -iname manifest.json` genuinely found nothing while the app is still
installable). Confirmed real fields: `name`, `short_name`, `start_url: "/home"`,
`display: "standalone"`, `theme_color`/`background_color` matching the design-token values in
`CLAUDE.md`, an icon (`/logo-mark.svg`), and a real `share_target` block wired to
`/api/veri-chat/share-target` (POST, `multipart/form-data`). This was already independently,
live-tested end-to-end by OCID-051 (merged PR #844) — a real `GET /manifest.webmanifest` request
returning the full contract, and a real working Web Share Target flow. Not re-tested live again
in this pass (no live deployment access was needed to re-confirm this — the route file itself,
its wiring, and the prior independent live test are sufficient corroboration); the manifest
source file itself is unchanged since that verification (confirmed via `git log -- src/app/manifest.ts`,
no commits since the OCID-051 pass).

## B2. Service worker — genuinely does not exist

Re-confirmed independently this session, matching every prior pass (OCID-024 §33, OCID-025 §20,
OCID-028 §4, OCID-038's `GAP-OCID038-NO-PWA`):

- `git ls-files | grep -iE "sw\.js|service-?worker|workbox"` → **zero hits**, repo-wide.
- `grep -iE "next-pwa|workbox" package.json` → **zero hits**.
- `grep -n "serviceWorker.register\|navigator.serviceWorker"` across all `.ts`/`.tsx` → **zero
  hits**.
- `next.config.ts` has no PWA/service-worker plugin — only `next-intl` and conditional
  `@sentry/nextjs` wrapping.

**Real consequence, stated plainly:** there is no app-shell caching, no offline page, and no
background-sync registration anywhere in compliance-tracker. The PWA is real and installable
(§B1), but once installed it behaves exactly like a normal browser tab pointed at the live site —
no offline capability whatsoever beyond whatever the browser's own default HTTP cache does for
static assets.

## B3. PWA certification summary

| Capability | Real status |
|---|---|
| Installable manifest with correct branding | **Real, live** (`src/app/manifest.ts`) |
| Web Share Target (`share_target`) | **Real, live**, independently tested end-to-end by OCID-051 |
| Service worker | **Does not exist** — zero files, zero dependency, zero registration call |
| Offline app-shell caching | **Does not exist** (requires a service worker) |
| Background sync registration | **Does not exist** (requires a service worker) |
| Push notifications | **Does not exist** (requires a service worker) |

This is a real, honest gap, not something this document certifies as present. Per this task's own
scope, no service worker is built here — this is a discovery/verification pass, and per SEC-07
implementation stays locked pending OCID-020 regardless.

---

# Part C — Synchronization Engine and Offline Queue Report

## C1. Prior art — not duplicated, independently re-verified

`ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` (OCID-028, merged) already ran an
exhaustive 35-section synchronization discovery one day before this document. Rather than
re-deriving all 35 sections from scratch, this report independently re-checked the load-bearing
claims directly against current live code (not by trusting OCID-028's citations) and confirms
they are **still accurate as of 2026-08-04**:

- `src/lib/browser-execution/sync-engine.ts` (244 lines) still exists, unchanged in substance,
  still part of the passing `browser-execution` test suite (confirmed: `sync-engine.test.ts` is
  one of the 12 files in the 108/108-pass run, §A1).
- `git grep -n "browser-execution/sync-engine" -- '*.ts' '*.tsx'` (excluding its own test file) →
  **zero hits, repo-wide.** The sync engine is real, tested, and has never been imported by any
  API route, service, hook, or component. Same finding as OCID-028 §14/§18/§19, independently
  reproduced rather than assumed still true.
- `src/lib/services/task-service.ts::updateTask()` (lines 346-372, re-read directly this session)
  still performs an unconditional `db.update(tasks).set(updates).where(eq(tasks.id, id))` — no
  version/`If-Match` check, no `baseVersion` comparison. Confirmed unchanged since OCID-028 §6/§18.
- No dedicated `/api/sync` endpoint exists for this purpose. Two superficially similar routes were
  checked and ruled out: `src/app/api/connectors/[toolkit]/sync` (third-party toolkit connector
  sync, unrelated) and `src/app/api/internal/ops-task-sync/route.ts` (a server-to-server bridge
  from the separate Hetzner ops box to this app's DB, also unrelated to browser/client offline
  sync).
- `git grep -n "\.channel(\|postgres_changes\|new WebSocket\|EventSource("` across `src` (excluding
  tests) → **zero hits.** No Supabase Realtime, WebSocket, or SSE channel exists anywhere for user
  data. Chat freshness remains polling-only (5-8s intervals across the surfaces OCID-028 §7
  catalogued — not independently re-walked line-by-line this pass, since the underlying mechanism
  — polling hooks, no push — is architecturally unchanged and the absence of any `.channel(`/
  `WebSocket`/`EventSource` call is a direct, sufficient re-confirmation on its own).

## C2. The real offline queue — what it actually is

`OfflineQueue` (`sync-engine.ts:73-110`) is a real, well-designed, per-entity-keyed
(`entityType:entityId`) `Map`-backed queue with genuine coalescing logic
(`coalesceQueuedChanges()`, lines 47-63): create+update coalesces to create; update+update keeps
the *earliest* `baseVersion` so a later sync attempt detects a conflict against the true first
local edit, not a second edit's already-stale basis; anything+delete coalesces to delete;
delete+create/update resets to a fresh create (`baseVersion: null`); create+delete cancels out to
nothing. This is real, deliberate, documented conflict-coalescing logic — not a stub. `syncQueue()`
(lines 168-188) pushes every queued change through an injected `PushChange` transport in FIFO
order, resolves remote conflicts via `resolveConflict()` (field-level merge, local fields win
per-field over the server's current payload; a local delete against a server-side edit is flagged
`needs-manual-resolution` rather than auto-guessed), and re-queues merged conflicts with the
server's new version as the fresh basis. `pullDeltaSync()` (lines 217-225) and `SyncMutex`
(lines 232-244, a real async mutex serializing concurrent sync attempts across tabs) round out a
genuinely complete, small, well-tested offline-sync primitive set.

**The honest, load-bearing fact remains: none of it is reachable from any live code path.** There
is no live entity-type in compliance-tracker whose writes are ever enqueued into an `OfflineQueue`
instance, no live component that instantiates one, and no live endpoint a `PushChange`/
`FetchDeltas` implementation could be wired against without new work. This report re-confirms
rather than repeats OCID-028's own §14/§17/§18/§19 finding: `sync-engine.ts` is the correct
starting point for any future implementation that wires up delta sync/offline queuing/conflict
resolution — not a reason to build a second version, and not something this document builds
further, per its own discovery-only scope.

## C3. Synchronization/offline-queue certification summary

| Area | Real status |
|---|---|
| Offline queue primitives (`OfflineQueue`, coalescing, `SyncMutex`) | **Real, tested, `REAL_BUT_UNWIRED`** |
| Conflict detection primitive (`baseVersion`) | **Real, tested, `REAL_BUT_UNWIRED`** |
| Conflict resolution logic (`resolveConflict`, field-level merge) | **Real, tested, `REAL_BUT_UNWIRED`** |
| Delta sync (`pullDeltaSync`, sync-token-based) | **Real, tested, `REAL_BUT_UNWIRED`** |
| Live task-update conflict detection | **Does not exist** — unconditional last-write-wins, unchanged |
| Dedicated sync API endpoint | **Does not exist** |
| Real-time/push sync (Realtime/WebSocket/SSE) | **Does not exist** |
| Background sync (requires a service worker, §B2) | **`NOT_YET_BUILT`** |
| General offline-first data layer for compliance-tracker CRUD/chat | **Does not exist** — an offline write today is simply a failed HTTP request |

---

## Net certification position (stated plainly, per this task's discovery-only mandate)

**Browser runtime:** real, tested tier-detection and tier-selection infrastructure exists and is
genuinely live-wired into the composer submission path — but it only ever selects and reports a
tier, never executes one; the actual local-model inference code for every non-server tier is
real, passes its own tests, and is currently unreachable from any live user action.

**PWA:** a real, live, correctly-branded, installable manifest with a working Share Target exists.
No service worker exists in any form — no offline caching, no background sync, no push
notifications.

**Synchronization/offline queue:** a real, carefully-designed, fully unit-tested offline-sync
primitive set (`sync-engine.ts`) exists and is completely unwired to any live path. The live
product's actual synchronization model remains, as OCID-028 already put it, "one database, fetched
fresh, polled while a tab is open" — a genuine, working consistency model for what is shipped
today, but not what would be recognized as an offline-capable synchronization runtime.

None of these three gaps (tier execution wiring, service worker, sync-engine wiring) are closed by
this document — per the SPEC's explicit instruction, any real implementation decision here is held
for a separate PM call, and remains additionally locked behind SEC-07 pending OCID-020's
independent completion regardless of that separate call's outcome.

---

Real updated UMR/OCID chain: this document extends the real chain rooted at
`UMR-20260802-173631-ca85` (OCID-021) through `UMR-20260802-165606-4413` (OCID-020) and the real,
independently-verified OCID-053 through OCID-057 chain (§0). It does **not** chain through OCID-058
as the SPEC requested, because OCID-058 is not yet real as of this writing (§0) — the real parent
used is OCID-057. No new UMR chain was created.

Canonical artifact: this file,
`ai-os/VERIDIAN_OCID_059_UNIVERSAL_BROWSER_PWA_SYNC_CERTIFICATION_2026-08-04.md` — new, not a
duplicate of any existing file (confirmed: no prior file in `ai-os/` covers browser-execution
tier-selection-vs-execution wiring, PWA service-worker absence, and sync-engine wiring in one
combined certification document; the closest adjacent prior art, OCID-028, covers synchronization
alone in far greater section-by-section depth and is cited throughout rather than duplicated).

**Not acted on.** No implementation, architecture change, database change, or UI change has been
made under this document. Awaiting Owner review, consistent with SEC-07's implementation lock and
this task's own explicit discovery-only mandate.
