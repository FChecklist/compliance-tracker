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

## Remaining
- [ ] Schema + migration
- [ ] ai-model-emergency-revert.ts + tests
- [ ] Wire into orchestra-model-resolver.ts
- [ ] Wire into roster-overrides.ts
- [ ] Admin API route
- [ ] asset-registry-coverage.yaml entry
- [ ] Run test suite, lint, typecheck
- [ ] Commit, push, open PR
