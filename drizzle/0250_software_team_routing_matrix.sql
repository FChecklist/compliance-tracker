-- AIROUTER-01 Phase 2 (Owner directive 2026-07-19), Part C: seed the
-- Software Development Task Routing Matrix as the first-ever ACTIVE
-- ai_routing_policies row for scope='software_team' (that table has
-- existed since drizzle/0231 but shipped with zero seed rows -- confirmed
-- by grep before writing this migration: no other migration file inserts
-- into platform.ai_routing_policies).
--
-- Cost bias (Owner's explicit priority): most real work must land on
-- GPT-OSS-20B/DeepSeek V4 Pro (low/mid cost); GLM-5.2 is reserved for
-- planning/supervision/final-approval/audit, not routine execution. This
-- matters concretely here because roster.ts's own static default for MOST
-- operational engineering roles (senior_backend_engineer,
-- fullstack_developer, devops_engineer, etc.) is GLM_52 -- without this
-- policy row, every software_team dispatch to one of those roles would
-- keep resolving to the expensive judgment-tier model regardless of how
-- simple the task actually is. This row is what actually shifts real
-- dispatches down to the cheap/mid tier by default.
--
-- ONE DELIBERATE, DISCLOSED DIVERGENCE from the Owner's literal Part C
-- text (do not silently "fix" this away in a future pass without
-- re-reading this note): the Owner's routing matrix names GPT-OSS-120B for
-- "multi-file/integrative implementation tasks." model-tier-eligibility.ts's
-- INTEGRATIVE_ELIGIBLE set explicitly EXCLUDES GPT-OSS-120B -- that file's
-- own header states it was confirmed TWICE in this session's real history
-- to burn its full iteration budget on exactly this task shape (multi-file
-- wiring) without writing anything, even after a much-tightened brief.
-- Per AGENTS.md Operating Rule 9, no agent may weaken/route around a named
-- guardrail without the owner's explicit written instruction quoted in the
-- PR + a manifest update -- this task's own prompt did not give that
-- instruction (it asks for the matrix to be "swappable," not for
-- INTEGRATIVE_ELIGIBLE to be reopened). Naming GPT-OSS-120B here anyway
-- would not be a safe no-op: mother-router.ts's computeSoftwareTeamResolution()
-- always runs an override through checkTierEligibility() and, on
-- ineligibility, falls back to roster.ts's OWN STATIC BASELINE for that
-- role -- which is GLM-5.2 for most engineering roles, i.e. the single
-- MOST expensive model in the fleet. Seeding the Owner's literal choice
-- here would therefore silently defeat the cost-bias goal for exactly the
-- category it was supposed to help, while looking correct on a superficial
-- read of this file. If GPT-OSS-120B is wanted here for real, that requires
-- first reopening the INTEGRATIVE_ELIGIBLE decision itself (which has real
-- evidence behind it), a separate, explicit, owner-level call -- not
-- something this migration does unilaterally. See
-- ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md / ai-os/SOFTWARE_TEAM.md for
-- the same disclosure in narrative form.
--
-- Audit round 1 (GLM-5.2, finding M5): the first draft of this migration
-- ALSO named "multi_file_integrative": "deepseek/deepseek-v4-pro" under
-- preferredModelByCapabilityCategory -- genuinely redundant, since
-- preferredModelByTier.integrative already resolves to the identical model
-- via mother-router.ts's own fallback chain whenever no
-- preferredModelByCapabilityCategory entry exists for the dispatch's
-- category. Removed: "multi_file_integrative" is deliberately UNMAPPED
-- below, so it falls through to the tier axis with zero divergence to
-- disclose for that key specifically (the ONLY real, still-necessary
-- divergence is the one documented above: NOT naming GPT-OSS-120B anywhere
-- for integrative-tier work, tier axis included).
--
-- preferredModelByCapabilityCategory is the finer Part-C axis
-- (software-team-ladder.ts's CapabilityCategory); preferredModelByTier is
-- the coarser fallback axis (task-tightening.ts's ComplexityTier, used
-- when a dispatch declares no capability category, or one with no entry
-- in preferredModelByCapabilityCategory).

INSERT INTO platform.ai_routing_policies (scope, version, is_active, rule, created_by)
VALUES (
  'software_team',
  1,
  true,
  '{
    "preferredModelByCapabilityCategory": {
      "single_file_mechanical": "openai/gpt-oss-20b",
      "architecture_design_analysis": "deepseek/deepseek-v4-pro",
      "planning_governance_oversight": "z-ai/glm-5.2"
    },
    "preferredModelByTier": {
      "mechanical": "openai/gpt-oss-20b",
      "integrative": "deepseek/deepseek-v4-pro",
      "judgment": "z-ai/glm-5.2"
    }
  }'::jsonb,
  'AIROUTER-01-PHASE2-migration-0250'
)
ON CONFLICT (scope, version) DO NOTHING;
