# PROGRESS -- task-20260718-113005-retry-2--ai-engineering-quality--code-s

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Code Structure & Modularity (5 findings).

Note: this task's first ~13 lifetime invocations were all pre-flight-blocked on a real
OpenRouter negative-balance credit issue (see task.yaml history) -- zero code work had
been done before this invocation. This is a genuine fresh start, not a resume of
abandoned work.

## Completed

- [x] **[Medium] Code Modularity -- task-execution-engine.ts split (partial, by design).**
  Read the file in full (2,438 lines) before touching it. It had two large,
  self-contained, near-zero-coupling responsibility blocks bolted onto the real
  orchestration logic:
  - `dispatchTool()` (~260 lines) -- the small global-agent allowlist dispatcher.
  - `dispatchEngine()` + its `truthy`/`parseNumberList` helpers (~1,175 lines,48% of
    the file) -- the giant VCEL computation-engine allowlist switch (GST, Math,
    Costing, Income Tax, TDS/TCS, Accounting, Payroll, Inventory, HR, Banking,
    Procurement, Security, Audit, AI Support, Compliance, Analytics, Logistics,
    Marketing, Project Management, CRM, Sales, Fixed Assets, Data Quality, Document
    Processing).
  Extracted both into their own service files:
  - `src/lib/services/tool-dispatch-service.ts` (dispatchTool)
  - `src/lib/services/engine-dispatch-service.ts` (dispatchEngine + helpers)
  `task-execution-engine.ts` re-exports `dispatchTool` (`export { dispatchTool } from
  "@/lib/services/tool-dispatch-service"`) so its 2 existing external call sites
  (`src/app/api/v1/projexa/assistant/route.ts`, `src/lib/services/fde-service.ts`)
  keep importing it from `@/lib/task-execution-engine` unchanged -- same barrel-file
  pattern this codebase already uses for `src/lib/db.ts` re-exporting
  `src/lib/db/schema.ts`. `dispatchEngine` is imported and called once internally
  (`executeEngineDispatch`), same as before.
  Result: `task-execution-engine.ts` 2,438 -> 994 lines, now holding only real
  task-execution orchestration (LLM planning, guardrails, memory, reflection,
  escalation). Verified: `bun test task-execution-engine.test.ts` (7/7 pass, all
  pre-existing), `bunx eslint` clean on all 3 files + both external call sites,
  targeted `bunx tsc --noEmit` diff-check clean (a full-repo tsc run OOMs in this
  sandbox regardless of this change -- pre-existing environment limit, not caused
  by this edit).
  **schema.ts split -- deliberately NOT done, see "Findings that don't match
  current reality" below.**

## Findings that don't match current reality / scoped down after investigation

- **Code Modularity -- schema.ts split.** The recommended approach ("split schema.ts
  into per-domain files re-exported from an index") is real (schema.ts is 10,196
  lines) but is NOT done in this PR. `ai-os/boss/ACTIVE-CLAIMS.yaml` shows dozens of
  concurrent/recent sessions actively adding tables/columns to `schema.ts` as their
  normal course of work (grep for "schema.ts" in that file: 30+ distinct claims).
  A full mechanical split (moving schema.ts to schema/index.ts + per-domain files)
  would rename/move the one file nearly every other in-flight session is currently
  touching, guaranteeing merge conflicts across the fleet for a purely structural
  change with zero user-facing benefit -- disproportionate risk for a single-session
  PR. Consumers already go through one barrel (`src/lib/db.ts` re-exports
  `./db/schema`; 306 files import from `@/lib/db`, only ~10 import `db/schema`
  directly), so a future split IS low-risk for consumers whenever it's done -- just
  not safely doable as a drive-by in a wave with this much concurrent schema.ts
  traffic. Left for a dedicated, coordinated pass (announced in ACTIVE-CLAIMS.yaml
  ahead of time, done when schema.ts churn is briefly low).

- **File & Folder Organization -- "consolidate ai-os/'s overlapping subtrees per
  stale-doc-manifest.yaml's own stated direction".** Investigated via a dedicated
  sub-agent read of the real file. `stale-doc-manifest.yaml` (real path:
  `ai-os/registry/stale-doc-manifest.yaml`) contains **no statement anywhere**
  directing consolidation of tree4-unified/audit-tree/system-tree -- its only
  mentions of those trees are about bannering already-archived files in place. The
  finding's cited justification does not exist; treating it as one would be exactly
  the kind of fabricated citation this repo's own governance docs are built to
  catch. Separately, `ai-os/OS.yaml:89-96` already documents why the 3 trees exist
  (Tree 1 = stated requirements, Tree 3 = what's actually built, Tree 4 = the merge/
  diff, already flagged there as "mostly archived into MASTER-TRACKER.yaml"/
  "historical") -- they are deliberately distinct, not accidental duplication, and
  each already has its own `00-INDEX.md`. `ai-os/OS.yaml` itself already is the
  top-level `ai-os/` navigation aid (self-described as such, CI-enforced via
  `check-metadata-index-coverage.mjs`). **Not consolidating the ai-os/ trees** --
  no real gap found there matching the finding's premise.
  The other half of the same finding ("API route... folders are large enough to
  need their own navigation aids") DOES hold up: `src/app/api/` has 129 top-level
  subdirectories / 880 files / zero README or index anywhere. Addressed below with
  a real, narrowly-scoped fix instead.

## Remaining
- [ ] [Low] Component Reusability -- add REUSABLE-UTILITIES.md index.
- [ ] [Medium] Low Coupling / High Cohesion -- investigate current FK constraint
      coverage on org/user scoping; add incrementally if safe, or document why not.
- [ ] [Low] Design Pattern Consistency -- custom lint rule for requireAuth()/
      ServiceError usage in new API routes/services.
- [ ] [Medium] File & Folder Organization -- add a real navigation README to
      src/app/api/ (129 subdirs, 0 nav aid today; see finding above).
