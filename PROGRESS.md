# PROGRESS -- task-20260731-043738-crm--project-team-junction-table

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, no collision found, registered claim
- [x] Studied pmsMeetingParticipants/userClientAccess/conversationParticipants junction-table shape + 0269_construction_progress_claims_workflow.sql (most recent real RLS/migration convention)
- [x] Added `projectTeamMembers` table to src/lib/db/schema.ts (org-scoped, projectId/userId/role, matches pmsMeetings-depth RLS convention)
- [x] Hand-written migration drizzle/0302_project_team_members.sql (fetched origin/main fresh, confirmed 0301 was the real highest prefix) -- table + indexes + backfill from existing leadUserId + RLS
- [x] Registered `project_team_members` as exempted (pure join table) in ai-os/registry/asset-registry-coverage.yaml
- [x] Added addProjectTeamMember/removeProjectTeamMember/listProjectTeamMembers to product-service.ts (the real home of all other project CRUD -- crm-service.ts has zero project-related code), keeping leadUserId consistent via extracted pure helpers resolveLeadUserIdOnAdd/resolveLeadUserIdOnRemove
- [x] Unit tests for the pure helpers in product-service.test.ts (no live-DB test, matching repo convention)

- [x] Fixed stale `crm-service.ts` comment references in schema.ts and the migration SQL (functions actually live in product-service.ts)
- [x] `npx tsc --noEmit` clean (exit 0, zero output) across the whole repo
- [x] `bun test src/lib/services/product-service.test.ts` -- 8 pass, 0 fail
- [x] Committed (3b7eb3bc) + pushed `worker/task-20260731-043738-crm--project-team-junction-table`, opened PR #663: https://github.com/FChecklist/compliance-tracker/pull/663 -- left CI-green, not merged, no AUDIT verdict posted (per spec constraints)

- [x] CI green on all required checks: Lint, Type Check, Build, Unit Tests, plus every guardrail job (Terminology, Guardrail Presence, Asset Registry Coverage, Metadata Index Coverage, Doc Cross-Reference, Doc Quarantine Banner, Documentation Sentinel, Secret Scanning, Security Pattern, CodeQL/Analyze). Fixed a Terminology Guardrail Check failure (hardcoded `2026-07-31` ISO date in two comments) in a follow-up commit.
- [x] `audit-check` fails as expected -- Rule 10's mandatory-audit gate, waiting on an independent auditor's `AUDIT: PASS/FAIL` comment (not self-certifiable). `Vercel` also fails, but that's an unrelated account build-rate-limit (vercel.com/.../upgradeToPro=build-rate-limit), not a required check and not caused by this PR's code.

## Remaining
- [ ] None -- task complete. PR #663 open, CI-green on every required check, awaiting independent Rule 7(c) audit (out of scope for this session to self-certify).

## Note
`KERNEL_CONSOLIDATION_STATUS.md` (which the spec asked to append a PR line to) does not exist anywhere in this repo -- confirmed absent both locally and on a freshly-fetched `origin/main` (`git ls-tree -r origin/main --name-only | grep -i kernel` returns nothing). Treating this as a stale reference from a different task template rather than inventing a new file/section whose expected structure isn't specified. PR description itself documents what was built and links back to this task.
