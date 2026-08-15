# PROGRESS -- task-20260718-075004-architecture---design--reusability-acros

VERIDIAN Review Framework gap-closure: Architecture & Design / Reusability
Across Scope (2 Low findings).

## Investigation (read-before-code, per task instructions)

Both findings' recommended fixes were checked against the live codebase
before writing anything, per the task's own instruction that the evaluation
may be stale:

- **Finding 1 ("Feature Reusability Across Projects/Modules" — "Reuse is
  via API integration, not shared library code"):** the recommended
  mitigation ("Add API versioning e.g. `/api/v1/projexa` vs
  `/api/v2/projexa` before breaking changes") turned out to be **already
  built** — `/api/v1/**` has existed since Wave 11 (2026-07-03) and
  `/api/v1/projexa/**` is a live, ~60-route alias namespace inside it
  (`src/app/api/v1/projexa/**`). `docs/API_CHANGELOG.md` already documents
  every route added under it. What was genuinely still missing — and what
  `ERP_BENCHMARK_COMPARISON.md`'s own INT004 row already flagged as an open
  gap ("formal API versioning policy are not yet fully built out") — was a
  **written policy** for when a `v2` becomes necessary, not the versioning
  mechanism itself. The underlying architectural critique (reuse via API
  calls rather than a shared library) is real and structurally bigger than
  a Low-severity, doc-scoped finding — noted honestly below rather than
  attempted here.
- **Finding 2 ("Module Reusability Across Industries" — "Core domain
  modeling is still CA-firm/compliance-first... Document which of the 416
  tables are compliance-specific vs universal"):** the table count has
  grown to **431** since the evaluation was written (schema.ts is the live
  source of truth, confirmed via `git grep -c "\.table(" src/lib/db/schema.ts`
  — a plain recursive `grep`/`find` in this environment silently caps at 51
  results, so `git grep` was used instead). No such classification existed
  anywhere in the repo before this PR.

## Completed

- [x] Investigated both findings against the live codebase first (see
      above) — Finding 1's recommended mechanism was already built;
      Finding 2's classification genuinely didn't exist.
- [x] `scripts/classify-schema-tables.mjs` — new static-analysis script
      (parses `src/lib/db/schema.ts` directly, no DB access) that
      classifies every one of the 431 `complianceSchemaDB.table(...)`
      definitions into `universal` / `compliance` / `industry_vertical`,
      via name-prefix/keyword rules with a section-header fallback.
      Re-runnable as the schema grows (per CLAUDE.md, "growing every
      wave"): `node scripts/classify-schema-tables.mjs > docs/TABLE_REUSABILITY_CLASSIFICATION.md`.
      Iterated until zero tables fell through to "uncategorized", and
      manually caught + fixed one real classification bug from the
      section-header fallback (10 generic platform-infra tables — e.g.
      `application_errors`, `platform_assets`, `instruction_packages` —
      that only *live* under schema.ts's "Construction Intelligence (Wave
      120)" comment for chronological reasons, not because they're
      construction-domain tables).
- [x] `docs/TABLE_REUSABILITY_CLASSIFICATION.md` — generated output:
      **322 (74.7%)** universal/platform, **87 (20.2%)**
      compliance-specific (CA-firm/Indian-regulatory), **22 (5.1%)**
      industry-vertical (PROJEXA construction/interior-design) — the
      PROJEXA slice is itself live evidence the platform core already
      generalizes across a second industry, not just CA-firm compliance.
      Notes the `compliance` Postgres schema name itself as a known
      naming-legacy artifact from the original product scope (renaming it
      is a real migration, out of scope for a Low/doc finding).
- [x] `docs/API_CHANGELOG.md` — added a **Versioning Policy** section:
      what counts as additive vs. breaking, that versioning is scoped per
      top-level namespace (`/api/v1/<namespace>/**`, so a future
      `/api/v2/projexa/**` wouldn't force the rest of `/api/v1/**` to move),
      and a 90-day-minimum deprecation window for any future `v1`→`v2`
      migration. No breaking change has actually shipped yet, so nothing
      currently needs deprecating — this is the rule for *when* one does.
- [x] `ERP_BENCHMARK_COMPARISON.md` — updated the stale INT004 row (still
      said rate limiting AND versioning policy were "not yet fully built
      out"; rate limiting actually landed in Wave 96, and versioning policy
      is now built via the above) to reflect the real, current state.

## Remaining

- [ ] None for these 2 findings — both closed as documentation-only
      changes, matching what their own "Recommended approach" text asked
      for. No source/runtime code was touched (correctly — neither finding
      asked for one), and `permission-service.ts`'s `ERP_ACTION_ROLES`
      table was not touched.
- [ ] Not attempted, flagged for a future, larger-scoped task if the Owner
      wants it: Finding 1's deeper architectural point (PROJEXA reuses
      VERIDIAN's modules via `/api/v1/projexa/**` HTTP calls, not a shared
      in-process library) is real and would be a genuine refactor —
      extracting shared service-layer code both products import directly.
      That's a real engineering project, not something a Low-severity
      finding's own recommended fix asked for, and well beyond what a
      single doc-scoped PR should attempt.
