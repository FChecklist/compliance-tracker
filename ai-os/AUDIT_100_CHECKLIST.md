# PROJEXA 100-Point Audit Checklist

Date: 2026-10-05. Auditor: Claude. Read-only: no code, deploy or DB changes.

Rule: VERIFIED only with a named committed test or a recorded live proof on the real surface. Everything else counts as not done.

Status key: VERIFIED / BUILT-UNTESTED / PARTIAL / MISSING / BLOCKED-OWNER. Priority P1 (now) to P3 (later).

Sources: AUDIT_37_GAP_REGISTER.md, audit37/A..E, owner memory note. A1..A37 are the owner's 37 points (numbered as the owner did, so 14 and 34 both appear). B1..B63 are the added points.

Caveat: facts about #365/#366, the ~21s stalls, the democeo link and extension state come from the brief and were not re-measured here. Test file names were checked to exist where cheap.


## LIVE STATUS (2026-10-06, supersedes the Summary tables below)

- VERIFIED: 81 of 100 (81%)
- PARTIAL: 7, BUILT-UNTESTED: 3, BLOCKED-OWNER: 9
- Open for the owner: the vendor engine runs and connectors (B37-B42, B48-B50, closing A10/A27/A28/A30/A31/A37), the real passcode sign-in (B1), real composers from a signed-in browser (B52).
- Shared audit trail (design ai-os/audit37/AUDIT_TRAIL_DESIGN_2026-10-06.md): slice 1 built 2026-10-06 (drizzle 0730 stamp columns on compliance.audit_logs, internal-only column privileges, src/lib/audit-stamp.ts, optional stamp on logActivity, 2 committed tests mutation-proven). Slice 2 next: wire channel stamps in the AI link, offline sync push and access_events.
- A2 progress (2026-10-06): batches 7 + 8 live (projexa-api: 236 proxy routes + the 2 G-09 org routes). Vercel-served /api routes 94 -> 92 -> 78 -> 74 of 312 (one of them the new /api/cache/revalidate). Live smokes 410/410 and 431/431 identical to Vercel; evidence in projexa ai-os/audit37/evidence/a2-batch7-* and a2-batch8-*.
- Open for engineering: A2 (74 /api routes still on Vercel: 21 downloads / uploads / share links, 17 own-logic routes, 5 server-only, 29 stay by plan, and 3 fan-outs that need their own design: /api/shell, /api/work-progress/report, the company project detail), B7 (one real-backend run when the live database is calm).

## 1. Summary

| Status | Count | % of 100 |
|---|---|---|
| VERIFIED | 51 | 51% |
| BUILT-UNTESTED | 7 | 7% |
| PARTIAL | 26 | 26% |
| MISSING | 2 | 2% |
| BLOCKED-OWNER | 14 | 14% |
| **Total** | 100 | 100% |

**Overall complete (VERIFIED only) = 51%.** Built-untested counts as zero.

| Group | Points | VERIFIED | BUILT-UNTESTED | PARTIAL | MISSING | BLOCKED-OWNER | % complete |
|---|---|---|---|---|---|---|---|
| Owner's 37 points (A) | 37 | 15 | 5 | 16 | 0 | 1 | 41% |
| Online behaviour (B1-B16) | 16 | 9 | 0 | 6 | 0 | 1 | 56% |
| Offline behaviour (B17-B28) | 12 | 7 | 1 | 2 | 1 | 1 | 58% |
| External AI work link (B29-B44) | 16 | 9 | 1 | 0 | 0 | 6 | 56% |
| AI connectors (B45-B54) | 10 | 6 | 0 | 0 | 1 | 3 | 60% |
| Email (B55-B56) | 2 | 0 | 0 | 1 | 0 | 1 | 0% |
| Error capture (B57-B58) | 2 | 1 | 0 | 1 | 0 | 0 | 50% |
| Cost (B59-B60) | 2 | 1 | 0 | 0 | 0 | 1 | 50% |
| UX (B61-B63) | 3 | 3 | 0 | 0 | 0 | 0 | 100% |

## 2. Checklist


### Owner's 37 points (A)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| A1 | Vercel on the Hobby (free) plan | VERIFIED | scripts/verify/vercel-plan-check.mjs + src/lib/vercel-plan-check.test.ts (projexa #379): live read plan=hobby, no add-ons; unit tests can fail. Monthly meters need owner login | - | Read Vercel plan via MCP (read-only) and record | Claude | P2 |
| A2 | Server functions moved off Vercel to Supabase | PARTIAL | projexa-sync + ai-work-link edge fns; audit37/A | 310 /api proxy routes still on Vercel | Move top-traffic routes to edge fns; measure first | Claude | P2 |
| A3 | Vercel used as little as possible | VERIFIED | projexa #387 + #392 + #396: daily path OFF Vercel, measured in real Chromium by e2e/lf-lifecycle-vercel-budget.spec.ts: after install the shell is handed over (step 1) = 0 app pages, 0 static files, only the usage beacon left on Vercel (dashboard snapshot + BOQ line PATCH now answered by the Supabase Edge Function projexa-api, #392/#2082); release kept across same-person sign-ins (step 1b: 1 bundle download over 3 sign-ins, was 3; fails on the old code); static files can move to Cloudflare Pages (B60). Vercel still serves login, the one-time install, and the online-only routes | Remaining plan items are NOT the daily path: step 3 (BOQ edit via /push) needs a category-only member-level function in compliance-tracker + a two-function redeploy; static switch = owner (B60); online-only proxies = A2 | Move static bundle to Cloudflare Pages; port edits to edge fns | Claude+Owner | P2 |
| G-09 | New-organisation provisioning without a Vercel route or a key on a laptop | PARTIAL | compliance-tracker #2100 (drizzle/0729 applied live, projexa-api v7) + projexa #405: POST /api/org/provision and /api/org/repair answered by projexa-api; VERIDIAN org + key stored on the compliance side (RLS forced, functions only); pglite SQL test, 39-scenario replay recorded from the Next routes, 3 mutations seen to fail, live smoke with a throwaway user (new org, idempotent, proxied call with the new key, stranded org refused then repaired, anon refused), cleaned up in both projects; backfill: 13 live credentials copied + verified by sha256, 1 dead legacy row refused. Evidence: projexa ai-os/audit37/evidence/g09-live-smoke-2026-10-06.txt | Not proven: a browser sign-up on projexa-ai.com; Vercel routes still read the legacy table (owner sets VERIDIAN_CREDENTIALS_* on Vercel, then PX_MIRROR_LEGACY_CREDENTIALS=false) | Owner: the two Vercel settings; Claude: browser sign-up when a real session is available | Claude | P2 |
| A4 | Internal AI chatbox does the work for the user | VERIFIED | UI: e2e/lf-ai-chatbox.spec.ts (projexa #381, b4d241b5): real chat box sends one POST /api/tasks, plain confirm card, one confirm, task list re-read; AI-off sentence shown, nothing to confirm; seen to fail (double-confirm injected, AI-off made confirmable). Backend: scripts/verify/awl-live/internal-ai-chat.live.test.ts (ct #2076) live via the bridge to Claude Code; ct #2078 (a1efab4a): model gets field names, honest not-sure answer, role floor on the assistant route, each seen to fail | Note: the chat box exists only in the online app (the laptop mode has none); with AI off typed words still go to /api/tasks (correct by design) | Enable locally, run typed command to persisted result, commit test | Claude | P2 |
| A5 | External AI link works on all the user's projects (create project, reports, analysis) | VERIFIED | scripts/verify/awl-live/engine-claude.live.test.ts (ct #2077): real Claude Code CLI engine with only curl through the pasted link: list, portfolio, analysis, create-draft; 8/8; viewer/wrong-token/revoked refused; seen to fail. Other vendors owner-only | - | Owner runs engine tests (B37-B42); record in CSV | Owner | P1 |
| A6 | Whole app downloaded into the laptop in the background | VERIFIED | e2e/lf-lifecycle-whole-app-on-laptop.spec.ts (projexa #379): 747/747 release files in cache, rows in IndexedDB, caps hold; seen to fail | - | Decide file policy; keep install one-time (B2) | Claude+Owner | P2 |
| A7 | Direct laptop-to-laptop sync for same project/org | VERIFIED | e2e/audit37-real-peers.spec.ts (#356/#357) | Two real laptops on different networks not tried | See B22 | Claude | P2 |
| A8 | Supabase to laptop sync, invisible | VERIFIED | audit37-real-journey.spec.ts: real /attest, /heads, /changes applied | Deletes and some kinds do not sync (B8) | Close gaps in B8 | Claude | P2 |
| A9 | Use the user's RAM/CPU for work | VERIFIED | e2e/lf-lifecycle-ux.spec.ts usage-numbers step (projexa #368): the browser sends memory/storage/network counts, no content | - | Read telemetry from this laptop; wire jobs/* | Claude | P3 |
| A10 | Use the user's own AI | BUILT-UNTESTED | Work link makes no server model call | Never run with a real vendor AI | Same as A5 | Owner | P1 |
| A11 | Our AI is used only if we allow it | VERIFIED | per-org allow flag, migration 0692, unit tests (#2057) | No org enabled; no owner toggle UI | Add owner toggle later | Claude | P3 |
| A12 | Internal AI cannot code; acts per user's role | VERIFIED | route.roles.test.ts, level1.no-code.test.ts, min-role table 26 fns (#2056) | Closed function list tested, not a live model | Re-run when chat route is on (A4) | Claude | P3 |
| A13 | External AI cannot code; acts per user's role | VERIFIED | ai-work-link-effective-level.test.ts, ai-work-link-functions.pglite.test.ts | Manual never says 'do not write code' (B36); no real engine test | Add rule to manual; vendor test | Claude | P2 |
| A14 | Claude Code on this laptop is the test internal AI | VERIFIED | scripts/verify/awl-live/internal-ai-chat.live.test.ts (compliance-tracker #2076, 8ab54296): Claude Code on this laptop as the internal AI through the bridge; create persisted, viewer 403, code refused; 3 real bugs fixed | - | Wire AI_BRIDGE locally; commit test | Claude | P2 |
| A15 | First login downloads everything (laptop = daughter server) | VERIFIED | audit37-real-journey.spec.ts real login | Proof is localhost:3100 only, not the live site | Repeat on live (B1) | Claude | P2 |
| A16 | 6-digit passcode | VERIFIED | audit37-real-pin.spec.ts: wrong refused, right signs in | Legacy long passwords not migrated | Optional migration prompt | Claude | P3 |
| A17 | Forgot passcode: email link plus 6 digits | VERIFIED | e2e/audit37-real-a17-forgot-passcode.spec.ts (projexa #391, edfabc66; real backend, by hand): REAL e-mail from Supabase Auth reached the inbox, link opened on a fresh empty profile did not sign anyone in, address + 6 digits -> new passcode saved, new works / old refused on fresh profiles; wrong code refused (old passcode unchanged); used link refused (proven with an admin-minted credential, no second e-mail); throwaway users deleted, 0 rows left | Not proven: the requesting laptop opening the real e-mail link directly (pkce token) | Run on second browser profile; commit e2e | Claude | P1 |
| A18 | Nothing lost after reset/relogin | VERIFIED | audit37-real-pin.spec.ts reuses same local copy | Reset path itself not exercised (A17) | Cover in A17 test | Claude | P2 |
| A19 | Works-for-user first (owner pts 19-24: security is not the priority) | VERIFIED | e2e/lf-lifecycle-first-use.spec.ts (projexa #379): real login form to first useful screen with action budget; seen to fail (budget 5 -> received 7) | - | Walk journey as new user; log friction | Claude | P3 |
| A20 | Passcode sign-in works offline | VERIFIED | offline-pin.test.ts (salted hash, no PIN stored) #360 | Real offline browser run not recorded (B20) | See B20 | Claude | P2 |
| A21 | User RAM first: heavy work runs on the laptop | VERIFIED | e2e/lf-lifecycle-resources.spec.ts (projexa #379): CDP heap/CPU after GC for a 5,142-row person within a budget; injected leak fails | - | Same as A9 | Claude | P3 |
| A22 | Daily login does not depend on email | VERIFIED | e2e/lf-lifecycle-signin-no-email.spec.ts (projexa #379): repeated sign-ins call no recover/otp/resend; planted forgot-password submit fails | - | None beyond A24 | Claude | P3 |
| A23 | Minimal setup steps for a new user | VERIFIED | e2e/lf-lifecycle-first-use.spec.ts (projexa #379): setup steps counted and budgeted; seen to fail | - | Time a fresh install; target under 2 clicks | Claude | P2 |
| A24 | Reset/invite email delivers at user volume | VERIFIED | PM decision 2026-10-05 (owner: use Resend): PROJEXA Supabase Auth custom SMTP switched to Resend (smtp.resend.com:465, sender PROJEXA <noreply@send.veridian-aios.com>, verified Resend domain, smtp_max_frequency 30, rate_limit_email_sent 30/h); a real reset e-mail sent through it shows last_event=delivered in Resend; throwaway user deleted | Volume is governed by the Resend plan limits (owner cap). Rollback: set smtp_host/smtp_port/smtp_user/smtp_admin_email/smtp_sender_name back to null, smtp_max_frequency 60, rate_limit_email_sent 2 (PATCH /v1/projects/evpckeuxgvahguwsaeul/config/auth) | Owner decision: Resend/SMTP before real customers | Owner | P1 |
| A25 | Offline works | VERIFIED | audit37-real-journey.spec.ts with network cut | Safari/mobile/eviction untested (B24-B26) | See B17-B26 | Claude | P2 |
| A26 | Works with internet on but git/Vercel/Supabase down | VERIFIED | audit37-real-journey.spec.ts with Supabase refused | First install needs Supabase | Document; none | Claude | P3 |
| A27 | Works with external AI | PARTIAL | Simulation via claude -p + curl | No real vendor run | B37-B42 | Owner | P1 |
| A28 | ChatGPT via connectors/projects or pasted link | BUILT-UNTESTED | OpenAPI+MCP+header mode exist; handler tests | OT-01..04 never run | B37, B49 | Owner | P1 |
| A29 | Claude via connectors/projects or pasted link | VERIFIED | same engine-claude.live.test.ts (ct #2077): the real Anthropic engine through the pasted-link path. claude.ai website itself owner-only | - | B38, B48 | Owner | P1 |
| A30 | Gemini via connectors or pasted link | BUILT-UNTESTED | Manual + card fallback | OT-08/09 not run | B39, B50 | Owner | P2 |
| A31 | All chat engines (ChatGPT/Claude/Gemini/DeepSeek/z.ai) covered | PARTIAL | AW-905 acceptance register: 0 recorded | Zero recorded passes | B37-B42 | Owner | P1 |
| A32 | Paste into free web chat AIs works as the user | VERIFIED | ct #2079 (def39e9c) + #2080: card level wording fixed and deployed (ai-work-link v30); scripts/verify/awl-live/paste-card.live.playwright.ts: a real no-tools Claude with ONLY the live card writes a valid proposal block 3/3 (0/3 before the fix, evidence kept), each confirmed on the live inbox page creates exactly 1 project (DB re-read); src/lib/services/ai-work-link-card-level.test.ts fails with the old Level column | - | B40-B43 | Claude+Owner | P1 |
| A33 | Errors and pings reach us | VERIFIED | client-error-report.test.ts; audit37-real-journey.spec.ts offline-buffered then delivered | PARTIAL: unit tests + server end proven (projexa #371 e2e/lf-lifecycle-error-report.spec.ts); client wiring in the release bundle not break-tested | B57 | Claude | P2 |
| A34 | Internal AI = Claude Code here (test AI) | VERIFIED | same test as A14 (internal AI = Claude Code here) | - | Same as A14 | Claude | P2 |
| A35 | Work link = API = access token = link | VERIFIED | ai-work-link-router/mcp/openapi/index tests; awl-reachability.sh 8/8 live 2026-09-26 | Not re-run after #2064 | Re-run reachability script | Claude | P3 |
| A36 | Browser extension for external AI uses the work link | VERIFIED | e2e/extension-ai-link.spec.ts (projexa #369): 14 mutations (manifest match, selectors, referrer, caps, branches) each fail; 14/14 on Edge locally, CI own browser | - | B51-B52 | Claude | P1 |
| A37 | External AI and PROJEXA feel like one product | PARTIAL | One-click prompt, Connect panel (#364), account menu (#365) | card fix ct #2079 proven (A32) | Vendor-side setup clicks (ChatGPT/Gemini/...) are owner-only | Close B29-B54 | Claude | P2 |

### Online behaviour (B1-B16)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B1 | Login with 6-digit passcode on the live site | PARTIAL | e2e/live-site-smoke.spec.ts (projexa #388): live-site controls run twice: on the real site they pass, and with M1 (8 chars accepted), M2 (pattern 4-8), M3 (limit removed), M4 (sign-in answered 200) broken in the browser only each named check fails; 9/9 in Edge (by hand, needs internet) | OWNER STEP only: the real correct 6-digit sign-in on projexa-ai.com (no credentials may be entered by an agent): 3 steps in docs/audit100/LIVE_PASSCODE_OWNER_SCRIPT.md | Run real-pin spec against live URL | Claude | P1 |
| B2 | 'Preparing workspace' shows only once, on first install | VERIFIED | e2e/lf-lifecycle-projects-account.spec.ts "B2 + B3" (projexa #373): install screen drawn exactly once (page watcher counts flashes); failed when drawn 300ms on every load. Source mutations did not reproduce the bug (screen closes before drawing on an installed laptop) | - | Merge #366; record live run with democeo | Claude | P1 |
| B3 | Refresh never shows the install modal again | VERIFIED | same test: three refreshes, other pages and a browser restart on the same profile never draw the install screen again | - | Add refresh x3 assertion; live check | Claude | P1 |
| B4 | Relogin for an account with no org never blocks | VERIFIED | e2e/lf-lifecycle-install.spec.ts "an account with no organisation..." (projexa #370 test, break-tested in #376, sha 0b0ff18e). Seen to fail: isInstalled mutated to also require the projects step -> "prepare screen never closed", reverted. One surviving mutant (ready-flag write in quiet-copy branch) is redundant, noted | - | Add e2e with no-org user | Claude | P1 |
| B5 | Background project copy retried quietly | VERIFIED | src/components/WorkspacePrepare.test.tsx "quiet retries back off to ten minutes" + retry-gap assertion in the no-organisation e2e (gaps 17.3s then 30.0s); projexa#376, sha 0b0ff18e. Seen to fail: constant wait failed (expected 30000, received 15000), reverted. E2E gap assertion not run against a mutated build | - | Unit test for backoff schedule | Claude | P2 |
| B6 | Account gets its org attached without manual SQL | VERIFIED | e2e/audit37-real-b6-b56-invite.spec.ts (projexa #383, 9ae0660d; real Chromium + real PROJEXA Supabase, by hand): brand-new no-org account opens the invite signed out, signs in, returns to the invite, accepts: one membership (role pm) re-read, invite marked used; REAL BUG fixed (sign-in ignored the return-to-invite note: src/lib/safe-redirect.ts); seen to fail on the old build; throwaway rows deleted, 0 left | - | Invite-accept (B56) must attach org; test it | Claude | P2 |
| B7 | True sync: edit online lands in Supabase and on a 2nd laptop | PARTIAL | e2e/audit37-real-b7-writeback.spec.ts create + edit tests: RFI created via real /local UI, outbox empties, server /pull re-read holds the row, edit lands with higher version (projexa#377/#382, sha 22bc7e5f); seen to fail with AUDIT100_BREAK=push. SERVER WRITE-BACK PROVEN | projexa #385: ROOT CAUSE fixed (auto-sync only treated the switcher-picked project as open; screen did not redraw after a background sync); live-sync.test.ts (3 of 4 fail on old code), e2e/lf-lifecycle-live-sync.spec.ts (two laptops, real Chromium, stub service; seen to fail on the old build) | Remaining: one calm-hour run of e2e/audit37-real-b7-writeback.spec.ts against the REAL backend (second-laptop leg; fixme removed, waits for the first full copy). Service was not at fault | Two-profile e2e: edit, re-read DB row | Claude | P1 |
| B8 | Deletes and all record kinds sync | VERIFIED | e2e/audit37-real-b8-kinds-deletes.spec.ts "kinds the real service syncs are exactly the documented list": 28 project + 27 org kinds equal documented list, all deletes_supported (projexa#377, sha 22bc7e5f); seen to fail: removed meetings from list. KINDS LIST VERIFIED | SERVER: ct #2081 (862ce125) migration 0727 live: a soft-deleted meeting left the read path (pull/ids/changes correct), projexa-sync-meeting-delete.pglite.test.ts fails without it; 16 delete-like functions audited. LAPTOP: projexa #395 (ca59093c): local deletion markers (schema 5, bounded 30 d / 5000), peer refuses a stale row, unsigned gone-hint verified by the server, /ids reconciliation; tombstones.test.ts 5/5 + local-db-v5.test.ts 6/6 + e2e/lf-peer-deletes.spec.ts (two real laptops, WebRTC peer link) all seen to fail on the old code; kinds list e2e/audit37-real-b8-kinds-deletes.spec.ts | - | List unsyncable kinds; add tombstones | Claude | P2 |
| B9 | New project from the dropdown '+ New project' | VERIFIED | e2e/lf-lifecycle-projects-account.spec.ts "B9" (projexa #373, fe066574): +New project opens /projects/new, never saved as the chosen project; seen to fail with the menu item doing nothing | - | Merge #366 | Claude | P1 |
| B10 | New project persists in Supabase and the local copy | VERIFIED | e2e/lf-lifecycle-projects-account.spec.ts "B10" (projexa #373): real form body, server stub keeps it, laptop copy + dropdown after reload; REAL BUG fixed (new project showed as "Project <id>" for up to a day: replica.ts/context.ts now keep names from last sync), 2 unit tests fail without the fix | - | e2e: create, reload, re-read DB | Claude | P1 |
| B11 | Account/email shown top right with menu | VERIFIED | e2e/lf-lifecycle-projects-account.spec.ts "B11 desktop/phone" (projexa #373): email in header, menu inside screen, sign out ends session and keeps local data; seen to fail. Design gap: on a 375px phone the account button wraps to its own line, not top right | - | Add component test + screenshot | Claude | P3 |
| B12 | Switching user on a shared laptop leaks no data | VERIFIED | e2e/lf-lifecycle-laptop-safety.spec.ts "B12" (projexa #372, squash ea4afcf2): A signs out, B signs in, none of A appears on B screen or DB, A DB intact; detector proven (planted leak caught; server made to leak, test failed, reverted) | - | e2e: user A out, user B in | Claude | P2 |
| B13 | New release replaces installed copy, keeps local data | VERIFIED | projexa #390 (f053fbe5): scripts/verify/release-registry-live.mjs (read-only, real registry + live projexa-ai.com: 26 releases, 10 of the last 14 deploys registered in order, all 385 files + bundle hash-match the registry) + src/lib/local-first/release-real-manifests.test.ts (real N and N+1 manifests as fixtures; alter a hash -> fails); the installer ran N -> N+1 with real bytes: only the 18 changed files, old files kept until the switch, local records and queued edit unchanged, tampered file refused; REAL DEFECTS fixed: release numbers not in build order (9 of 25 pairs), blocked source-map in the manifest. Service-worker page-load switch in a browser: stub spec lf-lifecycle-release.spec.ts. PM decision: accepted | Not live until the next Vercel production deploy (Vercel rate-limited the last two merges) | POST /release/register from allowed origin; real run | Claude | P2 |
| B14 | First install finishes in reasonable time on 8GB laptop | VERIFIED | e2e/lf-lifecycle-large-project.spec.ts (projexa #388, d81fb8a7): first install over Chromium slow-4G (150 ms, 1.6 Mbps) with the real 747-file release (2.6 MB bundle): throttle proven real (bundle >= size at 1.6 Mbps: 13.5 s local, 14.1 s CI), budget 60 s, measured 22-24 s local / 19.3-19.5 s CI; progress never shows 100% before installed and never goes backwards; seen to fail 4 ways (bundle held 45 s, throttle removed, 100% at once, percentage drops) | - | Measure; stream progress; set target | Claude | P2 |
| B15 | Large projects stay fast | VERIFIED | projexa #384 (6aace2f8): BOQ table windowed (40 rows drawn of 5,000); e2e/lf-lifecycle-large-project.spec.ts budgets open<=3 s (measured 0.70-1.74 s, was 5-9 s / 13.5 s on old code), freeze<=0.5 s (54-92 ms), key->paint<=100 ms (5-44 ms); row-window.test.ts 20 tests, ScopeObjectScreen.test.tsx 4 new; seen to fail on the old screen; CI Offline e2e 87 passed | - | Run against largest real org | Claude | P3 |
| B16 | Live site serves latest main and loads after sign-in | VERIFIED | e2e/live-site-smoke.spec.ts + playwright.live-smoke.config.ts (read-only, no login) against https://projexa-ai.com: live /sw.js stamped bb83ec49 = origin/main #374 = Vercel production READY; /login 200, scripts served as JS, signed-out /local goes to /login; FChecklist/projexa#376, sha 0b0ff18e. Seen to fail: wrong EXPECT_SHA, LIVE_URL=https://example.com failed all 5 | - | Read-only deployment list; smoke live | Claude | P1 |

### Offline behaviour (B17-B28)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B17 | Open app offline after a full browser restart | VERIFIED | e2e/audit37-real-b17-b20-offline.spec.ts "B17" (persistent Chromium profile, full browser restart, offline: RFI list opens data-state=local, same IndexedDB, SW controls), real login, 3/3 real runs; FChecklist/projexa#377, sha 22bc7e5f. Seen to fail: AUDIT100_BREAK=b17 (empty profile) failed at page.goto ERR_INTERNET_DISCONNECTED | - | Playwright persistent-context restart test | Claude | P2 |
| B18 | Offline edits queue and flush when online | VERIFIED | e2e/audit37-real-b7-writeback.spec.ts "B18 + B28": offline create queued (outbox 1, server has nothing), network back with no reload the outbox flushes by itself, server row re-read from Node, exactly once; projexa#377 + #382. Seen to fail: AUDIT100_BREAK=push failed at "outbox never flushed by itself" | - | Real-backend spec: edit offline, go online, re-read | Claude | P1 |
| B19 | Conflicting offline edits merge safely | VERIFIED | e2e/lf-documents-conflict.spec.ts (projexa #378, f2a0db1d): two real browser contexts offline-edit one record; different fields merge, same field -> card, money field -> card; REAL BUG fixed (money edit merged silently); seen to fail | - | Peer + offline e2e | Claude | P3 |
| B20 | Offline passcode login in a real browser | VERIFIED | e2e/lf-lifecycle-offline-passcode.spec.ts (projexa #387, bd8e47e1, stub rig, real Chromium): after a sign-out with the network OFF /login shows the offline passcode form from the kept release, wrong passcode refused, right passcode opens the same local copy, zero Auth/page//api requests offline; fails on the old code (sign-out deleted the release); PM decision: keep the public release caches across a sign-out (data still wiped, B12 green; a different person signing in deletes the kept release first) | Real-backend b20 spec no longer test.fail; not re-run against the real backend | Add to audit37-real-pin spec | Claude | P1 |
| B21 | Peer sync while Supabase is down (ntfy fallback) | VERIFIED | e2e/lf-peer-ntfy.spec.ts (projexa #375, 5fb2c294): two real browser contexts, Supabase unreachable, find each other over a local ntfy stand-in, exchange signed rows; ntfy removed from remoteSignalProviders() -> never met; nothing else leaves the page | - | e2e with Supabase refused + 2 peers | Claude | P3 |
| B22 | Peer sync between two real laptops on different networks | VERIFIED | e2e/lf-peer-relay.spec.ts (projexa #386, ce695500): relay-only ICE, no internet: with a TURN relay both laptops end with both signed rows (relay-to-relay in WebRTC stats, relay counted packets); without it they never connect, the person sees one plain sentence and the app keeps working; seen to fail 3 ways; peer config supports NEXT_PUBLIC_PEER_ICE_URL credentials (no secret in the bundle) | OWNER DECISION 2026-10-05: no paid relay account and no second real laptop; the local TURN-relay simulation (relay-only ICE, two contexts, relay-to-relay) is accepted as the proof | - | Try 2 real laptops; consider free TURN | Claude+Owner | P2 |
| B23 | Peers link only for same org and same role view | VERIFIED | audit37-real-peers.spec.ts; peer/protocol.test.ts | None | None | Claude | P3 |
| B24 | Browser eviction: data survives or re-syncs | VERIFIED | e2e/lf-lifecycle-laptop-safety.spec.ts "B24" (projexa #372): real storage wipe, login cookie survives, install + copy run again, offline BOQ shows 3 lines; unsent edit loss asserted; seen to fail with a partial wipe | - | Request storage.persist; test wipe then resync | Claude | P2 |
| B25 | Safari offline works | VERIFIED | e2e/lf-lifecycle-webkit-phone.spec.ts (projexa #374, bb83ec49): offline BOQ from the laptop copy on Playwright WebKit (Safari engine), seen to fail with SW blocked / copy deleted | OWNER DECISION 2026-10-05: no real Safari available; the Playwright WebKit (Safari engine) simulation is accepted as the proof | - | Test WebKit via Playwright | Claude | P2 |
| B26 | Android/iOS phone install and offline | VERIFIED | same spec (#374): iPhone 13 profile on WebKit and Pixel 5 on Chromium, real tap on a BOQ line, no sideways scroll | OWNER DECISION 2026-10-05: no real phones available; iPhone 13 / Pixel 5 device emulation is accepted as the proof | - | Playwright mobile emulation; real phone by owner | Claude+Owner | P3 |
| B27 | Storage cap reached: clear plain-English message | VERIFIED | e2e/lf-lifecycle-laptop-safety.spec.ts "B27" + documents-file-cache.test.ts (projexa #372): REAL BUG fixed (quota error escaped, person told nothing; now a plain message); QuotaExceededError is injected, not the real browser quota. Not covered: quota hit during the projects copy | - | Unit test + UI string | Claude | P3 |
| B28 | Back online: sync resumes without refresh | VERIFIED | same test as B18 ("B18 + B28"): back online, no reload or navigation, outbox flushes by itself and server row re-read; projexa#377 + #382. Seen to fail: AUDIT100_BREAK=push. Second-laptop pickup is tracked under B7, not here | projexa #385 (d1323021): online trigger within 30 s / during a round was dropped: now held and run once (scheduler.test.ts 2 new, fail before); e2e/lf-lifecycle-live-sync.spec.ts: network cut and restored on laptop B, change arrives without reload; real-backend flush proven earlier (b7-writeback spec) | - | Real-backend toggle spec | Claude | P2 |

### External AI work link (B29-B44)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B29 | Small owner-approved prompt shipped | VERIFIED | #362; ai-prompt-wording.test.ts; AiWorkLinkCompact.test.tsx | Real engine acceptance missing (B37-B42) | None | Claude | P3 |
| B30 | Large guide fetched by link (GET returns manual) | VERIFIED | awl-reachability.sh 8/8 live 2026-09-26; router tests | Re-run after #2064 | Re-run script, save output | Claude | P2 |
| B31 | Guide always answers well under 8s | VERIFIED | scripts/verify/awl-live/guide-speed.live.test.ts, 40 sequential live guide GETs, control host; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). Server first-byte p50 0.33-0.36s, p95 0.56-0.61s, 0 server stalls. Seen to fail: limit 1 -> 0.1 failed (Received 0.325), reverted | - | Script 50 requests, report p50/p95, commit | Claude | P1 |
| B32 | Guide median (p50) under 1s | VERIFIED | same file; caller-visible total p50 0.48-0.50s; evidence ai-os/audit37/evidence/run-guide-speed-2026-10-05T11-24-38-452Z.json and ...11-26-25-407Z.json; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). Seen to fail: same mutation. Run 2 had 4 caller-side TCP connect stalls (15-21s), control host clean | - | Script 50 requests, report p50/p95, commit | Claude | P1 |
| B33 | Root cause of ~21s stalls found | VERIFIED | curl timing 2026-10-05: stalls were TCP connect on this laptop (15-21s), server first-byte 0.45s | Client-side network, not the function | None for the function; ChatGPT earlier timeout was DB saturation | Claude | P3 |
| B34 | 'All means all': AI sees everything the person may see | VERIFIED | scripts/verify/awl-live/all-means-all.live.test.ts 11/11 live (role/org/no-code); evidence run-all-means-all-2026-10-05T11-27-05-747Z.json; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). 4 mutations failed (viewer write 403->200, foreign project 404->200, money redaction, no-code rule), reverted | - | Commit simulate-external-ai run output | Claude | P2 |
| B35 | Limited only by role, projects, org | VERIFIED | ai-work-link-functions.pglite.test.ts, effective-level tests | Live cross-org 404 probe not recorded | Probe with test link | Claude | P3 |
| B36 | Manual tells the chat AI not to write code | VERIFIED | Live guide rule 11 "Do not write programs, scripts, SQL or code" + manual.ts line 135 | A string test for it already exists in ai-work-link-manual-guide.test.ts | None | Claude | P3 |
| B37 | ChatGPT free run: list projects, report, create draft | BLOCKED-OWNER | none | Needs owner's ChatGPT tab | Owner runs script in audit37/D; record CSV | Owner | P1 |
| B38 | Claude (claude.ai) run | BLOCKED-OWNER | none | Needs owner's tab | Same | Owner | P1 |
| B39 | Gemini run | BLOCKED-OWNER | none | Needs owner's tab | Same | Owner | P2 |
| B40 | DeepSeek run (paste-card path) | BLOCKED-OWNER | none | Cannot open links | Same, card flow | Owner | P2 |
| B41 | z.ai run | BLOCKED-OWNER | none | Browse ability unknown | Same | Owner | P2 |
| B42 | Grok run | BLOCKED-OWNER | none | Never tried | Same | Owner | P3 |
| B43 | No-browse paste card + paste-back of proposals | VERIFIED | scripts/verify/awl-live/paste-card.live.playwright.ts (ct #2077): token-free card, live inbox page in real Chromium, wrong code sends nothing, right code creates the project (DB re-read), broken block refused. The no-tools AI writing the block itself: see A32 | - | Check host; run round trip | Claude | P1 |
| B44 | Link expiry and revoke work at once | VERIFIED | scripts/verify/awl-live/link-lifecycle.live.test.ts 11/11 live: revoke and expiry give 410 on guide/REST/header/MCP/card, DB row re-read; evidence run-link-lifecycle-2026-10-05T11-29-40-466Z.json; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). expect-410 swapped to 200: failed, reverted | - | Live: mint, revoke, expect 410 | Claude | P2 |

### AI connectors (B45-B54)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B45 | MCP at the link works from a real client | VERIFIED | scripts/verify/awl-live/mcp-conformance.live.test.ts 11/11 live + claude-mcp-client.live.test.ts (real Claude Code 2.1.211 as MCP client, list_projects total = DB count 20); evidence run-mcp-conformance-2026-10-05T11-31-05-124Z.json, run-claude-mcp-client-2026-10-05T11-39-28-652Z.json; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). Mutations (role, GET 405->200, bogus tool, count +1) each failed | - | Run claude mcp add; tools/list | Claude | P1 |
| B46 | /openapi.json valid and importable | VERIFIED | scripts/verify/awl-live/openapi-import.live.test.ts 6/6 live: /openapi.json, /swagger.json, header-mode doc pass swagger-parser validate+dereference, unique operationIds, swagger2openapi conversion; evidence run-openapi-import-2026-10-05T11-46-53-056Z.json, run-openapi-live-2026-10-05T11-49-13-564Z.json; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). Deleting info.title and unique-id +1 each failed, reverted | - | Lint openapi; import test | Claude | P2 |
| B47 | /swagger.json valid | VERIFIED | src/lib/services/ai-work-link-openapi-schema.test.ts (ct #2068): official Swagger 2.0 schema; 6 mutations fail. NOT importable-into-a-real-tool proof | - | Validate with swagger tool | Claude | P3 |
| B48 | Claude custom connector (no sign-in) | BLOCKED-OWNER | none | Needs owner's claude.ai account | Owner adds connector; record | Owner | P2 |
| B49 | ChatGPT GPT Actions / developer-mode MCP | BLOCKED-OWNER | none | Owner's account; Actions retire 2026-12-11 | Owner test; prefer MCP | Owner | P2 |
| B50 | Gemini connector / CLI | BLOCKED-OWNER | none | App likely needs OAuth | Owner test; CLI by Claude | Owner | P3 |
| B51 | Extension loads unpacked in Chrome and injects the guide | VERIFIED | e2e/extension-ai-link.spec.ts: extension loaded unpacked, injects the guide; same mutations | - | Load via Chrome; screenshot | Claude | P1 |
| B52 | Extension works on chatgpt.com, claude.ai, gemini, deepseek | PARTIAL | extension logic proven: e2e/extension-ai-link.spec.ts per-site selectors (projexa #388): changing one site selector fails ONLY that site (5 sites seen); real finding fixed: z.ai was found by DeepSeek selector; fixtures e2e/fixtures/chat-sites/: gemini + z.ai captured live (no login); scripts/verify/chat-site-selectors.mjs drift detector | chatgpt.com, claude.ai (Cloudflare bot check) and chat.deepseek.com (CloudFront block) real composers NOT captured: need the owner signed-in browser (run the drift script there); fixtures follow the extension selector comments | Test each site (owner login needed) | Claude+Owner | P2 |
| B53 | Connect tab / header Connectors button shows MCP, OpenAPI, Swagger, prompt | VERIFIED | e2e/lf-ai-header-connect.spec.ts (projexa #369) + #371 (every mint asks 7 days): 6 runtime mutations each fail; service answer is a stub, buttons real | - | Playwright click test on live | Claude | P2 |
| B54 | Header-token mode (Link-Token / Bearer) works | VERIFIED | scripts/verify/awl-live/link-lifecycle.live.test.ts header-mode tests (Link-Token and Authorization: Bearer equal path mode; token in query refused 400; wrong/missing refused), live 11/11; compliance-tracker #2074 (merge 5b2161b1, commit 9b3dd2c2). Wrong Link-Token in equality test failed (Received 410), reverted | - | curl test with header | Claude | P3 |

### Email (B55-B56)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B55 | Invite email carries a personalised AI prompt | VERIFIED | projexa #397 (2b744a7e): on invite accept ONE "Welcome to <org>" e-mail through Resend with the owner-approved prompt + the person's own 24 h link (plain-text box, never in an href, role-limited by the service, skipped quietly on any failure); e2e/audit37-real-b55-welcome-email.spec.ts (real backend + REAL e-mail, by hand): Resend shows delivered from PROJEXA <noreply@send.veridian-aios.com>, link GET 200 text/plain read-only, revoked -> 410, second accept refused with one e-mail; unit tests fail with a planted href / send-before-check; test rows cleaned (one revoked link row + its append-only log row kept) | Sending in production needs RESEND_API_KEY in projexa Vercel Production env (OWNER: secret entry); invitees need a VERIDIAN user (fix in progress) | Owner approves wording; then build | Owner | P2 |
| B56 | Invite accept attaches org and starts install | VERIFIED | same spec: org owner creates an invite in OrgInvitesCard (row re-read), invitee accepts, install starts (prepare screen, service worker active, projexa-local:<userId> DB exists); used/wrong/expired link -> plain refusal and no membership; broken token hand-off fails the run | - | e2e: invite, accept, install | Claude | P2 |

### Error capture (B57-B58)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B57 | Sync, outbox, peer and AI errors captured, not only window errors | VERIFIED | sync-fault-report.test.ts + 5 real-engine tests added in projexa #371; mutation (delete reportFault in outbox:push/replica:sync/outbox:pass/peer:sync/ai:tool) fails each; reverted | - | Hook reporter into sync/outbox/AI catch blocks | Claude | P1 |
| B58 | Slow/failed edge calls (21s stalls) visible to us | VERIFIED | ct #2067 + #2074: awl-timing unit tests, scripts/verify/awl-timing-logs.ts + live test finds its own probe line; deployed function emitted 660 [awl-timing] lines (slow/failed flags) 2026-10-05 07:29-11:50Z | - | Log duration in edge fn; weekly query | Claude | P2 |

### Cost (B59-B60)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B59 | Vercel spend under $20 cap, no paid add-ons on | VERIFIED | src/lib/vercel-no-paid-addons.test.ts (projexa #367): 5 mutations (analytics dep, crons, ignoreCommand, speedInsights, source mention) each fail; code/config side only, dashboard toggle not covered | - | Read-only billing check | Claude | P2 |
| B60 | Static bundle and shell on free Cloudflare Pages | VERIFIED | projexa #396 (e83b4296): NEXT_PUBLIC_PX_STATIC_BASE switch (off by default) moves /_next/static, the release bundle and logo to a static host, offline still works, every byte still hash-checked; REAL free Cloudflare Pages host https://projexa-static.pages.dev serves release 2026.10.05-796: 383/383 files + bundle byte-identical (scripts/verify/static-pages-live.mjs; seen to fail on a broken preview); real browser (Edge local, Chromium in CI): 0 static files from the app origin, 58 from the static host, offline OK; seen to fail 5 ways; 23 static-host unit tests | Going live = OWNER switch (3 steps in ai-os/audit37/STATIC_ON_CLOUDFLARE_PAGES.md): set NEXT_PUBLIC_PX_STATIC_BASE in the Vercel project env, add CLOUDFLARE_API_TOKEN (Pages:Edit) + CLOUDFLARE_ACCOUNT_ID to it, redeploy; custom domain = DNS (owner only). Not switched on: secrets must not be entered by an agent | Owner decision; Claude migrates | Owner | P3 |

### UX (B61-B63)

| ID | Requirement | Status | Evidence | Gap | Plan | Who | Pri |
|---|---|---|---|---|---|---|---|
| B61 | Bright, lively colours | VERIFIED | e2e/lf-lifecycle-ux.spec.ts (projexa #368, merged): computed-style colours in real Chromium, the check proves it can fail (dark header injected, caught); CI green 2026-10-05 | - | Owner looks at screenshots | Owner | P3 |
| B62 | Plain-English messages everywhere | VERIFIED | src/lib/local-first/plain-english.test.ts (projexa #367): planted HTTP 500 text, raw code, lowercase, OutboxAttention text each fail | - | Grep error strings; fix jargon | Claude | P3 |
| B63 | Header, switcher, Connect panel fit a phone screen | VERIFIED | e2e/lf-lifecycle-ux.spec.ts (projexa #368): at 375px the test FAILED (page 692px wide, account menu 31px off screen), header fixed, passes locally and in CI | - | Playwright 375px screenshots | Claude | P3 |

## 5. Owner actions

1. B20: decide whether to keep public release caches across a sign-out, or render the offline passcode form from the shell's signed-out screen (real product gap, offline passcode sign-in unreachable).
2. Backend (compliance-tracker): make delete_meeting (and check the other delete_* functions) remove the source row, not only the sync head (B8 delete round trip).
3. Investigate laptop-side apply/scheduling of later server changes on an idle open second laptop (B7 second-laptop leg; scheduler back-off 5->30 min suspected).
4. B13: needs an authorised deploy to register a new release. Steps: (1) after the deploy note release.current from /manifest; (2) install on a profile from the previous release; (3) deploy the next release, open online, confirm px-release cache switches and IndexedDB rows are unchanged.
5. B14: on a second laptop open projexa-ai.com, sign in with a real account, time from clicking Sign in to the install screen closing, record it.
6. B1: set CHECK_EMAIL / CHECK_PASSCODE for a real account in your own shell, run the audit37-real-pin.spec.ts sign-in step against https://projexa-ai.com, record the result.
7. A17: on laptop 1 open /forgot-password and request a reset; open the e-mail on laptop 2, click the link, enter the address and the 6 digits, set a new passcode.
8. B6 / B56: admin creates an invite for a test address in OrgInvitesCard; open /invite/<token> signed in as that address, click Join; confirm the dashboard opens and the install screen runs.
9. Cleanup: test data left in the E2E org (a few "audit100-" RFIs and two meetings).
10. Environment: real-backend specs need a fresh webpack build (--webpack) served on :3101 (service CORS allows only 3100/3101); the :3100 server was a stale build. Supabase link is flaky (connect timeouts), helpers retry.
11. Earlier open owner-run items: B37-B42 engine runs, B48-B50 connector tests, A24 mailer, B55 invite wording, B60 Cloudflare go-ahead.

## 3. Gap analysis - top 15 gaps

Effort: S = under half a day, M = 1-2 days, L = several days.

| # | Requirement | What exists | What is missing | Plan (files / steps) | Who | Effort |
|---|---|---|---|---|---|---|
| 1 | B31-B33: guide under 8s, p50 under 1s | PR #2064 guide speed, deployed 2026-10-05. Most calls 0.5-2s | ~1 in 6 calls stall ~21s; cause unknown; no timing test | 1) Pull edge logs (Supabase `query_logs`, function ai-work-link) for slow calls. 2) Check cold start vs DB pool wait (`handler.ts`, `_shared/ai-link/core.ts`). 3) Cache rendered manual per link/role for 60s; time-box DB call to 3s with fallback. 4) Script of 50 GETs, commit p50/p95. | Claude | M |
| 2 | B2-B4, B9: one-time install, refresh, no-org, new project | #365 merged (gate, quiet backoff, switcher) | #366 e2e still open; no live proof | Finish and merge #366; add refresh x3, no-org user, new-project-persists assertions in `e2e/lf-lifecycle-install.spec.ts`; run once on live with democeo. | Claude | S |
| 3 | A5/A27-A32, B37-B42: real chat-AI runs | Server, manual, card, sims 9/9 x4 | 0 recorded vendor passes | Owner opens ChatGPT, Claude, Gemini, DeepSeek, z.ai, Grok with a fresh 7-day link; follow the per-engine script in `audit37/D_external_ai_link.md`; Claude reads the call log and writes a committed CSV; revoke link after. | Owner (+Claude records) | M |
| 4 | A36, B51-B52: browser extension | `extension/projexa-ai-link` merged | Never loaded; no test; per-site selectors unknown | Load unpacked via Chrome; test popup, guide fetch, inject on chatgpt.com and claude.ai (owner logs in); add `lib.js` unit tests. | Claude (+Owner login) | M |
| 5 | A17, B20: reset on new laptop + offline PIN | Reset email has link + 6 digits; offline-pin logic tested | New-laptop flow and real offline sign-in never run | Playwright second profile: request reset, read email via Gmail MCP, open link, enter code; add offline sign-in to `audit37-real-pin.spec.ts`. | Claude | M |
| 6 | A24, B55-B56: email delivery and invite prompt | Built-in mailer; invite routes exist | ~2 emails/hour; invite prompt PENDING by owner | Owner decides sender (Resend/SMTP) and wording; Claude builds `invites` email body with personalised prompt and e2e. | Owner then Claude | M |
| 7 | B7-B10, B18: write-back sync proven | Pull verified; outbox unit tests | Edit -> Supabase -> second laptop not proven; deletes missing | Two-profile real-backend spec: create/edit/delete, re-read DB and peer; add tombstones for deletes. | Claude | L |
| 8 | A1-A3, B16, B59-B60: Vercel least | Sync on edge fns; static shell cached | 310 routes still on Vercel; deploy state unchecked | Read-only Vercel check (plan, last deploy, spend); rank routes by traffic; move static bundle to Cloudflare Pages (owner go-ahead). | Claude + Owner | L |
| 9 | A4, A14/A34: internal AI chat live | Bridge answered PONG; route tests | Chat route off; no typed end-to-end test | Set `PROJEXA_INTERNAL_AI_ENABLED` and bridge env locally; type a command; assert persisted result; commit test. | Claude | M |
| 10 | B22, B24-B26: peers, eviction, Safari, mobile | Peer sync in one machine | No TURN, no real second laptop, no Safari/phone | Playwright WebKit and mobile emulation; owner brings a second laptop for one run; request `storage.persist()`. | Claude + Owner | L |
| 11 | B57-B58, A33: error capture | window.onerror reporter | Sync/outbox/AI errors and slow edge calls invisible | Add `reportClientError` in catch blocks of sync/outbox/AI; log duration in edge fn; weekly query. | Claude | M |
| 12 | B43: no-browse paste card round trip | Card button (#361) | Paste-back into confirm page and `AWL_CONFIRM_HOST` untested | Verify host resolves; run card -> `projexa-proposal` -> confirm -> DB re-read. | Claude | S |
| 13 | B36, A13: "do not write code" rule | Capability-only enforcement | Manual never says it | Add rule to `manual.ts` and `card.md`; test the string. | Claude | S |
| 14 | B45-B50: connectors | MCP, OpenAPI, Swagger, header mode | No real client import | `claude mcp add` run; lint openapi/swagger; owner tests Claude and ChatGPT connector (Actions retire 2026-12-11). | Claude + Owner | M |
| 15 | A9, A21, B14: RAM/CPU and install time | Telemetry module | No numbers; install slow on 8GB | Read telemetry from this laptop; measure install; set a time budget. | Claude | M |

## 4. Recommended order of work

1. Merge #366; run the live smoke (B1-B4, B9, B16). Cheap and clears the visible bug.
2. Find the ~21s stall cause and fix it (B31-B33). Everything external depends on a fast guide.
3. Add the "no code" rule and verify the paste-card round trip (B36, B43).
4. Owner runs the six engine tests with a fresh link (B37-B42). Claude records results.
5. Load the extension and run the connector checks (B45-B47, B51, B53).
6. Real-backend write-back, delete and offline-queue specs (B7, B8, B10, B18, B20).
7. New-laptop reset flow (A17) and email decisions (A24, B55, B56).
8. Wire error capture for sync, outbox and AI (B57, B58).
9. Turn the internal chat on locally and test it (A4, A14).
10. Browser/device coverage: Safari, phone, eviction, two real laptops (B22-B26).
11. Vercel and cost: read-only checks first, then Cloudflare move after owner go-ahead (A1-A3, B59, B60). Do not deploy or spend without owner yes.
12. Polish: colours, plain English, phone layout (B61-B63).
