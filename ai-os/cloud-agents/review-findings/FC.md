# Client review findings assigned to package FC: Cost, the local-first flag and sign-out policy

Source: independent adversarial review of the laptop client (feat/lf-client-core) run against the REAL backend, three lenses, every finding re-verified. 11 findings, blocker > major > minor. Keys are `lens:id`; where two findings describe the same defect fix it once and say so. Paths in the findings refer to the reviewer's checkout (C:\ct\pxa-sync is the projexa repo, C:\ct\ct-aibridge the backend); the same files exist in your clones.

## [MAJOR] cost-and-quality:COST-02  src/components/WorkspacePrepare.tsx  (104-115, 190-229 (also app/(app)/layout.tsx:56))

**Issue:** The most expensive operation in the client, the full replica sync, is NOT behind the px-local-first flag. Every first sign-in on a laptop runs replica.sync() (P x 28 pulls) even with the flag off, and nothing reads the copy when the flag is off: the only readers (boq-local.ts:65, local-writes.ts:37, use-local-writes.ts:42, use-outbox-state.ts:24) are flag-gated, so the copy is write-only, pure cost.


**Scenario:** Flag off, 10-project org, person signs in: modal 'Preparing your workspace' for up to 3 minutes, 401 Edge requests (+ all rows downloaded and written to IndexedDB), result never used. Once the backend CORS is fixed (COST-01) this switches on for every user at once.


**Evidence:** grep: no isLocalFirstEnabled/px-local-first in WorkspacePrepare.tsx, replica-shared.ts, prepare-workspace.ts, replica.ts. Scratch test flagoff2.test.tsx (buildSteps with a fake replica, flag removed) FAILS: 'Expected: 0, Received: 1' sync calls. Measured 401 requests for P=10.


**Suggested fix:** Skip the 'projects' step (and the prepare modal's sync part) unless isLocalFirstEnabled(); flag off must mean zero Edge invocations. Add the test above as a permanent regression test (it is validated: fails today). Owner decision needed on whether slice-1 'install app/warm screens' steps should stay unflagged.


**Verified fix:** In buildSteps (or in WorkspacePrepare's start effect) skip the 'projects' step, and the replica sync, unless isLocalFirstEnabled(). Flag off must mean zero Edge invocations. The service-worker and warm-routes steps can stay as the owner decides. Add the regression test: flag off, buildSteps with a fake replica, expect sync not called. Do not enable the COST-01 CORS fix before this lands.

---

## [MAJOR] cost-and-quality:COST-03  src/lib/local-first/replica.ts  (482-517 (pair loop), 486-495 (reconcile right after pull), 520-534 (feed))

**Issue:** Request volume does not scale with change but with project x kind: a sync with nothing changed costs 1+29P (291 at P=10) and a first sync wastes P x non-empty-kinds /ids calls reconciling rows it pulled seconds earlier (100 of 401). The server's cap is 120 requests/min per person per isolate (handler.ts:77), so a 401-request first sync needs >=3.3 min, longer than the 3-minute prepare budget, and gets 429s when requests land on one isolate.


**Scenario:** P=10: first sync 401 requests, run ends by the 3-minute ceiling with status not 'done' -> readyKey never set -> next tab runs it again. Normal day: sign-in (401) + 20 BOQ opens + 30 BOQ writes (3 each, ScopeObjectClient.tsx:145,160-161 revalidates after every write too) + 30 ops (each op = 1 projexa-sync request + 1 ai-work-link-exec invocation) = ~611 invocations/user/day = ~13K/user/month: about 37 daily users exhaust 500K/month at P=10 (68 at P=3). Projection from measured unit costs, assumptions: 22 days, 20 opens, 30 writes, 30 ops.


**Evidence:** cost.test.ts harness output (see integration_harness). Prototype in scratch: (a) stamp the reconcile instead of calling /ids after a from-scratch pull: first sync 401 -> 301; (b) changes-first: when a project's feed is quiet and the pair is done, skip its pulls: no-change sync 291 -> 11, syncProject 3 -> 2. realhandler.ts: limiter answers 120 calls then 429 Retry-After 60.


**Suggested fix:** Ship (a) and (b); cache the manifest in memory ~10 min for syncProject (3 -> 1 request); debounce revalidateBoq per (project,kind) to once per few minutes and drop the after-write revalidate (the screen already read through the server). Structural: put per-project head_seq and per-kind counts in the manifest, or add a multi-kind /pull, so empty kinds cost nothing (first sync P=10 would be ~30-100 requests). Expected: roughly 15x more users inside 500K/month.


**Verified fix:** (a) After a pair pulled from a null cursor in this run, stamp reconcileKey instead of calling /ids (401 to 301). (b) Skip a pair's keyset pull when the project's change feed is quiet and the pair is done, but keep one keyset pull per pair per day (or per N days, spread across projects) as the repair net, and keep the /ids reconcile on its daily stamp. Without that daily pull, (b) trades correctness for cost. (c) Cache the manifest in memory for about 10 minutes for syncProject (3 requests to 1-2). (d) Debounce revalidateBoq per (project, kind) and skip it for afterWrite loads. (e) Structural: put per-project head_seq and per-kind counts in the manifest, or add a multi-kind /pull, so empty kinds cost nothing.

---

## [MAJOR] cost-and-quality:COST-04  src/lib/local-first/replica.ts  (496-508 (failed pair is recorded and the run carries on), C:/ct/pxa-sync/src/lib/local-first/sync-client.ts:372-376)

**Issue:** No circuit breaker: after a pull fails with network/timeout/server/rate_limited the run still tries every remaining pair, each with 1+2 attempts. The server's DAILY quota answer (handler.ts:203, 429 'Try again tomorrow', no Retry-After) is retried 3x rapidly per pair instead of stopping.


**Scenario:** Edge/DB overloaded (the live DB was overloaded for hours recently) or daily quota hit while manifest still answers: ONE failed run = 851 requests at P=10 (about 450-850 inside the 3-minute budget depending on latency); every new tab session before a run ends 'done' repeats it.


**Evidence:** cost.test.ts: STORM A (/pull 500) = 851 requests, STORM C (/pull 429) = 851, vs STORM B (everything 500) = 3 because the manifest fails first.


**Suggested fix:** Abort the run (like 401/426) after 3 consecutive transport failures, and treat 429 without Retry-After as a stop-until-tomorrow state; keep a short in-memory cooldown so the next syncProject does not retry at once. Expected: ~20 requests per failed run. Test: server.failNext({status:500,times:1e9,path:'/pull'}) then expect requests <= 30.


**Verified fix:** In run(): count consecutive transport failures (network, timeout, server, rate_limited, not 404) across the worker pool and abort the run after 3, ending 'error'. On 429, pause the whole pool for Retry-After (default 60 s when the header is hidden) instead of failing each pair 3 times. Keep a short in-memory cooldown (about 5 minutes) so syncProject and the next tab do not retry immediately. Expected about 20 requests per failed run. Test: failNext({status:500, times:1e9, path:'/pull'}), then expect requests <= 30.

---

## [MAJOR] wire-conformance:F07  supabase/functions/projexa-sync/handler.ts  (handler.ts:77 (REQUESTS_PER_MINUTE = 120), 167-169 (429 + Retry-After: 60); client replica.ts:386-387, 482-517 (every project x every one of the 28 kinds = one pull each, concurrency 2), sync-client.ts:372-375,399)

**Issue:** A first sync costs ~33 requests per project (28 pulls + 2 changes + ~3 ids) and the person is capped at 120 requests per minute. From about 4 projects the cap is hit mid-sync; the client retries 429 only 2x (0.5 s, 1 s) because Retry-After is not readable cross-origin (F02), so the pair is failed.


**Scenario:** An organisation with 6 projects opens the workspace for the first time: ~186 of 306 requests are answered 429, the report is 'partial' with 62 issues; it only completes over several passes at least a minute apart (cursors are saved, so it is not data loss, but the 'workspace ready' state is not reached and the user sees a failing sync). Page-visit revalidations (syncProject per screen) spend the same budget.


**Evidence:** Harness W03: 2 projects = 67 requests (56 pull, 4 changes, 6 ids, 1 manifest). W26: 6 projects with the real default limiter and maxRetries 2 -> 306 requests, 186 answered 429, status partial, 62 issues, Retry-After present on the response but not exposed.


**Suggested fix:** Raise the cap for read routes (cost is near zero; the limit is per isolate anyway), or add one POST /pull_many that returns a page per kind in one call; expose Retry-After and make the replica honour it (pause the pool) instead of failing the pair.


**Verified fix:** Preferred: add one batched read (POST /pull_many or a /status that returns, per project and kind, whether anything is newer than the client's cursors) so a no-change sync costs about 1-2 requests per project. Also raise the read-route cap (cost is near zero), expose Retry-After (F02) and make the replica honour it (pause the pool, do not fail the pair), and run the change feed for a project even when one of its kind pulls was rate-limited.

---

## [MINOR] cost-and-quality:COST-05  src/lib/local-first/sign-out.ts  (134-161 (wipe), plus WorkspacePrepare readyKey logic)

**Issue:** OWNER TRADE-OFF (privacy rule vs cost, cost is the owner's stated first priority): every sign-out with nothing pending deletes the whole laptop copy AND removes the 'workspace ready' key, so the next sign-in repeats the complete first sync. The wipe is not flag-gated, so it applies to flag-off users too.


**Scenario:** A person who signs out each evening re-downloads every row of every project every morning: 401 requests at P=10, plus the whole dataset's egress (Supabase egress also has a free-tier cap; size not measured).


**Evidence:** Scratch test: first sync 401 requests; finishLocalWorkspaceOnSignOut -> wiped=true, readyKey removed; next sync again 401 requests.


**Suggested fix:** Decide with the owner: wipe only when the person ticks 'shared computer' at sign-in, or after N idle days, or when a different person signs in (per-user database names already prevent mixing). If the wipe stays, make COST-02/03 land first so a wipe-driven first sync is cheap.


**Verified fix:** Owner decision. Recommended order: fix COST-02 first (flag-off then holds no copy, so wiping costs nothing). Then either wipe only when the person ticks 'shared computer' at sign-in or after N idle days, or keep the wipe and rely on the cheap first sync from COST-03. The per-user DB name already prevents mixing between people. The residual risk of keeping the copy is that someone with browser-profile access can read it, which is the privacy side of the trade-off.

---

## [MINOR] cost-and-quality:FLAG-16  src/components/shell/M24Shell.tsx  (1122-1146 (SIGNED_OUT), AccountMenu.tsx:52, AppTopbar.tsx:78, SettingsClient.tsx:172)

**Issue:** Complete list of code paths whose behaviour changes with px-local-first OFF (everything else I diffed is inert): (1) the 3 explicit sign-outs now await finishLocalWorkspaceOnSignOut() BEFORE supabase.auth.signOut(): extra Supabase Auth getUser() network call when no active user is known (resolveLocalUserId), indexedDB.databases(), opens and DELETES projexa-local:<uid> (it exists for every flag-off user because WorkspacePrepare filled it), clears the BOQ device copy a second time, removes px-local-first-boq:* hints and px-workspace-ready-v1:<uid>, loads outbox-shared, waits up to 4 s (blocked delete) or 8 s (flush if ops exist); (2) M24Shell's SIGNED_OUT handler does the same on ANY SIGNED_OUT event (expired session, other tab) and when the person is not yet resolved (userIdRef null) it looks at EVERY projexa-local:* database on the browser and deletes all that have nothing pending, including other people's; (3) WorkspacePrepare's replica.sync() now issues the new /changes + /ids + pull-by-ids traffic and stores versions/signatures (COST-02/03); (4) IndexedDB schema upgrade v2 -> v3 on first open; (5) bundle: sign-out.ts, local-db, local-reader, prepare-workspace and OutboxAttention are loaded for everyone. Inert with flag off: createRfiLocally/answerRfiLocally/updateTaskLocally return null at once (local-writes.ts:37), useLocalWrites sets the same EMPTY object (no re-render), RfisClient/RfiObjectClient/ScheduleTaskObjectClient render the same JSX when nothing is pending, startOutbox is gated (M24Shell 1116), OutboxAttention renders nothing (but see TEST-11), revalidateBoq/loadBoqFromReplica/rememberBoq return at once.


**Scenario:** Owner turns nothing on and still sees: a 3-minute modal, 401 requests per sign-in, a slower sign-out and wiped data on session expiry.


**Evidence:** Source reads with line numbers above; grep for the flag in each file; tests: only RfiCreateClient, RfisClient, ScheduleTaskObjectClient have flag-off tests, none for sign-out, WorkspacePrepare or RfiObjectClient.


**Suggested fix:** Decide which of (1)-(5) must be flag-gated; at minimum gate (3) and make (1)/(2) skip when the laptop copy was never enabled.


---

## [MINOR] cost-and-quality:TEST-10  src/components/sign-out-local-first.test.tsx  (138-160)

**Issue:** The tests that claim AccountMenu, AppTopbar and M24Shell's SIGNED_OUT path flush and wipe are source-text greps (readFileSync + toContain/indexOf). They pass when the call is dead code. Only SettingsClient's button is driven for real. The M24Shell check is a 1800-character window.


**Scenario:** A later edit wraps the call in if (false) or moves it after signOut(): all four 'every sign-out path' tests stay green and a signed-out laptop keeps the person's data.


**Evidence:** Ran the tests' exact assertions on AccountMenu.tsx, AppTopbar.tsx, SettingsClient.tsx with the line changed to 'let localNotice = null; if (false) { await finishLocalWorkspaceOnSignOut(); }': structural test still PASSES for all three.


**Suggested fix:** Drive AccountMenu and AppTopbar like the SettingsClient test (click Sign out, assert order and that the DB is gone); for M24Shell capture the callback passed to the mocked onAuthStateChange and fire SIGNED_OUT with and without a known user. Also add the missing RfiObjectClient flag-OFF test (its only 'not on laptop' case runs with the flag ON).


**Verified fix:** Drive AccountMenu and AppTopbar like the SettingsClient test (click Sign out, assert flush order and that the database is gone). For M24Shell capture the callback passed to the mocked onAuthStateChange and fire SIGNED_OUT with and without a known user. Add the RfiObjectClient flag-off case with harness({flag:false}). Keep the grep tests only as a cheap backstop.

---

## [MINOR] cost-and-quality:TEST-11  src/components/OutboxAttention.test.tsx  (45-57)

**Issue:** 'With the flag off it does not even look' is not tested: removing the flag check in use-outbox-state.ts:24 leaves all 11 tests green, because the test never sets an active user, so the code path returns null for a different reason. With a signed-in person and the flag off, the mutated hook would create the outbox, attach the online listener and flush.


**Scenario:** Regression makes flag-off users create an outbox on every page; nothing fails.


**Evidence:** Mutation OA1: 11 pass, 0 fail. Added scratch test flagoff.test.tsx (setActiveLocalUser('u1'), flag off, mocked outbox-shared, expect getSharedOutbox never called): passes on real code (control), fails on the mutation.


**Suggested fix:** Add flagoff.test.tsx as written (validated).


**Verified fix:** Add the test as described: setActiveLocalUser('u1'), flag not '1', mock outbox-shared with a spy getSharedOutbox, render <OutboxAttention /> with no outbox injected, wait, then expect the spy not called. Add the equivalent for WorkspacePrepare's sync step as part of the COST-02 fix.

---

## [MINOR] cost-and-quality:TEST-12  src/lib/local-first/replica-versions.test.ts  (130-137)

**Issue:** 'a row whose version has not moved is not fetched again' is vacuous: the first sync records no ids-mode pulls, the second sync has no feed entries at all, so 0 == 0 holds even if the feed ALWAYS refetches. The skip at replica.ts:277-278 (the behaviour that bounds feed refetch cost) is pinned by no test.


**Scenario:** Someone removes 'known >= change.version' : every row the page cursor already delivered is fetched a second time by the feed; suite green.


**Evidence:** Mutation R1: 36 pass, 0 fail. Proposed T2 (row updated on the server with a moving updated_at, then sync; expect no /pull with ids and serverVersion 2) passes on real code and fails on R1.


**Suggested fix:** Replace the test with T2 (exact text in scratch lf/src/lib/local-first/extra.test.ts).


---

## [MINOR] cost-and-quality:TEST-14  src/lib/local-first/sign-out.ts  (57-72, 127-130, 143)

**Issue:** Two sign-out behaviours have no test: a delete that fails or is blocked is silent (the person is told nothing, wiped=false, notice=null, and it costs 4.7 s), and the second flush for an edit joined to a pass already ending (mutation S4 survives; S5 'report failed delete as wiped' survives).


**Scenario:** A stale tab that never closes holds the database: sign-out takes ~5 s, the data stays, nobody is told (the delete request stays queued and completes when that tab finally closes).


**Evidence:** Scratch T5: result {"pending":0,"wiped":false,"notice":null} after 4744 ms. Mutations S4, S5, S6: 11 pass 0 fail.


**Suggested fix:** Return a notice when a delete fails; add T5 (needs a short deleteTimeoutMs option) and a two-flush test (stub outbox whose first flush leaves the op).


---

## [MINOR] data-safety:F11  src/lib/local-first/sign-out.ts  (57-72 (4 s timeout -> false), 112, 146-161; boq-local.ts:26,41-48)

**Issue:** Sign-out can leave the person's data behind without telling them: (a) deleteDatabase resolves false after 4 s when blocked and no notice is produced (wiped:false, pending:0, notice:null); (b) the px-local-first-boq:<id> hints (BOQ title/status/project id, not per user) and px-workspace-ready-v1:<userId> are removed only when a database was actually wiped, so they survive the kept-database path and the early return at line 112.


**Scenario:** Probe S4 (s4.ts): with one pending op, localStorage keys left after sign-out: px-local-first-boq:boq1, px-workspace-ready-v1:u1, px-device-id; with no database present the same keys remain; only a clean wipe removes them.


**Evidence:** Probe s4.ts A/B/C.


**Suggested fix:** Remove the hints/ready key in every path, and return a notice when a delete did not complete.


---
