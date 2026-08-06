# PROGRESS -- task-20260806-215747-owner-delegated-decision--provision-a-re

## Completed
- [x] Read governance chain (AGENTS.md, CLAUDE.md, ACTIVE-CLAIMS.yaml) and confirmed no
      concurrent session is already provisioning this exact tenant/accounts.
- [x] Found the real blocking chain this task resolves: GTM category 15 (`multi tenant testing`)
      and category 16 (`role permission testing`) in `gtm_certification_categories` are both
      `passed=NULL` ("blocked"), re-confirmed 2026-08-06 (`UMR-20260806-165616-74d5`), citing the
      standing no-credential-entry rule + open `pm_decisions_pending` id=69/id=70 recommending
      exactly this: an Owner-provisioned real test credential. This SPEC is that Owner-delegated
      decision.
- [x] Confirmed real auth mechanism: Supabase Auth Admin API (service-role key) against project
      `pcrjmlpuqsbocqfwoxod` ("verdian-ai"), `compliance.users` matched by email
      (`src/lib/supabase/auth-guard.ts`), `passwordHash` column is dead-code placeholder
      `"supabase-auth-managed"`. Role enum: admin/manager/member/viewer (+6 Wave-1 roles, not
      used here). Real Postgres RLS via `app.current_org_id` GUC (`src/lib/db/tenant-scoped.ts`),
      not just app-layer filtering.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, validated YAML still parses.

## Remaining
- [ ] Provision org "Meridian Test Industries" (obviously-fictional, clearly test-flagged via
      name + `internalUseExempt=true`) in `compliance.organisations`.
- [ ] Create 4 real Supabase Auth users (admin, manager, member, viewer) + matching
      `compliance.users` rows, generated random passwords, stored only in gitignored
      `.env.local`, never committed in plaintext.
- [ ] Rewrite `gtm_check_multi_tenant_testing.py` (category 15) to really sign in as each test
      account and probe cross-tenant isolation against https://projexa-ai.com.
- [ ] Rewrite `gtm_check_role_permission_testing.py` (category 16) to really sign in as each
      test account and probe the role/permission matrix.
- [ ] Run both scripts for real, record pass/fail into `gtm_certification_categories` via
      `gtm_write_category_result.py` only (never a narrated pass).
- [ ] Commit+push provisioning script + rewritten check scripts to `veridian-scripts` repo.
- [ ] Commit+push this task's `ai-os/` bookkeeping to `compliance-tracker` via PR.
