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

- [x] **[Low] Component Reusability -- REUSABLE-UTILITIES.md.** Data-driven (real
  `git grep` import-site counts, not guesses): auth/tenant-isolation, data access,
  AI/LLM orchestration, dispatch, UI primitives, and formatting helpers, each with
  real import counts. Also documents a real, un-fixed gap found along the way: 2
  separate `ServiceError` classes exist (`compliance-service.ts`,
  `workspace-memory-service.ts`), neither canonical -- noted honestly rather than
  silently picking one to promote.

- [x] **[Low] Design Pattern Consistency -- lint-enforced requireAuth() presence.**
  New `eslint-rules/require-auth-in-api-routes.mjs` (local ESLint plugin, flat-config
  compatible) + wired into `eslint.config.mjs`, scoped to `src/app/api/**/route.ts`
  only. Checks for `requireAuth(`/`requireAuthOrApiKey(`/`validateApiKey(` anywhere
  in the route file; reports if none found.
  Deliberately **"warn", not "error"**: a real repo-wide scan found 825/878
  route.ts files already call one of those directly; the other ~53 are legitimate,
  intentional exceptions (pre-auth flows like passcode-login/SSO, public
  token-based access like client-portal/[token] and esignature sign/[token],
  contact/forge public forms, health checks, internal cron routes). CI's `lint`
  job runs `eslint .` with no `--max-warnings` flag, so ESLint's default
  behavior (warnings don't fail the run) means this is CI-visible without being
  CI-blocking -- verified: `bun run lint` on the full repo exits 0 with 54 new
  warnings (the known exceptions) plus the handful of pre-existing unrelated
  warnings, same as before this change. An "error" severity would have failed
  CI repo-wide for every concurrently in-flight PR touching any of those 53
  files, which would have been a disproportionate blast radius for a Low-priority
  finding -- explicitly did not do that.
  The "ServiceError usage" half of this finding's recommended approach is
  deliberately NOT lint-enforced: as documented in REUSABLE-UTILITIES.md, there
  isn't yet one canonical ServiceError class to enforce (2 competing
  definitions), and many services (e.g. the pure computation-engine dispatchers
  extracted in this same PR) legitimately never need a domain error type --
  enforcing it now would either be a no-op or actively wrong. Real prerequisite
  (consolidate the 2 ServiceError classes) is called out as a separate follow-up,
  not done here.

- [x] **[Medium] File & Folder Organization -- src/app/api/README.md.** Real
  navigation index for the 129 top-level route groups / ~880 files (previously
  zero README/index anywhere in that tree), grouped by domain (compliance,
  governance, audit, ERP, CRM, HR, Legal, Construction/PROJEXA, AI/Orchestra,
  Chat, Access/Platform, versioned v1 API). See "Findings that don't match
  current reality" above for why the ai-os/ subtree half of this same finding
  was NOT acted on.

- [x] **[Medium] Low Coupling / High Cohesion -- FK constraints, investigated,
  deliberately NOT added.** Confirmed the gap is real: 0 of 343 `orgId` columns
  in schema.ts carry a `.references()` today. Prototyped adding one
  (`complianceItems.orgId -> organisations.id`, the most obviously-correct
  starting point per the finding's own "starting with org/user scoping"
  wording) and ran `bun run db:generate` to see what applying it would take.
  Two independent findings changed the plan:
  1. This worker sandbox has no `DATABASE_URL`/live DB access, so there is no
     way to verify zero orphaned `org_id` values exist in production before a
     constraint could safely be applied (Postgres refuses to add a violated FK
     -- a safe failure, but only once run against real data).
  2. `bun run db:generate` itself is unsafe here: `drizzle/meta/_journal.json`
     is badly out of sync with the real `drizzle/*.sql` history (231 real
     migration files, but the meta snapshot chain only knew about migration
     0000) -- running it produced a 5,904-line "recreate almost the entire
     schema from scratch" file (`0001_huge_hercules.sql`), not a small
     targeted diff. Generated, inspected, and deleted it along with the stray
     snapshot/journal entry it created -- confirmed `git status` clean before
     moving on. `drizzle-kit generate` is not the mechanism this repo actually
     uses for schema changes; hand-written migration files are (see e.g.
     `drizzle/0224_crm_accounts_contacts_actor_columns_no_fk.sql`).
  3. That same file (`0224_crm_accounts_contacts_actor_columns_no_fk.sql`)
     surfaced the decisive reason to stop rather than ship even a schema-only,
     unapplied FK: this exact codebase has a **documented, repeated bug
     pattern** of adding an actor/reference FK constraint, then having to drop
     it because PROJEXA's server-to-server API-key calls resolve the acting
     "user" as the API key's own synthetic ID (`ctx.dbUser?.id ??
     ctx.apiKey!.id`), which is not a row in `compliance.users` -- 6 separate
     incidents on record (job_openings 0202, pms_issues 0204,
     erp_sales_invoices 0205, crm_leads 0206, crm_opportunities 0207, and
     crm_accounts/crm_contacts added in 0219 then reverted in 0224). My
     proposed FK was org-scoping, not actor-scoping, so it is not necessarily
     the same failure mode -- but confirming that would require auditing
     every write path that sets `orgId` (including PROJEXA API-key routes,
     webhooks, internal cron actors) for a synthetic/non-organisation value,
     which needs the same live-data access this sandbox does not have.
  Given a real, proven history of this exact change class breaking things
  when shipped without full write-path verification, shipping an unverified
  FK -- even schema-only and technically "unapplied" -- risks a future
  session applying it blindly and repeating the pattern a 7th time.
  **Conclusion: reverted the prototype, shipping nothing for this finding.**
  Real next step (not done here, needs Supabase MCP / live DB access):
  audit every `orgId`-setting write path for non-organisation values, then
  add the FK with a session that can verify against live data before
  applying.

## Remaining
- (none -- all 5 findings addressed: 2 real code changes shipped, 1 real doc
  index shipped, 1 real lint rule shipped, 1 real doc/nav fix shipped, and
  2 sub-findings + 1 full finding investigated and deliberately not acted on
  with reasoning recorded above, per this task's own "if the gap doesn't
  match what you find, say so" instruction.)
