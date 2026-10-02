# Client review findings assigned to package FB: Outbox, conflicts and write safety (including the automatic merge, R12)

Source: independent adversarial review of the laptop client (feat/lf-client-core) run against the REAL backend, three lenses, every finding re-verified. 19 findings, blocker > major > minor. Keys are `lens:id`; where two findings describe the same defect fix it once and say so. Paths in the findings refer to the reviewer's checkout (C:\ct\pxa-sync is the projexa repo, C:\ct\ct-aibridge the backend); the same files exist in your clones.

## [MAJOR] data-safety:F3  src/components/ScheduleTaskObjectClient.tsx  (114-122 (patch builder), 90 (values = whole task); local-writes.ts:155; src\lib\pipeline\executors\schedule.ts:188-192)

**Issue:** The local task save always sends completionPercentage (values is a copy of the whole task, so it is always defined), but executeUpdateTask refuses any completionPercentage on a task linked to a BOQ line (checkNamedRecords: badRequest 'progress_is_derived' -> REQUEST_REJECTED -> status 'rejected'). The old online route PATCH /v1/projexa/schedule/[id] passes completionPercentage straight to updateIssue (route.ts:57; the service only checks 0..100), so this is a new refusal.


**Scenario:** Person changes only the title (or due date) of a BOQ-linked task. Screen toasts 'Task saved on this laptop'. Server rejects the whole op, the laptop undoes the edit and shows 'Your change to this task was not saved. That was not accepted as entered - check the values and try again.' Trying again sends the same completionPercentage and is refused again, forever; the typed edit is gone each time.


**Evidence:** Backend's own test coverage-wave6.test.ts:499-504: update_task {issueId, completionPercentage:50} on a linked task is refused, {issueId, dueDate} alone succeeds. Probe S8 shows the wire params carry completionPercentage:40 with a title-only edit.


**Suggested fix:** Send only the fields the person actually changed (diff against the loaded task), never the whole form.


**Verified fix:** In handleSave, diff against the loaded task and send only changed fields (title, description, priority, statusId, dates, and completionPercentage only if the person edited it). Disable or hide the % Complete input when the task is BOQ-linked. As a defence, make updateTaskLocally return null (online path) when the patch contains completionPercentage.

---

## [MAJOR] data-safety:F4  src/lib/local-first/outbox.ts  (204-213 (rejectionMessage), 341-352 (rejectOp), 742-753 (discard); RfiCreateClient.tsx:31; RfiObjectClient.tsx:55-60; ScheduleTaskObjectClient.tsx:122-127)

**Issue:** Every permanent refusal deletes the only copy of what the person typed, with no way to get it back and a notice that says 'check the values and try again'. The pipeline path that /push uses applies the AI-link text rules (ai-link-text.ts:92-95: more than 2000 cleaned characters is refused, control chars stripped, backtick runs rewritten), the registry's min_role_rank 2, and status/ownership rules; the three forms have no maxLength and no role check. The old online paths showed the error inline and kept the text (RfiObjectClient.tsx:61-73 clears answerText only after success).


**Scenario:** A 2,500-character RFI question or answer (no limit existed on the old route: construction-field-workflow-service.ts has none) is accepted locally ('Answer saved on this laptop'), sent later, refused (REQUEST_REJECTED/TEXT_TOO_LONG), undone. Probe S7: typed text found nowhere in the local database afterwards; the notice names neither the field nor the 2000 limit. Same loss for a role below rank 2, a needs_server op (only 'Discard' is offered, OutboxAttention.tsx:112-117), and 'Keep theirs'.


**Evidence:** Probe s2.ts S7; registry text_params/min_role_rank; grep: no maxLength in the three components.


**Suggested fix:** Validate the registry limits (2000 chars, role rank) before enqueue and fall back to the online path with the text kept; keep rejected params in the notice (shown with a Copy/Re-open button) instead of dropping them.


**Verified fix:** Validate before enqueue in local-writes.ts: run the same clean/length rule (2000 cleaned characters on any free-text param) and return null so the existing online path runs and keeps the text. On any 'rejected' result, keep the op's free-text params in the notice (or a rejected-drafts meta list) and show a Copy or Re-open action until dismissed. Map TEXT_TOO_LONG, ROLE_TOO_LOW, FUNCTION_NOT_ALLOWED and PROJECT_NOT_READABLE to specific sentences.

---

## [MAJOR] data-safety:F6  src/lib/local-first/outbox.ts  (418-421, 582-585 (CONFLICT_WITHOUT_ROW), 475-484, 255-273; local-db.ts:466-470; backend handler.ts:566-572,631-637; 0679_projexa_record_versions.sql:134-147,335-339; 0681_projexa_sync_push.sql:166-172)

**Issue:** When the row an op edits was deleted by someone else, the real backend answers status 'conflict' with server:null (the delete bumps the head version, so v_cur > base_version; pull_ids reads the live table, so signedRow returns null). settleConflict returns false for a conflict with no row and the op is settled as 'failed CONFLICT_WITHOUT_ROW' and retried every <=5 minutes forever. It is invisible (loadState only lists conflicts that carry conflictServer; the dirty row's serverCopy.deleted flag is never read by any UI), it holds every later edit of that row behind it, and it keeps the whole workspace copy on disk at every sign-out.


**Scenario:** Person A edits task/RFI T offline; person B deletes T; A reconnects: tombstone parks serverCopy.deleted=true on the dirty row, push answers conflict/server null. Probe S2 after 4 flushes: op status pending, attempts 4, lastError CONFLICT_WITHOUT_ROW, no conflict/notice/blocked in the state the UI reads (conflicts 0, notices 0, status idle), a second edit of the same row is queued behind it, and sign-out returns pending:2, wiped:false, notice 'Nothing is lost: sign in again to finish syncing them' (syncing can never finish).


**Evidence:** Probe s1.ts S2 (conflict answer shaped exactly like handler.ts:635 with server absent); the fake server cannot produce this because it rejects RECORD_NOT_FOUND for a deleted target.


**Suggested fix:** Treat a conflict without a row as 'the record is gone': drop the op, undo the optimistic row and tell the person (keep their text, F4); add a max-attempts escape that surfaces any op stuck >N tries.


**Verified fix:** Client: in the conflict case with no server row (or when the dirty row's serverCopy.deleted is true), settle it as 'record removed': rejectOp with a clear message ('This record was deleted by someone else'), keep the person's text (see F4), and let the row disappear. Server: have push answer with an explicit {server:null, deleted:true} (or a 'rejected' RECORD_NOT_FOUND) so the client does not have to infer it. Also add a max-attempts escape that surfaces any op stuck on the same non-network error (F7).

---

## [MAJOR] data-safety:F7  src/lib/local-first/outbox.ts  (540-557 (catch: everything else -> settleFailed + status 'idle'), 593-595; sync-client.ts:364-384; OutboxAttention.tsx:83-93; backend 0681:144-153)

**Issue:** Several states can never end and are never shown: (a) a ledger row left 'running' (exec call died between push_begin and push_finish) turns 'uncertain' after 10 minutes and push_begin answers retry EXECUTION_UNCERTAIN forever by design ('never re-run blindly'); (b) a whole-request refusal (403 NOT_LINKED, 404, 409, 413) is mapped by the client to bad_response/not_found and handled as 'try again later' for every op in the batch. The card only speaks for offline/signed_out/update_required, so the person sees 'Saved on this laptop, syncing' indefinitely, and the database is never wiped at sign-out.


**Scenario:** Probe S3: after 12 retries of EXECUTION_UNCERTAIN the op is still pending, attempts 12, UI conflicts 0 / blocked 0 / notices 0 / status idle. Probe S6: with the server answering 403, 404 or 409 for the whole push, flush reports failed:1, status 'idle', remaining 1, notices 0. One such op means the person's entire workspace copy (all projects' rows, kept because pending>0) stays on the laptop after sign-out.


**Evidence:** Probes s1.ts S3 and s6.ts; handler.ts:610 returns begin.status for the whole batch.


**Suggested fix:** After N attempts or on a non-retriable status, move the op to a visible 'needs attention' state with Discard / Retry-as-new-op; at sign-out keep only the outbox and dirty rows, wipe the rest.


**Verified fix:** Add a visible 'needs attention' state to loadState/OutboxAttention for any op with attempts >= N (for example 5) and the same non-network lastError (EXECUTION_UNCERTAIN, NO_RESULT, bad_response/403), with Retry and Discard (copying the text) actions. Map a whole-batch 403 NOT_LINKED to a signed-out-like state with its own sentence. Server: give 'uncertain' a resolution (after the 10-minute window, return rejected/EXECUTION_UNCERTAIN so the client undoes the op and says 'check whether it was saved'). At sign-out, wipe everything except the outbox and dirty rows, and do not promise that syncing will finish.

---

## [MAJOR] wire-conformance:F06  src/lib/local-first/outbox.ts  (outbox.ts:418-430 (settleConflict returns false when result.server is missing, line 420), 582-585 (-> settleFailed 'CONFLICT_WITHOUT_ROW', retried for ever); backend handler.ts:631-636 (server is null when the row is gone), test src/lib/services/projexa-sync-push.pglite.test.ts:242-249)

**Issue:** When the record was DELETED on the server after the laptop edited it, the backend answers `conflict` with server:null (and its own test asserts it). The client only understands a conflict that carries a server row, so the op is retried every <= 5 min for ever with no conflict card and no notice.


**Scenario:** Person A edits task T offline; person B deletes T; A's laptop reconnects: the op never settles, the optimistic row stays, pending never reaches 0 (sign-out keeps the whole workspace, see F05).


**Evidence:** Harness W20: after 3 passes pending 1, conflicts 0, notices 0, op {status:'pending', attempts:3, lastError:'CONFLICT_WITHOUT_ROW'}.


**Suggested fix:** In settleConflict treat server:null as 'deleted on the server': rejectOp-style (drop op, revertRow deletes the local row) with a plain notice ('This task was deleted by someone else, your change was not saved'). Add the case to outbox.test.ts using the real shape.


**Verified fix:** In settleConflict (or the case 'conflict' branch) treat server === null as deleted on the server: call rejectOp(db, op, '<label> was not saved: it was deleted by someone else. It was undone on this laptop.'), which drops the op and revertRow deletes the local row. Add the real shape (conflict with server: null) to outbox.test.ts, and a case to the fake server.

---

## [MINOR] cost-and-quality:COST-07  src/lib/local-first/outbox.ts  (540-556)

**Issue:** Any push failure that is not 401/426/abort (including permanent 400/403/413 -> bad_response, and 404) is treated as transient: the op is retried every 5 minutes forever and the status stays 'idle', so OutboxAttention says nothing.


**Scenario:** A person whose sign-in is not linked (403 NOT_LINKED) or whose role changed keeps 1 request per 5 minutes per laptop indefinitely with edits silently unsent.


**Evidence:** cost.test.ts: 403 on /push for 2 simulated hours = 31 flushes, 31 requests, status idle, remaining 1.


**Suggested fix:** Cap attempts for bad_response (e.g. 3), then mark the op blocked with a plain-words notice. Optional: skip scheduled flushes while navigator.onLine is false (saves no server cost, saves noise).


---

## [MINOR] cost-and-quality:COST-08  src/lib/local-first/outbox.ts  (189-196 (toWire) vs C:/ct/ct-aibridge/supabase/functions/projexa-sync/handler.ts:626,687-697 and index.ts:59-84)

**Issue:** The server derives the record kind for creates from an 'op.record_kind' hint the client never sends (no match in the client repo, absent from CONTRACT.md). So an applied create comes back with no row and no version, the client spends a second request (pull by ids) to fetch it. Separately each pushed op costs a second Edge invocation (projexa-sync calls ai-work-link-exec once per op), so a 50-op batch is 51 invocations.


**Scenario:** Person creates an RFI: 1 push + 1 pull(ids) on the client side and 2 invocations of projexa-sync + 1 of ai-work-link-exec on the server side.


**Evidence:** cost.test.ts: create_rfi = {"/push":1,"/pull(ids)":1}. grep record_kind in C:/ct/pxa-sync/src = 0 matches.


**Suggested fix:** Send record_kind for creates (or let the server read it from the function registry) so the answer carries the row; let sync-run accept the whole ops array (one exec invocation per batch).


---

## [MINOR] cost-and-quality:TEST-13  src/lib/local-first/outbox.test.ts  (499-510)

**Issue:** The cost-bounding defaults are untested: the back-off ceiling test injects backoffBaseMs 1000 / backoffMaxMs 5000, so the production default (2 s doubling to 5 min) can change silently. Same for sync-client defaults: maxRetries 3 (C5), Retry-After cap 30 s (C3), push timeout >= 60 s (C4), and non-OK 400/403/413 being non-retryable (C1) all survive mutation.


**Scenario:** Default ceiling edited from 5 min to 5 s: 12x more requests during every outage, suite green.


**Evidence:** Mutations O1 (43 pass 0 fail), C1, C3, C4, C5 (30 pass 0 fail each). T3 (default options, 14 failures: waits 2000,4000,8000,16000 ... 300000) passes on real code, fails on O1.


**Suggested fix:** Add T3 and one client test per default (403 is not retried, calls == 1).


---

## [MINOR] cost-and-quality:TEST-15  src/lib/local-first/outbox-shared.ts  (31-61 (also replica-shared.ts, shared-client.ts))

**Issue:** The production wiring is not tested at all: both component suites replace outbox-shared with a stub, and no test imports replica-shared or shared-client. The 'online' listener (the only auto-trigger after a reload), the per-person memo, the retry/timeout settings (maxRetries 1 and 2) and releaseSharedOutbox are unguarded. Also three existing tests (replica-versions 243-270, 272-281, 423-436) pin the wasteful reconcile/pull behaviour and must change when COST-03 lands. Several tests wait real time (outbox.test.ts 685, 726, 737; OutboxAttention.test.tsx 51, 55) and may false-pass or flake on this low-RAM laptop (not run under load).


**Scenario:** Delete window.addEventListener('online', handler): no test fails.


**Evidence:** grep: outbox-shared/shared-client/replica-shared appear in tests only as mock.module targets. Prototype run: 3 failures listed.


**Suggested fix:** Test outbox-shared with fake window events and the fake server; replace fixed sleeps with polling on a condition.


---

## [MINOR] data-safety:F10  src/lib/local-first/outbox.ts  (310-333 (revertRow with later ops), 255-262 (conflict 'local' = row.data))

**Issue:** When edit A is rejected while a later edit B of the same row is still pending, revertRow rewrites the row to the server copy (dropping B's visible effect) but leaves it dirty for B. Until B settles the laptop shows neither edit, and if B then conflicts the card's 'you wrote' comparison is computed from the reverted row.


**Scenario:** Probe S6b: A (title) rejected, B (description) pending: row.data = {title:'Old', description:'d0'} while dirty='op-2' and B's params still queued.


**Evidence:** Probe s3.ts S6b.


**Suggested fix:** Re-apply the remaining ops' effects after reverting (or re-derive the row from serverCopy + pending ops' params).


---

## [MINOR] data-safety:F12  src/lib/local-first/local-writes.ts  (58-72 (editableRow), 150-157; ScheduleTaskObjectClient.tsx:88-90,111-135)

**Issue:** baseVersion is read from the laptop's row at SAVE time, while the form's values come from the online GET at LOAD time. If the laptop copy was refreshed in between (another tab's BOQ revalidation applies the whole project change feed), the stale full-form patch is sent with the newer version, the server sees no conflict, and the other person's newer field values are silently overwritten.


**Scenario:** Tab 1 opens the task (server v5, form holds v5 values); Tab 2's BOQ screen revalidation pulls the change feed and stores v6 in the local row; Tab 1 saves a title edit: baseVersion 6 -> no conflict, patch also carries the old statusId/dates/completion and reverts the v6 change.


**Evidence:** Code reading; not executed.


**Suggested fix:** Capture the version with the loaded data (the row's version when the form opened) and use it as baseVersion; send only changed fields (F3).


---

## [MINOR] data-safety:F13  src/lib/local-first/outbox.ts  (all of local-db.ts openLocalDb / outbox.ts enqueue)

**Issue:** Pending edits live in best-effort IndexedDB and navigator.storage.persist() is never requested, so under storage pressure (or a Safari-style idle-site purge) the browser may delete the outbox and every unsynced edit with no signal.


**Scenario:** Laptop offline for days with queued edits; the browser evicts the origin's storage; the edits and their ops are gone without any message.


**Evidence:** grep for storage.persist / navigator.storage in C:\ct\pxa-sync\src returns nothing.


**Suggested fix:** Call navigator.storage.persist() when the first op is queued and warn if it is refused.


---

## [MINOR] data-safety:F2  src/lib/local-first/sign-out.ts  (114-144, 168-173; outbox.ts:341-352 (rejectOp/addNotice); callers AccountMenu.tsx:52, AppTopbar.tsx:78, SettingsClient.tsx:172, M24Shell.tsx:1145)

**Issue:** An offline edit that the server REJECTS during the sign-out flush is silently destroyed together with its explanation. The flush runs rejectOp, which undoes the row and stores the 'was not saved' notice in the database's meta store; pending is then 0, so the database (notice included) is deleted and finishLocalWorkspaceOnSignOut returns notice:null, which all call sites treat as 'nothing to say'.


**Scenario:** Person edits a task offline, reconnects only to sign out (or signs out right after the edit). The sign-out flush sends it; the server answers rejected (e.g. REQUEST_REJECTED, role, text too long, F3/F4). Probe S1 result: {"pending":0,"wiped":true,"notice":null}, databases left: [], while outbox.getState().notices held 'Your change to this task was not saved ... It was undone on this laptop.' (never shown). The person leaves believing the edit was saved.


**Evidence:** Probe s1.ts S1 (real outbox + sign-out code, fake server with every op rejected).


**Suggested fix:** Make sign-out count undismissed notices (and rejected ops of this flush) as 'something to tell': return them in SignOutLocalResult.notice (or keep the database until the notices are dismissed), and show the rejected edit's text.


**Verified fix:** In finishLocalWorkspaceOnSignOut, before deleting each database, read OUTBOX_NOTICES_KEY (and collect the rejected messages from this flush, e.g. via outbox.subscribe 'rejected' during the flush). Return them in result.notice and show them in the toast, then wipe. The text goes to the toast, not to disk, so the privacy rule still holds.

---

## [MINOR] data-safety:F5  src/components/ScheduleTaskObjectClient.tsx  (86-91 (load() calls setValues(data)), 105 (onApplied -> load), use-local-writes.ts:79-82, outbox.ts:414)

**Issue:** An outbox 'applied' event for ANY task of the project re-runs load(), and load() overwrites the open edit form (setValues(data)) with the server's data while mode stays 'edit'. The person's in-progress typing is replaced without a message.


**Scenario:** Person saves a task (op flushes within ~1-3 s) and immediately presses Edit again to fix something, or edits task B while an earlier offline edit of task A is flushed after the connection returns: the 'applied' event for tasks in this project fires, load() resets values to the server row, the text typed since is gone. RfiObjectClient is not affected (answerText is separate state).


**Evidence:** Code path read end to end: useLocalWrites subscribe fires onApplied when event.type==='applied' && projectId && kind match; load() line 90. Not executed in a browser/React render.


**Suggested fix:** Do not reset values in load() while mode==='edit' (or compare version), and scope onApplied to this task's id.


**Verified fix:** In load(), do not setValues when mode === 'edit' (track mode in a ref), or only refresh when data.version/updatedAt differs from the form's base. Scope onApplied to event.recordId === taskId.

---

## [MINOR] data-safety:F8  src/lib/local-first/outbox.ts  (708-728 (resolve keep_theirs uses op.conflictServer), 413 ; local-db.ts:244-258 (parkServerRow))

**Issue:** keep_theirs puts back the conflict snapshot stored when the conflict was first seen, and discards a NEWER server row that a later pull parked in serverCopy. The row is then clean at the older version and the change feed no longer re-announces the newer one.


**Scenario:** Probe S4: conflict against v2; someone saves v3; replica sync parks v3 (serverCopy.version 3); person clicks 'Keep theirs'. Row becomes 'theirs v2', serverVersion 2, clean, while the server head is v3 'theirs v3 (newest)'; a further sync does not repair it. The person reads an outdated 'server' value as current; their next edit based on v2 conflicts again.


**Evidence:** Probe s2.ts S4 output: 'after keep_theirs + another sync: row title = theirs v2 | serverVersion 2 | server head is v 3'.


**Suggested fix:** On keep_theirs/keep_mine use max(conflictServer, row.serverCopy) by version, or simply refetch the row by id after resolving.


---

## [MINOR] data-safety:F9  src/lib/local-first/local-db.ts  (21-24 (header claim), 426-455, 456-480, 481-488; replica.ts:391-412)

**Issue:** The dirty-row rule is opt-in, not 'enforced on its own so no caller can forget it': putRecords/deleteRecords only protect a dirty row when the caller passes {fromServer:true}; deleteByProject never protects one. Any future writer (the peer path the contract describes, a repair tool) that forgets the flag silently overwrites or deletes a pending edit while its op stays queued. Also replica.run deletes a project's rows (dirty included) and the outbox then rejects the ops client-side as 'no access' (outbox.ts:500-510) without asking the server, which itself already enforces PROJECT_NOT_READABLE.


**Scenario:** Probe S5: with a pending edit, db.putRecords([{...same id...}]) (no options) replaced the row and cleared dirty with the op still pending; db.deleteRecords(['tasks:t1']) removed the row with the op still pending; a manifest that stops listing p1 deleted the dirty row and the next flush rejected the op with 'you no longer have access' without any push.


**Evidence:** Probe s2.ts S5.


**Suggested fix:** Make dirty protection the default (opt out with an explicit {local:true} used only by the outbox), make deleteByProject skip dirty rows, and let the server decide an op's fate.


---

## [MINOR] wire-conformance:F10  src/lib/local-first/outbox.ts  (outbox.ts:189-196 (toWire never sends record_kind), settleApplied 360-376 (create branch); backend handler.ts:598, 659, 668; docs/local-first/CONTRACT.md section 2 (op shape has no record_kind))

**Issue:** The handler names the kind a CREATE produced from op.record_kind (its own push test: 'a create names the kind it made through record_kind'); the client does not send it and the contract does not define it. A create is answered applied with version:null and no server row, so the client needs a second request to settle it.


**Scenario:** create_rfi: the temp row is deleted in the same IndexedDB transaction, the real row only appears after a best-effort pullIds; if that request fails (network blip right after the save) the new RFI is absent from the laptop until the next sync. The duplicate replay of a create also carries version:null.


**Evidence:** Harness W16: wire op keys client_at,function_id,op_id,params,project_id (no record_kind), 1 extra /pull needed. W16b: refetch dropped -> temp row false, real row false (RFI vanished).


**Suggested fix:** Send record_kind: op.creates.kind in toWire and add it to CONTRACT.md section 2; then the answer carries id + version + signed row and settleApplied needs no refetch.


---

## [MINOR] wire-conformance:F12  src/lib/local-first/outbox.ts  (outbox.ts:123-143 (maxBatchBytes 256 KB), 518-532 (too-large check); backend 0681:101 (length(p_op::text) > 65536 -> BAD_OP))

**Issue:** The backend refuses any single op above 64 KB (an undocumented per-op ceiling); the client only guards the 256 KB request size.


**Scenario:** A 70 KB description in update_task is sent, refused BAD_OP, undone with the generic sentence instead of 'too large'.


**Evidence:** Harness W24: 1 push sent, rejected 1, notice 'Your change to this task was not saved. The server did not accept it.'


**Suggested fix:** Check each op against 64 KB in the client (same 'too large to send' branch) and document the ceiling in CONTRACT.md.


---

## [MINOR] wire-conformance:F14  supabase/functions/projexa-sync/handler.ts  (handler.ts:197-209 (callSql: any non-ok person -> 403 {code:'NOT_LINKED'}); client sync-client.ts:376-377 (403 -> bad_response), outbox.ts:552-555 (anything else -> settleFailed + back-off))

**Issue:** A person who no longer resolves (deactivated, ambiguous, unlinked) gets 403 for the whole batch; the client reports it as a generic bad_response and the outbox retries silently for ever.


**Scenario:** A person is deactivated while edits wait on their laptop: no message, the edits and the org data stay on the laptop indefinitely (sign-out cannot wipe it because ops are pending).


**Evidence:** Harness W10: manifest for an unlinked sub -> kind bad_response, status 403. W32: after 3 passes push answered 403, outbox status idle, notices 0, op pending attempts 3 lastError bad_response.


**Suggested fix:** Map 403 NOT_LINKED to a dedicated SyncErrorKind that stops sync/outbox and tells the person; decide what the laptop does with pending ops and the local copy (owner rule: tenant isolation).


---
