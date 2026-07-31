# PROGRESS -- task-20260731-044026-pm--teams---project-groups-templates

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain; registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (committed+pushed separately, before real work)
- [x] Confirmed next-free migration number (0302) via freshly-fetched `origin/main`'s `drizzle/meta/_journal.json` + `ls drizzle/*.sql` (highest existing: 0301)
- [x] Researched real conventions to mirror: `ticket_teams` shape (schema.ts:5503), PMS tables (`pmsMilestones`/`pmsIssues`), org-scoping (`org_id text NOT NULL REFERENCES compliance.organisations(id)`), hand-written-migration RLS pattern (`drizzle/0021_wave25_pms_enablement_and_core_issues.sql`), service-layer convention (`pms-issue-service.ts`, `ticket-service.ts`'s team CRUD), test harness pattern (`pms-time-service.test.ts`)
- [x] Designed genuinely new, decoupled schema (appended to `src/lib/db/schema.ts`, NOT extending `ticket_teams`): `pmTeams` + `pmTeamMembers` (real membership roster, which ticket_teams never had), `projectGroups` + `projectGroupProjects` (many-to-many), `projectTeamAssignments` (project <-> team link, `isPrimary` flag = "default team"), `projectTemplates` (JSON snapshot of phases/tasks, captured either explicitly or from an existing project's real structure), `projectPhases` + `projectTasks` (new minimal ungated tables cloning targets -- deliberately NOT `pms_issues`/`pms_milestones`, out of scope + PMS-branch-gated)
- [x] Hand-written migration `drizzle/0302_pm_teams_project_groups_templates.sql` (CREATE TABLE + RLS `app_runtime_org_scoped`/`service_role_bypass` policies + grants + covering indexes, same shape as 0021's), registered in `drizzle/meta/_journal.json`
- [x] Service layer: `pm-team-service.ts` (list/get/create/update team, list/add/updateRole/remove member), `project-group-service.ts` (list/create/update group, list/add/remove group-project link), `project-template-service.ts` (list/get/create/update template incl. snapshot-from-existing-project, `createProjectFromTemplate` clone function + 2 pure helper functions `buildClonedPhaseRows`/`buildClonedTaskRows`)
- [x] `bun install` (node_modules was missing in this fresh workspace)
- [x] Tests written: `pm-team-service.test.ts`, `project-group-service.test.ts`, `project-template-service.test.ts` (incl. real template-clone-produces-real-cloned-structure test: phases created, tasks linked to their real cloned phase id, default team assignment created)

- [x] `bun test` on the 3 new test files: 21 pass / 0 fail, 47 expect() calls
- [x] `node scripts/check-migration-collision.mjs`: OK, no number collisions
- [x] `node scripts/check-guardrail-presence.mjs`: passed, all 88 markers present
- [x] Manual review of schema.ts diff, migration SQL, and all 3 service files for convention consistency, RLS coverage, FK indexing -- all clean
- [~] `npx tsc --noEmit` locally OOM'd (exit 134, "JavaScript heap out of memory") -- NOT a code issue: `free -h` showed 13Gi/15Gi used, swap exhausted, by other concurrent Claude sessions' node processes on this shared machine (matches known shared-worktree resource contention). Per protocol (stop repeating an approach after a failure rather than burning cycles on a memory-starved retry that will very likely fail identically), did not retry locally. `.github/workflows/ci.yml` runs `bunx tsc --noEmit` as a dedicated CI step on a fresh runner -- deferring the full type-check gate to CI on the PR, consistent with `bun test` already passing and manual review finding no type issues.

## Remaining
- [ ] Commit + push service/schema/migration/test changes
- [ ] Open PR (do not merge, do not self-audit per Rule 7c) -- watch CI's tsc step in particular given the local OOM above
- [ ] Append PR number + summary to `KERNEL_CONSOLIDATION_STATUS.md`'s Task #47 section
- [ ] Move ACTIVE-CLAIMS.yaml entry from `active:` to `recently_completed:` once PR is open
