# Audit 37 - B: sync, peer sync, user RAM, error telemetry (points 7, 8, 9, 33)

Read-only audit, 2026-10-04. Repos: projexa (origin/main 1b8c8388; working branch fix/signup-already-registered-message, same local-first code) and compliance-tracker worktree C:\ct\ct-audit37 (da8b21bb). All paths under projexa are `src/lib/local-first/...` unless noted. Nothing was run; evidence is from reading code, tests and CI config.

## Verdict table

| # | Requirement | Status |
|---|---|---|
| 7 | Laptop-to-laptop (peer) sync, invisible | PARTIAL - fully built and e2e-tested in a harness, but NOT STARTED anywhere in the shipped app |
| 8 | Supabase <-> laptop sync, invisible | PARTIAL - pull, outbox push, conflict merge all built and tested; the automatic scheduler that makes it "invisible" is not started; deletes and several kinds do not sync; live real-JWT path unproven |
| 9 | Use the user's RAM/CPU | PARTIAL - data and UI run from the laptop (IndexedDB + /local shell); compute offload (jobs) is built but not wired; no measured RAM/CPU evidence |
| 33 | Failures are captured and sent to us | PARTIAL - only the "Preparing workspace" run reports to us; sync, offline, outbox, peer and AI errors stay on the laptop |

## Point 7 - peer (laptop-to-laptop) sync

### What exists (built)
- Pipeline: attestation (24 h signed by our server, `peer/attest.ts`) -> signalling hub (`peer/signalling.ts`) -> peer network (`peer/network.ts`, WebRTC data channel via `peer/transport.ts`) -> verified-hello session (`peer/protocol.ts`) -> scheduler (`peer/scheduler.ts`) + status (`peer/status.ts`) -> `PeerSyncMarker` ("Synced with N laptops").
- Signalling providers raced in parallel: Supabase Realtime, ntfy.sh (free public fallback, AES-GCM encrypted, for when our server is down), BroadcastChannel (same browser). `signalling.ts:1-19`. STUN: Google + Cloudflare (`transport.ts:21-22`). No TURN: laptops behind symmetric NAT will not connect.
- Security: hello must carry a server-signed token with same org and same view class (`protocol.ts:1-25`); rows carry ES256 `sig` + `sig3` (view-class bound); `requirePx3` default true; holder binding (`cnf.jkt`) in backend README; org_people and `peer_shareable:false` kinds never move.
- Scheduler: on open/online/visible/new peer, then 5 -> 30 min back-off, hidden tab 30 min, hidden 60 min = off unless peer connected (`scheduler.ts:1-15`). One leader tab per browser through a Web Lock (`peer-shared.ts:42-100`).
- Cost: server step runs at most every 30 min while a peer is connected, "peers first, server for what only it knows".

### Critical gap - not wired
- `startPeerSync` (peer-shared.ts:42) has NO caller in non-test code. Verified by grep on the working tree and with `git grep` on origin/main: the only hits are its definition, a comment, and the harness. `overview-catch-up.ts:6` states it outright: "the auto-sync scheduler (peer/peer-shared.ts startPeerSync) is not started anywhere".
- `<PeerSyncMarker/>` is also rendered nowhere (only its own test imports it).
- Net effect today: no real user's laptop announces, links or exchanges rows with another. The only in-app freshness mechanism is `shell/modules/overview-catch-up.ts` (one `GET /heads` on screen draw / online / focus, no timer).
- The same omission also means the scheduled SERVER step (periodic `/heads` + feed catch-up) does not run in the app (see point 8).

### Conflict handling and data kinds
- Peers move ONLY rows that already carry a server signature and are not dirty (`local-db.ts:183 isShareable`; `peer/localdb-store.ts:13-20`). Consequences:
  - A person's unsynced local edits (outbox) are NOT shared with a neighbour. With our server down, laptop A's new edit does not reach laptop B until A has pushed it to Supabase. So "peer sync when the server is down" only relays data that was already server-confirmed. State this to the owner; it is by design (money/approval safety) but is narrower than the requirement text.
  - Tombstones are rejected (`protocol.ts` reason `tombstone`): deletes never propagate by peer.
  - A row is accepted only if its version is strictly higher than local and the local record is not dirty (`not_newer`, `dirty`). Conflicts are therefore never merged between peers; the server remains the single arbiter and the outbox three-way merge (`outbox-merge.ts`) resolves later.
- Kinds: 28 project kinds + org kinds (9 from 0684, +18 from 0691 = 27) exist in the sync service; org kinds move peer-to-peer only if both tokens carry an equal server-attested `org_view` claim, and the lf-peer-auto spec notes "today's /attest (no org_view claim) moves none" (`e2e/lf-peer-auto.spec.ts` header). Verify whether the deployed /attest now emits `org_view`; if not, org masters (vendors, departments, ...) do not peer-sync.

### Offline queue
- Peer transfer has no queue of its own; it is a pull model (have/want/items) re-run by the scheduler. Offline edits wait in the outbox (see 8).

### Tests
- Unit (`peer/*.test.ts`): auto-sync, lost-hello, network, network-visibility, org-peer, protocol, px3, scheduler, server-step, server-step-heads, signalling, verify.
- Real-browser e2e through `playwright.peer.config.ts`: `e2e/peer-sync.spec.ts`, `e2e/lf-peer-auto.spec.ts` (two laptops started together, zero server requests), `e2e/lf-peer-signed.spec.ts`, `e2e/lf-peer-versions.spec.ts`. Run in CI by the "Offline e2e" job (`.github/workflows/ci.yml:260-283`), gated by repo variable `LOCAL_FIRST_E2E_ENABLED`.
- Limits of that evidence: the e2e uses `peer/e2e-harness-lf.ts` (test-only entry, "Not imported by the app"), a relay standing in for Supabase Realtime/ntfy, `iceServers: []` loopback, and `--disable-features=WebRtcHideLocalIpsWithMdns`. It does not exercise `peer-shared.ts` (the real production wiring) and never crosses a real network. Backend requirements doc itself rates this "the peer path is not [live-verified]" (`ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md:115`).

### Suggested proof test (needed to move to BUILT-VERIFIED)
1. Wire `startPeerSync(userId)` after sign-in and workspace-prepare in the `(app)` layout; render `PeerSyncMarker` in the top bar.
2. Playwright test through the REAL `peer-shared.ts` (not the harness), two browser contexts, two real Supabase sessions of the same org (test accounts), real Supabase Realtime signalling. Steps: A creates a task and waits for it to be pushed; block `projexa-sync` for B with `page.route` (server down); assert B shows A's task, `peer-sync` marker says "Synced with 1 laptop", and zero requests reached `projexa-sync`. Then offline-edit on A, assert it does NOT appear on B (documents the limit) until A reconnects.
3. Cross-network test: two machines on different networks (or one behind CGNAT) to measure real WebRTC success rate and decide on TURN.
4. Negative: a laptop of another org on the same channel is refused (`refused.wrong_org` count in `network.stats()`).

## Point 8 - Supabase <-> laptop sync

### Built
- Edge function `projexa-sync` (compliance-tracker `supabase/functions/projexa-sync/handler.ts`): routes `/manifest`, `/pull` (keyset or ids), `/changes`, `/ids`, `/heads`, `/push`, `/attest`, `/release/*`, `/install`, `/jobs/*`, `/prepare` (README table). Migrations 0677-0691 (all live per memory notes). 120 req/min per person, body caps, 426/503 update gate.
- Client: `sync-client.ts` (typed fetch, SyncError), `replica.ts` (IndexedDB copy, cursors advance only after page stored, 2 pulls in flight, circuit breaker at consecutive transport failures, 429 pacing via `rate-pacer.ts` at 100/min), `outbox.ts` (1095 lines: op_id idempotent exactly-once push, retries with same op_id, field-level three-way merge `outbox-merge.ts`, conflict cards, rejected -> draft kept, `needs_server`, 403 pause, 426 pause), `connectivity.ts` (online / offline / server_down with probe back-off), sign-out safe flush (`sign-out.ts:192`).
- Outbox flush is wired: `outbox-shared.ts:52-57` flushes on connectivity-back and at start; `shell/shell-outbox.ts:78`, `LocalShell.tsx:146`.
- First copy is wired: `components/WorkspacePrepare.tsx:242` -> `prepare-workspace.ts`; `LocalFirstDefault` turns local-first on.

### Gaps
1. Automatic background server sync (scheduler server step: `/heads` poll, reset on view-class/epoch change) lives only inside `startPeerSync`, so it is not running. What does run: first copy, per-screen pulls (BOQ via `replica-shared.ts:46`), overview catch-up on draw/online/focus, outbox flush. Screens other than overview may show stale colleague data until opened/edited. Fix is the same wiring as point 7.
2. Deletes: `deletes_supported` is per kind; memory notes say "deletes not synced" originally; replica applies tombstones from /changes and reconciles via /ids at most daily. Verify per kind with a delete round-trip test.
3. Not syncable (memory: projexa-browser-install-build-state): payroll, recruitment, grc, kpis, proposals/copilot, journal/budget/PO/quotation LINES (line-item tables have no org_id), CRM leads, leave, loans. 0691 syncs header rows only. Those screens say "not on this laptop yet".
4. Writes need the server online: push goes through `projexa-sync` -> `ai-work-link-exec`; `needs_server` functions cannot run offline.
5. Real PROJEXA JWT through the deployed function was never exercised (mint-session is fail-closed by R81 on purpose); verification was stub session over live SQL (`scripts/verify/projexa-sync-live-*.ts`). Owner's first real login is the proof.
6. Cost: free-tier ceiling 500k Edge invocations/month shared by all laptops; measured workday 209 requests/laptop (`docs/local-first/COST_MODEL.md`) so about 108 laptops/month before heads savings. Scale risk, not a defect.
7. Known flaky: `lf-ai-data.spec.ts` "AI-created row can briefly vanish" when a pull is in flight during push-settle (memory 2026-10-02 21:45).
8. Safari 7-day IndexedDB eviction, mobile, Dubai-latency test: untested (memory 2026-10-03).

### Tests
- Client: replica*.test.ts, outbox*.test.ts (safety, merge, drafts), conformance/wire.integration.test.ts (real client vs real handler on PGlite, 49 pass at last record) and parity.test.ts (CI job "Local-first wire conformance", non-required, `ci.yml:135-168`), cost harness (`cost/cost-budget.test.ts` fails if a scenario exceeds its request budget).
- Real browser: `e2e/offline-local-first.spec.ts`, `boq-offline.spec.ts`, `offline-work-progress-sync.spec.ts`, `lf-delivery-*.spec.ts`, `lf-documents-*.spec.ts`, `lf-overview-*.spec.ts`, `lf-lifecycle-*.spec.ts` (all use stubbed sync server `e2e/support/lf-ai-stub.ts` that keeps pushed rows and a feed).
- Backend: ~20 `src/lib/services/projexa-sync-*.test.ts` (PGlite + real handler), live check scripts (read 117, write 30, push 12, signing 14 per memory).
- Status: BUILT-VERIFIED for sync mechanics against stubs/PGlite; not verified against live prod with a real login.

### Suggested proof test
Two-user live test on a test org: A edits a task offline, reconnects, B (second browser, real session) sees it without any click within one scheduler interval; then A deletes it and B's list drops it; assert via IndexedDB and Supabase `platform.projexa_record_head`. Add a committed Playwright spec with the scheduler started (after wiring).

## Point 9 - use the user's RAM/CPU

- Data: whole permitted copy in IndexedDB (`local-db.ts`, one DB per person), screens read locally (`local-reader.ts`, `shell/modules/*-adapter.ts`), 14 modules / 21 routes in the `/local` shell served from a versioned offline bundle (`release/*`, service worker `release/sw-core.ts`). Vercel only serves static files once installed.
- Compute offload: `jobs/runner.ts` (claim loop), `jobs/requester.ts`, `jobs/browser-worker.ts` + `worker-entry.ts` (real Web Worker, 50 ms main-thread slices) and backend `/jobs/{enqueue,claim,heartbeat,result,get}` (0682) exist, but `createJobRunner`/`requestJob` are referenced only by `cost/harness.ts` and tests - NOT started in the app. So "another laptop's idle CPU does work for us" is MISSING in practice; "my own laptop does its own work" is BUILT.
- Reports/exports: some still hit server routes (`src/app/api/reports/*`, `/api/work-progress/report/*`), i.e. Vercel compute, unless the local ReportsLocalScreen covers them (`shell/modules/ReportsLocalScreen.tsx`, `reports-adapter.ts`). Needs a per-report audit.
- No measurement of laptop RAM/CPU/IndexedDB size exists; only request counts. Owner machine has 8 GB so a memory budget test matters.
- Suggested proof: a Playwright test that loads a 10k-row project, records `performance.memory`/JS heap and long-task count while scrolling BOQ, asserts heap under a budget and zero requests to Vercel origin after install (`outsideRequests` helper pattern in `e2e/support/lf-peer-browser.ts`).
- Status: PARTIAL.

## Point 33 - failures reach us

### What is captured today
1. Prepare monitor (the owner's 2026-10-03 directive), BUILT-VERIFIED live:
   - Client `prepare-report.ts` (stage, percent, status running/retrying/done/failed, attempt, error class from 12 classes, detail <=300 chars, 20 s heartbeat, pending kept in localStorage `px-prepare-report-pending` and re-sent).
   - Line 1: `POST projexa-sync /prepare` -> tables `platform.projexa_prepare_state` (one row per person+device) and `platform.projexa_prepare_event` (append-only, 400/person/day), function `public.projexa_prepare_report` (migration `drizzle/0688`, plus 0689 STUCK state, 0690 exclude `*.e2e-test.projexa-ai.com`).
   - Line 2 (if the service is unreachable): `sendBeacon` to PROJEXA `/api/local-first/prepare-report` (`src/app/api/local-first/prepare-report/route.ts`), which only `console.error`s one `[prepare-report] {...}` line into Vercel runtime logs (stores nothing).
   - Watcher: `public.projexa_prepare_health()` read every 10 min by `.github/workflows/projexa-prepare-health.yml` -> `scripts/projexa-prepare-health-check.mjs`; run goes red (GitHub email) on STALLED / STUCK / FAILING / NEVER FINISHED or monitor unreachable. Test: `src/lib/services/projexa-prepare-monitor.pglite.test.ts`, `e2e/lf-lifecycle-monitor.spec.ts`.
2. Install record: `POST /install` stores one row per laptop (`platform.projexa_client_install`, release registry 0680) - best effort, retried; not an error log.
3. Server side: push ledger records every op with status (applied/conflict/rejected/failed) in 0681 tables; Edge function logs in Supabase.
4. Monitoring on the two Cloudflare Pages sites (corporate-tambola, shobha) has RUM + error beacons into D1 - NOT PROJEXA.

### What is NOT captured (gaps)
- No generic client error channel: grep of projexa `src` finds no `window.onerror`, `unhandledrejection`, `global-error.tsx`, Sentry/PostHog/Datadog (package.json has none). Only 6 route-level `error.tsx` files, and they `console.error` locally (e.g. `(app)/reports/error.tsx:36`).
- Sync errors (`SyncError`, 5xx, 429, circuit-breaker trips, 426 update_required), outbox outcomes (rejected, uncertain, conflict cards, draft kept), `connectivity` server_down episodes, peer refusals (`network.stats().refused`), job failures and browser-AI/AI-link errors are shown to the person or kept in IndexedDB (`OutboxState`, `OUTBOX_NOTICES_KEY`) but never sent to us. The server only learns of a rejected/failed push because the request itself reached it.
- If a laptop's sync is silently broken (e.g. scheduler never started, as today), nothing alerts us; the health monitor only covers the first-copy run, not steady state.
- AI work-link: backend logs its own errors; client-side AI failures (browser AI attach, `ai/*`) have no report path.
- The Vercel fallback route only logs; nothing aggregates or alerts on it.

### Suggested build and proof
1. Add a general `client-report` stream: new `POST /report` on projexa-sync -> `platform.projexa_client_event` (user, device, release, area sync|outbox|peer|ai|ui, code, detail<=300, count) with the same 12-class discipline and rate limit; reuse the prepare-report queue + beacon fallback.
2. Hook `window.onerror`, `unhandledrejection`, `global-error.tsx`, `SyncError` in `replica.ts`/`outbox.ts`, `connectivity` transitions to server_down (with duration), outbox `rejected`/`uncertain`, peer refusals, AI-link failures.
3. Extend `projexa_prepare_health` (or a sibling) and the 10-minute workflow to flag steady-state failure rates and "no heartbeat for N hours while signed in".
4. Proof test: Playwright forces (a) `projexa-sync` 500 on /pull, (b) a thrown render error, (c) a rejected push; asserts one row per class lands in the table (SQL read-back) and the workflow script exits non-zero. Plant-then-revert check per R74-RULING-03.
- Status: PARTIAL (first-copy: BUILT-VERIFIED; everything after first copy: MISSING).

## Single most important fix
Wire `startPeerSync` (and therefore the scheduler's server step and peer network) into the signed-in `(app)` layout after workspace prepare, render `PeerSyncMarker`, and add a real-wiring e2e. Points 7 and 8 both depend on it, and it also unlocks the steady-state data for point 33.

## Evidence index
- projexa: `src/lib/local-first/peer/{peer-shared,auto-sync,network,protocol,scheduler,signalling,transport,attest,status,localdb-store}.ts`; `sync-client.ts`; `replica.ts`; `outbox.ts`; `outbox-merge.ts`; `connectivity.ts`; `rate-pacer.ts`; `prepare-report.ts`; `jobs/*`; `shell/modules/overview-catch-up.ts`; `src/components/{PeerSyncMarker,WorkspacePrepare}.tsx`; `src/app/api/local-first/prepare-report/route.ts`; `playwright.peer.config.ts`; `e2e/{peer-sync,lf-peer-*,lf-lifecycle-monitor}.spec.ts`; `docs/local-first/COST_MODEL.md`.
- compliance-tracker: `supabase/functions/projexa-sync/{handler,sign,index}.ts` + README; `drizzle/0677-0691`; `scripts/projexa-prepare-health-check.mjs`; `.github/workflows/projexa-prepare-health.yml`; `src/lib/services/projexa-sync-*.test.ts`, `projexa-prepare-monitor.pglite.test.ts`; `ai-os/PROJEXA_LOCAL_FIRST_REQUIREMENTS.md`.
