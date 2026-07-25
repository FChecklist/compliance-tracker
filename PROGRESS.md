# PROGRESS -- task-20260725-174858-phase1-prompt-registry-version-lifecycle

VERIDIAN_Architecture_v2.0 phase_1_prompt_registry_lifecycle_foundation
(claude-control's ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml,
target_repo: compliance-tracker per that phase's own target_repo_note).
CORRECTED scope: extend the real, live compliance.prompt_templates/
prompt_versions tables (Wave 22 Prompt Operating System, ~20 production
resolvePromptTemplate() call sites), not build a new datastore.

## Completed
- [x] Registered ACTIVE-CLAIMS.yaml claim before starting real work (Rule 11)
- [x] Drizzle schema: promptVersions gets major/minor/patch integers,
      lifecycleState (Draft/Review/Staging/Production/Deprecated, default
      'Draft'), metadata jsonb, rolledBackFromVersionId -- additive
      alongside the pre-existing label/version/isActive columns
      (src/lib/db/schema.ts)
- [x] Migration drizzle/0262_prompt_registry_version_lifecycle.sql --
      ALTER TABLE ADD COLUMN IF NOT EXISTS + CHECK constraint on
      lifecycle_state + backfill (label='production'/'staging' ->
      lifecycle_state) + index. NOT applied live, same convention as every
      other schema-touching claim in ai-os/boss/ACTIVE-CLAIMS.yaml.
- [x] ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json -- 18 categories
      from the document's own section 2.6 table, minimum-viable field
      depth per category (same precedent as claude-control's
      AUDITOR_ENGINE_FINDING_RECORD_SCHEMA_2026-07-24.schema.json)
- [x] src/lib/services/prompt-os-service.ts: transitionPromptLifecycle
      (bare Draft->Review->Staging->Production->Deprecated state machine,
      isLegalLifecycleTransition exported for testing -- the
      APPROVAL-GATE enforcement on top is phase_3 scope, not this one's),
      diffPromptVersions (line-level LCS diff, no external dep --
      package.json's "diff" pin lives under `overrides`, not a real
      installed dependency), rollbackPromptVersion (append-only: creates
      a new version, never mutates history, rolledBackFromVersionId
      records provenance, lifecycleState restarts at 'Draft'). Also gave
      createPromptVersion an optional `bump` param (major/minor/patch,
      default minor) that computes real major.minor.patch via
      nextSemanticVersion. All veridian_admin-gated like the pre-existing
      functions; existing exports/call sites unchanged.
- [x] src/lib/services/prompt-os-service.test.ts -- bun:test coverage of
      the pure helpers (isLegalLifecycleTransition, nextSemanticVersion,
      diffContentLines), same no-live-DB pattern as
      esignature-service.test.ts. bun isn't installed in this sandbox, so
      logic was independently verified against a standalone Node script
      replicating the exact algorithm (all assertions passed) rather than
      run via `bun test` directly -- CI (.github/workflows/ci.yml) runs
      the real `bun test`.
- [x] ai-os/DATABASE_CATALOG.json -- prompt_versions entry surgically
      re-extracted via ai-os/scripts/extract-db-schema-catalog.mjs
      (mechanical, ground-truth-from-code), not a full-file regen (avoids
      pulling in 5 unrelated tables added by other merges since the last
      full build)
- [x] ai-os/MASTER_INDEX.yaml -- new registries[] entry
      prompt_registry_version_lifecycle_extension
- [x] Registered knowledge via claude-control's superboss-register.py
      (shared DB at /opt/veridian/ai-os/memory/superboss-register.sqlite
      -- compliance-tracker's own ai-os/scripts/superboss-register.py
      copy is a stale 429-line version with no register-knowledge/
      query-knowledge subcommands, confirmed before using
      claude-control's current 1821-line copy instead). Verified both
      success-criteria queries return found=1:
      `query-knowledge "veridian_v2_prompt_registry" --tag domain:veridian_architecture_v2`
      and
      `query-knowledge "phase_1_prompt_registry_lifecycle_foundation" --tag domain:veridian-architecture-v2-0-docx`
- [x] tsc --noEmit and eslint clean on all changed/new files
- [x] compliance-tracker PR opened, CI running

## Remaining
- [ ] BLOCKED ON BUDGET (session USD budget exhausted this run): claude-control side (separate repo): update phase_1's status in
      ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml to done
      with real evidence, and add the lifecycle_state/version column
      relationship evidence to WIRING_ENGINE_REGISTRY_2026-07-25.json for
      the existing compliance.prompt_versions table entity. Done via an
      isolated `git worktree` off origin/master -- NOT the shared primary
      claude-control checkout on this box, which had unrelated
      in-progress uncommitted edits from another session when this task
      started (ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml +
      scripts/auto_phase_continuation.py), left untouched.
- [ ] Move this task's ACTIVE-CLAIMS.yaml entry to recently_completed once
      both PRs are up.

## Notes / honest limitations
- The approval-gate ENFORCEMENT on top of the lifecycle state machine
  (who may authorize a Staging->Production transition, beyond the
  veridian_admin floor every write already requires) is phase_3
  (governance_policy_cost_engines) scope per that gap item's own note --
  transitionPromptLifecycle() here only enforces which edges are
  structurally legal.
- No new API route was added for these service functions (transition/
  diff/rollback) -- this phase's scope is the data-model + service-layer
  foundation; wiring an admin UI/route is not named in this phase's own
  scope and would be new, unscoped surface area.
- drizzle/0262 is NOT applied to the live database by this task, matching
  every other schema-touching entry in ai-os/boss/ACTIVE-CLAIMS.yaml's own
  convention -- left for the supervising session / next deploy.

## Session budget note
This session's USD budget was exhausted after: compliance-tracker PR #559 opened, independently audited (Rule 7c -- a fresh general-purpose agent instance reviewed the diff, found a real Terminology Guardrail Check regression from 3 new hardcoded_iso_date comment hits, which was fixed in commit 7828f391 by adding exemption entries following the repo's established precedent), and the audit re-posted as AUDIT: PASS. CI was re-triggered by that fix and was still running (audit-check/Terminology Guardrail Check both `pending`) when the budget ran out -- a future session should confirm CI is green on PR #559 before merging, then complete the remaining claude-control-side deliverable (phase_1 status update + WIRING_ENGINE_REGISTRY entity, via an isolated `git worktree` off origin/master, NOT the shared primary claude-control checkout which had unrelated in-progress uncommitted edits from another session when this task started) and move this task's ACTIVE-CLAIMS.yaml entry to recently_completed.
