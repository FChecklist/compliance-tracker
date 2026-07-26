# PROGRESS -- task-20260726-171939-delegation-expiry-enforcement-audit---te

## Completed
- [x] Re-verified triage evidence against the live tree: `isDelegated()`/`isDelegationActive()` (delegation-service.ts) had zero consumers outside that file -- confirmed still true, not fixed elsewhere since 2026-07-26 triage.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before real work (no collision found).
- [x] Audited every `requireRole()`/`hasRole()`/`ROLE_RANK[...]`/`requirePermission()`/`requireRoleOrScope()` checkpoint (~100 call sites) against the 6 `DELEGATION_SCOPE_TYPES` -- see `ai-os/DELEGATION_EXPIRY_ENFORCEMENT_AUDIT_2026-07-26.md` for the full checkpoint-by-checkpoint findings.
- [x] Wired `isDelegated()` into `approval-workflow-service.ts`'s `decideApprovalStep()` (the generalized Approval Workflow Engine's real, non-listing per-step decision) -- rank-insufficient deciders now get a delegation fallback, expiry/revocation-aware, purely additive.
- [x] Wired the same pattern into `erp-payment-entries-service.ts`'s `canDecidePaymentEntry()`/`decidePaymentEntry()` (a second, independent, hard-coded mandatory-approval checkpoint that explicitly mirrors `decideApprovalStep()`) -- additive `hasDelegatedAuthority` param, default `false`, self-approval still always blocked.
- [x] Split `isDelegated()`'s decision logic into the separately-exported, DB-free `resolveDelegatedAuthority()` (pure refactor, no behavior change) so it's directly unit-testable.
- [x] Added regression tests proving an EXPIRED (and separately, a revoked) delegation is rejected at both non-listing checkpoints: `delegation-service.test.ts` (`resolveDelegatedAuthority` suite), `approval-workflow-service.test.ts` (`decideApprovalStep's delegation fallback` suite), `erp-payment-entries-service.test.ts` (`hasDelegatedAuthority` cases).
- [x] Verified success-criteria command is non-empty: `grep -rln "isDelegated(\|isDelegationActive(" src --include=*.ts | grep -v delegation-service` now hits `approval-workflow-service.ts`, `erp-payment-entries-service.ts`, and both their `.test.ts` files.
- [x] Full suite green: `bun test` -- 2042 pass / 0 fail / 4000 expect() calls across 166 files. `bunx tsc --noEmit -p .` clean.
- [x] Wrote audit doc: `ai-os/DELEGATION_EXPIRY_ENFORCEMENT_AUDIT_2026-07-26.md` (methodology, findings, what was wired vs. deliberately left alone and why, verification commands).

## Remaining
- [x] Open PR against `compliance-tracker`: [#579](https://github.com/FChecklist/compliance-tracker/pull/579) (this is auth-logic -- Tier2, holds for Owner sign-off per task constraints, no autonomous merge regardless of CI outcome).
- Documented-not-actioned follow-ups (see audit doc's "no delegation scope applies" section and closing note): `permission-service.ts`'s `ERP_ACTION_ROLES` (a much larger, separate RBAC primitive spanning ~51 routes -- out of scope for this task's blast radius), and `createDelegation()` not currently verifying the delegator holds the authority they're handing off (a delegation-*creation* gap, distinct from this task's delegation-*expiry-at-consumption* scope).
