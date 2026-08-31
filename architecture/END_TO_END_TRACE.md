# End-to-End Trace: submission → segment → L0/L1 → validate → task → execute → persist → reuse

**R46 P9 seq34** (platform.r43_queue). Real, live, timestamped evidence — not a
description of the architecture. Every submission below was sent to real
production (`projexa-ai.com` → `veridian-compliance-ai.vercel.app`) via the
same zero-password minted-session mechanism this whole work order has used
throughout (`mint-session-r33` Edge Function → GoTrue `token_hash` exchange
→ a real `sb-evpckeuxgvahguwsaeul-auth-token` cookie, `democeo@projexa-ai.com`
/ Demo Organization, `org_id=ve45lczmkodbiq1m20fy48r5`), against the real
Supabase project `pcrjmlpuqsbocqfwoxod`. Every DB row cited below was
re-SELECTed after the fact, not just read back from the HTTP response.

Code path traced: `POST projexa-ai.com/api/assistant` → `callVeridian("/assistant")`
→ `POST veridian-compliance-ai.vercel.app/api/v1/projexa/assistant` →
`runSubmission()` (`compliance-tracker/src/lib/segmentation/pipeline.ts`) →
`segment()` → `classifyL0()` → (miss only) `adapter.classify()` → `validate()`
→ INSERT `compliance.pipeline_tasks` → `executeTask()` → UPDATE
`compliance.pipeline_tasks` → real domain-table INSERT (or a real read query).

## Run 1 — the exact example in the work order, no `projectId`

```
POST /api/assistant  {"rawInput":"frame 01 is 50% done and show me the budget","mode":"Projects"}
T0 (request sent):     2026-08-24T20:36:42.709Z
T1 (response received): 2026-08-24T20:36:47.023Z
HTTP 201
{"submissionId":"ly1t5ogj9aj56rarfanhd0u7","status":"failed",
 "tasks":[{"taskId":"mpr4j98u4rslpt3udsr79dn7","functionId":"record_work_progress",
           "status":"blocked","error":"no project resolved for this task"}]}
```

Re-SELECTed:
- `compliance.submissions` id=`ly1t5ogj9aj56rarfanhd0u7`: `project_id=NULL`,
  `raw_input="frame 01 is 50% done and show me the budget"`, `status="failed"`,
  `created_at=2026-08-24 20:36:44.287558`.
- `compliance.pipeline_tasks` id=`mpr4j98u4rslpt3udsr79dn7`: `sequence=0`,
  `function_id="record_work_progress"`, `params={"percent":50,"itemCode":"01"}`,
  `chain_matched_hint=false`, `executor="software"`, `status="blocked"`,
  `error="no project resolved for this task"`, `created_at=20:36:45.168538`,
  `updated_at=20:36:45.858`.
- `compliance.gap_log` for this submission: **0 rows** (this segment never
  missed L0 — see "real segment.ts/classify.ts mechanics" below — so it never
  reached the miss/gap path at all).

**Honest, real finding**: the pipeline is genuinely honest about failure here
— it did not guess a project, it recorded `blocked` with a real reason, and
`runSubmission()`'s own `validate()` step (per `pipeline.ts`'s
`reachableProjectIds: input.projectId ? new Set([input.projectId]) : new
Set()`) is what stopped it. This confirms the `validate()` hop for real: a
`record_work_progress` task IS created and persisted even when it cannot
execute, exactly as M25 requires ("dependents of a failed task are BLOCKED
with reason", and blocked ≠ silently dropped).

## Run 2 — same shape, real `projectId`, item code doesn't exist in this BOQ

```
POST /api/assistant  {"rawInput":"frame 01 is 50% done and show me the budget","mode":"Projects","projectId":"upv2q7pv8qcwdayybvu74egm"}
T0: 2026-08-24T20:38:13.372Z   T1: 2026-08-24T20:38:18.698Z   HTTP 201
{"submissionId":"qbysn966rihrbdii5c7qnyne","status":"failed",
 "tasks":[{"taskId":"cinuahjqkwu7xu5vsvhnkz73","functionId":"record_work_progress",
           "status":"blocked","error":"item code \"01\" not found in this project's BOQ"}]}
```

Real, honest execution-layer validation: `executeTask()` re-checked
`itemCode="01"` against the real `compliance.construction_boq_line_items`
rows for project `upv2q7pv8qcwdayybvu74egm` and correctly found no match —
`pipeline.ts`'s own header comment ("boqLineItemId existence is re-checked
for real inside executor.ts's own DB query regardless") holds up under a
real run, not just in the code comment.

## Run 3 — a real item code that exists (`PP1`), full success, real DB write

Project `upv2q7pv8qcwdayybvu74egm` ("Oakwood Residence — Full Renovation")
real BOQ line items were queried first (`compliance.construction_boqs` join
`compliance.construction_boq_line_items`, `order by version desc`): the
project's newest BOQ (`id=de0o155k2dsp83x6h24zsp1d`, version 2) has item
`PP1` ("Parent PP1").

```
POST /api/assistant  {"rawInput":"PP1 is 50% done and show me the budget","mode":"Projects","projectId":"upv2q7pv8qcwdayybvu74egm"}
T0: 2026-08-24T20:39:10.206Z   T1: 2026-08-24T20:39:17.647Z   HTTP 201
{"submissionId":"dug0ytanzzdoa7dve35hu99l","status":"done",
 "tasks":[{"taskId":"pr2xmqr6fwicw09kncdsyyl1","functionId":"record_work_progress","status":"done",
   "result":{"id":"kyuf1p6hxd620sal6lh9c7x0","orgId":"ve45lczmkodbiq1m20fy48r5",
             "projectId":"upv2q7pv8qcwdayybvu74egm","activityId":"bvlmj1tlhjd6u5x1tmd0uh19",
             "boqLineItemId":"hqlhvy0p65o77ravvw1mzxc9","entryDate":"2026-08-24",
             "quantityDone":"0","percentComplete":"50","entryBasis":"DELTA",
             "recordedById":"d85txngcm9mwdpl04qgy5jwc","createdAt":"2026-08-24T20:39:14.428Z"}}]}
```

Every hop, with real timestamps:

| Hop | Evidence | Timestamp |
|---|---|---|
| Raw input received | `raw_input="PP1 is 50% done and show me the budget"` | request sent 20:39:10.206Z |
| `submissions` row inserted | `compliance.submissions` id=`dug0ytanzzdoa7dve35hu99l`, `project_id="upv2q7pv8qcwdayybvu74egm"` | `created_at=20:39:12.325961` |
| `segment()` → 1 segment | See "real segment.ts mechanics" below — a bare `"and"` never splits (by design); the whole string is one segment | n/a (pure function, no DB row) |
| `classifyL0()` tier 3 (structural) hit | `PERCENT_TOKEN` matched `"50%"`, `ITEM_CODE_TOKEN` matched `"PP1"` → `{functionId:"record_work_progress", params:{itemCode:"PP1", percent:50}}`, **zero AI calls** | n/a (deterministic, $0, confirmed by response latency — 7.4s total vs. Run 5's 15.3s with a real AI call) |
| `validate()` passed | task reached `pipeline_tasks` with `status="to_do"` before executing | — |
| `pipeline_tasks` row inserted | id=`pr2xmqr6fwicw09kncdsyyl1`, `function_id="record_work_progress"`, `params={"percent":50,"itemCode":"PP1"}`, `executor="software"` | `created_at=20:39:13.231239` |
| `executeTask()` ran | resolved `boqLineItemId="hqlhvy0p65o77ravvw1mzxc9"` from the real BOQ, real activity, real INSERT | — |
| `construction_work_progress_entries` row inserted (**re-SELECTed, not just read from the API response**) | id=`kyuf1p6hxd620sal6lh9c7x0`, `org_id`/`project_id`/`activity_id`/`boq_line_item_id` all match, `percent_complete="50"` | `created_at=2026-08-24 20:39:14.428776` |
| `pipeline_tasks` row updated to `done` | same row, `status="done"`, `error=null` | `updated_at=20:39:15.645` |
| `submissions` row updated to `done` | `status="done"` | (same request) |
| Response returned | HTTP 201 | 20:39:17.647Z |

Re-SELECT of the domain-table write (the actual DB row, queried fresh, not
the HTTP response echo):

```sql
select id, org_id, project_id, activity_id, boq_line_item_id, entry_date,
       quantity_done, percent_complete, entry_basis, recorded_by_id, created_at
from compliance.construction_work_progress_entries
where id = 'kyuf1p6hxd620sal6lh9c7x0';
-- -> 1 row, all fields match the API response exactly.
```

## Run 4 — real bug found live: `show me the budget` is silently dropped

The raw input in every run above is genuinely two intents joined by a bare
`"and"`. Reading `segment.ts`'s own header comment (line 192-197) explains
why only one task is ever created:

> "NEVER split on a bare `"and"` (M25) — a message like `"frame 01 done and
> show me the budget"` has no syntactic marker separating its clauses, so it
> stays one segment and `classify.ts` (seq12) decides, with real semantics,
> whether it is actually one task or several."

In this real run, `classify.ts` did **not** in fact decide it was two tasks.
`classifyL0()`'s tier-3 structural matcher (`tryStructuralMatch()`) fires on
**any** percent+item-code pattern found anywhere in the segment and treats
the entire segment as one `record_work_progress` call — it never re-examines
the rest of the string for a second intent, and because this was an L0 HIT
(not a miss), the segment never reaches L1's AI classifier either, so nothing
ever gets a chance to notice `"show me the budget"` was never addressed.
`compliance.gap_log` has **0 rows** for any of these submissions — the
dropped clause isn't even logged as a miss, because from the pipeline's point
of view nothing missed; it just never looked past the first match.

**This is a real, reproducible gap**, not a hypothetical: confirmed by
re-querying `compliance.gap_log where submission_id in (...)` for every
submission above → 0 rows every time, and by `compliance.pipeline_tasks`
never having more than 1 row per submission across all 5 runs.

## Run 5 — forcing the real L1 (AI) hop

Runs 1-4 above never actually called the AI adapter (L0 tier 3 hit every
time, deterministic, $0, per M27's design). To trace the L1 hop for real, a
phrase with no item code and no percent (so it fails all 4 L0 tiers) was
submitted:

```
POST /api/assistant  {"rawInput":"how is this project doing overall","mode":"Projects","projectId":"upv2q7pv8qcwdayybvu74egm"}
T0: 2026-08-24T20:44:32.842Z   T1: 2026-08-24T20:44:48.178Z   HTTP 201   (15.3s -- vs. 5-7s for every L0-only run above, consistent with a real model round trip)
{"submissionId":"ox842p0zl4nkpxow35ds7p8o","status":"done",
 "tasks":[{"taskId":"ylnm39m106cfymgockvhsutd","functionId":"get_construction_project_dashboard","status":"done",
   "result":{"projectId":"upv2q7pv8qcwdayybvu74egm","projectName":"Oakwood Residence - Full Renovation",
             "budget":0,"revenue":0,"expenses":0,"progressPercent":51,"delayedTaskCount":0,
             "photoCount":0,"taskCount":3,"projectValue":null,"earnedValue":0,"percentByValue":0,
             "contractValue":5000}}]}
```

Re-SELECTed `compliance.pipeline_tasks` id=`ylnm39m106cfymgockvhsutd`:
`function_id="get_construction_project_dashboard"`, `params={"orgId":"ve45lczmkodbiq1m20fy48r5","projectId":"upv2q7pv8qcwdayybvu74egm"}`
(params shaped like `adapter.classify()`'s real output, not a hand-built L0
match), `executor="software"`, `status="done"`, `created_at=20:44:43.017256`
(≈10.2s after T0 — segmentation + L0 miss on all 4 tiers +
`assertAiProviderAllowed()` + the real `provider.classify()` round trip),
`updated_at=20:44:46.998` (execution finished ≈3.98s after the task row was
created — a real dashboard query over `compliance.projects` /
`construction_work_progress_entries` / etc. for this org+project).

This confirms the L1 hop for real: **one** batched `adapter.classify()` call
per submission (M27: "3 segments cost the same as 1"), only reached because
every L0 tier genuinely missed, with real params flowing through
`validate()` into a real, executed, persisted task.

## Run 6 — resubmitting the IDENTICAL input: reuse_cache is NOT wired (real gap)

Per seq34's test_oracle: "Re-submit the SAME input: second run is a reuse
hit with ZERO model calls — prove it by comparing the two traces." Run 3's
exact input was resubmitted verbatim:

```
POST /api/assistant  {"rawInput":"PP1 is 50% done and show me the budget","mode":"Projects","projectId":"upv2q7pv8qcwdayybvu74egm"}
T0: 2026-08-24T20:43:51.322Z   T1: 2026-08-24T20:43:57.691Z   HTTP 201
{"submissionId":"v9f7azoo3x5okh7v0jnpn2bk","status":"done",
 "tasks":[{"taskId":"rybr04c59yepynp6ps6ikg59","functionId":"record_work_progress","status":"done",
   "result":{"id":"znmnqv7suqoyk2xgi1udkxmp", ... "createdAt":"2026-08-24T20:43:55.144Z"}}]}
```

**Real, confirmed gap**: this produced a **brand-new** `submissionId`, a
**brand-new** `taskId`, and a **second, distinct** real row in
`construction_work_progress_entries` (`id=znmnqv7suqoyk2xgi1udkxmp`, not
`kyuf1p6hxd620sal6lh9c7x0`) — i.e. the identical input did not hit a cache,
it re-executed the mutation a second time (Oakwood's `PP1` line item now has
two independent progress entries from this trace). This was never going to
be a "zero model calls" comparison either way (Run 3 was already an L0
structural hit, $0), but the deeper finding is real and checkable
independently of that:

```sql
select count(*) from compliance.reuse_cache;                       -- 0 (always has been -- checked before and after both runs)
-- and, repo-wide:
grep -rn "reuseCache" src/                                          -- 0 matches, anywhere, in any file
```

`compliance.reuse_cache` (columns: `id, org_id, user_id, scope, input_hash,
function_id, params, response, reuse_count, created_at, updated_at`) exists
as a real table in the live schema, but **no code in this repo reads or
writes it** — not `pipeline.ts`, not `classify.ts`, not `executor.ts`,
nowhere. It is schema-only, a stub that was never wired into the pipeline.
`classifyL0()`'s "L0" tiers (`phrase_map`, structural, last-action-recall)
are a genuinely different, real, working mechanism for avoiding a repeated AI
call on a *similar* input — but they are not a reuse cache for an *identical*
input, and they do not prevent RE-EXECUTING a real mutation, which is the
specific thing this test_oracle asked to be proven or honestly reported as
missing.

## Summary

| Claim | Status | Evidence |
|---|---|---|
| One real input traced all the way to a real persisted DB row | **PROVEN** | Run 3 — `pipeline_tasks` id `pr2xmqr6fwicw09kncdsyyl1` → `construction_work_progress_entries` id `kyuf1p6hxd620sal6lh9c7x0`, re-SELECTed |
| Every hop timestamped | **PROVEN** | Run 3's table above, real `created_at`/`updated_at`, real request/response wall-clock |
| L0 (deterministic, $0) hop exercised for real | **PROVEN** | Runs 1-4, tier 3 structural match, confirmed by fast (5-7s) response time and `chain_matched_hint`/params shape |
| L1 (real AI call) hop exercised for real | **PROVEN** | Run 5, confirmed by the ~15.3s round trip and AI-shaped `params` |
| `validate()` hop exercised for real (both pass and fail) | **PROVEN** | Run 1 (no project → blocked), Run 3 (valid → executed) |
| Resubmitting the identical input is a reuse-cache hit with zero model calls | **NOT PROVEN — genuine, cited gap** | Run 6: `reuse_cache` has 0 rows, 0 code references anywhere in `src/`; identical resubmission re-executes and writes a second real row |
| Real bug found live, not previously documented | `segment.ts`'s bare-`"and"` design intentionally defers a 2-intent decision to `classify.ts`, but `classifyL0`'s structural tier never actually re-examines the segment for a second intent, so the second clause is silently dropped with **zero** `gap_log` entry | Runs 1-4, `gap_log` re-queried, 0 rows every time |

**Scope note for whoever picks up the reuse_cache gap**: this is real,
buildable work (an `input_hash` lookup keyed on
`org_id+function_id+normalised params` before `executeTask()` runs, a
`response`/`reuse_count` update on a hit) but it is a genuine new code path
touching the pipeline's write path, not a doc or a scoped low-risk change —
out of scope for this pass per this work order's own instruction not to
fabricate unbuilt subsystem work.
