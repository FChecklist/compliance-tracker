# Task: Owner-delegated decision -- provision a real test tenant + 4 role accounts, run GTM cat 15/16

## Context (collision check, done before starting)
- Read `ai-os/boss/ACTIVE-CLAIMS.yaml` first; registered a claim entry there (later moved to
  `recently_completed:`).
- Found this SPEC is a **re-dispatch**, not a fresh gap. Prior session
  `task-20260806-215747-owner-delegated-decision--provision-a-re` already wrote
  `compliance-tracker/scripts/gtm-provision-cat15-16-test-tenant.ts` (commit `6077f3d24`) and
  opened PR #1002 (was `OPEN`, `CONFLICTING`/`DIRTY`, 9 days stale, never merged).
- That provisioning script **had** already run once for real (2026-08-06T22:14Z), but the
  live `gtm_certification_categories` DB (queried directly, not from PR #1002's own body text)
  still showed category 15/16 as `blocked` as of `2026-08-06T17:07Z` -- **before** that
  provisioning run -- so PR #1002's own claim of a corroborated pass was never actually true.
  `pm_decisions_pending` id=69/70 were still `status=open`.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this task's claim.
- [x] Verified live state of `gtm_certification_categories` (cat 15/16 = blocked, not pass) and
      `pm_decisions_pending` id=69/70 (still open) directly against `superboss-register.sqlite`
      -- not trusted from PR #1002's own body text.
- [x] Cherry-picked `compliance-tracker/scripts/gtm-provision-cat15-16-test-tenant.ts` (commit
      `6077f3d24`) into this task's own branch/diff -- reviewed against current
      `src/lib/db/schema.ts` (userRoleEnum, internalUseExempt, authUserId), no drift.
- [x] Re-ran the provisioning script for real (idempotent) against the live app's
      Postgres/Supabase: org `Meridian Test Industries (GTM Cat 15/16 Test Fixture --
      Non-Production)` (`org_id=dstmb99kn1hc4toxb6iqs1td`,
      `slug=meridian-test-industries-gtm-fixture-nonprod`, `internal_use_exempt=true`), 4 real
      accounts (owner/admin, manager, member, viewer), real Supabase Auth credentials freshly
      generated and written only to gitignored `.env.local` -- never committed anywhere.
- [x] Ran `gtm_check_multi_tenant_testing.py` (category 15) for real against
      `https://projexa-ai.com` -- **PASS**: 4/4 accounts logged in and confined to the Meridian
      org, 0 cross-tenant leaks, direct fetch of a real different tenant's (Acme Corp/org_001)
      resource denied (404) for every role including admin.
- [x] Ran `gtm_check_role_permission_testing.py` (category 16) for real -- **PASS**: real
      4-role x 5-endpoint ROLE_RANK matrix (`GET /api/me`, `POST /api/departments`, `POST
      /api/compliance`, `DELETE /api/compliance/[id]`, `POST /api/access-review/cycles`),
      17/17 checks matched the documented boundary exactly, 0 mismatches.
- [x] Confirmed both categories' real pass landed in `gtm_certification_categories` via the
      canonical `gtm_write_category_result.py` (never raw SQL) -- independently re-queried the
      live DB after the writer ran (`passed=1` for both, `validated_at`
      `2026-08-15T03:46:31Z` / `2026-08-15T03:47:43Z`), not just trusted from script stdout.
- [x] Resolved `pm_decisions_pending` id=69 and id=70 via `superboss-register.py
      resolve-pm-decision-pending`, citing this real evidence.
- [x] Updated `ai-os/boss/ACTIVE-CLAIMS.yaml` (moved this task's entry from `active:` to
      `recently_completed:`).
- [x] Closed stale PR #1002 as superseded (comment posted citing this task's real, corroborated
      result).
- [x] Committed + pushed after each meaningful unit.

## Remaining
- [x] Opened this task's own PR against `main`: #1199.
- [x] Posted the required `AUDIT: PASS` structured comment (8 fields, `validate-audit-verdict.ts`
      format) -- honestly disclosed as a single-session self-audit, same limitation this repo's
      own history already documents for single-agent sessions.
- [x] CI's real `bunx tsc --noEmit` caught a genuine pre-existing type bug in the cherry-picked
      script (line 206, `role` possibly-`undefined` per drizzle's own `$inferInsert` typing on a
      column with a DB default) -- fixed with `NonNullable<...>`, pushed, re-triggered CI.
- [ ] Confirm CI is fully green and PR is mergeable (branch-protection/self-approval identity
      limitation may still apply -- see `[[veridian-branch-protection-self-approval-deadlock-active]]`
      in this session's own memory; if so, this is left for the autonomous merge path per
      AGENTS.md Rule 12, not force-merged here).

## Re-verification (for anyone independently re-checking this work)
- Org: `org_id=dstmb99kn1hc4toxb6iqs1td`, `slug=meridian-test-industries-gtm-fixture-nonprod`.
- Accounts: `owner@meridian-test-industries.veridiandemo.internal` (role=admin),
  `manager@...` (role=manager), `member@...` (role=member), `viewer@...` (role=viewer) --
  compliance_user_id/auth_user_id values printed by the provisioning script's own stdout (not
  duplicated here since they change on every re-run reset).
- Script paths: `compliance-tracker/scripts/gtm-provision-cat15-16-test-tenant.ts`,
  `/opt/veridian/scripts/gtm_check_multi_tenant_testing.py`,
  `/opt/veridian/scripts/gtm_check_role_permission_testing.py`,
  `/opt/veridian/scripts/gtm_write_category_result.py`.
- Re-run either check script with `--no-write` at any time to re-confirm without touching the
  DB, or without the flag to re-confirm and re-record.
