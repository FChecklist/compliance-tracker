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

- `drizzle/0225_ai_router_mother_router.sql` + matching `schema.ts`
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
