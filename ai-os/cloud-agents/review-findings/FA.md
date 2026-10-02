# Client review findings assigned to package FA: Wire, identity and conformance against the REAL backend

Source: independent adversarial review of the laptop client (feat/lf-client-core) run against the REAL backend, three lenses, every finding re-verified. 10 findings, blocker > major > minor. Keys are `lens:id`; where two findings describe the same defect fix it once and say so. Paths in the findings refer to the reviewer's checkout (C:\ct\pxa-sync is the projexa repo, C:\ct\ct-aibridge the backend); the same files exist in your clones.

## [BLOCKER] data-safety:F1  src/lib/local-first/replica.ts  (375-378 (replica.ts); src\components\WorkspacePrepare.tsx:197-211,105-111; drizzle\0678_projexa_sync_keys_ids.sql:135,156)

**Issue:** The privacy guard compares two different ids, so every sync against the REAL backend ends in user_mismatch and nothing is ever stored. replica.run does `manifest.user.id !== options.userId`. options.userId is the Supabase auth user id (WorkspacePrepare uses createClient().auth.getUser().data.user.id; M24Shell the same). The backend's manifest returns user.id = `v_user` = compliance.users.id from projexa_read_resolve_user (0618:111 `min(u.id)`; users.id is a cuid, schema.ts:244; the person is found by auth_user_id = sub).


**Scenario:** Person signs in, WorkspacePrepare runs replica.sync(): manifest answers {user:{id:'<cuid>'}} but options.userId is '<auth uuid>' -> issue user_mismatch, status 'error', MANIFEST_KEY never written, no row stored. local-writes.ready() then finds no manifest and returns null for all three writes, so the whole local-first copy is inert against the real service while every fake-server test is green (the fake returns userId 'u1' for both). It fails SAFE (no data stored, writes fall back online), so this is a feature blocker, not a leak; but anyone 'fixing' it by loosening the check would remove the person-isolation guard.


**Evidence:** Backend's own fixture keeps them apart: projexa-sync-read.pglite.test.ts:21-24 maps user key 'u-mgr' to sub '11111111-...'. Verified by reading both repos; I could not run the live service or a database.


**Suggested fix:** Have /manifest also return the token's `sub` (user.sub) and compare THAT in replica.ts (and keep the db name keyed on it); add a contract test that uses a user whose compliance id differs from its auth id.


**Verified fix:** Have the backend /manifest add the verified token subject, e.g. in supabase/functions/projexa-sync/handler.ts manifest(): user: { ...r.data.user, sub: who.sub } (no SQL change). In replica.ts compare (manifest.user.sub ?? manifest.user.id) with options.userId, but require sub whenever the server sends it. Update CONTRACT.md and the fake server (give it a compliance id different from the auth id). Add a contract test whose compliance id differs from the auth id.

---

## [BLOCKER] wire-conformance:F01  src/lib/local-first/replica.ts  (replica.ts:375-378 (check); components/shell/M24Shell.tsx:1104, components/WorkspacePrepare.tsx:209 and lib/local-first/replica-shared.ts:12-19 (what is passed); backend drizzle/0678_projexa_sync_keys_ids.sql manifest 'user' = jsonb_build_object('id', v_user, ...); src/lib/db/schema.ts:243-244)

**Issue:** The replica refuses to sync unless manifest.user.id === options.userId, but the app passes the PROJEXA Supabase AUTH user id (supabase.auth.getUser().data.user.id = the token's sub) while the real manifest names compliance.users.id (a cuid, createId()), a different column from auth_user_id.


**Scenario:** Any real person signs in, WorkspacePrepare / getSharedReplica(authUuid).sync() -> GET /manifest returns user.id = '<cuid>' -> replica.ts:375 pushes issue reason 'user_mismatch' and finishes status 'error' before a single row is stored. Nothing is ever copied to the laptop. The client tests never see it because the fake server uses the same string ('u1') for the token and for user.id.


**Evidence:** Harness W02: createReplica({userId: <auth uuid>}).sync() -> issues [user_mismatch], status error. 0618 header: 'p_sub is the verified token's sub (a PROJEXA auth user id). The linked user is the compliance.users row whose auth_user_id = p_sub'; every fixture has users.id 'u-mgr' vs auth_user_id '1111...'. All other harness tests only pass because they create the replica with the compliance id ('u-mgr').


**Suggested fix:** Add the sub to the manifest ('user.auth_user_id': who.sub in handler.ts manifest() / SQL) and compare that in replica.ts (or drop the id comparison and keep the org check); name the local database by the auth id as today. Make the fake server use different ids for token sub and user.id so the unit tests catch this.


**Verified fix:** Server: in handler.ts manifest() (around line 223) return user: { ...r.data.user, auth_user_id: who.sub }. Add the same field to the attest answer if peers need it. Client: add auth_user_id?: string to SyncManifest.user and compare (manifest.user.auth_user_id ?? manifest.user.id) !== options.userId at replica.ts:375. Make the fake server issue a different cuid-style user.id from the token sub, and add a backend test that manifest.user.auth_user_id equals the token sub.

---

## [MAJOR] cost-and-quality:SYNC-06  supabase/functions/projexa-sync/handler.ts  (78 (BODY_MAX_BYTES 4096), 336-338 (pull reads body with that cap) vs C:/ct/pxa-sync/src/lib/local-first/sync-client.ts:31,412-416 (SYNC_IDS_LIMIT 200))

**Issue:** The real server rejects any non-push body over 4096 characters with 413; the client sends pull-by-ids chunks of up to 200 ids. With 24-char ids (cuid2, compliance schema) 150+ ids is 413; with 36-char ids 104+. The client maps 413 to bad_response (not retried), the project is marked failed and the feed position does not move: the sync can never converge. The fake has no body cap, so every test passes.


**Scenario:** Someone else bulk-changes 300 rows of a kind without updated_at (progress); next sync: feed names 300 ids, pullIds chunk 200 -> 413 -> status error, same failure on every later sync (4 requests each, data stays stale).


**Evidence:** realhandler.ts: 'pull {ids x140} 200, x150 413, x200 413; uuid x100 200, x104 413'. cost.test.ts 'MASKED RULE' with the real cap: 1st sync done, 2nd and 3rd sync 'error' bad_response:413.


**Suggested fix:** SYNC_IDS_LIMIT <= 90 (or raise the server cap for ids-mode to 16 KB). Add a limits constant file shared by both repos (body cap, ids max, id regex) and a client test asserting SYNC_IDS_LIMIT x max id length + envelope < cap.


**Verified fix:** Server: use a size consistent with its own PULL_IDS_MAX, e.g. readBody(req, deps, 16_384) when body.ids is present (200 x 67 chars + envelope is about 14 KB). Client, which also works against the already-deployed server: chunk pullIds by serialized size (e.g. keep each JSON body <= 3,500 chars) as well as by count, or cap SYNC_IDS_LIMIT at 50. Add a shared limits constants file or golden JSON, and a client test asserting chunk size x max id length (64) + envelope < the server cap.

---

## [MAJOR] cost-and-quality:TEST-09  src/lib/local-first/__fixtures__/fake-sync-server.ts  (26-426 (whole fixture), 402 and 425 (release 2026.10.02-3))

**Issue:** The fake was written from the contract text, not from the real handler, and every test in the suite trusts it. Verified divergences it hides: CORS allow-list and exposed headers (COST-01), 4096-char body cap (SYNC-06), 120 req/min cap and 429 without Retry-After for the daily quota (COST-04), record_kind for creates (COST-08), 28 kinds plus org_kinds in the manifest (client parseManifest drops org_kinds), and the release rule: the real RELEASE_RE needs a 3-digit build, so the fake's and tests' '2026.10.02-3' is never answered 426.


**Scenario:** Backend ships, all 300+ client tests stay green, first real browser call fails.


**Evidence:** realhandler.ts: X-Px-Client release '2026.10.02-3' below the minimum -> 200 (no 426); '2026.10.02-003' -> 426. handler.ts:450,488.


**Suggested fix:** Add a golden contract file (limits.json: body cap, ids max, id regex, rate cap, allowed/exposed headers, release regex) generated from handler.ts and asserted by both repos' tests; make the fake read it (apply the body cap and rate cap, send Retry-After only where the real one does). Use the contract's '-NNN' release format in fixtures.


**Verified fix:** Fix the contract and fixtures first: change CONTRACT.md's example and the fake/test release to the zero-padded 3-digit form, and make the client's release build emit it. Then add a golden limits file (body cap, ids max, id regex, rate cap, allowed and exposed headers, release regex) generated from handler.ts and asserted by both repos' tests. Make the fake read it: apply the pull body cap, apply a per-minute cap, emit Retry-After. Add one backend-side test that drives the real handleSync with the client's exact request shapes (headers and ids chunk sizes).

---

## [MAJOR] wire-conformance:F03  supabase/functions/projexa-sync/handler.ts  (handler.ts:74 (BODY_MAX_BYTES = 4096), 70 (PULL_IDS_MAX = 200), 303-313 (readBody default cap), 324-326; client sync-client.ts:31 (SYNC_IDS_LIMIT = 200), 412-423 (pullIds chunks of 200); replica.ts:289-293 (applyChangePage), 297-317 (applyChanges))

**Issue:** The server caps every non-push body at 4096 characters yet accepts 'ids <= 200' (CONTRACT section 1) and the client sends chunks of 200. With 36-char uuid ids the limit is 103 ids, with 24-char cuid ids 150; a 200-id chunk is a 413. The client turns 413 into bad_response (no retry), the replica fails the project and never advances the change-feed position, so the SAME page is retried and fails on every later sync: the project's change feed is wedged permanently.


**Scenario:** Most synced tables have no updated_at (boq_line_items, activities, work_progress, rfis, submittals, punch_list, change_orders, materials, documents, roster, attendance, ...), so for them the change feed is the ONLY way an update reaches a laptop. A PM applies a rate escalation to 300 BOQ lines (or 130 RFIs are answered) while a laptop is away: next sync -> /changes returns 300 'U' -> pullIds in chunks of 200 -> 413 -> status 'partial' forever, feed position frozen, the project never syncs again (other projects are fine).


**Evidence:** Harness W06: pullIds of 200 uuids -> SyncError bad_response 413 (body 7845 bytes). W06b: largest accepted list = 103 uuid ids / 150 24-char ids. W25: 130 RFIs answered elsewhere -> 2nd sync status 'partial', issue 'The sync service answered 413' (5116-byte body, 130 ids), the 3rd sync identical, feed position 157 before and after.


**Suggested fix:** Either raise the cap for POST /pull {ids} to ~16 KB (200 x 66 bytes) in handler.ts, or make the client chunk by bytes/ids (<= 80 ids). Do both; add a test that sends 200 uuid ids.


**Verified fix:** Server: raise the cap for pull to about 16384 (200 x 67 bytes plus envelope) by calling readBody(req, deps, 16384) in pull(), or check size after parsing so non-ids bodies stay small. Client: lower SYNC_IDS_LIMIT chunking to at most 80 ids per request, ideally chunk by serialized bytes under 3.5 KB. Add tests that send 200 uuid ids and 200 cuid ids through the real handler.

---

## [MAJOR] wire-conformance:F08  src/lib/local-first/replica.ts  (replica.ts:297-317 (changes asked with afterSeq: cursor, line 303, no overlap); backend drizzle/0679_projexa_record_versions.sql header lines 16-19 ('KNOWN LIMIT ... Laptops therefore re-ask from after_seq - 200 ... daily /ids reconcile and the updated_at keyset pull repair anything a long transaction straddled'), projexa_sync_changes (no visibility horizon))

**Issue:** seq is an identity taken when the trigger fires, so a long transaction's rows become visible with seq numbers BELOW positions a laptop already holds. The backend documents that laptops must re-ask from after_seq - 200; the client does not, and the two repair paths the backend names do not repair it: the keyset cursor is (created_at/updated_at = transaction START, id), already behind the cursor, and /ids reconcile only ever REMOVES local rows. 200 would not be enough for a 10,000-line transaction anyway.


**Scenario:** A PM applies a rate update to 3,000 BOQ lines in one transaction (30 s) while a site engineer logs progress in the same project; a laptop syncs between: its feed position passes the seqs the big transaction took; the escalation commits afterwards; boq_line_items has no updated_at, so neither the keyset nor the feed ever shows the new rates on that laptop (money figures silently stale, no error).


**Evidence:** Harness W14: laptop holds feed position 13, next /changes asks after_seq=13 (no overlap). W14b (simulated with the real tables: seq G taken early via nextval, later writes pulled past it, then the row + head + log row committed with seq G and an older created_at): /ids lists 'late-rfi-1', the laptop still lacks it after 3 syncs.


**Suggested fix:** Server (proper): store pg_current_xact_id() in projexa_change_log and have /changes return only rows whose xid < pg_snapshot_xmin(pg_current_snapshot()) (the standard visibility horizon), so seq order equals visibility order. Client (stopgap): ask the first page of each run from max(0, position - 200) (idempotent: applyChangePage already skips known versions). Correct the 0679 header claim that keyset/reconcile repair it.


**Verified fix:** Proper fix (server): store pg_current_xact_id() (xid8) in projexa_change_log and have projexa_sync_changes return only rows whose xid is below pg_snapshot_xmin(pg_current_snapshot()), so seq order equals visibility order; apply the same horizon to head_seq. Client stopgap: make the first /changes request of each run start at max(0, position - 200) (applyChangePage already skips versions it holds). Correct the 0679 header claim that keyset and /ids repair this, and document the overlap in CONTRACT.md.

---

## [MAJOR] wire-conformance:F09  src/lib/local-first/boq-local.ts  (boq-local.ts:33-38 (isGatewayLine), 71-73 (loadBoqFromReplica returns null when no row passes); local-writes.ts:96,160 (camelCase optimistic rows / patches); backend kinds served via ai_work_link__records_core (drizzle/0677 projexa_sync__src))

**Issue:** The BOQ proof screen only accepts rows in the BOQ GATEWAY shape (boqId, boqTitle/boqVersion/boqStatus, quantity/rate/amount as strings), but the sync service serves the AI work link record shape: raw snake_case column names with numeric money (boq_id, item_code, quantity 120.5, rate 450, amount 54225, ...) and no boqTitle/boqVersion/boqStatus at all.


**Scenario:** With the flag on, loadBoqFromReplica filters out every real row, returns null, and the screen silently loads from the server every time: local-first BOQ reading never takes effect against the real backend (the fake-server tests used rows in the gateway shape). The same class: update_task patches merge camelCase keys (dueDate, statusId, ...) into server rows that use due_date / status_id, so an optimistic task row holds both until the server row replaces it.


**Evidence:** Harness W18b: real boq_lines data keys activity_id,amount,boq_id,breakdown_percentage,budget_percentage,category,created_at,description,equipment_cost,id,item_code,labour_cost,... ; isGatewayLine accepted 0 of 2. W18 prints the rfis/tasks key sets (snake_case) against the camelCase optimistic row.


**Suggested fix:** Pick one wire shape and test it against the real handler: either map the sync row in boq-local.ts (boq_id -> boqId, String(quantity), join the BOQ header for title/version/status) or serve boq_lines in the gateway shape from the sync SQL. Add W18b to the permanent suite.


**Verified fix:** Choose one wire shape and test it against the real handler. Either map in boq-local.ts (boq_id -> boqId, String(quantity/rate/amount), and join the BOQ header from the remembered hint or the 'boqs' kind for title/version/status), or add the mapping once at storePage/toStoredRow for known kinds. Add a test that feeds the real key set (activity_id, amount, boq_id, ... ) through loadBoqFromReplica, and make optimistic patches use the server's snake_case keys.

---

## [MINOR] wire-conformance:F11  src/lib/task-errors.ts  (task-errors.ts:514-526 (SERVER_CODE_ALIASES / asTaskErrorCode); outbox.ts:204-213 (rejectionMessage); backend handler.ts:613-615, 626-628)

**Issue:** None of the codes the push SQL/handler send for permanent refusals is known to the client's dictionary, so every one of them reads 'The server did not accept it.'


**Scenario:** A viewer edits something: ROLE_TOO_LOW; a project the person lost: PROJECT_NOT_READABLE; a registry change: FUNCTION_NOT_ALLOWED; the person is told nothing useful and the edit is undone.


**Evidence:** Harness W21: ROLE_TOO_LOW, FUNCTION_NOT_ALLOWED, PROJECT_NOT_READABLE, OP_ID_REUSED, BAD_OP, CAP_DAY all produce the generic sentence.


**Suggested fix:** Add sentences/aliases for the six codes (and for failed codes PREVIOUS_OP_BLOCKED, IN_PROGRESS, RATE_LIMITED if ever shown).


---

## [MINOR] wire-conformance:F13  supabase/functions/projexa-sync/handler.ts  (handler.ts:422 (RELEASE_RE ^YYYY.MM.DD-NNN$), 460 (gate only when the client's release matches it), 454-463; drizzle/0680:45,138; docs/local-first/CONTRACT.md line 16 (example 2026.10.02-3); client __fixtures__/fake-sync-server.ts:402,425; shared-client.ts:12-14 (falls back to a 40-hex commit SHA))

**Issue:** The contract's own example and the client fake use a 1-digit build number ('-3'); the backend requires '-NNN'. A build numbered like the example cannot be registered (AW400 BAD_MANIFEST) and a client on such a number, or on the SHA fallback, is never blocked by min_compatible (the gate fails open).


**Scenario:** make-release produces 2026.10.03-3 following the contract: /release/register refuses it; a laptop on 2026.09.30-1 keeps syncing below the floor.


**Evidence:** Harness W28b: register '2026.10.03-3' -> AW400 BAD_MANIFEST; client '2026.09.30-1' with a floor of 2026.10.01-001 ALLOWED to sync. W28 (correct 'YYYY.MM.DD-NNN') passes: 426 body maps to update {current, minCompatible}.


**Suggested fix:** Fix CONTRACT.md and the fake to '-NNN' (or relax the regex and compare numerically); decide explicitly that non-matching releases (dev, SHA) are exempt.


---

## [MINOR] wire-conformance:F15  docs/local-first/CONTRACT.md  (CONTRACT.md section 4 (attest token '10 minutes'), section 1 changes ('Only the 13 synced kinds'), section 2 (no record_kind, no 64 KB op ceiling), section 1 ids ('ids:[<=200]'); backend sign.ts:20 (ATTEST_TTL_SECONDS = 86_400), handler.ts:53-57 (28 kinds))

**Issue:** The contract says 'when the two disagree this file wins and the loser is a bug', but it has drifted from the code: attest lifetime is 24 h in the backend, 28 kinds not 13 (and organisation kinds are being added in the backend working tree), record_kind and the per-op ceiling are undocumented, and the ids/4 KB mismatch (F03) is a contract-level conflict.


**Scenario:** The peer-sync work package builds token-expiry handling against '10 minutes'; the laptop and the backend then disagree about when a peer statement expires.


**Evidence:** Harness W29: attest exp - iat = 86400 s (contract: 600).


**Suggested fix:** Update CONTRACT.md to the implemented values (decide whether 24 h is intended: it is by design in sign.ts), and add record_kind, per-op size, body caps and the CORS header list.


---
