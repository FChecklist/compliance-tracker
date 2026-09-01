# PROGRESS -- task-20260718-072002-ai-model-lifecycle---benchmarking--ongoi

Spec: VERIDIAN Review Framework gap-closure, 3 findings under "AI Model Lifecycle & Benchmarking / Ongoing Quality Monitoring":
1. [High] Per-role quality regression tracked over time (extend promptfoo-style scoring to a recurring job)
2. [High] Cost-per-quality-point tracked per model (depends on #1)
3. [High] Provider-outage historical incident correlation with role failures (outage-window table + correlation query)

## Completed
- [x] Re-synced branch to origin/main, checked ACTIVE-CLAIMS.yaml (no collision), dispatched Explore agent
- [x] Explore agent + a prior invocation of this task session had already implemented all 3 findings (found uncommitted on resume, invocation 15):
  - `drizzle/0313_ai_model_lifecycle_benchmarking.sql` + `src/lib/db/schema.ts`: `platform.role_quality_runs` + `platform.provider_outage_windows` tables (hand-written migration, `platform` schema, RLS service_role-bypass-only -- mirrors `platform.dispatch_outcomes`/drizzle/0300 exactly)
  - `src/lib/services/role-quality-regression-service.ts`: per-role recurring eval reusing `prompt-eval-service.ts`'s exact scoring logic (exported `renderTemplate`/`scoreKeywords`, additive), rolling-baseline regression detection (`computeRegression`, 5-run lookback, 15pp threshold), budget-gated real LLM calls
  - `src/lib/services/cost-quality-service.ts`: joins `role_quality_runs` x `token_usage_ledger` on an exact per-run tag (`taskSummary = 'role_quality_run:<runId>'`), aggregates cost-per-passed-case by (role, model)
  - `src/lib/services/provider-outage-service.ts`: `provider_outage_windows` CRUD + `correlateOutageWithRoleFailures()` (same-role before/during failure-rate delta against `platform.dispatch_outcomes`) + `findCandidateOutageWindows()` (auto-detected failure-cluster heuristic, admin-promotable, never auto-confirmed)
  - Routes: `GET/POST /api/ai/team/role-quality`, `GET /api/ai/team/cost-quality`, `GET/POST /api/ai/team/provider-outages`, `GET /api/ai/team/provider-outages/candidates`, `GET/POST /api/internal/role-quality-regression/run` (cron entry point) -- all veridian_admin-gated via `requireAuth()` except the internal cron route (shared-secret, mirrors `/api/internal/cost-anomalies/run`)
  - Tests: `cost-quality-service.test.ts`, `provider-outage-service.test.ts`, `role-quality-regression-service.test.ts` -- 25 tests, all pure-function coverage of the join/aggregation/clustering/regression logic
- [x] Reviewed every new/changed file for correctness (this invocation) -- all sound, well-investigated (headers cite real prior-code absence, not assumed from the eval report), reuse existing infra instead of forking
- [x] Found + fixed one real gap during review: the new cron route existed but was **never registered in `vercel.json`'s `crons` array** -- without that, "recurring job" would never actually run in prod. Added `{ "path": "/api/internal/role-quality-regression/run", "schedule": "30 10 * * *" }`.
- [x] Found + fixed one real type error: `cost-quality-service.ts`'s `conditions` array needed an explicit `SQL[]` type annotation (matches this codebase's established pattern in audit-search-service.ts et al.) -- was failing `tsc --noEmit`.
- [x] Verified: `bun install`, `bun test` (25/25 pass on the 3 new test files), `NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit -p tsconfig.json` (clean, zero errors, whole project), `bun run lint` (0 errors, 3 pre-existing unrelated warnings), `node scripts/check-guardrail-presence.mjs` (88/88 markers present)
- [x] Confirmed `dispatchOutcomes` schema fields (`roleKey`, `status`, `modelUsed`, `dispatchedAt`) match what `provider-outage-service.ts` queries; confirmed `src/lib/db/index.ts` re-exports `* from './schema'` so no wiring needed for the new tables to be importable

- [x] Confirmed claim already registered in `ai-os/boss/ACTIVE-CLAIMS.yaml` (commit 89e847c5a, earlier invocation) -- matches exactly what was delivered, no re-registration needed
- [x] Committed all files (schema, migration, journal, services+tests, routes, prompt-eval-service.ts export change, vercel.json cron entry) -- commit 91976e1d7
- [x] Pushed branch, opened PR: https://github.com/FChecklist/compliance-tracker/pull/1229

## Remaining
- [ ] CI checks were still initializing at last check (Vercel: pending, others not yet reported) -- not blocking, resolves async. No action needed from this session; branch-protection self-approval deadlock ([[veridian-branch-protection-self-approval-deadlock-active]]) means this session likely cannot merge it itself regardless.
- [ ] Move the ACTIVE-CLAIMS.yaml entry from `active:` to `recently_completed:` once PR #1229 actually merges (per that file's own protocol step 3) -- a future invocation/session should do this, not before merge.
