# PROJEXA Synthetic Load Test — Protocol & Guardrails

**Status: DESIGNED, NOT YET EXECUTED.** Awaiting Boss confirmation on scope/budget (see "Open decision" at the bottom) before any run starts.

**Author/Supervisor:** Claude (Super Boss role, AGENTS.md). **Analysis + fix implementation:** Z.ai GLM-5.2, per explicit Boss instruction — this document is also the brief Z.ai receives after the run.

## 1. Ground truth first — what this test can and cannot exercise

Checked directly against the live codebase before designing anything (not assumed):

- **PROJEXA has no UI today.** ~48 real routes exist under `src/app/api/v1/projexa/*`, but zero pages exist under `src/app/(app)/`. "Test the mode pills for PROJEXA" cannot mean clicking through a browser — it means testing `capability-tree-service.ts`'s real `buildConstructionNodes()` output (lines 251-313, deterministic, explicitly scoped so PROJEXA "must never see GST/compliance/other product nodes, only its own") and the `/api/tasks` → `task-execution-engine.ts` pipeline directly.
- **`POST /api/tasks` requires a real authenticated session** (`ctx.dbUser`, not an API key). 100 synthetic personas cannot practically hold 100 real Supabase Auth sessions. This test therefore calls the real service-layer functions directly (`task-service.ts`'s `createTask()`, `task-execution-engine.ts`'s `executeTask()`) — the same functions the HTTP route calls, minus the HTTP/auth wrapper, which is not what's under test here. This is the same direct-invocation method already used and verified working for the jsPDF/Cerebras/routing smoke tests earlier this session.
- **Only 1 of the "5 orchestra layers" is actually reachable through PROJEXA task flow: `task_oa`.** Checked honestly, not assumed:
  - `page_agent_oa` — globally disabled (`PAGE_AGENT_ENABLED = false`). Cannot be exercised by any test.
  - `global_intelligence_oa` — zero real call sites anywhere in the codebase. Cannot be exercised.
  - `meta_oa` — a platform-internal, cross-org scheduled audit (`loop-engineering-audit.ts`), not tied to any single org's task flow. Not exercised by user-level tasks, by design.
  - `facilities_management_register_digitize_oa` — a *different product* (facilities register digitization), unrelated to PROJEXA/construction.
  - `task_oa` — real, live, and exactly what PROJEXA task creation/planning/execution flows through. **This is the layer this test actually exercises.**
  This report will say so plainly rather than claim "all 5 tested" when 4 of them are structurally unreachable from this test.

## 2. Isolation

- One dedicated demo org, `slug` prefixed `projexa-loadtest-` (no existing schema column marks synthetic orgs — this prefix is the isolation/cleanup mechanism, modeled on `src/db/seed.ts`'s existing org-creation pattern).
- `productBranches` row for `'construction'` (already seeded) gets an `orgProductBranchEnablements` row for this org with `isEnabled: true` — the real, existing enablement mechanism, not a bypass.
- 100 synthetic `users` rows, associated with this org, roles distributed across ~15 realistic construction-company archetypes (Project Manager, Site Engineer, Site Supervisor, Quantity Surveyor, Procurement Manager, Safety Officer, Design/Architecture Lead, MEP Engineer, Finance/Accounts, Contracts Manager, Document Controller, BIM Coordinator, Client Relations, Subcontractor Coordinator, HR/Admin) — created via direct `db.insert(schema.users)`, mirroring `seed.ts`'s pattern, not through the one-at-a-time invite API.
- Nothing here touches a real customer org's data — no shared tables get cross-contaminated (every insert carries this org's own `orgId`, enforced by the same RLS/tenant-scoping every other write in this codebase already goes through).

## 3. Persona and task generation — where GPT-OSS-120B does the "acting as 100 users" work

Two distinct generation passes, both via GPT-OSS-120B (Groq, free tier, matches the platform-default floor tier already live):

1. **Persona generation** (one-time, ~100 calls): for each of the 100 users, generate a short realistic profile (name, role, 1-2 sentence context — "Site Engineer on the Phase 2 tower block, 3 months into the project") — grounds the task generation in a believable voice per role, not generic filler.
2. **Task generation** (5 tasks per persona = 500 total): for each persona, generate 5 realistic PROJEXA task requests **in that persona's own voice**, phrased the way a real employee would actually type them — not a dry enumeration of every API endpoint. Deliberately weighted toward what that role would realistically ask: a Site Engineer asks about site diary/progress, a Finance persona asks about budget status, a Safety Officer asks about incident/risk detection, etc. A small deliberate fraction (~10%, ~50 of 500) are edited/corrected mid-task — the concrete test of "tasks can be edited" — and a small fraction (~5%) are intentionally ambiguous or reference a capability that doesn't exist, to test the "no approved worker agent matches" path honestly rather than only testing the happy path.

This is where "all permutation and combinations of tasks" gets bounded deliberately: full cross-product of 100 personas × every possible task type would be thousands of largely-redundant combinations. 500 tasks, weighted by real role-relevance with an honest slice of edits/ambiguity/failure-path, tests the real distribution of what this system will actually see rather than an unbounded synthetic combinatorial space.

## 4. Execution — what actually gets tested per task

For each of the 500 generated task requests, in this order (mirrors `task-execution-engine.ts`'s real flow exactly, not a simulation of it):

1. `createTask()` (or direct construction of the same task row shape) — captures whether the task is accepted, and exercises the Wave 146 two-step confirmation gate: any task detected high-impact returns `needsConfirmation: true` first; the harness auto-confirms (`confirmed: true`) on the resubmit, since this is a controlled test with no human to click "confirm" — this IS the intended way to exercise that gate end-to-end, not a bypass of it.
2. `executeTask()` — real dispatch: structured (`resolvedWorkerAgentId`)/engine (`engineKey`) tasks skip the LLM entirely (the existing "software first" path); free-text tasks go through the real planning call, now with the escalation layer (PR #116) live.
3. Result captured: `tasks.status`, `taskExecutionPlan` rows, `taskAgentExecutions` output, and — critically — `orchestra_executions`' `input`/`output`/`provider`/`model`/`promptTokens`/`completionTokens`/`costUsd`/`durationMs` columns, which already carry everything needed for the cost/time report (confirmed via schema read — no new tracking table needed).
4. **Edit path** (the ~10% subset): after initial completion/failure, resubmit an edited version of the same task (same `taskId` where the schema allows, or a linked follow-up) — this is exactly what `checkTaskEscalationContext()` (PR #116) is built to detect, so this also validates that the escalation logic fires correctly on real edited-task traffic, not just in unit tests.

## 5. Guardrails (hard limits, not best-effort)

| Guardrail | Limit | Why |
|---|---|---|
| Total tasks | 500 (100 personas × 5) | Bounded, realistic distribution — see §3 |
| Total LLM calls (hard ceiling) | 2,500 | ~5 calls/task budget (persona gen + task gen + planning + possible escalation retry + possible dispatch) — the harness stops immediately if this is hit, regardless of task count |
| Spend, tiered (Boss's explicit allocation, 2026-07-10) | Groq: free tier, no cap (it's free). Cerebras: up to **$3** real paid spend. GLM-5.2: up to **$1** real paid spend. Beyond both paid caps: Claude (this machine, Super Boss role) resolves the task directly. | Groq/Cerebras split is the existing PR #115 same-model reliability failover (Groq primary, Cerebras when Groq fails/rate-limits) — already built, just budget-capped for this run. GLM-5.2 is the existing PR #114/#116 quality-escalation path — already built, budget-capped the same way. Per-provider `costUsd` from `orchestra_executions` is checked after every batch; a capped provider is skipped, not force-used past its limit. Tasks that would have escalated but find both paid tiers capped are queued to `docs/testing/PROJEXA_LOAD_TEST_OVERFLOW_QUEUE.md` and resolved by Claude directly after the automated run, not mid-script (no way to invoke Claude programmatically from a script — `ANTHROPIC_API_KEY` was deliberately never funded, see [[veridian_app_secrets]]). |
| Wall-clock time | 90 minutes | Prevents an unbounded/stalled run from running silently for hours |
| Per-persona iteration cap | 8 (5 planned + up to 3 retries/edits) | Mirrors `scripts/ai-workforce-agent.mjs`'s existing `MAX_ITERATIONS` pattern (40, for a very different job) scaled to this job's shape — no persona can loop indefinitely |
| Repetition / stuck-loop detection | Halt persona's remaining tasks if 2 consecutive tasks produce byte-identical output, or if the same task retries >3 times | Concrete definition of "not hallucinating/not stuck," not a vague aspiration |
| Concurrency cap | 5 tasks in flight at once | Groq's free tier has real rate limits; running 100 personas fully in parallel risks mass 429s that look like false "failures" rather than real system behavior |
| Kill switch | Any single condition above, OR error rate >30% across the last 50 tasks | One clear, checkable trigger set — not "use judgment" |

**Supervision, not autonomous unattended execution**: per Boss's own framing ("You set up the whole testing. You only monitor"), the harness runs as a background process I actively watch — checking cumulative spend/error-rate/time against the table above at regular intervals, not fire-and-forget. Any guardrail breach halts the run and produces a partial report rather than continuing.

## 6. What gets reported

Pulled directly from `orchestra_executions` + `tasks` + `taskExecutionPlan` after the run (real SQL against real data, not estimated):

- Per-task: prompt tokens, completion tokens, total tokens, cost (USD), wall-clock duration, model/provider used, whether it escalated (and why), pass/fail.
- Aggregate: total tokens, total cost, average cost per task, average duration per task, cost/duration broken down by persona role and by task category (read-only query / write action / ambiguous / edit).
- Correctness findings: mode-pill/capability-tree specificity to PROJEXA (did `buildConstructionNodes()` ever leak a non-construction node, or fail to match a real construction request), task-edit handling, input/output validation gaps, escalation trigger accuracy (false positives/negatives against manual spot-check), and the honest `task_oa`-only orchestra-layer scope from §1.
- Explicit "what should we improve" section, written before handoff, not left for Z.ai to infer from raw data alone.

## 7. Handoff to Z.ai GLM-5.2

Per Boss's explicit instruction: I do not implement fixes myself. After the run:
1. This document (updated with real results) + the findings report get written to `docs/testing/PROJEXA_LOAD_TEST_RESULTS.md`.
2. Dispatched to Z.ai via the existing `ai-team-workforce.yml` pipeline (same mechanism used throughout this session — `ceo_technical_director`/GLM-5.2, real tool-calling repo access), briefed with the findings doc as task input, asked to propose and implement corrections.
3. Z.ai's changes go through the normal PR/CI gate (AGENTS.md Rule 6) — no direct-to-main bypass for load-test-driven fixes either.
4. I audit Z.ai's fixes before merge, mirroring the mandatory cross-audit pattern already established (AGENTS.md Rule 7c) — not self-certified.

## 8. Cleanup

After results are captured and handed off, the demo org (`projexa-loadtest-*` slug) and its 100 users/500 tasks are deleted — this is a disposable test fixture, not a permanent addition to the org list.

## Open decision — needs Boss confirmation before execution

Everything above is designed and ready to build. Before spending real money and writing ~500+ new rows to the shared production database, confirming:
- **Scope**: 100 personas × 5 tasks = 500 total, as designed above — proceed as-is, or adjust?
- **Budget**: $10 hard cap — proceed as-is, or adjust?
- **Timing**: run now, or at a specific time (e.g. to avoid overlapping with other production traffic)?
