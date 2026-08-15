# AIROUTER-01: Mother Router Phase 1

Built directly by Super Boss (Claude Desktop session, per Owner's explicit
2026-07-18 directive to complete this personally rather than wait on the
server-side worker task, which was blocked on exhausted OpenRouter credits).
Full context: `control/CONTROLLER.yaml` entry `AIROUTER-01` and memory file
`veridian_ai_router_hierarchy_project_2026-07-18.md`.

## What this PR does

Adds a real, unifying "Mother Router" -- a model/provider registry +
versioned routing policy + audit log -- covering the 3 domain scopes the
Owner named: `software_team`, `end_user_org`, `sales_marketing`.

- `drizzle/0231_ai_router_mother_router.sql` + matching `schema.ts`
  additions: 3 new tables (`ai_model_registry`, `ai_routing_policies`,
  `ai_routing_audit_log`), all additive.
- `src/lib/ai-router/mother-router.ts`: `resolveModel(context)` is the
  single entry point. Hot-reload via a 60s in-process TTL cache +
  `invalidateMotherRouterCache()`; emergency rollback via
  `rollbackPolicy(scope, version)` (versioned policies, partial unique
  index enforces one active version per scope).
- `src/lib/ai-router/mother-router.test.ts`: 11 passing unit tests on the
  pure resolution logic (no DB -- see below for why).
- One additive, fire-and-forget audit-log call wired into
  `/api/ai/team/dispatch/route.ts` (does not change that route's actual
  dispatch/gating behavior).

## Deliberate scope decisions (read before assuming something is missing)

1. **`model-tier-eligibility.ts`, `orchestra-model-resolver.ts`, `roster.ts`,
   `llm-client.ts` are UNTOUCHED.** Mother Router calls into them exactly as
   they already are (`checkTierEligibility`, `resolveModelConfig`,
   `AI_TEAM_ROSTER`) and layers registry/policy/audit metadata on top. A
   full rewrite of their ~23+3 existing call sites (several guardrail-
   critical) was judged too large/risky for one solo pass. Existing callers
   of those 4 files need no changes and keep working identically.

2. **Only one real call site wired so far**: `/api/ai/team/dispatch`, and
   only as a fire-and-forget audit-log call -- it does NOT yet consume a
   policy override to change which model actually gets dispatched.
   `dispatch-repo.ts` and `scripts/ai-workforce-agent.mjs` (the other 2 real
   dispatch surfaces per AGENTS.md Rule 10) are NOT wired yet -- same
   pattern, follow-up work.

3. **Subscription packages reuse the EXISTING `subscription_plans` table**
   (schema.ts, Wave 1) rather than inventing a new one -- it already had
   exactly the right shape (`userPackSize`, `assistantsPerUser`, `features`
   jsonb) but zero seed rows and zero consumers anywhere in `src/`
   (confirmed by grep before writing this, not assumed). Seeded 4 real rows:
   Basic(10)/Standard(25)/Professional(50)/Enterprise(100), `features.aiPackage`
   holding the tag `mother-router.ts` reads. `price_monthly` left NULL --
   real pricing is a business decision outside this task's scope.

4. **BYOB got NO new columns.** The raw capability already exists,
   unconditionally, today: `customer_model_config` (schema.ts) already lets
   any org configure its own provider/model/encrypted key, consulted FIRST
   by `resolveModelConfig()`. Adding new `byob_enabled`/`byob_config`
   placeholder columns would have duplicated that real, wired table --
   explicitly avoided. What's genuinely PENDING (Phase 2, per Owner's "keep
   byob ai PENDING"): gating/restricting BYOB *by subscription package*
   (e.g. "only Enterprise orgs may configure `customer_model_config`") --
   today any org can use it regardless of package, unchanged by this PR.

5. **Testing**: this repo's own CI (`ci.yml`'s `unit-tests` job) runs
   `bun test` against a placeholder `DATABASE_URL` with no real Postgres
   behind it. `mother-router.test.ts` therefore tests ONLY the pure
   `compute*Resolution` functions (no DB access) -- the same pattern
   `permission-service.test.ts` already established. The DB-touching
   wrappers (`resolveModel`, `getActivePolicy`, `getOrgAiPackage`,
   `rollbackPolicy`) are NOT exercised by any automated test in this PR --
   a real, disclosed limitation, not a silent gap. They should get a live
   smoke test once this migration is actually applied to a real Postgres
   instance (this repo's own established pattern for schema changes -- see
   `AI_OS_CERTIFICATION.md`'s own "zero E2E tests" disclosure for the same
   class of honesty).

6. **This PR does NOT apply the migration to any live database.** Per this
   repo's own tier2 rule (schema/migration changes are held for explicit
   human sign-off, never auto-merged), the SQL file exists but has not been
   run against Supabase. Applying it is a separate, deliberate step for the
   Owner (or a follow-up task) to take after reviewing this PR.

## Naming note

`roster.ts` already has an unrelated role literally named `"ai_router"`
(the task classifier used by `classifyTask()`/`team-service.ts`). That is
a different concept from this PR's Mother Router (a model/provider
resolution registry) -- not conflated anywhere in this code, called out
explicitly in `mother-router.ts`'s header so a future reader doesn't
confuse the two.

## Independent audit (before requesting Owner sign-off)

Since Super Boss both wrote this code AND would otherwise be the one
certifying it, an independent review was run instead of self-certifying
(matching AGENTS.md Rule 7c's "doer != auditor" principle) -- 2 fresh
sub-agents with no memory of writing this code reviewed the diff cold
across correctness/reuse/simplification/efficiency angles. Real findings,
fixed before this PR was finalized:

1. **Migration idempotency**: the 3 new `CREATE TYPE` statements and the
   `CREATE TRIGGER` in 0226 were bare, not wrapped in this repo's own
   established idempotent-retry pattern (`DO $$ ... EXCEPTION WHEN
   duplicate_object ...` / `CREATE OR REPLACE TRIGGER`) -- fixed to match
   convention (see `drizzle/0222_training_lms_module.sql` precedent).
2. **`ai_model_registry` shipped permanently empty**: the migration's own
   header claimed to migrate llm-client.ts/model-tier-eligibility.ts's
   existing model truth into the registry, but no INSERT actually did that
   -- fixed by seeding the real models/tiers/pricing from those 2 files
   (pricing left NULL for the 2 models neither file prices, not guessed).
3. **Audit-log mislabeling**: when an active policy named the SAME model
   as the roster.ts baseline, `computeSoftwareTeamResolution`/
   `computeSalesMarketingResolution` fell through to the "no active
   policy" branch and logged that -- misleading for anyone auditing
   `ai_routing_audit_log` later. Fixed: that case now correctly attributes
   the resolution to the policy version. 2 new regression tests added
   (13 total, up from 11).
4. **Efficiency**: `getOrgAiPackage()`'s user-count check fetched every
   user row just to take `.length` -- switched to a real `count(*)`.
   3 mutually-independent DB fetches in `resolveModel()`'s `end_user_org`
   branch (and 2 inside `getOrgAiPackage()`) ran sequentially -- switched
   to `Promise.all`.
5. **Multi-instance cache honesty**: the header comment overclaimed that
   hot-reload/rollback take effect "immediately... no restart required
   either way" -- true per-process, not true across Vercel's multiple
   serverless instances (each has its own 60s-TTL in-memory cache). Comment
   corrected to state this limitation plainly rather than imply instant
   global propagation.
6. **Not fixed, disclosed instead**: `rollbackPolicy()`'s two-step
   deactivate-then-activate (though atomic as one DB transaction) has no
   optimistic-lock check across concurrent callers -- last commit wins
   silently. Low real risk (infrequent, human-triggered admin action);
   documented in the function's own header rather than engineered around,
   given Phase-1 scope.

Findings judged NOT worth fixing now (noted, not silently dropped): the 3
near-identical `compute*Resolution` functions could share a helper (each
resolves a genuinely different context shape; premature to abstract at 3
call sites); the in-process policy cache lacks in-flight-request dedup
(irrelevant at this table's real size -- at most 3 rows, checked at most
once/minute); `logRoutingDecision` doesn't reuse
`orchestra-execution-logger.ts`/`activity-log-service.ts`'s insert
patterns (neither fits schema-wise, and `ai_routing_audit_log` has no
`orgId` to scope through `withTenantContext` the way those two do).

## Follow-ups (not done here, listed honestly)

- Wire `dispatch-repo.ts` / `ai-workforce-agent.mjs` the same way as
  `/api/ai/team/dispatch`.
- Have `end_user_org` scope actually apply a policy override live (today
  only proven via unit test on the pure function -- no live caller consumes
  `computeEndUserOrgResolution`'s override path yet).
- Apply the migration to a real Postgres instance and smoke-test the DB-
  touching wrappers for real.
- Phase 2: BYOB entitlement gating by subscription package; A/B testing;
  feature-flag-based routing -- none requested for Phase 1, none attempted.
