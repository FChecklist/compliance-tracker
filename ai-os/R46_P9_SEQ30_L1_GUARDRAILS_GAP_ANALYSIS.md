# R-46 P9 seq30 — L1 Guardrails Real-State Audit (2026-08-25)

**Ref:** R-43 C.1 / R-46 G.18 | **Queue row:** `platform.r43_queue` seq 30
**Verdict: PARTIAL.** Real, wired code exists for 2 of 6 guardrails. The other
4 exist only as generic, differently-scoped primitives (a different
subsystem) or not at all. No single `guardrails.ts` file implementing the
six R-43 checks as one unit exists anywhere in this repo.

This replaces guesswork with file:line citations. It does not modify any
runtime behaviour — see "What this PR does and does not do" at the bottom.

## What R-43 C.1 asked for

Six guardrails, as CODE not prompt text, at the L0→L1 pipeline
(`src/lib/segmentation/pipeline.ts`, R42 seq14):
1. **NO HALLUCINATION** — L1 may only return a `function_id` from the
   supplied candidate set / an id from the supplied option list.
2. **NO DRIFT** — non-ERP requests get a fixed refusal naming the scope.
3. **NO GIBBERISH** — response must parse as the JSON schema; one retry,
   then FAIL.
4. **NO INFINITE LOOP** — max 2 attempts per level, then escalate;
   attempts tracked on the task row.
5. **NO OPEN-ENDED TASKS** — every task resolves to a `function_id` with a
   Boolean outcome.
6. **NO COLLISION** — unique task_id per request + a lock so the same
   submission cannot process twice.

## Real current state, guardrail by guardrail

### 1. NO HALLUCINATION — REAL, wired
`src/lib/segmentation/validate.ts` `validate()` (line 64):
```
if (!ctx.candidateFunctionIds.includes(candidate.functionId)) {
  return fail(`function_id "${candidate.functionId}" is not in this module's candidate set`);
}
```
Called on every AI-classified candidate before a task row is ever created —
`src/lib/segmentation/pipeline.ts` line 193 (`const v = validate({ functionId, params }, validationCtx)`),
and a failure is treated as a miss (`gap_log` write + "I can't do that yet",
never surfaced as a lower-confidence suggestion) — matches M26's "a
candidate failing validation is a FAIL, not a suggestion" exactly.
**Confirmed real and matches spec.**

### 2. NO OPEN-ENDED TASKS — REAL, structural
Every resolved segment in `pipeline.ts`'s loop (lines 151-258) either
becomes a chat message (no task) or a `pipelineTasks` row with a concrete
`functionId`, whose only terminal states are `done`/`blocked` driven by
`executor.ts`'s `outcome.success` boolean (lines 245-252). There is no path
that creates a task without a function_id, and no open-ended "figure it out"
task type exists in the `pipelineTaskStatusEnum`. **Confirmed real by
construction**, though there is no single named `check` function for it —
it's an emergent property of the type system + control flow, not a
guardrail with a name.

### 3. NO DRIFT — PARTIAL, different shape than spec'd
When L0 misses and L1 (`openrouterProvider.classify`) returns
`functionId: null`, `pipeline.ts` lines 178-181 logs the gap and emits
`"I can't do that yet: "<segment>"` — an honest refusal, never an
AI-hallucinated answer. This functionally prevents drift (nothing off-scope
is ever executed), but it is **not** the "fixed refusal naming the scope"
message R-43 specifies, and there is no explicit check distinguishing "no
ERP entity referenced" from "no function matched" — both collapse into the
same generic miss path. A poem request and a genuinely-unsupported ERP
request produce the identical message today.

### 4. NO GIBBERISH — PARTIAL, weaker than spec'd
`src/lib/llm-client.ts` `callLLMJson()` (line 707) does
`JSON.parse(stripJsonFence(content))` and checks `expectedKeys` are present,
throwing `LLMVerificationError` on a shape mismatch. `withRetry()` (line 144)
retries transient HTTP failures (429/5xx/network, `RETRY_DELAYS_MS = [300, 900]`)
but **does not retry on a JSON-parse failure or a missing-key failure** — a
genuinely malformed/gibberish model response throws immediately and
propagates as an uncaught exception up through `pipeline.ts`'s
`await provider.classify(...)` call (line 128), which has no try/catch
around it. Real JSON-shape *validation* exists; the spec'd "one retry, then
FAIL gracefully" behaviour for a parse failure specifically does not.

### 5. NO INFINITE LOOP — NOT implemented at this pipeline
A real, generic iteration-budget guardrail exists —
`src/lib/loop-prevention.ts` `checkLoopBudget()` — but it is registered
against `AI_WORKFORCE_LOOP_BUDGET_LEAF` in
`src/lib/guardrail-registrations.ts` (line 450), which is the **AI Dev Team
dispatch / `ai-workforce-agent.mjs`** subsystem, an entirely different part
of the codebase from the L0-L4 assistant pipeline this queue row is about.
`pipelineTasks` (schema.ts line 11790) has no `attempts` column, and
`pipeline.ts` calls `provider.classify()` exactly once per submission with
no retry-then-escalate ladder. **No 2-attempt-per-level cap exists for L1.**

### 6. NO COLLISION — NOT implemented
`submissions.id` / `pipelineTasks.id` are server-generated `createId()` cuids
(schema.ts lines 11770, 11791) — collision-by-construction is not the
concern the spec raises. The spec asks for **duplicate-submission**
protection (e.g. a double-click resubmitting the same `rawInput` while the
first is still processing). No such check exists: `runSubmission()`
(`pipeline.ts` line 94) unconditionally inserts a new `submissions` row and
processes it — there is no lookup for an in-flight identical submission, no
unique constraint enabling one, and no advisory lock. Grep across
`src/lib/segmentation/` and `executor.ts` for `idempot|dedup|advisory_lock|
for update` returns zero real matches.

## Summary table

| # | Guardrail | Real & wired? | Where |
|---|---|---|---|
| 1 | No Hallucination | **Yes** | `validate.ts:64`, called `pipeline.ts:193` |
| 2 | No Open-Ended Tasks | **Yes** (structural) | `pipeline.ts` task creation + `executor.ts` outcome |
| 3 | No Drift | Partial (generic refusal, not scope-naming) | `pipeline.ts:178-181` |
| 4 | No Gibberish | Partial (shape-validated, not retry-on-parse-fail) | `llm-client.ts:707-725` |
| 5 | No Infinite Loop | **No** (exists only for a different subsystem) | n/a for L1 |
| 6 | No Collision | **No** | n/a |

## Why this is reported, not silently fixed

Implementing #5 and #6 correctly needs real design decisions this pass
should not make unilaterally: #5 needs an `attempts` column + migration on
`pipelineTasks` and a decision about what "escalate" means today (there is
no L3 human-gated runtime path per M26 — L3 is explicitly batch/offline);
#6 needs a decision between a DB unique constraint + `ON CONFLICT`, a
short-TTL in-memory lock (which won't work across serverless instances), or
a `SELECT ... FOR UPDATE` row lock, each with different tradeoffs for this
Next.js/Vercel deployment. Shipping a guess at either risks a guardrail that
*looks* covered in a status report but silently fails the adversarial test
R-43's own `test_oracle` specifies. Honest PARTIAL now, real design + a
scoped follow-up queue row, beats a fabricated DONE.

## Scoped estimate for closing the gap

- #3 (No Drift): ~1-2 hours — add an explicit ERP-entity-reference check in
  `pipeline.ts`'s miss branch, split "no ERP entity referenced" from "ERP
  entity referenced but unmapped" into two distinct fixed messages.
- #4 (No Gibberish): ~1-2 hours — wrap the `provider.classify()` call in
  `pipeline.ts` with a single retry on `JSON.parse`/`LLMVerificationError`
  specifically (distinct from `withRetry`'s existing transient-HTTP retry),
  then a graceful `functionId: null` fallback instead of an uncaught throw.
- #5 (No Infinite Loop): ~half a day — `attempts` column + migration on
  `pipelineTasks`, a 2-attempt cap per level, wired through
  `guardrail-registrations.ts` the same way `AI_WORKFORCE_LOOP_BUDGET_LEAF`
  already is for the other subsystem.
- #6 (No Collision): ~half a day — likely a short-TTL unique index on
  `(org_id, user_id, content_hash-of-raw_input)` with `ON CONFLICT DO
  NOTHING`/return-existing, since this is a serverless deployment where an
  in-memory lock does not hold across instances.

Total: roughly 1.5-2 engineer-days of real implementation + tests, not
achievable safely inside this single audit pass alongside seq31/seq32.

## What this PR does and does not do

Does: add this one documentation file. Does not: touch any runtime code,
schema, or test file. Zero functional change, zero CI risk.
