# PROGRESS -- task-20260731-044019-pm--project-status-access-rollup

## Completed
- [x] Fetched origin/main fresh; confirmed next-free migration number is 0302 (journal.json is stale/stub at idx 3 -- cross-checked against real `drizzle/*.sql` filenames instead, per this repo's established hand-written-migration convention)
- [x] Audited `projects` table (schema.ts): confirmed status/accessLevel/rollupPercentage/customTabs are ALL genuinely missing at DB level (only issuePrefix/issueSequence/leadUserId/startDate/targetDate/healthStatus/parentProjectId exist from Wave 25) -- not a "just expose it" case, real columns needed
- [x] Found the existing construction-domain deterministic rollup pattern (construction-dashboard-service.ts's getProjectDashboard() `progressPercent` = average of each activity's latest logged percentComplete) and generalized it to PMS issues
- [x] Added migration `drizzle/0302_pms_project_status_access_rollup.sql` + schema.ts: `projects.status` (pms_project_status enum, default 'active'), `projects.accessLevel` (pms_project_access enum, default 'public' -- preserves existing unrestricted-read behavior for every pre-existing row), `projects.rollupPercentage` (integer, default 0), `projects.customTabs` (jsonb array, default [])
- [x] `calculateProjectRollupPercentage()` + `recalculateProjectRollup()` in pms-issue-service.ts -- deterministic average of non-archived issues' completionPercentage, written back to `projects.rollupPercentage` inline on every createIssue()/updateIssue() call that can move it
- [x] `canReadProject()` in product-service.ts -- the real Private/Public access gate (public = unrestricted, unchanged; private = admins + the project's own leadUserId only). Wired into GET /api/projects/[id] (404s for unauthorized, same as not-found) and listAllProjectsForOrg() (filters the list)
- [x] Exposed status/accessLevel/customTabs in the New Project creation form (src/app/(app)/pms/page.tsx) + rollupPercentage/access badge on project cards
- [x] Tests: pms-issue-service.test.ts (calculateProjectRollupPercentage, 6 cases) + new product-service.test.ts (canReadProject, 7 cases including the required "private project refused for unauthorized member" case)

- [x] `npx tsc --noEmit` clean run (exit 0, no errors)
- [x] `bun test` on touched files: 20 pass / 0 fail, 24 expect() calls (pms-issue-service.test.ts + product-service.test.ts)
- [x] Register claim in ai-os/boss/ACTIVE-CLAIMS.yaml

- [x] Opened PR #664 against FChecklist/compliance-tracker: https://github.com/FChecklist/compliance-tracker/pull/664 (not merged, not self-audited)
- [x] KERNEL_CONSOLIDATION_STATUS.md does not exist in this repo (confirmed via find/grep) -- Task #47 summary put in the PR description instead, noted honestly rather than silently skipped

- [x] Monitored PR #664 CI (invocation 3, 2026-07-31): all fixable gates green -- Lint, Type Check, Build, Unit Tests, E2E Tests, Analyze, Guardrail Presence Check, Secret Scanning, Security Pattern Check, Terminology Guardrail Check, Doc Cross-Reference/Quarantine/Sentinel Checks, Asset Registry Coverage Check, Metadata Index Coverage Check all pass. Two checks are red, both correctly out of this session's scope to fix:
  - `Vercel` -- fails with "Deployment rate limited" (external quota, not a code issue). Precedent in `ai-os/boss/COMPLETED.yaml` (WAVE-177/PR #282 audit entry) confirms this preview-deploy check fails intermittently across unrelated recent waves and is not treated as a merge blocker.
  - `audit-check` -- fails with "No structured audit verdict found. Per AGENTS.md Operating Rule 7c, post a comment starting with 'AUDIT: PASS' or 'AUDIT: FAIL'..." This is the expected, correct state: per Rule 7c the doer may not self-certify, so this session (the doer) does not post that comment. Requires a separate auditor session/agent to independently re-verify (re-run tsc/bun test, spot-check the diff, confirm the migration SQL) and post the verdict, per the pattern documented for WAVE-177/PR #282.

## Remaining
- [ ] Awaiting an independent auditor session to review PR #664 and post the mandatory `AUDIT: PASS`/`AUDIT: FAIL` comment (Rule 7c/10) -- not actionable by this session per its own "do not self-audit" constraint. Once posted (and Vercel's rate-limit clears/retries), PR #664 should be mergeable.

## Notes / honest limitations
- No live DB credentials in this sandbox (no DATABASE_URL, no Supabase MCP tool available) -- migration SQL is written and reviewed against the exact hand-written-migration convention (0268's own header) but not applied live. Flagged in the PR description for the merging session to apply via Supabase MCP or db:push before/at merge time.
- Private-project access control is scoped to the real `projects`-entity read paths (GET /api/projects, GET /api/projects/[id]) per the task's explicit scope boundary (not touching pms_issues). Deeper PMS sub-resource routes (e.g. reading issues within a private project directly) are a natural follow-up, not built here -- flagged in the PR description, not silently assumed complete.
