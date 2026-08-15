# Progress -- task-20260718-071004-ai-model-lifecycle---benchmarking--depre

## Finding
AI Model Lifecycle & Benchmarking: Model deprecation/rollback process defined.
Gap: Deprecation/rollback is a manual git-revert process, not an automated mechanism.
Recommended: Add an emergency-revert config flag.

## Investigation (before any code)
- `ai_model_registry` (schema.ts) already has a `status` enum
  (active/disabled/deprecated) and orchestra-model-resolver.ts's
  `getRoleModel()` only reads `status='active'` rows -- per-row deprecation
  is already a DB flip, not a git revert.
- `roster-overrides.ts` already has `setRoleOverride`/`clearRoleOverride`
  (DB-backed, PATCH /api/ai/team/dispatch) -- per-role override/clear is
  already a DB action, not a deploy.
- `mother-router.ts` already has `rollbackPolicy()` for versioned
  `ai_routing_policies` -- but no API route calls it, and `ai_routing_policies`
  has zero real INSERT call sites anywhere in src/ (confirmed via grep) --
  effectively dormant infrastructure, already honestly documented as such
  in that file's own header. Left untouched -- out of scope for this
  narrowly-named finding (separate, already-disclosed gap).
- Real remaining gap: none of the above is a single "revert everything to
  known-good, right now" switch. An operator dealing with a bad model still
  has to find and clear/deactivate each affected registry row or role
  override individually, or (for anything still only expressed in code,
  e.g. roster.ts's static defaults) do a real git revert + deploy. That is
  exactly the gap this finding names, and exactly what "add an emergency-
  revert config flag" asks for.

## Plan
1. New table `ai_model_emergency_revert_log` (append-only activate/deactivate
   events, same class as `ai_routing_audit_log`) in schema.ts + migration.
2. New `src/lib/ai-model-emergency-revert.ts`: TTL-cached
   `isEmergencyRevertActive()` (same pattern as orchestra-model-resolver.ts's
   own role-registry cache), `activateEmergencyRevert()`,
   `deactivateEmergencyRevert()`, `getEmergencyRevertStatus()`.
3. Wire into `orchestra-model-resolver.ts`'s `getRoleModel()`: when active,
   skip the DB registry lookup and return the hardcoded fallback literal
   directly.
4. Wire into `roster-overrides.ts`'s `resolveEffectiveModel()`: when active,
   skip the DB override and return roster.ts's static default directly.
5. Admin-gated (`veridian_admin`) API route
   `/api/ai/model-registry/emergency-revert` (GET status, POST
   activate/deactivate).
6. Unit tests for the new module + the two wired branches.
7. `asset-registry-coverage.yaml` exemption entry for the new log table.

## Completed
- [x] Investigation done, gap re-confirmed as real (not already resolved)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Schema (`ai_model_emergency_revert_log`, platform schema, append-only)
      + hand-written migration `drizzle/0313_ai_model_emergency_revert_log.sql`
      (NOTE: `bun run db:generate` was NOT used for the final migration --
      the repo's own drizzle snapshot state is stale/incomplete
      (`drizzle/meta/` only has `0000_snapshot.json` and `0265_snapshot.json`
      committed, nothing for 0266-0312), so a real `db:generate` run diffed
      against the 0265 snapshot and tried to re-create dozens of unrelated
      already-applied tables. Discarded that output; hand-wrote a minimal
      SQL migration for just this table + a matching `_journal.json` entry
      instead. Pre-existing repo issue, out of scope to fix here -- flagging
      for whoever next needs `db:generate` to work cleanly.)
- [x] `src/lib/ai-model-emergency-revert.ts` (isEmergencyRevertActive/
      activateEmergencyRevert/deactivateEmergencyRevert/
      getEmergencyRevertStatus) + `.test.ts` (9 tests)
- [x] Wired into `orchestra-model-resolver.ts`'s `getRoleModel()`
- [x] Wired into `roster-overrides.ts`'s `resolveEffectiveModel()`
- [x] Admin API route `POST/GET /api/ai/model-registry/emergency-revert`
      (veridian_admin-gated)
- [x] `asset-registry-coverage.yaml` exemption entry
- [x] Tests: 50/50 pass across the 3 touched/new test files, in every file
      order tried. Found + fixed a real (pre-existing-pattern, not
      previously hit) bun `mock.module()` cross-file leak my own new test
      file was causing -- `mock.restore()` does NOT undo a `mock.module()`
      call, so the last thin `@/lib/db` mock in one test file can break
      unrelated tests in a LATER file within the same `bun test` process.
      Fixed by capturing the real `@/lib/db` module before mocking and
      restoring it in `afterAll`. Full-suite `bun test`: 2544 pass / 2 fail
      / 2 errors -- verified both the 2 fails (a pre-existing, same-class
      cross-file mock leak between `departments/route.test.ts` and
      `v1/tasks/[id]/status/route.test.ts`, nothing I touched) and the 2
      errors (`Cannot find module '@fchecklist/veridian-ui-kit/*'`, a
      missing workspace package) reproduce identically on a clean
      `origin/main` checkout -- pre-existing, not a regression.
- [x] ESLint clean on all touched/new files (0 errors, 0 warnings)
- [x] `tsc --noEmit -p .` OOMs/times out in this environment even on a
      clean checkout with no changes of mine (confirmed: same behavior
      building the full project) -- a pre-existing environment resource
      constraint, not something this change caused. Not able to get a full
      project type-check to complete here; relying on ESLint (TS-aware)
      + bun test's own transpilation + careful manual review instead.

## Remaining
- [ ] None for this finding. Full CI (which may have more headroom for
      `tsc`/`next build` than this sandbox) is the real final check.
