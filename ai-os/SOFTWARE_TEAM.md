# VERIDIAN AI OS — the Software Team L0-L5 system, plain language

AIROUTER-01 Phase 2 (Owner directive, 2026-07-19). This document explains,
in plain language, the REAL implementation behind
`ai-os/AI_ORCHESTRA_HIERARCHY.md`'s Table 1 (Software Development) --
mirrors `ai-os/BRAIN.md`'s style: every claim below is grounded in a file
this document's author actually read, cited by path. Where something is
genuinely unfinished or divergent from the Owner's raw spec text, that is
stated plainly, not smoothed over.

---

## 1. What this system is, in one paragraph

The Owner asked for three things "as ONE coherent system": (a) a Software
Team L0-L5 execution ladder describing who does what at each level of
software-development work, (b) a matched Instruction Contract (pre-
execution input) / Execution Report (post-execution output) JSON schema +
task register so every dispatched task carries the same structured
contract, and (c) a capability-based routing matrix that sends most real
work to cheap/mid-cost models and reserves the expensive judgment-tier
model for planning, supervision, and audit. None of this is a new dispatch
mechanism. It is a real, additive layer on top of the already-merged Mother
Router (`src/lib/ai-router/mother-router.ts`, PR #433) and the existing AI
Dev Team dispatch pipeline (`roster.ts` / `task-tightening.ts` /
`model-tier-eligibility.ts` / `/api/ai/team/dispatch`) -- see §5 for the
explicit "why this isn't a duplicate system" reasoning.

---

## 2. The L0-L5 ladder (Part A)

`src/lib/ai-router/software-team-ladder.ts`'s `SOFTWARE_TEAM_LADDER`
constant is the single source of truth for what each level is allowed to
do, carrying the Owner's own "Universal Tightened Instruction Template"
fields for every level (retry policy, escalation rules, documentation/
evidence/handover requirements):

| Level | Role | Authority | Not Allowed | Automatic Retries |
|---|---|---|---|---|
| L0 | Software Engine (no AI) | None | Reasoning | n/a -- no AI dispatch path exists for L0 in this PR; it is CI/build/test/migration tooling, unchanged |
| L1 | Code Worker | Execute only | Architecture | 1 |
| L2 | Sequential Worker | Execute only | Design decisions | 1 |
| L3 | Feature Worker | Implementation only | Architecture changes | 1 |
| L4 | Coding Supervisor | Technical decisions | Company decisions | 0 (as-needed re-plan, not a bare retry) |
| L5 | Mother Router / Super Boss | Full authority | Routine coding itself | n/a -- IS the router, never a dispatch target |

**Every "model" named in the ladder is descriptive only** -- the real model
used for any dispatch is resolved live through `resolveModel()` /
`checkTierEligibility()` / `roster-overrides.ts`, matching
`AI_ORCHESTRA_HIERARCHY.md`'s own "model-agnostic" principle. Nothing here
hardcodes a model as an enforcement value.

**How this actually wires into a real dispatch**: `/api/ai/team/dispatch`
(`src/app/api/ai/team/dispatch/route.ts`) accepts an OPT-IN
`softwareTeamLevel` field. Omitted -> the route behaves exactly as it did
before this PR (every existing caller is unaffected). Declared -> the route:

1. Validates the declared level against the declared `complexityTier`
   before calling any model (`validateLevelDispatch()`) -- an L1 dispatch
   declaring `complexityTier: "judgment"` is rejected with guidance, not
   silently coerced.
2. Resolves a capability-category routing signal (Part C, §4) alongside
   the existing tier check.
3. Registers an Instruction Contract for the task BEFORE execution (§3).
4. Runs a bounded automatic retry loop (0-1 retries per the level's own
   `maxAutomaticRetries`) -- and, per audit round 1's fix, a retry now
   injects the SPECIFIC low-confidence/knowledge-gap signal that triggered
   it back into the retried prompt, so a retry is a real second attempt,
   not a bare re-roll of the identical input.
5. Builds and persists an Execution Report (§3), returning it in the
   response.

**L0 and L5 are documented, not dispatchable.** L0 has no AI-dispatch path
in this PR at all -- it is this codebase's existing, unchanged CI/build/
test/migration tooling. L5 IS the Mother Router itself (`resolveModel()`)
plus the human Super Boss role (`AGENTS.md`) -- it assigns work to L1-L4,
it is never itself a dispatch target. `validateLevelDispatch()` rejects
both explicitly, with guidance pointing at their real execution path.

---

## 3. Instruction Contract / Execution Report + task register (Part B)

`src/lib/ai-router/instruction-contract.ts` defines two genuinely new JSON
shapes, distinct from `platform.ai_routing_audit_log` (which only logs
which MODEL got picked and why, never a task's actual input/output):

- **Instruction Contract** (pre-execution): `{taskId, level, roleKey,
  objective, preconditions, input, process, expectedOutputFormat,
  validationCriteria, successCriteria, failureCriteria, retryPolicy,
  escalationRule, documentationRequirements, evidenceRequired,
  handoverRequirements, expectedSteps}` -- the Owner's Universal Tightened
  Instruction Template fields, verbatim. Built from the level's own ladder
  contract (`baseProcessSteps`, `retryPolicy`, `escalationRules`, etc.) plus
  the caller's TightTask fields -- not a hollow echo of the caller's raw
  `scope` string (audit round 1 fixed this specifically, see the audit log).
- **Execution Report** (post-execution): matches the Owner's own 4 worked
  examples EXACTLY as the schema (`{task_id, task_type, objective, status,
  overall_confidence, completion, steps, missing, warnings, errors,
  escalation, execution_summary}`) -- used verbatim as regression test
  fixtures in `instruction-contract.test.ts`.

**Task register**: `platform.task_register` (schema.ts + `drizzle/0249`),
a new table -- one row per `taskId`, holding both the Instruction Contract
and the (possibly still-accumulating) Execution Report. A multi-step L2/L3
workflow reuses the SAME `taskId` across its sequential dispatch calls;
`task-register-service.ts`'s `recordExecutionReport()` aggregates each new
step onto the prior report into a genuine workflow-level view: `status` is
FAIL if any accumulated step failed, `overall_confidence` is the MINIMUM
across all steps (a workflow is only as confident as its weakest step),
`execution_summary` fields are SUMMED across steps, and `objective` stays
the FIRST step's objective -- never silently overwritten by a later,
narrower step's objective. The row is only marked `"completed"` once the
accumulated step count reaches the `expectedSteps` the FIRST dispatch call
declared -- not after any single passing step (this exact bug was the
worst finding of audit round 1, see the audit log's B1 entry).

---

## 4. Capability-based routing matrix (Part C)

The Owner's routing matrix names 4 task categories
(`software-team-ladder.ts`'s `CapabilityCategory` type):
`single_file_mechanical`, `multi_file_integrative`,
`architecture_design_analysis`, `planning_governance_oversight`. This is a
FINER axis than `task-tightening.ts`'s 3-value `ComplexityTier`
(mechanical/integrative/judgment) -- every category still resolves THROUGH
a `ComplexityTier` (`COMPLEXITY_TIER_FOR_CATEGORY`), so
`model-tier-eligibility.ts`'s guardrail is never bypassed by this new axis.

`mother-router.ts`'s `PolicyRule` gained one additive field,
`preferredModelByCapabilityCategory`, checked BEFORE the existing
`preferredModelByTier` fallback but still run through the identical
`checkTierEligibility()` gate every other override already uses -- naming
an ineligible model here can never grant it the work; it silently
downgrades to the eligible baseline, exactly like an ineligible
`preferredModelByRole` override already does.

`drizzle/0250_software_team_routing_matrix.sql` seeds the first-ever ACTIVE
`ai_routing_policies` row for `scope='software_team'`:

| Category | Seeded model | Matches Owner's literal text? |
|---|---|---|
| single_file_mechanical | `openai/gpt-oss-20b` | Yes |
| multi_file_integrative | *(unmapped -- falls through to `preferredModelByTier.integrative` = `deepseek/deepseek-v4-pro`)* | **No -- deliberate, disclosed divergence, see below** |
| architecture_design_analysis | `deepseek/deepseek-v4-pro` | Yes |
| planning_governance_oversight | `z-ai/glm-5.2` | Yes |

**The one deliberate divergence, explained plainly**: the Owner's Part C
text names GPT-OSS-120B for "multi-file/integrative implementation tasks."
`model-tier-eligibility.ts`'s `INTEGRATIVE_ELIGIBLE` set explicitly excludes
GPT-OSS-120B -- that file's own header states it was confirmed TWICE in
this codebase's real history to burn its full iteration budget on exactly
this task shape (multi-file wiring) without writing anything, even after a
much-tightened brief. Per AGENTS.md Operating Rule 9, no guardrail may be
weakened or routed around without the Owner's explicit written instruction
-- this task's own prompt asked for the matrix to be "swappable," not for
`INTEGRATIVE_ELIGIBLE` to be reopened. Naming GPT-OSS-120B anyway would not
have been a safe no-op either: `computeSoftwareTeamResolution()` always
runs an override through `checkTierEligibility()`, and on ineligibility
falls back to `roster.ts`'s own STATIC per-role baseline -- which is
GLM-5.2 for most engineering roles, the single most expensive model in the
fleet. Seeding the Owner's literal choice would have silently defeated the
cost-bias mandate for exactly the category meant to help it, while looking
correct on a superficial read. Seeded instead: DeepSeek V4 Pro (already
integrative-eligible, already this codebase's "middle" tier per
`CONSTITUTION.yaml`'s `ai_orchestra_tiers` TIER-2, and the same model
`AI_ORCHESTRA_HIERARCHY.md`'s own Table 1 already names for L3 Feature
Worker). If GPT-OSS-120B is wanted here for real, that requires first
reopening the `INTEGRATIVE_ELIGIBLE` decision itself -- a separate,
explicit, owner-level call, not something this PR does unilaterally.

**Cost bias, verified not just asserted**: `mother-router.test.ts`'s "Part
C's actual seeded matrix" test proves that `fullstack_developer` (whose
`roster.ts` baseline is GLM-5.2, the expensive judgment-tier model)
actually resolves to `openai/gpt-oss-20b` for a `single_file_mechanical`
dispatch and `deepseek/deepseek-v4-pro` for `multi_file_integrative` --
a real, executable regression proof, not a comment claiming it works.

---

## 5. Why this isn't a duplicate dispatch mechanism

`AI_ORCHESTRA_HIERARCHY.md` (PR #476, already merged) states its own Table
1 maps "L4/L5 ... to Mother Router's `resolveModel()`... L0-L3 ... to the
existing `roster.ts`/`checkTierEligibility()`/`task-tightening.ts`
pipeline. No new abstraction layer was created." This PR makes that mapping
REAL rather than aspirational: `software-team-ladder.ts` is DATA (the
ladder's contract fields), not a parallel dispatch engine; the actual
dispatch is still `classifyTask()` -> `checkTierEligibility()` ->
`runRole()` inside `/api/ai/team/dispatch`, unchanged in its core shape.
`model-tier-eligibility.ts`, `orchestra-model-resolver.ts`, `roster.ts`, and
`llm-client.ts` were NOT modified -- only called into, per this task's own
constraint and the same discipline `mother-router.ts` itself already
established.

---

## 6. Independent audit summary (GLM-5.2, 3 rounds)

Full verbatim findings and fixes: `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md`.

*(This section is updated after each round completes -- filled in fully
once all 3 rounds are done; see the audit log for the authoritative,
append-only record in the meantime.)*

---

## 7. Honest, disclosed gaps that remain

- **L0 has no real dispatch/rejection wiring beyond documentation and a
  guidance string.** It is correctly excluded from `/api/ai/team/dispatch`,
  but nothing in this PR adds a NEW L0-aware entry point to
  `task-execution-engine.ts` -- L0 is the ladder's documentation of an
  EXISTING, unchanged deterministic path, not a new integration.
- **`architecture_design_analysis` has no ladder level that defaults to
  it.** L4 maps to `planning_governance_oversight` instead (see
  `software-team-ladder.ts`'s own comment on why forcing L4 onto the
  DeepSeek-tier category would silently downgrade its judgment-tier
  guardrail). A caller can still select `architecture_design_analysis`
  explicitly via the route's `capabilityCategory` override field (audit
  round 1 fix), but no level chooses it by default.
- **`recordExecutionReport()`'s read-merge-write is not atomic.** Two
  concurrent dispatch calls sharing the same `taskId` can race and silently
  drop a step. L2/L3 are sequential by the Owner's own ladder contract, so
  this is a real, accepted Phase-1 limitation for an out-of-design usage
  pattern, not engineered around with a DB transaction/row lock this phase
  doesn't need yet -- same disclosure class as `mother-router.ts`'s own
  `rollbackPolicy()` concurrent-caller gap.
- **The migration was NOT applied to any live database.** Per this repo's
  own tier2 rule (schema/architecture changes held for explicit Owner
  sign-off), `drizzle/0249`/`0250` exist as reviewed SQL files only.
