# AUDIT 37 — Gap Register (opened 2026-10-04)

Owner's 37 PROJEXA points. Detailed per-group evidence: `ai-os/audit37/A..E_*.md`.
Status vocabulary: VERIFIED (real surface, committed test, passes) / BUILT-UNTESTED / PARTIAL / MISSING / N/A.
Nothing is VERIFIED yet: every e2e proof to date used stubbed sync + fake Supabase Auth. Order: local + git + Supabase first, Vercel last.

| # | Point | Status (static audit) | Gap / next action |
|---|---|---|---|
| 1-3 | Vercel used least | PARTIAL | 310 PROJEXA /api proxy routes, BOQ edits, doc signing, bundle hosting, login still on Vercel. Measure; move cheap ones later. |
| 4 | Internal AI chatbox | PARTIAL | Built but OFF (PROJEXA_INTERNAL_AI_ENABLED, AI_BRIDGE unset locally). Enable locally, live test. |
| 5 | External AI link works on all projects | PARTIAL | Server built; no real engine tried. Project create needs user confirm in browser. |
| 6 | Whole app downloaded in background | PARTIAL | Files only pinned/recent; install is a blocking screen. |
| 7 | Peer laptop sync | PARTIAL | startPeerSync has NO caller; PeerSyncMarker not rendered. FIX P1. |
| 8 | Supabase<->laptop sync | PARTIAL | Steady-state catch-up lives in same uncalled fn. Some kinds unsyncable. |
| 9 | Use user RAM/CPU | PARTIAL | Compute offload (jobs/*) not wired; no measurement. |
| 10 | User's own AI | BUILT-UNTESTED | Work link needs no server model calls. |
| 11 | Our AI only if allowed | PARTIAL | Deployment-wide flag only; no per-org entitlement. |
| 12 | Internal AI no code, role-limited | PARTIAL | Closed function list + tools disabled; no per-function min-role table; no refusal test. |
| 13 | External AI no code, role-limited | BUILT (API-level) | Roles re-checked in SQL; add engine-level test. |
| 14/34 | Claude Code = internal AI | worker live, unused | Heartbeat OK; enable env + test. Bridge has no owner-identity check (owner flag). |
| 15 | First login = daughter server | PARTIAL | Stub-only proof; no real login proof. |
| 16 | 6-digit passcode | PARTIAL | Signup/reset enforce; login any pw; no test; Supabase pw policy unknown. |
| 17 | Forgot: link + 6 digits | LIKELY BROKEN | Email probably lacks code (default Supabase mail); new-laptop branch needs token_hash; same-laptop check weak. FIX P2. |
| 18 | Nothing lost | BUILT-UNTESTED | Reset keeps same user; add test. |
| 19-24 | Works-first, security low | RISK | Supabase default mail ~2/hr. Offline PIN login MISSING. |
| 25 | Offline | PARTIAL | Stub proof only; Safari/mobile/eviction untested. |
| 26 | Our side down | PARTIAL | First install needs Supabase; peer w/ Supabase down relies on ntfy. |
| 27 | Works with external AI | PARTIAL | Needs real-engine runs. |
| 28-31 | ChatGPT/Claude/Gemini/all connectors | UNVERIFIED | AW-905 vendor tests never run. |
| 32 | Paste into free web chat AIs | PARTIAL | No-browse AIs need paste card; DeepSeek can't open links. |
| 33 | Errors reach us | PARTIAL | Only prepare run reported. No window.onerror/global error reporter. FIX P1. |
| 35 | Link = api = token | BUILT | |
| 36 | Browser extension | MISSING | None in either repo. Build small free MV3 extension. |
| 37 | External AI + PROJEXA seamless | PARTIAL | Depends on above. |

## Fix order
P1 wire peer sync + steady-state sync; global client error reporter (33); merge prompt-wording fix.
P2 reset email with code + callback flow (17), PIN tests (16/18), offline PIN login.
P3 enable internal AI locally + role/no-code tests (4,12,14); per-function min-role table.
P4 real-backend local e2e (15,25,26), two-browser sync, real engine runs (28-32), extension (36).
P5 Vercel (last, cap-checked).

## Progress log (updated 2026-10-04, real-backend runs on localhost:3100)
Real-backend Playwright journey (FChecklist/projexa PR #356, e2e/audit37-real-*.spec.ts, playwright.audit37-real.config.ts):
- VERIFIED against the real Supabase project + real projexa-sync: real login, release installed in Cache Storage, service worker controls page, real data markers (sync:done:*) in IndexedDB (6, 15); works with network cut (25); works with Supabase refused (26); page errors buffered offline and delivered when online (33); sync/peer leader lock held (7/8 wiring).
- FOUND+FIXED: startPeerSync had no caller (7/8); /attest user_id != session id so the client rejected every real attestation and never opened signalling (e80504a3); no client error reporter (33).
- FOUND, env: projexa-sync CORS allows only localhost:3100/3101 + projexa-ai.com; real-backend tests MUST run on :3100. Locally built release is not registered with the service (POST /install -> 400 "Bad request"; GET /release/current registered:false) - needs POST /release/register from an allowed origin, not yet done.
- OPEN: two same-org laptops open Realtime+ntfy signalling but no verified peer link forms (under investigation).
- Point 14/34 VERIFIED at bridge level: a prompt enqueued to platform.ai_bridge_request was claimed by the live worker on this laptop and answered by Claude Code ("PONG", ~50s on this RAM-starved laptop). Chat route itself still OFF (PROJEXA_INTERNAL_AI_ENABLED / AI_BRIDGE unset locally).
- Point 17: reset email template already has link + 6-digit code (live auth config read). Delivery risk: Supabase built-in mailer (2/hr, team-member recipients only). Owner chose to keep built-in (no Resend); revisit before real customers.
- Points 4/12: committed proof tests (route.roles.test.ts, level1.no-code.test.ts, claude-code-bridge.test.ts) with falsifiability evidence, PR #2056.
