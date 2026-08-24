# AI Workflow & RAG — L0→L3 flow, guardrails, and the RAG corpus

**R46 P9 seq35** (platform.r43_queue, ref D.2). This merges what R-43 called
"Part C" (the six guardrails, C.1) and "Part D" (the RAG corpus, D.1) into
one cross-referenced document, per the work order. **Honest status up
front**: Part C exists as real, wired code and is merged below in full,
file:line cited. Part D — the `rag_corpus` table — **does not exist**. This
was verified directly against the live schema (not assumed), and is reported
here precisely rather than fabricated; see "Part D" below for the real gap
and a scoped estimate to close it. Because Part D doesn't exist, the
corpus-category → guardrail cross-reference the work order also asks for
cannot be built against real data yet — that section says so explicitly
instead of inventing categories.

## Part A — the L0→L3 flow, with real decision thresholds

Code path: `POST /api/v1/projexa/assistant` (`rawInput` body) →
`runSubmission()` (`src/lib/segmentation/pipeline.ts:94`).

| Level | What it is | Code | Threshold / decision rule |
|---|---|---|---|
| **Segmentation** (pre-L0) | Pure, deterministic string splitting — never calls a model (`segment.ts:1-11`: "This file must never call an LLM") | `segment.ts:141` `segment()` | Splits on newlines → bullets/numbering → semicolons → qualifying `.`/`?`/`!` → `"then"`/`"and then"` → else 1 segment. **Never** splits on a bare `"and"` (`segment.ts:192-197`, confirmed live — see `architecture/END_TO_END_TRACE.md` Run 4). `MAX_SEGMENTS = 5` (`segment.ts:50`); beyond that, `flagged=true` and extra segments are dropped, not silently processed. |
| **L0** | Deterministic software, $0 per call (M26's own definition) | `classify.ts:121` `classifyL0()` | Ladder, stops at first hit: (1) acknowledgement list → `chat` (`classify.ts:31-39`); (2) exact `phrase_map` match, **promoted rows only** (`pipeline.ts:64-65`, unpromoted L2 candidates never go live at L0); (3) structural pattern — a percent token (`PERCENT_TOKEN`) + an item-code token (`ITEM_CODE_TOKEN`) anywhere in the segment → `record_work_progress` (`classify.ts:54-85`); (4) last-action recall — a bare percent with no item code reuses the user's most recent task's `function_id` (`classify.ts:92-110`); (5) miss → escalate to L1. |
| **L1** | The only AI call in the live-request path | `src/lib/ai/adapter.ts` `classify()`, invoked `pipeline.ts:126-132` | **One batched call for every L0 miss in the submission** (M27: "3 segments cost the same as 1"), never one call per segment. Gated by `assertAiProviderAllowed()` (`adapter.ts`) — refuses closed if `AI_PROVIDER=claude-cli` and the caller isn't the configured owner identity. Candidate set is fixed and passed explicitly (`pipeline.ts:24` `CANDIDATE_FUNCTION_IDS`) — L1 may only return a `function_id` from that list (enforced downstream by guardrail #1, Part C). |
| **validate()** | Deterministic, no AI | `src/lib/segmentation/validate.ts` `validate()`, called `pipeline.ts:193` | A classified candidate must be in the module's real candidate set (guardrail #1) and pass whatever else `ValidationContext` carries (reachable project, permitted function). A validation failure is logged to `gap_log` and surfaced as a miss — **never** downgraded to a "maybe" suggestion (M26). |
| **Task creation + execution** | `pipeline.ts:202-220` (INSERT `pipeline_tasks`), `executor.ts` `executeTask()` (`pipeline.ts:245`) | A task with no registered executor is `blocked` immediately (`pipeline.ts:235-243`), never silently retried. Every terminal state is `done` or `blocked` with a real `error` string (guardrail #2, Part C) — see `architecture/END_TO_END_TRACE.md` for a live-traced example of both. |
| **L2** | Nightly batch only, never in-request (M27) | `src/lib/ai/batch/analyse.ts` `runL2Batch()`, cron-triggered via `/api/internal/l2-phrase-promotion/run` | Clusters `gap_log` rows with `frequency >= 3` (`MIN_CLUSTER_FREQUENCY`, `analyse.ts:14` — "one user's one-off is not a product signal"), asks the AI provider for `phrase_map_candidate` / `report_definition` / `capability_gap` / `no_action` artifacts, and (as of R46 P9 seq33) persists a `report_definition` artifact as a real, immediately-runnable `compliance.report_definitions` row **only** when it resolves to a whitelisted `deterministic_aggregation` shape (`analyse.ts` `toReportDefinitionInput()`) — never runs arbitrary SQL. |
| **L3** | A real human (Rajat today), offline/batch — no in-runtime L3 gate exists for this pipeline (confirmed in the seq30 guardrail audit, see Part C #5) | `analyse.ts:162` `promotePhraseMapCandidate()` | Sets `promotedAt`/`promotedById` on a `phrase_map` candidate row. Only a promoted row is ever matched by L0 tier 2 (`pipeline.ts:64-65`) — an unreviewed AI-proposed candidate can never go live on its own. |

## Part C — the six guardrails, enforced IN CODE (file:line)

Merged verbatim from the real, current audit of this exact pipeline —
`ai-os/R46_P9_SEQ30_L1_GUARDRAILS_GAP_ANALYSIS.md` (R46 P9 seq30, PR #1363,
merged into `main` 2026-08-25). That document is the source of truth for
this section; summarised here so the whole flow is in one place, per this
seq's own instruction ("cite file paths, never prose descriptions of code" —
every claim below traces back to that file's own file:line citations).

| # | Guardrail | Real & wired for L1? | Where |
|---|---|---|---|
| 1 | **No Hallucination** — `function_id` must be in the supplied candidate set | **Yes** | `validate.ts:64`, called `pipeline.ts:193` |
| 2 | **No Open-Ended Tasks** — every task resolves to a `function_id` with a Boolean (`done`/`blocked`) outcome | **Yes** (structural — an emergent property of the type system + control flow, not a named check) | `pipeline.ts:151-258` task creation, `executor.ts` outcome, `pipeline.ts:245-252` |
| 3 | **No Drift** — non-ERP requests get a fixed refusal naming the scope | **Partial** — a miss produces an honest generic refusal (`pipeline.ts:178-181`), but does not distinguish "no ERP entity referenced" from "ERP entity referenced but unmapped"; both collapse to the same message | `pipeline.ts:178-181` |
| 4 | **No Gibberish** — a malformed model response gets one retry, then FAILs gracefully | **Partial** — `llm-client.ts:707` `callLLMJson()` validates JSON shape and throws `LLMVerificationError` on mismatch, but a parse/shape failure is **not** retried (only transient HTTP failures are, via `withRetry()`, `llm-client.ts:144`) and propagates as an uncaught exception through `pipeline.ts:128`'s un-guarded `provider.classify()` call | `llm-client.ts:707-725` |
| 5 | **No Infinite Loop** — max 2 attempts per level, then escalate | **No**, for this pipeline — a real, generic budget guardrail exists (`src/lib/loop-prevention.ts` `checkLoopBudget()`) but is wired only to the AI Dev Team dispatch subsystem (`guardrail-registrations.ts:450`), an entirely different part of the codebase. `pipelineTasks` has no `attempts` column; `pipeline.ts` calls `provider.classify()` exactly once per submission, no retry-then-escalate ladder | n/a for L1 |
| 6 | **No Collision** — a duplicate in-flight submission of the same input is prevented | **No** — `runSubmission()` (`pipeline.ts:94`) unconditionally inserts a new `submissions` row every call; no lookup for an in-flight identical submission, no unique constraint, no advisory lock (confirmed empirically: `architecture/END_TO_END_TRACE.md` Run 6 resubmitted the identical input and got a second, independent execution, not a collision guard or a cache hit) | n/a |

Scoped estimates to close #3/#4/#5/#6 (from the seq30 audit, unchanged here
since no code was touched by that PR or this one): ~1-2h / ~1-2h / ~half a
day / ~half a day respectively, total ~1.5-2 engineer-days — see the seq30
doc for the exact design questions each one needs answered first (e.g. #6
needs a decision between a DB unique constraint, a short-TTL lock, or a row
lock, given this is a serverless/Vercel deployment).

## Part D — the RAG corpus: **does not exist** (real gap, not fabricated)

R-43 D.1 calls for a `rag_corpus` table: a derived (not invented) corpus of
roughly 150 entries with a provenance breakdown, to ground L1's
classification and/or L2's report-definition proposals in real prior
examples rather than the model's own unaided judgment.

**Verified directly against the live schema** (Supabase project
`pcrjmlpuqsbocqfwoxod`, both `compliance` and `platform` schemas):

```sql
select table_schema, table_name from information_schema.tables where table_name like '%rag%';
-- -> 0 rows. No rag_corpus table, no similarly-named table, anywhere.
```

Cross-confirmed by a separate, independently-produced audit merged the same
day (`audit/R1_R45_OPEN_ITEMS.md`, R46 P9 seq44, PR #1365): "the entire P3-AI
phase (guardrails, RAG corpus, reuse store, cache strategy — seq30-39, zero
attempts on any of them)" — i.e. this isn't a stale doc lagging behind real
code; two independent checks on the same day agree the corpus was never
built.

**This is real, buildable subsystem work, not a doc gap** — deriving ~150
real entries (from real `gap_log`/`pipeline_tasks`/`phrase_map` history, per
D.1's own "DERIVED entries, NOT invented" framing per `platform.r43_queue`
seq31's own title) plus a provenance-breakdown schema is a multi-session
engineering task in its own right (R43 seq31 in the queue, currently
PENDING, zero attempts as of this doc). Per this work order's own
instruction not to fabricate unbuilt subsystem work in this pass, it is
reported here precisely instead: **no table, no rows, no code path reads or
writes it, and no corpus categories exist yet to cross-reference against
Part C's guardrails.**

### Cross-reference (Part C ↔ Part D): blocked on Part D, not fabricated here

The work order asks for "a cross-reference mapping each corpus category to
the guardrails that apply to it." That mapping needs real corpus categories
to map *from* — since Part D has zero categories (zero rows, zero schema),
this section cannot honestly produce one. Once seq31 derives the real
corpus and its provenance breakdown, each real category should be checked
against Part C's six guardrails the same way L1's own candidate-function
list is checked today (`validate.ts:64`) — e.g. a corpus entry used to
ground an L1 classification should itself only ever point at a real,
in-candidate-set `function_id` (guardrail #1), and a corpus-grounded
report-definition proposal from L2 should go through the same
`deterministic_aggregation`/`TABLE_REGISTRY` whitelist check the L2 batch
already applies to a model's raw `report_definition` artifact (`analyse.ts`
`toReportDefinitionInput()`, R46 P9 seq33) rather than a new, separate trust
path. This is a design note for whoever builds seq31, not a completed
cross-reference — restating it as complete would misrepresent PENDING
subsystem work as finished.

## Sources merged into this document

- `ai-os/R46_P9_SEQ30_L1_GUARDRAILS_GAP_ANALYSIS.md` (R46 P9 seq30, PR #1363) — Part C, verbatim file:line citations.
- `architecture/END_TO_END_TRACE.md` (R46 P9 seq34, PR #1370) — the real, live-traced flow evidence Part A and the guardrail-#6 claim above cite.
- `src/lib/segmentation/{segment,classify,validate,pipeline,executor}.ts`, `src/lib/ai/adapter.ts`, `src/lib/ai/batch/analyse.ts` — read directly for this document, not summarised from memory.
- Live Supabase schema query (`information_schema.tables`) + `audit/R1_R45_OPEN_ITEMS.md` (R46 P9 seq44, PR #1365) — Part D's "does not exist" claim, cross-confirmed two ways.

## What this PR does and does not do

Does: add this one documentation file, combining two real, already-cited
sources plus a live schema check. Does not: touch any runtime code, schema,
or test file. Zero functional change.
