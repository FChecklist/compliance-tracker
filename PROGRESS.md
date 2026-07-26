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
- [x] claude-control: ai-os/VERIDIAN_V2_LIFECYCLE_GOVERNANCE_SCHEMA_2026-07-25.yaml (schema-only design doc) -- committed directly to claude-control master (config-only repo, no PR/CI gate there, matches phase_1/phase_2 backfill precedent)
- [x] claude-control: register-knowledge (KE-20260726-041920-ec24) + query-knowledge success criteria (found=1)
- [x] claude-control: phase_3 entry status: done, completed_by_task + evidence set
- [x] compliance-tracker: committed, pushed, PR #561 opened (https://github.com/FChecklist/compliance-tracker/pull/561)
- [ ] Move ACTIVE-CLAIMS entry to recently_completed -- NOT done (budget exhausted this session); next session touching this repo should do so once PR #561 merges, or verify CI status first
- [ ] Watch PR #561 CI and merge once green (not done this session)

# PROGRESS (fix-up) -- task-20260726-042710-fix-pr561-cross-tenant-governance-bypass

Fixing AUDIT: FAIL findings from PR #561's review (cross-tenant governance
bypass + secondary findings). Pushing corrective commits to this same
branch/PR, not a new PR.

## Completed
- [x] Read AUDIT: FAIL comment on PR #561 in full
- [x] Checked out branch worker/task-20260726-035742-phase3-business-rule-permission-policy-c

- [x] Read prompt-governance-service.ts, module-rules-resolver.ts, module-rule-service.ts, schema.ts (prompt_templates/prompt_versions/prompt_eval_runs, moduleRegistry, productBranches), abac-policy-service.ts to pick remediation direction
- [x] Fixed cross-tenant escalation: getPromptLifecycleRule() is now PLATFORM-ONLY -- reads only the scope_type='platform' module_rule_configs row, no orgId param, never consults module-rules-resolver.ts's org/project/client chain
- [x] Fixed checkPromptEvalBudget() shared-pool distortion (same root cause, same fix -- no orgId param)
- [x] Documented checkPromptPolicyDeny()'s org-scoped-ABAC-vs-platform-wide-resource mismatch as an intentional, explicit, out-of-scope-for-this-fix limitation (deny-only means it can only over-restrict, never escalate -- see the function's own header comment for the full reasoning)
- [x] Tightened PII credit-card regex: real Luhn checksum on 13-19 digit candidates, replacing the bare `\b(?:\d[ -]?){13,16}\b` false-positive-prone pattern
- [x] Added src/lib/services/prompt-governance-gates.test.ts (14 tests, DB-mocked): checkPromptEvalBudget + runLifecycleTransitionGates coverage, including 2 explicit cross-tenant-escalation regression tests reproducing the PR #561 audit scenario
- [x] Added 2 PII Luhn tests to prompt-governance-service.test.ts (Visa test PAN flagged; non-card 16-digit ID not flagged)
- [x] bun install (bun wasn't present in this task's sandbox -- installed via bun.sh/install), tsc --noEmit clean, eslint clean on all touched files
- [x] bun test: full suite 2029 pass / 0 fail across 166 files (includes the new/modified files)
- [ ] Commit + push corrective commits to the existing PR #561 branch (worker/task-20260726-035742-phase3-business-rule-permission-policy-c) -- do not open a new PR
- [ ] Final checkpoint to user: chosen remediation direction (platform-only rules, not org-scoped resources) + why, and confirm PR ready for re-audit

## Remediation direction chosen: platform-only rules (not org-scoped resources)

Per the audit's own two offered directions, chose "make prompt_lifecycle
governance rules platform-only" over "give prompt_templates/prompt_versions/
prompt_eval_runs real orgId columns." Confirmed against real design intent in
schema.ts's own comments before committing: prompt_templates/prompt_versions
are explicitly "Global-read platform catalog... prompt content is a
platform-governed asset, not per-org customizable"; prompt_eval_runs/
prompt_eval_cases are "Global/platform-governed... eval cases are authored
content, not tenant data, so there is no org_id anywhere here." Writes to all
three are veridian_admin-gated at the service layer, not RLS/org-gated.
Adding orgId columns to genuinely platform-wide, shared-content tables would
contradict that explicit by-design intent (and raise its own new questions --
which org "owns" a template used by all of them?) for no real benefit, since
the actual bug was never "these tables need org scoping" -- it was "a
per-org-overridable rule was governing a resource that has no such thing as
'per-org.'" Making the governance rule platform-only (getPromptLifecycleRule
now takes no orgId param, reads only the scope_type='platform' row) directly
closes the exploit with a small, contained change.
