# Dependency Index / Impact Analysis

VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
Management" -- closes two related findings:

- **[High] Impact Analysis Before Modification** -- "No automated
  pre-modification impact analysis."
- **[High] Dependency Graph Accuracy** -- "No accurate, queryable
  dependency graph exists at any layer."

## What this is

`scripts/build-dependency-index.ts` is a lightweight **static import
graph**: which `.ts`/`.tsx` file under `src/app/api`, `src/lib`, or
`src/components` imports which other file, resolved through the `@/` ->
`src/` alias and relative paths. It answers the question "if I change this
file, what else in this codebase references it?" *before* you make the
change, not after something breaks.

It is not a runtime call graph. It does not follow dynamic requires,
string-built import paths, or non-TypeScript callers (SQL, cron jobs,
external services). For those, this index is a starting point, not the
whole picture -- say so explicitly rather than overselling automated
coverage.

## Usage

Build/refresh the index (not committed -- see `.gitignore` -- regenerate on
demand so it's never stale):

```
bun scripts/build-dependency-index.ts
```

Writes `docs/dependency-index.json` (forward + reverse import graph, plus
the file count and scan roots it was built from).

Before modifying a service or route, ask what depends on it:

```
bun scripts/build-dependency-index.ts --impact src/lib/services/foo-service.ts
```

Prints direct dependents (files that import it directly) and transitive
dependents (files that import something that imports it, walked via BFS,
deduplicated so a diamond dependency is only listed once). Both lists are
the real, current blast radius of a change to that file -- review every one
of them, or at minimum re-run their tests, before merging.

## Example (real output against this repo)

```
$ bun scripts/build-dependency-index.ts --impact src/lib/services/permission-service.ts
Impact analysis for src/lib/services/permission-service.ts
  59 direct dependent(s):
    - src/app/api/erp/accounts/route.ts
    - src/app/api/erp/bank-reconciliation/import/route.ts
    ...
```

## Design notes

- Parsing is regex-based (import/export/dynamic-import specifiers), not a
  full TypeScript AST -- consistent with this codebase's other structural
  scan scripts (`scripts/check-doc-cross-references.mjs`'s own header makes
  the same choice for the same reason: cheap, dependency-free, good enough
  for "which file references which path"). See that script's comments if
  you need to extend the specifier regex.
- Pure-core/FS-shell split: `extractImportSpecifiers` / `resolveImportPath`
  / `buildDependencyGraph` / `computeImpact` are unit-tested directly in
  `scripts/build-dependency-index.test.ts` against fake source text and a
  fake filesystem, matching this repo's established pattern (see
  `model-scorecard-service.test.ts`'s own note on not touching a live
  dependency from a `.test.ts` file).
- Not wired into CI. This is a query tool run by a human or an AI agent
  before a change, the same way `git grep` is -- it does not block anything,
  and adding it as a merge gate is out of scope for this finding (the
  recommendation asked for a queryable index, not a new guardrail).

## Related: "Dependency Graph Accuracy" row 37 follow-up (FK constraints)

The Dependency Graph Accuracy finding's recommendation also suggested
"consider adding FK constraints per row 37 to make the data-layer graph
enforceable" -- i.e. a *separate*, database-level dependency graph (which
tables reference which via real foreign keys), distinct from this
code-level import graph. That is a real, larger, schema-migration-risk
piece of work spanning Drizzle's `schema.ts` (hundreds of tables) and is
explicitly out of scope for this pass -- flagged honestly here rather than
attempted as a drive-by alongside an unrelated static-analysis tool. See
`PROGRESS.md` for this task's own accounting of what was and wasn't
attempted.
