# PROGRESS -- task-20260731-043735-crm--campaigns-entity

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and `ai-os/boss/ACTIVE-CLAIMS.yaml` protocol before picking work
- [x] Confirmed branch is at `origin/main` tip (11db691a), no divergence
- [x] Investigated the spec's premise ("genuinely new -- no existing analog") and found it STALE: `crmCampaigns`
      table (schema.ts:5078), full CRUD service (`crm-campaigns-service.ts`), API routes
      (`src/app/api/crm/campaigns/`), a UI page, and the migration (`drizzle/0251_crm_wave1_activities_campaigns_lost_reasons.sql`)
      were already built and merged on main (Wave 1/2, commits 40423b71 + b4b1ded1), predating this dispatch.
      `calculateCampaignScore` already exists in `marketing-engine.ts` and is already wired via
      `task-execution-engine.ts` -- confirmed, not rebuilding (per this task's own CONSTRAINTS).
- [x] Identified the one real gap against spec's SCOPE line ("name/type/objective/date-range/budget"): no
      `objective` column exists on `crm_campaigns` today.
- [x] Confirmed `KERNEL_CONSOLIDATION_STATUS.md` does not exist anywhere in this repo (find + repo-wide grep for
      "Task #46" across all .md files both empty) -- spec's EXPECTED_OUTPUT instruction to append to it is stale.
      Documented, not silently worked around.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` documenting the above before starting real edits.
- [x] Checked `drizzle/meta/_journal.json` fresh (fetched origin/main) for the real next-free migration number:
      last entry idx 278 / tag `0300_stage12_dispatch_outcomes`; highest numbered .sql file on disk is 0301 ->
      next free number is 0302.

## Remaining
- [ ] Add `objective` column to `crmCampaigns` in schema.ts
- [ ] Write migration `drizzle/0302_crm_campaigns_objective.sql` + matching journal entry
- [ ] Thread `objective` through `crm-campaigns-service.ts` (CreateCampaignInput, createCampaign)
- [ ] Write `src/lib/engines/marketing-engine.test.ts` covering all 6 exported pure functions
- [ ] `npx tsc --noEmit` clean
- [ ] `bun test` on touched test file(s), 0 failures
- [ ] Commit + push, open PR (do not merge, do not self-audit)
