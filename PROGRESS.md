# PROGRESS -- task-20260807-063723-retry-ai-documentation-ai-readable-techn

VERIDIAN Review Framework gap-closure: AI Documentation / AI-Readable Technical Documentation
(10 findings, sub-task of `UMR-20260801-170930-2080`). Every finding was re-verified against
live code before any change was made, per the task's own instruction.

**Note on this invocation (2/20):** the checkpoint this invocation resumed from claimed a large
amount of work as "Completed" in its summary, but almost none of it existed as committed or
on-disk files -- only the claim-registration commit and one uncommitted draft file
(`ai-os/registry/BUSINESS-RULES-REGISTRY.md`) were real. That draft file was verified for real
content (spot-checked several citations against actual source) and found genuinely good, so it
was kept and committed; everything else below was built fresh this invocation, each item
verified against real code/grep output before being written, and pushed in small, real commits.

## Completed

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real work.
- [x] Re-verified all 10 findings against live code before writing anything.

### [High] AI-Readable Business Rules Documentation -- DONE
Built `ai-os/registry/BUSINESS-RULES-REGISTRY.md` (kept from the prior invocation's draft after
spot-verifying several of its citations against real source) -- rule-first index generated from
`ai-os/system-tree/50-merged-tree.yaml`'s own `rules:`/`objects:` fields (83/94 domains, 163
rule statements), cross-referenced to enforcing files.

### [Low] AI-Readable Architecture Documentation + [Low] AI-Readable Database Documentation -- DONE
Same root cause (system-tree is a manual snapshot with no re-sync signal), closed together.
- Confirmed real drift since the tree's last regen (2026-07-26): 995 API routes (was 614), 468
  DB tables (was 377), 133 DB enums (was 106).
- `ai-os/system-tree/DRIFT-BASELINE.yaml` + `scripts/check-architecture-doc-drift.mjs` (CI job
  `architecture-doc-drift`, non-blocking warn at >10% drift).
- Refreshed `ai-os/system-tree/00-INDEX.md`'s counts + added a "how to re-sync" note.

### [Medium] AI-Readable Workflow Documentation -- DONE
Confirmed the "one-third lack workflow" figure exact (31/94 domains, `workflow: []`). Filled all
31 in `ai-os/system-tree/50-merged-tree.yaml`: real workflows for domains with a genuine process
(UI-05/07/09/11/12, PRX-04/06/07/09/10, DB-11, VA-04/11), grounded in each domain's own already
-verified objects/input/output fields plus one direct spot-check (PRX-06's HTTP-502 wrap,
confirmed against `src/app/api/assistant/route.ts` in the projexa checkout). Explicitly marked
the rest `N/A` with a one-line reason (schema-completeness listings, reusable-component
grab-bags, business-content taxonomies, confirmed placeholder scaffolds) instead of leaving them
silently empty. Found and flagged (did not fix -- logged in `ai-os/MASTER-TRACKER.yaml`) a real
discrepancy: VA-02/VA-11's `objects` lists describe files that no longer exist in the current
veda-advisors checkout.

### [Medium] AI-Readable Prompt Documentation -- DONE
Found the finding's cited "previously-scoped Prompt Directory" is actually a different feature
(chat-composer predictive autocomplete, `docs/research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md`
§3/§5) -- did not build that. The real gap (`prompt_templates.description` is empty/generic
boilerplate, no catalog of purpose) is real and closed: `ai-os/registry/PROMPT-TEMPLATE-DIRECTORY.md`,
26 real `resolvePromptTemplate()` call sites catalogued with purpose read from each call site's
own context (excludes the ~40 AI Dev Team role prompts, already self-describing via `roster.ts`).

### [Medium] AI-Readable Configuration Documentation -- DONE
No consolidated reference existed. Built `docs/master/CONFIGURATION.md` (all 54 distinct
`process.env.*` vars in `src/`+`scripts/`, grouped by purpose, plus 6 notable in-code constants)
+ `scripts/check-configuration-doc-coverage.mjs` (CI job `configuration-doc-coverage`).

### [Low] AI-Readable Module Documentation -- DONE
`docs/master/MODULE_MAP.md` already existed (domain-level) -- refreshed its stale 2026-07-09
scale numbers with a dated correction. Confirmed the per-file leading-doc-comment convention is
real (211/212 files in `src/lib/services/`) and built the file-level complement:
`scripts/generate-module-doc-index.mjs` -> `docs/master/MODULE_DOC_INDEX.md` (212 files, `--check`
mode wired into CI job `module-doc-index-check`).

### [Low] AI-Readable Metadata Documentation -- VERIFIED, NO CHANGE NEEDED
`ai-os/OS.yaml`'s index + `scripts/check-metadata-index-coverage.mjs` (CI job
`metadata-index-coverage`, pre-existing, untouched) is real and already wired. The finding's own
recommendation ("maintain the existing registry") is already true.

### [Low] AI-Readable Calculation Documentation -- DONE
The finding's "~17% implemented" figure matched neither `docs/master/CAPABILITY_COVERAGE.md`'s
own numbers nor current reality. Directly re-counted `dispatchEngine()`'s live switch in
`src/lib/task-execution-engine.ts`: **185 real dispatchable engineKeys** (184 case branches +
1 special-cased GST branch), not 127/247 (~51%) let alone 17%. Recorded a dated correction rather
than fabricating a full category-level re-audit (needs live DB access this sandbox doesn't have).
Did not implement more engines -- real, multi-day engineering work, logged in
`ai-os/MASTER-TRACKER.yaml`.

### [Medium] AI-Readable API Documentation -- PARTIAL, remainder logged
Confirmed current coverage (~30% of `/api/v1` domains, brain/connectors/platform at 0%, PROJEXA
~20%) still matches the finding. Extended `src/lib/openapi/generate.ts` with the 7
highest-external-integration-value gaps, each read from its real route handler first:
`brain/capabilities`, `brain/entity-relationships`, `connectors/office-addin/whoami`,
`connectors/office-addin/departments`, `platform/provision-org` (documented its distinct
`pk_...` service-to-service auth scheme explicitly), `tasks/{id}/status`,
`construction/predictions/{activityId}`. Left the remaining ~64 PROJEXA sub-resources
undocumented intentionally (real, multi-day work) -- logged in `ai-os/MASTER-TRACKER.yaml`
(`AI-DOC-GAP-CLOSURE-REMAINDER`), prioritized finance cluster first per the finding's own
external-integration-demand steer.

## CI wiring blocked on token scope (real limitation, not skipped work)

This session's `gh` token lacks the `workflow` OAuth scope, so any commit touching
`.github/workflows/ci.yml` cannot be pushed from here. All 3 new CI jobs
(`architecture-doc-drift`, `module-doc-index-check`, `configuration-doc-coverage`) exist as a
real, tested, local-only commit on this branch (not pushed) and as a saved patch:
**`ai-os/registry/PENDING-CI-WIRING-architecture-doc-drift.patch`** -- apply with
`git am ai-os/registry/PENDING-CI-WIRING-architecture-doc-drift.patch` from an identity with
`workflow` scope, then push. All 3 underlying scripts were run and verified passing locally
before this patch was saved.

## Remaining
- [ ] Apply/push `ai-os/registry/PENDING-CI-WIRING-architecture-doc-drift.patch` (owner or a
      session with `workflow` scope).
- [ ] None else for this task's own scope. Three real, deliberately-deferred items (remaining
      ~64 PROJEXA OpenAPI sub-resources; a full VA-01..VA-11 veda-advisors re-audit; continued
      VCEL engine wiring) are logged in `ai-os/MASTER-TRACKER.yaml`'s
      `AI-DOC-GAP-CLOSURE-REMAINDER` entry for a future session to pick up.
