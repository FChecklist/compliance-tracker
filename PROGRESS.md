# PROGRESS -- task-20260726-172016-mother-router-and-roster-persistent-memo

## Honest note on the redispatch's cited evidence

Before starting, re-verified the KNOWN_CONTEXT evidence files independently rather than
trusting them: `ai-os/SYSTEM_MEMORY_ARCHITECTURE.yaml` and
`ai-os/TIER3_RELEVANCE_TRIAGE_REPORT_2026-07-26.md` (both cited by this redispatch as proof
the gap is real) **do not exist anywhere in this repo's git history** (`git log --all` on
either path returns nothing, `find` across the whole ai-os tree finds neither file). This is
a discrepancy worth flagging, not silently working around.

The underlying gap itself was independently re-verified regardless, directly against live
code: `grep -n "mother_router_memory\|ai_agent_memory" src/lib/db/schema.ts` returned zero
matches before this task started. So the real objective (ground-up persistent memory for
Mother Router + the AI agent roster) was genuinely still open, confirmed by direct evidence,
independent of whether the cited triage report file actually exists.

## Completed
- [x] Read ai-os/CONSTITUTION.yaml, ai-os/boss/ACTIVE-CLAIMS.yaml, AGENTS.md, CLAUDE.md
- [x] Re-verified the gap directly against schema.ts/mother-router.ts/roster.ts (see note above)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed standalone
- [x] Branch created: feat/mother-router-roster-persistent-memory
- [x] Drizzle schema additions (src/lib/db/schema.ts, additive only):
      - `platform.mother_router_memory` (dispatch_id, ts, input_capability_tag, resolved_role,
        resolved_model, outcome, cost, cross_ref_work_item_id) -- written at resolution time
        by mother-router.ts's resolveModel() (every scope), UPDATED once a dispatch's real
        outcome/cost are known (recordMotherRouterOutcome()). This is genuinely distinct from
        the pre-existing `platform.ai_routing_audit_log`: that table is a write-once
        resolution log; this one is a per-dispatch row that starts pending and gets a real
        outcome later -- the actual "memory" the original prompt asked for.
      - `platform.ai_agent_memory` (role_id, ts, task_id, outcome, escalation_flag,
        cross_ref_work_item_id) -- written from the one real roster-driven dispatch decision
        point, `/api/ai/team/dispatch`'s POST handler (roster.ts itself is static role data
        with no dispatch call site of its own -- confirmed by grep before wiring anything).
- [x] Migration: drizzle/0264_mother_router_roster_memory.sql (hand-authored SQL, same
      convention as every other platform-schema migration in this repo since 0245 --
      drizzle-kit's schemaFilter only tracks `compliance`, confirmed via drizzle.config.ts).
      RLS enabled on both new tables with the same app_runtime/service_role policy split
      verified live (via Supabase MCP `pg_policies`) against the existing sibling table
      `platform.ai_routing_audit_log`, rather than replicating `platform.task_register`'s
      known RLS-disabled gap (flagged by the Supabase MCP's own advisory when listing
      `platform` tables -- pre-existing on task_register, not touched here, out of scope).
- [x] Wired writes:
      - src/lib/ai-router/mother-router.ts: `recordMotherRouterMemory()` (insert at
        resolution time, inside `resolveModel()`, all 4 scopes) + `recordMotherRouterOutcome()`
        (exported, update once outcome/cost known). `MotherRouterResolution.dispatchId` added
        as optional (doesn't touch the pure compute*Resolution() functions or their existing
        unit tests).
      - src/app/api/ai/team/dispatch/route.ts: generates the dispatch id up front (so the
        existing fire-and-forget `resolveMotherRouterModel()` call -- deliberately unawaited,
        pre-existing design decision documented in that route's own comments -- doesn't need
        to be awaited just to learn its id), writes `ai_agent_memory` and calls
        `recordMotherRouterOutcome()` once the dispatch's real qaGate/taskRegisterStatus
        outcome and cost (`estimateCostUsd`) are known, right before the response is built.

## Remaining
- [ ] `bun install` / typecheck verification (bun unavailable in this sandbox, using
      `npm install --legacy-peer-deps` + `tsc --noEmit` as a substitute -- in progress)
- [ ] Apply the migration to the live Supabase DB (project pcrjmlpuqsbocqfwoxod / verdian-ai)
      via the Supabase MCP
- [ ] Run `bash -c 'grep -n "mother_router_memory\|ai_agent_memory" src/lib/db/schema.ts'`
      (the task's own verification command) and confirm both tables appear
- [ ] Commit, push, open PR
