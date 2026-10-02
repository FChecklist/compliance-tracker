# Client review findings assigned to package BACKEND: Backend-owned (already assigned to packages D1-D3; shown for completeness)

Source: independent adversarial review of the laptop client (feat/lf-client-core) run against the REAL backend, three lenses, every finding re-verified. 4 findings, blocker > major > minor. Keys are `lens:id`; where two findings describe the same defect fix it once and say so. Paths in the findings refer to the reviewer's checkout (C:\ct\pxa-sync is the projexa repo, C:\ct\ct-aibridge the backend); the same files exist in your clones.

## [BLOCKER] cost-and-quality:COST-01  supabase/functions/projexa-sync/handler.ts  (124-130 (corsHeaders) vs C:/ct/pxa-sync/src/lib/local-first/sync-client.ts:356)

**Issue:** The real server's CORS preflight allows only 'authorization, content-type'; the client sends 'X-Px-Client' on EVERY call. A browser blocks the call at preflight, so every sync and push from projexa-ai.com fails as a 'network' error. The server also sends no Access-Control-Expose-Headers, so a browser cannot read 'Retry-After' (the client's 30 s wait is dead code in a browser; it falls back to 0.5/1 s retries).


**Scenario:** Person opens PROJEXA, replica.sync() -> manifest: preflight OPTIONS (Origin https://projexa-ai.com, Access-Control-Request-Headers authorization,content-type,x-px-client) is answered 204 with allow-headers 'authorization, content-type' -> browser refuses the real request -> SyncError network, 3 attempts, run ends 'error'. Every outbox push the same: edits stay offline forever. No unit test can see this: the fake takes a fetchImpl and never models CORS.


**Evidence:** realcors.ts against the real handler printed for /manifest,/pull,/changes,/ids,/push: '204 allow-origin: https://projexa-ai.com | allow-headers: authorization, content-type | max-age: 600'. handler.ts has no 'expose' header. NOTE: this bug currently SHIELDS flag-off users from COST-02; fix it only together with the flag gate.


**Suggested fix:** Backend: add x-px-client to Access-Control-Allow-Headers, add Access-Control-Expose-Headers: Retry-After, raise Access-Control-Max-Age to 7200 (cuts preflight invocations 12x; each distinct URL is preflighted separately and every OPTIONS is an Edge invocation). Add a backend test: OPTIONS with every header listed in CONTRACT.md section 0 must be allowed. Client repo: a test asserting the exact set of non-safelisted headers sync-client sends (authorization, content-type, x-px-client) so a new header cannot be added silently.


**Verified fix:** handler.ts corsHeaders: 'Access-Control-Allow-Headers': 'authorization, content-type, x-px-client'; add 'Access-Control-Expose-Headers': 'Retry-After'; 'Access-Control-Max-Age': '7200' (Chrome's cap). respond() already merges corsHeaders into every response, so the expose header lands on 429s. Add a backend test that sends OPTIONS with every header the client sends and asserts each is allowed. Add a client test that pins the set of non-safelisted request headers. Ship together with the COST-02 gate and the COST-03/04 reductions, not before.

---

## [BLOCKER] wire-conformance:F02  supabase/functions/projexa-sync/handler.ts  (handler.ts:123-125 (corsHeaders: Access-Control-Allow-Headers 'authorization, content-type', no Expose-Headers); client sync-client.ts:351-357 (sends X-Px-Client on every call), SYNC_BASE_URL line 26 (cross-origin supabase.co))

**Issue:** The CORS preflight answer does not allow the X-Px-Client header the client sends on every request, so a browser blocks every call (manifest included). Retry-After is also not exposed, so the client can never read it cross-origin.


**Scenario:** projexa-ai.com (or localhost:3100) calls https://<ref>.supabase.co/functions/v1/projexa-sync/manifest with Authorization + X-Px-Client: the browser sends OPTIONS with Access-Control-Request-Headers: authorization,x-px-client; the handler answers 204 with Allow-Headers 'authorization, content-type'; the browser fails the request ('Request header field x-px-client is not allowed'). No sync, no push, no update gate. The in-process harness cannot hit this (no preflight) and no backend test asserts it.


**Evidence:** Harness W27: client really sends authorization,content-type,x-px-client; OPTIONS with exactly those -> Allow-Headers 'authorization,content-type' -> x-px-client missing (allow-origin itself is correct for https://projexa-ai.com). W27b: a 429 carries Retry-After: 60 but no Access-Control-Expose-Headers.


**Suggested fix:** Allow-Headers: 'authorization, content-type, x-px-client'; add Access-Control-Expose-Headers: 'Retry-After'. Add a preflight assertion built from the headers the real client sends (W27 is that test).


**Verified fix:** handler.ts:127: Allow-Headers 'authorization, content-type, x-px-client'; add 'Access-Control-Expose-Headers': 'Retry-After'. Add a handler test that builds the OPTIONS Access-Control-Request-Headers from the exact header names the real client sends and asserts each is allowed.

---

## [MAJOR] wire-conformance:F04  supabase/functions/projexa-sync/handler.ts  (handler.ts:559-561 (NEEDS_SERVER_CODES / TRANSIENT_CODES), 672-678 (failed -> rejected unless listed); pipeline src/lib/pipeline/error-codes.ts:403-406 (RETRYABLE_ERROR_CODES = BACKEND_UNAVAILABLE, UPSTREAM_TIMEOUT); client outbox.ts:586-588 + rejectOp 341-352)

**Issue:** The handler's TRANSIENT_CODES omits the two codes the pipeline itself defines as retryable (BACKEND_UNAVAILABLE = connection/pool timeout, UPSTREAM_TIMEOUT = statement_timeout). A transient DB failure on the exec path is therefore answered `rejected` (permanent), stored as rejected in the ledger, and the client drops the op and UNDOES the person's edit.


**Scenario:** The live DB pool is saturated or a query hits the 25 s statement timeout while a laptop pushes an edit: exec returns {status:'failed', code:'BACKEND_UNAVAILABLE'}; the person's change is reverted on the laptop with a 'not saved' notice although nothing was wrong with it; replaying the same op_id answers rejected forever.


**Evidence:** Harness W31: nextScript {kind:'failed', code:'BACKEND_UNAVAILABLE'} and then 'UPSTREAM_TIMEOUT' -> ledger status 'rejected', report.rejected 1, op no longer queued, local edit reverted (editKept false) for both codes.


**Suggested fix:** Add BACKEND_UNAVAILABLE and UPSTREAM_TIMEOUT (ideally import RETRYABLE_ERROR_CODES) to TRANSIENT_CODES so they become `failed` and are retried with the same op_id; add a handler test per retryable code.


**Verified fix:** Add BACKEND_UNAVAILABLE and UPSTREAM_TIMEOUT to TRANSIENT_CODES, ideally by importing RETRYABLE_ERROR_CODES. UPSTREAM_TIMEOUT (statement cancelled, transaction rolled back) is unambiguous. For BACKEND_UNAVAILABLE the only theoretical double effect is a connection cut after COMMIT; edits are protected by the base_version check (the re-run answers conflict), only creates are exposed, the same exposure INTERNAL_ERROR already has. Add a handler test per retryable code.

---

## [MAJOR] wire-conformance:F05  drizzle/0681_projexa_sync_push.sql  (0681:144-146 (uncertain -> retry EXECUTION_UNCERTAIN, always), 147-152 (running > 10 min -> uncertain); handler.ts:662-667, 686-689; client outbox.ts:593-596 (failed -> settleFailed, back-off capped at 5 min, forever), eligible() 475-484 (an earlier op holds back every later op on the same row); sign-out.ts:2-9)

**Issue:** An op whose outcome was 'uncertain' (exec call timed out after 25 s, exec answered 5xx/other, the finish RPC failed, or a running ledger row aged 10 min) is answered `failed EXECUTION_UNCERTAIN` on EVERY re-send, never re-run and never resolved to applied/duplicate/rejected. The contract promises the opposite ('failed ... keep the op, retry with the same op_id after a back-off; the ledger guarantees at most one effect'). The client cannot leave the state: no attempt limit, no notice, discard() only works for 'blocked'.


**Scenario:** One Edge hiccup on the exec call -> the op stays pending for ever (attempts grow every 5 min), the row stays dirty, every later edit of that row on this laptop waits behind it, and sign-out can never wipe the workspace ('nothing pending' is never true), contradicting the owner's privacy rule in sign-out.ts header.


**Evidence:** Harness W22: pipeline connection lost once; 6 flush passes = 6 /push requests, pipeline reached once, ledger {status:'uncertain', error_code:'EXECUTION_UNCERTAIN'}, client op {status:'pending', attempts:6, lastError:'EXECUTION_UNCERTAIN'}, notices 0.


**Suggested fix:** Give the state an exit. Client: after N (e.g. 3) EXECUTION_UNCERTAIN answers, re-read the record (pullIds) and either mark the op applied (version moved past base_version and content matches) or surface it as a decision card ('did this save? Retry as a new change / Discard'); a retry as a NEW op_id with the original base_version is safe for edits (conflict if it did apply). Server: resolve 'uncertain' by comparing projexa_record_head.version with base_version (applied_version) instead of answering the same code for ever.


**Verified fix:** Server: resolve uncertain instead of repeating it. The run note carries the op id ('[ai-link <link> intent <op_id>]', link-exec-entry.ts:101), so push_begin can look for a completed submission with that note and answer duplicate/applied, or, for edits, compare projexa_record_head.version with base_version; if neither shows an effect, set the row to failed so it can run again. Client: after N (about 3) EXECUTION_UNCERTAIN answers, stop silent retry and surface a decision card (Check again / Save again as a new change / Discard), and let discard() work for this state.

---
