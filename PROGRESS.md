# PROGRESS -- task-20260719-122711-airouter-01-phase-2--software-team-l0-l5

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml, mother-router.ts, AI_ORCHESTRA_HIERARCHY.md, roster.ts, model-tier-eligibility.ts, dispatch-repo.ts, team-service.ts, /api/ai/team/dispatch/route.ts, roster-overrides.ts)
- [x] Registered ACTIVE-CLAIMS.yaml claim, committed + pushed standalone
- [x] Design decision: L0-L5 extends the existing dispatch pipeline (mother-router.ts + /api/ai/team/dispatch + roster.ts/task-tightening.ts), does NOT duplicate it -- documented in code headers
- [x] Part B: Instruction Contract / Execution Report JSON schema (`src/lib/ai-router/instruction-contract.ts`) -- Execution Report matches the Owner's 4 example payloads exactly (regression-tested)
- [x] Part B: task register as a new DB table `platform.task_register` (schema.ts + drizzle/0249) + service module `task-register-service.ts` -- distinct from `ai_routing_audit_log` (routing decisions) per the task's own instruction
- [x] Part A: L0-L5 ladder data + Universal Tightened Instruction Template fields (`src/lib/ai-router/software-team-ladder.ts`)
- [x] Part A: wired `/api/ai/team/dispatch` to accept optional `softwareTeamLevel` -- validates level/tier consistency, registers Instruction Contract pre-execution, runs a bounded 1-retry loop for L1-L3, builds + persists the Execution Report, returns it in the response. Fully backward-compatible (existing callers omitting `softwareTeamLevel` are unaffected)
- [x] Part C: extended `mother-router.ts`'s `PolicyRule` with `preferredModelByCapabilityCategory` (new axis, additive, still gated through the same `checkTierEligibility()` as every other override -- never a guardrail bypass)
- [x] Part C: seeded `drizzle/0250_software_team_routing_matrix.sql` -- the first-ever active `ai_routing_policies` row for `scope='software_team'`. One deliberate, disclosed divergence from the Owner's literal text: `multi_file_integrative` seeded to `deepseek/deepseek-v4-pro`, not the literal `openai/gpt-oss-120b`, because GPT-OSS-120B is not `INTEGRATIVE_ELIGIBLE` (twice-confirmed failure at this exact task shape) and naming it would silently fall back to the expensive `GLM-5.2` roster baseline for most roles -- defeating the Owner's own cost-bias mandate. Full reasoning in the migration file's own header and in `ai-os/SOFTWARE_TEAM.md`.
- [x] Tests: `mother-router.test.ts` (capability-category resolution + cost-bias spot-check), `software-team-ladder.test.ts`, `instruction-contract.test.ts` (Owner's 4 worked examples as regression fixtures)
- [x] `bunx tsc --noEmit` clean, `bun run lint` clean (0 errors), `bun test` 1795 pass / 0 fail, `bun run build` clean, all 6 local CI guardrail scripts pass

## Remaining
- [ ] GLM-5.2 audit round 1 (direct OpenRouter API call) + append findings to `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md` + fix real gaps + re-test
- [ ] GLM-5.2 audit round 2 + fixes + re-test
- [ ] GLM-5.2 audit round 3 + fixes + re-test
- [ ] Documentation: extend `ai-os/CONSTITUTION.yaml` section 11, add pointers in `CLAUDE.md`/`AGENTS.md`, write `ai-os/SOFTWARE_TEAM.md` (mirroring `ai-os/BRAIN.md`'s style, including the 3-round audit summary + disclosed gaps)
- [ ] Commit + push incrementally
- [ ] Open PR against `main` (not self-merged), update `ACTIVE-CLAIMS.yaml` with `completed_at` + PR number
