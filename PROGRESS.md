# PROGRESS -- task-20260719-122711-airouter-01-phase-2--software-team-l0-l5

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml, mother-router.ts, AI_ORCHESTRA_HIERARCHY.md, roster.ts, model-tier-eligibility.ts, dispatch-repo.ts, team-service.ts, /api/ai/team/dispatch/route.ts, roster-overrides.ts)
- [x] Registered ACTIVE-CLAIMS.yaml claim, committed + pushed standalone
- [x] Design decision: L0-L5 extends the existing dispatch pipeline (mother-router.ts + /api/ai/team/dispatch + roster.ts/task-tightening.ts), does NOT duplicate it -- documented in code headers
- [x] Part B: Instruction Contract / Execution Report JSON schema (`src/lib/ai-router/instruction-contract.ts`) -- Execution Report matches the Owner's 4 example payloads exactly (regression-tested)
- [x] Part B: task register as a new DB table `platform.task_register` (schema.ts + drizzle/0249) + service module `task-register-service.ts` -- distinct from `ai_routing_audit_log` (routing decisions) per the task's own instruction
- [x] Part A: L0-L5 ladder data + Universal Tightened Instruction Template fields (`src/lib/ai-router/software-team-ladder.ts`)
- [x] Part A: wired `/api/ai/team/dispatch` to accept optional `softwareTeamLevel` -- validates level/tier consistency, registers Instruction Contract pre-execution, runs a bounded 1-retry loop for L1-L3 (with failure-signal injection), builds + persists a genuine workflow-level Execution Report, returns it in the response. Fully backward-compatible (existing callers omitting `softwareTeamLevel` are unaffected)
- [x] Part C: extended `mother-router.ts`'s `PolicyRule` with `preferredModelByCapabilityCategory` (new axis, additive, still gated through the same `checkTierEligibility()` as every other override -- never a guardrail bypass)
- [x] Part C: seeded `drizzle/0250_software_team_routing_matrix.sql` -- the first-ever active `ai_routing_policies` row for `scope='software_team'`. One deliberate, disclosed divergence from the Owner's literal text: `multi_file_integrative` left unmapped (falls through to `preferredModelByTier.integrative` = `deepseek/deepseek-v4-pro`), not the literal `openai/gpt-oss-120b`, because GPT-OSS-120B is not `INTEGRATIVE_ELIGIBLE` (twice-confirmed failure at this exact task shape) and naming it would silently fall back to the expensive `GLM-5.2` roster baseline for most roles -- defeating the Owner's own cost-bias mandate. Full reasoning in the migration file's own header and in `ai-os/SOFTWARE_TEAM.md`.
- [x] Tests: `mother-router.test.ts`, `software-team-ladder.test.ts`, `instruction-contract.test.ts`, `task-register-service.test.ts`, `src/app/api/ai/team/dispatch/route.test.ts` (real end-to-end integration test covering multi-step accumulation, retry loop, capabilityCategory override, file/test-count flow-through)
- [x] `bunx tsc --noEmit` clean, `bun run lint` clean (0 errors), `bun test` 1814 pass / 0 fail, `bun run build` clean, all 6 local CI guardrail scripts pass
- [x] GLM-5.2 audit round 1 (direct OpenRouter API call) -- 4 blockers, 5 major, 4 minor found (multi-step Execution Report aggregation was silently wrong); all fixed, re-tested clean
- [x] GLM-5.2 audit round 2 -- 2 blockers, 3 major, 5 minor found (incl. round 1's own audit log falsely claiming a route-level test existed); all fixed (added the real route-level integration test), re-tested clean
- [x] GLM-5.2 audit round 3 (final) -- needed 3 physical API attempts to get one complete answer (disclosed honestly in the audit log, not hidden); 2 major, 5 minor found; all fixed except one disclosed low-priority test-mock gap; also independently fixed a pre-existing `knownContext` wiring bug in the route (blocked every real L4/judgment-tier dispatch); re-tested clean (1814 pass)
- [x] Documentation: extended `ai-os/CONSTITUTION.yaml` section 11 (`ai_orchestra_tiers.software_team_l0_l5_implementation`) with amendment_log entry, added pointer in `CLAUDE.md`'s "Read Before Starting Work" list, wrote `ai-os/SOFTWARE_TEAM.md` (mirrors `ai-os/BRAIN.md`'s style, includes the full 3-round audit summary + honestly-disclosed remaining gaps), indexed both new docs in `ai-os/OS.yaml`
- [x] Committed + pushed incrementally (6 commits: claim registration, initial implementation, round 1/2/3 fixes, this final doc-sync commit)
- [x] PR #483 opened against `main` (not self-merged), ACTIVE-CLAIMS.yaml updated with `completed_at` + PR number -- original task DONE

## Completed (REBASE-PR483-FOR-MERGE follow-up)
- [x] Fetched origin, merged origin/main into this branch (real conflicts against the concurrently-merged Cost Incident RCA PR #482, 4 commits on main ahead)
- [x] Resolved 2 conflicts (both governance/tracking files, no code conflicts): PROGRESS.md (kept this task's content, updated to reflect the rebase follow-up; main's RCA content lives in that task's own PROGRESS.md) and ai-os/boss/ACTIVE-CLAIMS.yaml `recently_completed:` (kept BOTH sessions' entries per the repo's established pattern -- this task's PR #483 entry + the RCA task's PR #482 entry)
- [x] Verified the merge introduced no schema.ts / mother-router.ts / migration-number collisions (only auto-merged cleanly: ai-os/OS.yaml picked up the RCA doc's new index entry; new file ai-os/INCIDENT_11K_API_CALLS_RCA.md added cleanly)

## Remaining
- [ ] Run bunx tsc --noEmit, bun run lint, bun test, bun run build on the merged tree; fix anything the merge broke for real
- [ ] Commit the merge resolution, push to the SAME branch (updates existing PR #483)
- [ ] Confirm `gh pr view 483 --json mergeStateStatus` reports something other than DIRTY/CONFLICTING
- [ ] Confirm required checks green (Lint, Type Check, Build, audit-check, Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests); re-trigger audit-check if it ran before the merge-commit push landed
- [ ] Merge PR #483 (`gh pr merge 483 --merge --delete-branch`) -- explicitly authorized by Owner
- [ ] Verify `gh pr view 483 --json state,mergedAt` reports MERGED
- [ ] Final note in ACTIVE-CLAIMS.yaml if needed
