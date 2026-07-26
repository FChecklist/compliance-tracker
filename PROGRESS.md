# PROGRESS -- task-20260726-035742-phase3-business-rule-permission-policy-c

VERIDIAN_Architecture_v2.0 phase_3_governance_policy_cost_engines. See
ai-os/boss/ACTIVE-CLAIMS.yaml for full scope/design writeup.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, phase plan, gap analysis) + researched real prior art
- [x] Registered ACTIVE-CLAIMS entry, pushed standalone commit
- [x] schema.ts: additive columns (promptTemplates.ownerId; promptVersions.approvedById/approvedAt/stagingEnteredAt) + drizzle/0263 migration (seeds module_registry/module_rule_configs platform defaults too)
- [x] permission-service.ts: PROMPT_ACTION_ROLES (engine-permission)
- [x] prompt-governance-service.ts (new): business-rule accessors, PII scan, ownership assignment, dependency lookup, ABAC wiring, eval budget guardrail, audit event helper, orchestrating gate function
- [x] prompt-os-service.ts: named permissions + full gate stack wired into transitionPromptLifecycle (governance-lifecycle-state-machine)
- [x] prompt-eval-service.ts: named permissions + budget guardrail + audit trigger extension (engine-audit)
- [x] scripts/export-prompt-versions-gitops.ts: prompts-as-versioned-git-files half of governance-gitops-workflow
- [x] Tests: prompt-governance-service.test.ts (new) + existing prompt-os-service.test.ts/permission-service.test.ts still pass (81 pass, 0 fail)
- [x] tsc --noEmit clean, eslint clean on all touched/new files

## Known, honestly-carried limitation
- governance-gitops-workflow's "branch protection requiring passing evals before merge" sub-item is NOT done: needs a .github/workflows/ai-prompt-evals.yml edit, and this session's gh token lacks `workflow` OAuth scope (cannot push a branch touching that path). Documented in the export script's own header and ACTIVE-CLAIMS entry. Needs a future session with `workflow` scope, or the Owner pushing that one-line edit.

## Remaining
- [ ] claude-control: ai-os/VERIDIAN_V2_LIFECYCLE_GOVERNANCE_SCHEMA_2026-07-25.yaml (schema-only design doc)
- [ ] claude-control: register-knowledge + query-knowledge success criteria
- [ ] claude-control: update phase_3 entry in VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml to status: done
- [ ] compliance-tracker: commit, push, open PR
- [ ] Move ACTIVE-CLAIMS entry to recently_completed
