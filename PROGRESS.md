# PROGRESS -- VERIDIAN Review Framework gap closure: AI Architecture / AI Capability Registry

Finding: [Low] AI Capability Registry -- "registry coverage/backfill
completeness not independently measured". Recommended approach: instrument
`capability-backfill-service.ts` to report a coverage percentage.

Read the current code first (per task instructions) before changing anything.
`backfillCapabilityIndex()` returned only the *attempted* source counts
(agents/rules/modules/chains found and queued for indexing) -- each individual
`indexCapability()` call is wrapped in `.catch(err => console.error(...))`, so
a partially-failed run (e.g. one embedding call failing) would report an
identical-looking success count to a fully successful one. There was no
independent read-back confirming what's actually in `compliance.embeddings`.
The gap was real and matched the finding description; not already resolved.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no conflicting in-flight claim on
      capability-backfill-service.ts / capability-registry / embeddings
- [x] Read capability-backfill-service.ts, capability-registry-service.ts,
      embeddings.ts, the backfill API route + page, and the pre-existing
      capability-index-freshness-audit.ts cron loop (a related but distinct
      mechanism -- platform-wide self-heal for worker_agent/module only, not
      an org-scoped coverage report, and doesn't cover automation_rule or
      dynamic_chain)
- [x] Added `measureCapabilityCoverage(ctx)` to capability-backfill-service.ts:
      re-derives ground truth directly from `compliance.embeddings` (which
      source entities actually have an indexed row) independently of the
      backfill's own attempted-count, per entity type (worker_agent,
      automation_rule, module, dynamic_chain) plus an overall rollup, each
      with `{ total, indexed, coveragePercent }`
- [x] Wired it into `backfillCapabilityIndex()`'s return value (additive
      `coverage` field -- existing `agents`/`rules`/`modules`/`chains` counts
      unchanged, so the existing route/page callers keep working)
- [x] New GET route `/api/capability-registry/coverage` (admin-gated, same
      requireAuth+requireRole("admin") pattern as the existing backfill
      route) so coverage can be checked standalone, without running a
      backfill first
- [x] Updated the Capability Registry admin page: new "Index coverage" card
      showing per-type coverage %, loaded on mount and refreshed after a
      backfill run or manual "Refresh" click
- [x] Unit tests for the pure `toCoverage()` math (capability-backfill-service.test.ts)
      -- matches this repo's established convention of not exercising a live
      DB from a .test.ts file; `measureCapabilityCoverage`/
      `backfillCapabilityIndex` themselves are DB-touching and left untested,
      same as their sibling functions in capability-registry-service.ts
- [x] Verify: `bunx tsc --noEmit` -- 0 errors. `bunx eslint` on changed files
      and full repo -- 0 errors (3 pre-existing unrelated warnings, none
      introduced by this change). `bun test` -- full suite 1392 pass / 0 fail
      (was 1392 including the 4 new coverage tests; console noise during the
      run is pre-existing unrelated tests exercising their own fail-closed
      error-logging paths, not failures)
- [x] Did not touch permission-service.ts or any other in-flight worker's
      declared scope (no permission-service change was needed for this gap)

## Remaining
- [ ] None -- gap closed. Not yet committed/pushed/PR'd from this session;
      Rule 6 (branch + PR + green CI, no direct push to main) still applies.
