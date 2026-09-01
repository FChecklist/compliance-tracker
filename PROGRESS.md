# PROGRESS -- pr667-resume (real rebase-merge for PR #667)

## Scope
Real rebase-merge of PR #667 (`worker/task-20260731-044026-pm--teams---project-groups-templates`,
"PM Teams, Project Groups, and Project Templates (Task #47)") onto current main, per this repo's
standard rebase-sweep protocol. A prior attempt at this same task failed partway through on a
transient ECONNRESET network error (not a real decision) -- this is a fresh restart, new clone, new
branch. Decision context already verified real before starting: grep of schema.ts for
pmTeams/projectGroups/projectTemplates on main returns zero hits; every Team/Template match on main is
unrelated; no team/group/template directories exist under PM API routes -- PR #667's tables
(pm_teams, pm_team_members, project_groups, project_group_projects, project_templates,
project_team_assignments, project_phases, project_tasks) and services are genuinely new
functionality, not already shipped.

## Environment gotcha hit this session (new, not previously documented)
The scratchpad working directory is NOT exclusive to this session despite being session-scoped by
path -- a first clone into a generic `compliance-tracker` subdirectory was silently deleted out from
under this session mid-task (almost certainly by another concurrent session doing unrelated PR work
in the same physical scratchpad path -- evidence: dozens of other sessions' leftover files for
different PRs, e.g. `pr673*.json`, `r65_part_c_phase1.js`, timestamped minutes apart from this
session's own work, plus other sessions' own uniquely-named clone dirs like `ct2`/`r65c` showing
they'd already learned this lesson). Fix: re-cloned into a uniquely-named directory
(`pr667resume_9480ff4e`, keyed off this session's own id) instead of a generic name. Flagging this
so a future session picks a collision-resistant clone directory name from the start.

## Rebase (this session), branch `pr667-resume` off the PR's real head branch
- [x] Got the PR's real head branch via `gh pr view 667 --json headRefName`:
      `worker/task-20260731-044026-pm--teams---project-groups-templates`. Confirmed real state first:
      `state=OPEN`, `mergeStateStatus=DIRTY`, `mergeable=CONFLICTING` (genuine conflicts expected,
      not a stale/false signal).
- [x] Fresh `gh repo clone`, `git checkout -b pr667-resume` off the PR's head branch (commit
      `5f296ba2`), `git fetch origin main`. Branch had drifted **1333 commits** behind main.
- [x] `git merge origin/main` -- **4 real conflicts, resolved with actual judgment, not blind
      pick-one-side:**

  1. **`PROGRESS.md`** -- this repo's single-current-entry convention: replaced wholesale with this
     file (this section), did not concatenate with either the stale merge-base entry or main's own
     then-current entry (which was a different, still-in-progress rebase-sweep for PR #1212).

  2. **`ai-os/boss/ACTIVE-CLAIMS.yaml`** -- this branch's own diff carried the file's old, pre-Phase-5
     bloated state (its own claim for this task buried in a `recently_completed:` section, 4368 lines
     total). Origin/main had independently pruned this file down to just its current `active:` list
     (1450 lines, `recently_completed:` section removed entirely). Took main's current pruned content
     as-is, unmodified, and appended just this task's one relevant entry back under a fresh
     `recently_completed:` section at the end -- did not reintroduce any of the rest of the stale
     bloated history. Validated: `python -c "import yaml; yaml.safe_load(...)"` parses clean, 35
     active + 1 recently_completed entries.

  3. **`drizzle/meta/_journal.json`** -- this branch's own migration entry (idx 279, tag
     `0302_pm_teams_project_groups_templates`) collided with main's own independent use of `0302`
     for an unrelated migration (`0302_sales_pipeline_dashboard_targets`, Sales Pipeline dashboard
     targets). Found the TRUE current highest migration number the hard way, per this repo's own
     documented gotcha (never trust a stale local checkout or the journal's own idx sequence):
     `git ls-tree -r origin/main -- drizzle/`, parsed with a small Python script (a first attempt with
     a bash grep/sed/sort pipeline silently produced garbled/wrong results on this shell -- did not
     trust it, re-verified numerically in Python instead) -- main's real highest is
     `0518_ai_cost_reconciliation` (journal idx 340). Renamed this branch's migration file
     `drizzle/0302_pm_teams_project_groups_templates.sql` -> `drizzle/0519_pm_teams_project_groups_templates.sql`
     (`git mv`) and appended a new journal entry (idx 341) after main's real idx-340 entry, instead of
     splicing into the middle of main's list. Confirmed via targeted `Grep` that no other file
     (docs, tests, services) references the old `0302_pm_teams...` name or number -- only PROGRESS.md
     did, which is being wholesale-replaced anyway; `crm_sales_targets`-adjacent test files that
     reference "0302" refer to main's own unrelated `0302_sales_pipeline_dashboard_targets.sql` and
     were left untouched.

  4. **`src/lib/db/schema.ts`** -- a large additive conflict that `git` initially rendered as 3
     separate conflict hunks purely because of coincidental identical boilerplate lines
     (`createdAt`/`updatedAt`/`})`) at table-closing points on both sides, not because there were 3
     real separate insertion points. Verified this directly: pulled the full `schema.ts` from both
     branch tips (`git cat-file -p <branch>:src/lib/db/schema.ts`) and confirmed both sides'
     *entire* new content is one single contiguous append immediately after
     `supportSessionsRelations` running to the literal end of file on both branches (this branch:
     165 lines, the `pmTeams`/`pmTeamMembers`/`projectGroups`/`projectGroupProjects`/
     `projectTeamAssignments`/`projectTemplates`/`projectPhases`/`projectTasks` tables + their
     relations; main: 520 lines, several unrelated waves' tables --
     `reportShareLinks`/`submissions`/`pipelineTasks`, the M28 screen-registry tables, RAG/erasure
     tables, `roleQualityRuns`/`providerOutageWindows`). No real semantic collision between the two --
     reconstructed the resolved file as: common prefix (unconflicted, already correctly
     three-way-merged by git) + this branch's full 165-line block verbatim + main's full 520-line
     block verbatim. Zero content dropped from either side, nothing hand-edited inside either block.

## Real validation (this session, post-merge)
- [x] `bun install` -- 1249 packages, clean.
- [x] `node scripts/check-governance-yaml-parse.mjs` -- clean, all 5 governance YAML files parse.
- [x] `NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/tsc.exe --noEmit` -- **0 errors**
      (unlike the original session, no local OOM this time).
- [x] `bun test` on the 3 touched service test files -- 21 pass / 0 fail, 47 expect() calls (same
      counts as the original PR).
- [x] `node scripts/check-terminology-guardrail.mjs --file src/lib/db/schema.ts` -- initially
      **failed** (1 new unexempted `hardcoded_iso_date` finding: this PR's own section-header
      comment "...Task #47 PM gap analysis, 2026-07-31..."). Same benign class as every other entry
      in `ai-os/registry/terminology-guardrail-exemptions.yaml` for this file (dated section-header
      comment, not example/sample data) -- raised the registered count 102 -> 103 with a cited
      reason, re-ran clean.
- [x] `node scripts/check-migration-collision.mjs` -- reports its own known Windows portability
      quirk ("system cannot find the path specified" from an internal `head`/`2>/dev/null` pipeline
      under cmd.exe) but exits 0. Manually re-verified in Python instead of trusting that alone: 345
      `drizzle/*.sql` files, zero duplicate leading numbers; `0519_pm_teams_project_groups_templates.sql`
      is the only `0519_*`, main's own `0302_sales_pipeline_dashboard_targets.sql` is untouched.
- [x] `node scripts/check-migration-integrity.mjs` / `check-migration-schema-drift.mjs` -- both
      clean locally (no `DATABASE_URL` set in this sandbox, so only the file<->journal leg ran; 342
      journal entries, matches the file count). CI runs these against a real DB.
- [x] `bun run lint` -- clean, zero findings.
- [x] Manually confirmed via targeted `Grep` that no `<<<<<<<`/`=======`/`>>>>>>>` markers remain
      anywhere in the working tree, and cleaned up this session's own scratch analysis files
      (`git clean`) before committing so nothing extraneous ships in the PR diff.

## Remaining (this checkpoint)
- [ ] Push `pr667-resume`, open replacement PR "... [was #667]", close #667 pointing to it.
- [ ] Real CI (`gh pr checks`), retry transient network errors up to 5x. Known-ambient
      non-blocking failures per this task: E2E Tests, Vercel (org-wide deployment-blocked), Secret
      Scanning (only if pre-existing), Promptfoo Evals.
- [ ] Merge only when genuinely green (`gh pr merge --squash --delete-branch`), then independently
      verify via `gh pr view --json state,mergedAt` (not just the merge command's exit code).
