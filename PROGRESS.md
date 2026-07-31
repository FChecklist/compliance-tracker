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

## Remaining
- [ ] Commit + push, open PR

## Note
`KERNEL_CONSOLIDATION_STATUS.md` (which the spec asked to append a PR line to) does not exist anywhere in this repo -- confirmed absent both locally and on a freshly-fetched `origin/main` (`git ls-tree -r origin/main --name-only | grep -i kernel` returns nothing). Treating this as a stale reference from a different task template rather than inventing a new file/section whose expected structure isn't specified. PR description itself documents what was built and links back to this task.
