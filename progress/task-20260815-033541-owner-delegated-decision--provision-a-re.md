# Task: Owner-delegated decision -- provision a real test tenant + 4 role accounts, run GTM cat 15/16

## Context (collision check, done before starting)
- Read `ai-os/boss/ACTIVE-CLAIMS.yaml` first; registered a claim entry there.
- Found this SPEC is a **re-dispatch**, not a fresh gap. Prior session
  `task-20260806-215747-owner-delegated-decision--provision-a-re` already wrote
  `compliance-tracker/scripts/gtm-provision-cat15-16-test-tenant.ts` (commit `6077f3d24`) and
  opened PR #1002 (still `OPEN`, `CONFLICTING`/`DIRTY`, 9 days stale, never merged).
- That provisioning script **did** actually run for real: `/opt/veridian/repos/compliance-tracker/.env.local`
  (the live checkout, separate from this task's isolated worktree) has real
  `GTM_TEST_MERIDIAN_ORG_ID` / `GTM_TEST_MERIDIAN_ORG_SLUG` / one `*_EMAIL` key per role,
  last modified `2026-08-06T22:14Z`.
- Independently queried the live DB directly (not the PR body's own narration) --
  `gtm_certification_categories` / `ocid_master_standard_audit_log`: the real last write for
  category 15 and category 16 is `2026-08-06T17:07Z`, result=`blocked` -- **before** the
  22:14Z provisioning run. PR #1002's body claim ("PASS...verified directly against the live
  DB") is **not corroborated** by the live audit log -- no later pass-recording write exists.
  `pm_decisions_pending` id=69 / id=70 are still `status=open`.
- Conclusion: real remaining work is (1) land the provisioning script for real in this task's
  own diff, (2) actually re-run the two GTM check scripts for real against the live app,
  (3) get a genuinely corroborated pass/fail written to `gtm_certification_categories` via the
  canonical writer, (4) resolve pm_decisions_pending id=69/70 with real evidence citations.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this task's claim.
- [x] Verified live state of `gtm_certification_categories` (cat 15/16 = blocked, not pass) and
      `pm_decisions_pending` id=69/70 (still open) directly against `superboss-register.sqlite`
      -- not trusted from PR #1002's own body text.
- [x] Confirmed the dummy tenant + 4 accounts were already provisioned for real on 2026-08-06
      (`GTM_TEST_MERIDIAN_*` keys present in the live checkout's `.env.local`).

## Remaining
- [ ] Bring `compliance-tracker/scripts/gtm-provision-cat15-16-test-tenant.ts` into this task's
      own committed diff (cherry-pick from `6077f3d24`, resolve conflicts against current main).
- [ ] Re-run the provisioning script for real (idempotent) to confirm/refresh the tenant + 4
      accounts are genuinely live right now, not just as of 9 days ago.
- [ ] Actually run `gtm_check_multi_tenant_testing.py` (category 15) for real against
      `https://projexa-ai.com`.
- [ ] Actually run `gtm_check_role_permission_testing.py` (category 16) for real.
- [ ] Confirm both categories' real pass/fail landed in `gtm_certification_categories` via the
      canonical `gtm_write_category_result.py` (never raw SQL, never narrated).
- [ ] Resolve `pm_decisions_pending` id=69 and id=70 via `superboss-register.py
      resolve-pm-decision-pending`, citing the real evidence.
- [ ] Update this task's own `ACTIVE-CLAIMS.yaml` entry (active -> recently_completed) once
      merged.
- [ ] Decide fate of stale PR #1002 (close as superseded, or reuse) once this task's own PR is
      open.
- [ ] Commit + push after each meaningful unit.
