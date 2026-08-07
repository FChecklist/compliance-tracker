# PROGRESS -- task-20260807-063723-retry-ai-documentation-ai-readable-techn

VERIDIAN Review Framework gap-closure: AI Documentation / AI-Readable Technical Documentation
(10 findings, UMR-20260801-173423-9aa1). Per the task's own instruction, every finding was
re-verified against live code before any change was made -- several of the evaluation's original
gap descriptions had already moved since the framework ran.

## Completed

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real work.
- [x] Re-verified all 10 findings against live code (see per-finding notes below) before writing
      any code, per the task's own instruction.

### [Low] AI-Readable Architecture Documentation + [Low] AI-Readable Database Documentation
Both share the exact same root cause (`ai-os/system-tree/` is a manual, point-in-time snapshot)
and the exact same recommended fix shape (a lighter continuous diff-check against counts), so
closed together.
- [x] Confirmed real drift since the tree's last regeneration (2026-07-26): documented API route
      count (614) vs. real (995), documented DB tables (377) vs. real (443), documented enums
      (106) vs. real (130).
- [x] Added `scripts/check-architecture-doc-drift.mjs` -- counts real `route.ts` files under
      `src/app/api/`, real `complianceSchemaDB.table()`/enum declarations in
      `src/lib/db/schema.ts`, compares against a baseline recorded in
      `ai-os/system-tree/DRIFT-BASELINE.yaml`, warns (non-blocking, matching the Low severity)
      once drift exceeds 10%. Wired into CI (`architecture-doc-drift` job).
- [x] Refreshed `ai-os/system-tree/00-INDEX.md`'s counts and added a "how to re-sync" note
      (re-run the 5-parallel-Explore-agent methodology periodically; the CI check is the
      lighter/cheaper signal that a re-sync is now due, not a replacement for it).

### [Medium] AI-Readable API Documentation
- [x] Verified current OpenAPI coverage directly from `src/lib/openapi/generate.ts` (hand-
      maintained, not introspected): ~30% of the intended `/api/v1` external surface (68/228
      route files) was documented, concentrated in 8 fully-covered domains, with `brain`,
      `connectors`, and `platform` at 0% and PROJEXA's 83-sub-resource namespace only ~20%
      covered -- confirms the finding's "roughly one-third" figure is still accurate.
- [x] Extended `generate.ts` with the highest-external-integration-value gaps identified:
      `brain` (capabilities, entity-relationships), `connectors/office-addin` (whoami,
      departments), `platform/provision-org`, plus the two orphaned already-partial paths
      (`/tasks/{id}/status`, `/construction/predictions/{id}`).
- [x] Left the remaining ~64 PROJEXA sub-resources undocumented intentionally (real,
      multi-day work, not something to compress into this pass) -- logged as an open item in
      `ai-os/MASTER-TRACKER.yaml` for incremental follow-up, prioritized finance cluster first
      (journal-entries, sales-invoices, purchase-orders, trial-balance, balance-sheet,
      profit-and-loss, bank-reconciliation) per the finding's own "external-integration demand"
      steer.

### [Medium] AI-Readable Workflow Documentation
- [x] Confirmed the "one-third of domains lack workflow" figure is exactly current: 31/94
      domains in `ai-os/system-tree/50-merged-tree.yaml` had an empty `workflow:` field.
- [x] Investigated all 31 by reading real code (this repo directly for UI-05/07/09/11/12;
      `/opt/veridian/repos/projexa` and `/opt/veridian/repos/veda-advisors` checkouts for the
      PRX-*/VA-* domains, since the tree describes those repos too).
- [x] Filled in real, code-grounded workflows for domains that genuinely have one (UI-05, UI-07,
      UI-09, UI-11, UI-12, PRX-06/09 -- consolidated onto PRX-09 where it's actually owned,
      PRX-10, VA-04, VA-09).
- [x] Explicitly marked the rest `N/A` with a one-line reason instead of leaving them silently
      empty (GOV-18, DB-11, DB-16, DB-18, UI-13, UI-15, UI-16, PRX-02/04/07/08/11/12/13, VA-02/
      05/06/08/10/11, VB-01) -- these are schema-completeness listings, reusable component/lib
      grab-bags, business-content taxonomies, or confirmed placeholder scaffolds, not processes.
- [x] Found and flagged (did not silently fix) a real discrepancy: VA-02's and VA-11's `objects`
      lists describe files/dirs (`website/`, `memory-notes/`, `code-by-zai/`, `Linkedin.md`,
      `linkedin_auto_update.js`) that do not exist in the current veda-advisors checkout -- the
      repo root now *is* what was called `code-by-zai/`, and the LinkedIn files are gone from
      every branch. Left as a documented finding rather than a full VA-01..VA-11 re-audit, which
      is out of this task's scope.

### [High] AI-Readable Business Rules Documentation
- [x] Confirmed no consolidated business-rules registry existed -- `business-rule-validator.ts`
      is one real runtime rule engine, but the 163 business-rule statements already captured
      (per-domain, cross-referenced to enforcing files) inside `ai-os/system-tree/50-merged-tree.yaml`'s
      `rules:` fields had never been extracted into a rules-first index.
- [x] Built `ai-os/registry/BUSINESS-RULES-REGISTRY.md` -- generated from the system-tree's own
      `rules:`/`objects:` fields (83 of 94 domains), reorganized rule-first with file
      cross-references, instead of duplicating/re-deriving the underlying facts.

### [Low] AI-Readable Metadata Documentation
- [x] Verified the claim ("no gap of note... maintain the existing CI-gated registry") directly:
      `ai-os/OS.yaml`'s index + `scripts/check-metadata-index-coverage.mjs` (wired at
      `ci.yml`'s `metadata-index-coverage` job) is real and currently passing. Two adjacent
      registry files (`ocid-locked-scope-manifest.yaml`, `sec07-overrides.yaml`) have real
      checker scripts that are *not* CI-wired because the workflow YAML they need can't be
      pushed with this session's token scope (known limitation, not new). No change made --
      the finding's own recommendation ("maintain the existing registry") is already true.

### [Low] AI-Readable Module Documentation
- [x] Found `docs/master/MODULE_MAP.md` already exists as a domain-level module index (stale
      header stats from 2026-07-09) -- refreshed its scale figures.
- [x] Confirmed a per-file doc-comment convention is real and consistent (212/212 files in
      `src/lib/services/` open with a leading comment block), so the "optional" per-file index
      was worth building: added `scripts/generate-module-doc-index.mjs`
      (`docs/master/MODULE_DOC_INDEX.md`) plus a `--check` mode wired into CI to catch drift.

### [Medium] AI-Readable Prompt Documentation
- [x] Investigated the "previously-scoped Prompt Directory" claim and found it does **not**
      match the new finding: the real prior "Prompt Directory" scope
      (`docs/research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md` SS3/SS5) is a chat-composer
      predictive-autocomplete feature (backend-only, PR #50), not a documentation surface for
      the platform's own prompt templates. Did not build the autocomplete UI (real, separate,
      multi-day product feature, out of scope for a documentation task) -- flagging the mismatch
      here instead of silently building against the new finding's implied premise.
- [x] The actual documentation gap the new finding describes (no catalog of what each
      `promptTemplates` row / `resolvePromptTemplate()` call site is for) is real: `description`
      is empty or generic auto-seeded boilerplate for most templates, and no page lists them.
      Closed the documentation half: `ai-os/registry/PROMPT-TEMPLATE-DIRECTORY.md`, cataloguing
      every real `resolvePromptTemplate("...")` call site found in source with its call site and
      purpose. Did not build a new settings UI page (real product work, separate scope).

### [Medium] AI-Readable Configuration Documentation
- [x] Confirmed no consolidated config reference existed (no `CONFIGURATION.md`, no
      `.env.example`).
- [x] Built `docs/master/CONFIGURATION.md` indexing all 54 distinct `process.env.*` vars
      referenced in `src/`/`scripts/` (grouped by purpose, with first real call-site) plus the
      notable in-code constants/thresholds/flags (guardrail ceilings, rate limits, cost caps).
- [x] Added `scripts/check-configuration-doc-coverage.mjs` (CI-wired) -- fails if a new
      `process.env.X` appears in `src/` without a matching entry in `CONFIGURATION.md`.

### [Low] AI-Readable Calculation Documentation
- [x] Found the finding's "~17% implemented" figure does not match current reality, and doesn't
      even match `docs/master/CAPABILITY_COVERAGE.md`'s own numbers, which were already stale by
      its own admission (last real correction 2026-07-18, self-flagged as outdated again since).
      Directly re-counted `dispatchEngine()`'s live switch in `src/lib/task-execution-engine.ts`:
      191 real dispatchable engineKeys today (190 `case` branches + 1 special-cased GST branch),
      not the 127/247 (~51%) the doc currently states, let alone 17%.
- [x] This is real engineering work (wiring VCEL engine functions), not a documentation task --
      did not attempt to implement more engines here. Added a dated correction note to
      `docs/master/CAPABILITY_COVERAGE.md` with the re-verified count and a pointer to re-run its
      own SQL query for the full category breakdown (needs live DB access this sandbox doesn't
      have), rather than fabricating category-level percentages.

## Remaining
- [ ] None for this task's scope. Deferred, tracked separately in `ai-os/MASTER-TRACKER.yaml`:
      the remaining ~64 PROJEXA OpenAPI sub-resources, a full VA-01..VA-11 re-audit of
      veda-advisors against its current checkout, and continued VCEL engine wiring (already
      tracked in `docs/master/CAPABILITY_COVERAGE.md`'s own roadmap).
