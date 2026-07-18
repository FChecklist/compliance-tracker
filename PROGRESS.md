# PROGRESS -- AI Architecture / AI Orchestration, Routing & Failover gap-closure

Task: close 7 VERIDIAN Review Framework findings under one PR: AI Orchestration
observability, AI Orchestra routing accuracy, HA & Failover, Multi-AI Provider
Support, AI Model Routing, AI Failover & Fallback, Predictive AI Model Selection.

Read `ai-os/boss/ACTIVE-CLAIMS.yaml` and `ai-os/CONSTITUTION.yaml` first, per
CLAUDE.md. No active claim touched orchestra-model-resolver.ts, roster.ts,
floor-tier-escalation.ts, byo-model-audit.ts, or software-coverage-service.ts
at claim time (2026-07-18) -- confirmed by grep across the whole claims file
before starting.

Before writing code, read the CURRENT implementation of every module the 7
findings named (orchestra-execution-logger.ts, orchestra-model-resolver.ts,
roster.ts, model-tier-eligibility.ts, floor-tier-escalation.ts,
software-coverage-service.ts, byo-model-audit.ts/Loop 14, chat-service.ts,
team-service.ts, dispatch-repo.ts, ai-workforce-agent.mjs) rather than trusting
the framework's gap descriptions verbatim -- several turned out to be more
specific/different than described (see per-finding notes below).

## Completed

### Finding 1 (Low) -- AI Orchestration: no unified observability layer
- [x] Confirmed the AGGREGATE half already existed (orchestra-analytics-service.ts,
      Wave 95, `/api/orchestra/analytics`, surfaced in kpi-hub) -- what was
      genuinely missing was the individual-TRACE drill-down the finding's
      "extend orchestra-execution-logger.ts into a queryable trace view"
      wording actually asks for.
- [x] `src/lib/services/orchestra-trace-service.ts` -- `listOrchestraTraces()`
      (paginated, filterable by layerKey/status/model/date range,
      tenant-scoped) + `getOrchestraTraceDetail()` (full input/output for one
      execution id)
- [x] `GET /api/orchestra/traces`, `GET /api/orchestra/traces/[id]`
- [x] `src/app/(app)/ai-observability/page.tsx` -- new sidebar page (Tools
      section, after Enterprise KPI Hub): filterable table + a Sheet
      slide-over showing full trace detail. Same list+detail pattern as the
      existing Audit Log page.
- [x] Sidebar entry (AppSidebar.tsx, `Activity` icon) + i18n keys
      (`messages/en.json`, `messages/hi.json`) + regenerated
      `protected-routes.generated.ts`

### Finding 2 (High) -- AI Orchestra routing accuracy: no metric exists
- [x] `src/lib/services/routing-accuracy-report-service.ts` --
      `generateRoutingAccuracyReport(days)`: routing accuracy defined as
      1 - (escalated + gated + missed-escalation) / total chat.ai_thread_reply
      executions, computed entirely from existing orchestra_executions rows
      (no new telemetry). Pure helpers `computeRoutingAccuracy` /
      `shouldRecommendPredictiveModelSelectionReview` extracted for direct
      unit testing (mirrors ai-performance-report-service.ts's own split).
- [x] `GET /api/internal/routing-accuracy-report/run` (CRON_SECRET-gated,
      same isAuthorized() pattern as every other `/run` route) +
      `vercel.json` weekly cron (`0 1 * * 1`)
- [x] `GET /api/orchestra/routing-accuracy` (veridian_admin-gated -- this is
      a platform-wide aggregate across every org, NOT safe to expose to an
      ordinary org user, unlike `/api/orchestra/analytics`)
- [x] Tests: `routing-accuracy-report-service.test.ts` (9 tests)

### Finding 3 (Medium) -- HA & Failover: one documented failover path only
- [x] Read `platformFallbackFor()` fully first. Found TWO real gaps, not one:
      (a) the finding's literal ask -- only the floor tier (Groq->Cerebras)
      had a same-quality-class failover; the escalated tier and BYO/premium
      configs fell straight to a weak free llama-3.3-70b fallback.
      (b) a genuine pre-existing BUG found while fixing (a):
      `escalatedPlatformConfig()` never called `platformFallbackFor()` at
      all -- it built its `ResolvedModelConfig` by hand, so `fallback` was
      always `undefined` and an escalated call had ZERO failover, not even
      the weak generic one. Fixed both.
- [x] Added `ESCALATED_FALLBACK_MODEL` (deepseek/deepseek-v4-pro, a distinct
      OpenRouter upstream provider from GLM-5.2's DeepInfra) as the escalated
      tier's same-quality-class failover in `platformFallbackFor()`
- [x] Wired `escalatedPlatformConfig()` to actually call `platformFallbackFor()`
- [x] Added MODEL_PRICING row for deepseek/deepseek-v4-pro in llm-client.ts
      (verified live via openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints,
      2026-07-18) -- without it estimateCostUsd() would silently return null
      for this new consumer, same class of gap as an existing documented one
- [x] Deliberately did NOT invent a same-tier failover for arbitrary BYO/
      premium customer configs -- documented in code why (no platform-known
      "sibling" model to fail over to for an org's own arbitrary choice)
- [x] Tests: 3 new cases in `orchestra-model-resolver.test.ts` (all 25 pass)

### Finding 4 (Low) -- Multi-AI Provider Support: roster.ts not admin-editable
- [x] Scoped as an ADDITIVE override layer, not a roster rewrite: roster.ts
      (~180 roles) stays the single source of truth for role metadata; a new
      `ai_team_role_overrides` table (role_key unique -> model) lets an admin
      override just the model
- [x] Migration `drizzle/0226_ai_team_role_overrides.sql` (hand-written, see
      "Drizzle tooling note" below for why) -- RLS: app_runtime read/write
      (admin-gated in the service layer), service_role bypass, PLUS
      anon/authenticated SELECT (needed so `ai-workforce-agent.mjs`, which
      runs standalone in CI with only an anon PostgREST key, can actually
      read overrides -- same constraint documented in that script's existing
      `fetchSystemPrompt()`)
- [x] `src/lib/db/schema.ts`: `aiTeamRoleOverrides` table
- [x] `src/lib/ai-team/roster-overrides.ts`: `resolveEffectiveModel()`
      (DB override if known model, else static default, fails OPEN to the
      static default on any DB error), `setRoleOverride()`/`clearRoleOverride()`
      (validate role is LLM-backed + model is in `KNOWN_MODELS`, the set of
      every model already assigned to a role in roster.ts), `listRosterWithOverrides()`
- [x] Wired all 3 real dispatch surfaces named in AGENTS.md Operating Rule 10
      so the tier-eligibility CHECK and the actual model CALL always agree
      (an override to an ineligible model must be caught, not silently
      allowed through past a check on the stale static model):
      - `team-service.ts`'s `runRole()` -- the actual LLM call, used by both
        the main dispatch path and every `runGuardrailLevel()` check under it
      - `/api/ai/team/dispatch/route.ts`'s pre-flight tier check + cost
        estimate (now reads `execution.role.model`, the model actually used)
      - `dispatch-repo.ts`'s pre-flight tier check
      - `scripts/ai-workforce-agent.mjs`'s tier check + actual OpenRouter call
        (added a lightweight PostgREST-based `resolveEffectiveModel()` since
        this script has no Drizzle/DATABASE_URL access, matching its own
        existing `fetchSystemPrompt()` pattern)
- [x] Admin API: `PATCH /api/ai/team/dispatch` (set/clear one role's
      override), `GET /api/ai/team/roster/overrides` (roster joined with
      overrides + the known-models allowlist) -- both veridian_admin-gated
- [x] UI: `src/components/AiTeamRosterSection.tsx`, wired into
      Settings > "AI Team Roster" (search/filter, per-role model Select +
      Save/Reset)
- [x] Deliberately did NOT touch `classifyTask()`'s ai_router model
      resolution -- out of the governed-dispatch scope Rule 10 actually
      names, kept the change bounded
- [x] Tests: `roster-overrides.test.ts` (7 tests -- KNOWN_MODELS + validation
      branches that throw before any DB write)

### Finding 5 (Low) -- AI Model Routing: no audit for missed escalations
- [x] Extended Loop 14 (`byo-model-audit.ts`, BYO AI Model Loop) rather than
      inventing a new loop/cron -- it already owns exactly this class of
      escalation-pattern analysis (the codebase's own established "not one
      of the 15 canonical loops -> piggyback the existing mechanism"
      discipline, matching how `capabilityIndexFreshnessAudit` was added)
- [x] `detectMissedEscalations()`: pure function, walks chat replies ordered
      by (conversationId, createdAt) and flags a non-escalated reply
      immediately followed, in the SAME conversation, by a reply whose OWN
      pre-call check fired `reask_correction` -- i.e. the user's own next
      message proves the prior floor-tier reply should have escalated but
      didn't. Naturally scoped to floor-tier-only (BYO org replies always
      carry `signals: []` on both sides, documented in the function's own
      comment, verified in tests)
- [x] Wired into `runByoModelAudit()`: proposes a `review_escalation_signal_coverage`
      loop improvement (platform-level, not per-org) when the missed-rate
      crosses the same threshold Loop 14 already uses for high-escalation orgs
- [x] Tests: `byo-model-audit.test.ts` (10 tests covering adjacency, cross-
      conversation boundaries, null conversationId, BYO-org exclusion, etc.)

### Finding 6 (Medium) -- No predictive/ML model selection
- [x] Recommended approach was explicitly "no action needed unless escalation
      accuracy (finding 5) proves inadequate" -- so no ML model-selection
      code was built. Instead of leaving that a stale one-time judgment call,
      `shouldRecommendPredictiveModelSelectionReview()` (finding 2's report
      service) makes the trigger condition a real, automatically
      re-evaluated weekly check (same volume/rate threshold Loop 14 already
      uses), logged loudly by the cron route when it fires. This is the
      documented decision this finding asked for, made self-auditing rather
      than static.

### Finding 7 (Medium) -- No AI-reduction metric over time
- [x] Confirmed `taskCapabilities` only stores CUMULATIVE
      fullSoftwareCount/packageAvailableCount/novelCount counters (no
      per-event timestamp) -- genuinely no way to derive a monthly trend
      from it alone, so this was a real gap, not already covered
- [x] New table `ai_reduction_snapshots` (migration `drizzle/0225_...sql`,
      platform-wide, no org_id) -- one row per snapshot date, summing every
      task_capabilities row's cumulative counters
- [x] `src/lib/services/ai-reduction-service.ts`: `takeAiReductionSnapshot()`
      (writes one snapshot) + `computeMonthlyBucketDelta()` (pure -- diffs
      two consecutive cumulative snapshots into that period's real,
      non-cumulative bucket counts + a softwareCoverageRatio proxy) +
      `getAiReductionTrend()`
- [x] `GET /api/internal/ai-reduction-snapshot/run` (CRON_SECRET-gated) +
      `vercel.json` monthly cron (`0 2 1 * *`, 1st of each month)
- [x] `GET /api/orchestra/ai-reduction-trend` (veridian_admin-gated, platform-wide)
- [x] Tests: `ai-reduction-service.test.ts` (5 tests)

## Verification
- [x] `bunx tsc --noEmit -p .` -- 0 errors, whole project, run after every
      major change
- [x] `bunx eslint` on every changed/new file -- 0 errors/warnings
- [x] `node --check scripts/ai-workforce-agent.mjs` -- syntax OK (not
      TS-checked, no test harness for this script; verified by direct
      reading + the syntax check)
- [x] `bun test` (full suite) -- **1422 pass, 0 fail**, 2790 expect() calls
      across 106 files (up from the pre-existing 1415/105 baseline: +7 new
      test files this wave). Console noise during the run
      (APP_RUNTIME_DATABASE_URL warnings, "boom"/"db unreachable"/"simulated
      network failure" errors) is expected fail-closed logging from
      pre-existing unrelated tests exercising their own error paths, not
      failures caused by this change.
- [x] Did not touch `src/lib/services/permission-service.ts` or its
      ERP_ACTION_ROLES table, per task instructions

## Notable incident (self-corrected, no lasting effect)
Ran `bun run db:generate` once while preparing the finding-7 migration,
expecting it to scaffold a scoped diff. This repo's `drizzle/meta/_journal.json`
only tracks migration `0000` even though `0001`-`0224` exist as real,
hand-authored, already-applied SQL files never registered in that journal --
so drizzle-kit diffed the full current schema against an almost-empty
baseline and generated a ~5900-line file recreating the entire schema, plus
rewrote the journal to a wrong state. Caught immediately from the tool
output before it was ever used or committed; deleted the generated
`drizzle/0001_sticky_jack_flag.sql` + `drizzle/meta/0001_snapshot.json` and
ran `git checkout -- drizzle/meta/_journal.json` to restore it. Both new
migrations in this PR (`0225`, `0226`) were hand-written instead, following
this repo's own established convention for every migration after `0000`.

## Remaining
- [ ] None of the 7 findings are outstanding.
- [ ] Not yet committed/pushed/PR'd -- Rule 6 requires a branch + PR + green
      CI before merge to `main`; this session has not opened that PR yet.
- [ ] The 2 new migrations (`0225`, `0226`) have not been applied to a live
      database (no `DATABASE_URL`/Supabase access in this session) -- they
      need `bun run db:push` (or the team's normal live-migration process)
      run against the real database before the new tables exist there.
